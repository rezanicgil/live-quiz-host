# Bil Bakalım: Azure Speech (doğal Türkçe ses) anahtarını ve bölgesini bu bilgisayara, yalnız senin Windows kullanıcı hesabına kaydeder.
# Anahtar bir dosyaya, koda ya da Git'e yazılmaz: Windows'un kullanıcı ortam değişkenleri AZURE_SPEECH_KEY ve AZURE_SPEECH_REGION
# olarak saklanır, Bil Bakalım sunucusu açılırken oradan okur. Yazdığın anahtar ekranda görünmez; bu betik onu hiçbir yerde göstermez.
# -Scope Process yalnız deneme içindir: değerler bu pencereyle birlikte kaybolur, kalıcı hiçbir şey yazılmaz.
param([ValidateSet('User', 'Process')][string]$Scope = 'User')
$ErrorActionPreference = 'Stop'
$curKey = [Environment]::GetEnvironmentVariable('AZURE_SPEECH_KEY', $Scope)
$curRegion = [Environment]::GetEnvironmentVariable('AZURE_SPEECH_REGION', $Scope)
Write-Host ''
Write-Host 'Bil Bakalim - Azure ses anahtari' -ForegroundColor Yellow
if ($curKey -and $curRegion) { Write-Host ('Kayitli bir anahtar var (bolge: ' + $curRegion + ').') }
elseif ($curKey) { Write-Host 'Kayitli bir anahtar var ama bolge eksik; bolge olmadan dogal ses calismaz.' }
else { Write-Host 'Kayitli anahtar yok; Bil Bakalim Windows''un yerlesik Turkce sesiyle konusur.' }
Write-Host 'portal.azure.com > Speech kaynagin > "Keys and Endpoint" bolumunden KEY 1 degerini kopyala.'
Write-Host 'Ayni sayfadaki "Location/Region" degeri (ornek: westeurope) birazdan sorulacak.'
Write-Host ''
$secure = Read-Host 'Anahtari yapistir ve Enter''a bas (gorunmez; silmek icin "sil", vazgecmek icin bos birak)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if (-not $key) { Write-Host 'Degisiklik yapilmadi.'; return }
if ($key -eq 'sil') {
  [Environment]::SetEnvironmentVariable('AZURE_SPEECH_KEY', $null, $Scope)
  [Environment]::SetEnvironmentVariable('AZURE_SPEECH_REGION', $null, $Scope)
  Write-Host 'Anahtar ve bolge silindi; Bil Bakalim yeniden acildiginda yerlesik sesle konusur.' -ForegroundColor Green
  return
}
if ($key -match '\s') { Write-Host 'Anahtarda bosluk var; dogru kopyaladigindan emin ol. Kaydedilmedi.' -ForegroundColor Red; return }
if ($key -match '^https?:') { Write-Host 'Bu bir adres (Endpoint), anahtar degil; KEY 1 degerini yapistir. Kaydedilmedi.' -ForegroundColor Red; return }
if ($key.Length -lt 20) { Write-Host 'Bu deger bir anahtar icin cok kisa; KEY 1 degerinin tamamini kopyala. Kaydedilmedi.' -ForegroundColor Red; return }
$ask = 'Bolge (Location/Region; ornek: westeurope)'
if ($curRegion) { $ask += ' [Enter = ' + $curRegion + ']' }
$region = ([string](Read-Host $ask)).Trim().ToLowerInvariant() -replace '\s', ''
if (-not $region) { $region = $curRegion }
if (-not $region) { Write-Host 'Bolge olmadan anahtar ise yaramaz. Kaydedilmedi.' -ForegroundColor Red; return }
if ($region -notmatch '^[a-z0-9-]+$') { Write-Host 'Bolge yalniz harf ve rakamdan olusur (ornek: westeurope). Kaydedilmedi.' -ForegroundColor Red; return }
[Environment]::SetEnvironmentVariable('AZURE_SPEECH_KEY', $key, $Scope)
[Environment]::SetEnvironmentVariable('AZURE_SPEECH_REGION', $region, $Scope)
try { if ((Get-Clipboard -Raw).Trim() -eq $key) { Set-Clipboard -Value ' '; Write-Host 'Anahtar panodan silindi.' } } catch {}
Write-Host ('Kaydedildi (bolge: ' + $region + '). Anahtar hicbir yerde gosterilmez.') -ForegroundColor Green
Write-Host 'Bil Bakalim aciksa kapatip yeniden ac; panelin ses bolumunde saglayici "azure" gorunur.'
Write-Host 'Yerlesik sese donmek icin bu pencereyi yeniden acip "sil" yaz.'
