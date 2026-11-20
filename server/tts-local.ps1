# Bil Bakalim: local Turkish text-to-speech worker (Windows PowerShell 5.1, WinRT OneCore voices).
# Started once by server/show/tts.js and kept alive. This file is ASCII only on purpose, so that
# PowerShell 5.1 reads it the same way with or without a byte order mark.
#
# Protocol (UTF-8, one JSON object per line):
#   stdout, first line : {"ready":true,"voice":"Microsoft Tolga","lang":"tr-TR"}  or  {"ready":false,"err":"no-voice"}
#   stdin              : {"id":1,"file":"<absolute path to write>","ssml":"<speak ...>...</speak>"}
#   stdout             : {"id":1,"ok":true,"ms":1234,"n":<ssml length the worker received>,"bytes":<file size>}
#                        {"id":1,"ok":false,"err":"..."}
# "n" lets the caller prove that Turkish letters were not damaged on the way in. tts.js sends them as \uXXXX
# escapes; raw UTF-8 works as well. The worker writes only the file it is told to write and exits when stdin closes.
#
# Measured with Microsoft Tolga: <prosody rate> accepts "+10%", "1.1" and names, but is rounded to steps of about
# x1.11; <prosody pitch> accepts "+10%" and "+2st" ("1.2" is an error, "+40Hz" jumps to the ceiling).
param([string]$Voice = '', [string]$Lang = 'tr-TR')

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
# Raw byte streams with an explicit UTF-8 decoder: the console code page (857/1254 on a Turkish
# Windows) never touches the text, so "s-cedilla, soft g, dotless i" arrive exactly as sent.
$stdin = New-Object System.IO.StreamReader -ArgumentList ([Console]::OpenStandardInput()), $utf8
$stdout = New-Object System.IO.StreamWriter -ArgumentList ([Console]::OpenStandardOutput()), $utf8
$stdout.AutoFlush = $true

function Send-Line($obj) { $stdout.WriteLine((ConvertTo-Json -InputObject $obj -Compress)) }
function Get-Reason($err) {
  $e = $err.Exception
  while ($e -and $e.InnerException) { $e = $e.InnerException }
  if ($e) { return ($e.GetType().Name + ': ' + $e.Message) }
  return [string]$err
}
function Get-WavMs([byte[]]$b) {
  if ($b.Length -lt 20) { return 0 }
  $rate = 0; $o = 12
  while ($o + 8 -le $b.Length) {
    $id = [Text.Encoding]::ASCII.GetString($b, $o, 4)
    $size = [BitConverter]::ToUInt32($b, $o + 4)
    if ($id -eq 'fmt ' -and $o + 20 -le $b.Length) { $rate = [BitConverter]::ToUInt32($b, $o + 16) }
    if ($id -eq 'data') {
      $len = [Math]::Min([double]$size, [double]($b.Length - $o - 8))
      if ($rate -gt 0) { return [int][Math]::Round($len * 1000 / $rate) }
      return 0
    }
    $o += 8 + $size + ($size % 2)
  }
  return 0
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime] | Out-Null
  [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
  # WinRT IAsyncOperation<T> has no awaiter in PowerShell 5.1; AsTask<T>(IAsyncOperation<T>) is reached by reflection.
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
  $streamTask = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $loadTask = $asTask.MakeGenericMethod([uint32])

  $voices = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -eq $Lang })
  if ($voices.Count -eq 0) {
    $prefix = $Lang.Split('-')[0] + '-'
    $voices = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like ($prefix + '*') })
  }
  if ($voices.Count -eq 0) {
    Send-Line ([ordered]@{ ready = $false; err = 'no-voice'; lang = $Lang })
    exit 3
  }
  $picked = $voices[0]
  if ($Voice) {
    $wanted = @($voices | Where-Object { $_.DisplayName -like ('*' + $Voice + '*') })
    if ($wanted.Count -gt 0) { $picked = $wanted[0] }
  }
  $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  $synth.Voice = $picked
  # Less dead air after the last word (Windows 10 2004+); older builds simply keep the default.
  try { $synth.Options.AppendedSilence = [Windows.Media.SpeechSynthesis.SpeechAppendedSilence]::Min } catch {}
} catch {
  Send-Line ([ordered]@{ ready = $false; err = (Get-Reason $_) })
  exit 2
}

Send-Line ([ordered]@{ ready = $true; voice = $picked.DisplayName; lang = $picked.Language })

while ($true) {
  $line = $stdin.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  $id = $null
  $stream = $null; $reader = $null
  try {
    $req = ConvertFrom-Json -InputObject $line
    $id = $req.id
    $ssml = [string]$req.ssml
    $file = [string]$req.file
    if (-not $ssml -or -not $file) { throw 'bad-request' }
    $t = $streamTask.Invoke($null, @($synth.SynthesizeSsmlToStreamAsync($ssml)))
    $t.Wait()
    $stream = $t.Result
    $size = [int]$stream.Size
    $reader = New-Object Windows.Storage.Streams.DataReader -ArgumentList $stream.GetInputStreamAt(0)
    $l = $loadTask.Invoke($null, @($reader.LoadAsync([uint32]$size)))
    $l.Wait()
    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    [IO.File]::WriteAllBytes($file, $bytes)
    Send-Line ([ordered]@{ id = $id; ok = $true; ms = (Get-WavMs $bytes); n = $ssml.Length; bytes = $size })
  } catch {
    Send-Line ([ordered]@{ id = $id; ok = $false; err = (Get-Reason $_) })
  } finally {
    if ($reader) { try { $reader.Dispose() } catch {} }
    if ($stream) { try { $stream.Dispose() } catch {} }
  }
}
