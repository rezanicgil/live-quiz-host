# Bil Bakalim: Claude API anahtarini bu bilgisayara, yalniz senin Windows kullanici hesabina kaydeder.
# Anahtar bir dosyaya, koda ya da Git'e yazilmaz: Windows'un kullanici ortam degiskeni ANTHROPIC_API_KEY olarak saklanir,
# Bil Bakalim sunucusu acilirken oradan okur. Yazdigin ekranda gorunmez.
$ErrorActionPreference = 'Stop'
function Show-End([string]$k) { if ($k.Length -ge 4) { $k.Substring($k.Length - 4) } else { '****' } }
$cur = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY', 'User')
Write-Host ''
Write-Host 'Bil Bakalim - Claude API anahtari (Tarcin''in serbest sohbeti icin)' -ForegroundColor Yellow
if ($cur) { Write-Host ('Kayitli bir anahtar var (sonu ...' + (Show-End $cur) + ').') } else { Write-Host 'Kayitli anahtar yok.' }
Write-Host '1) claude.ai > Ayarlar > Faturalandirma: plan kredini bir Console hesabina bagla.'
Write-Host '2) platform.claude.com > API Keys: yeni bir anahtar olustur ve kopyala.'
Write-Host ''
$secure = Read-Host 'Anahtari yapistir ve Enter''a bas (gorunmez; silmek icin "sil", vazgecmek icin bos birak)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if (-not $key) { Write-Host 'Degisiklik yapilmadi.'; return }
if ($key -eq 'sil') { [Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY', $null, 'User'); Write-Host 'Anahtar silindi.' -ForegroundColor Green; return }
if ($key -match '\s') { Write-Host 'Anahtarda bosluk var; dogru kopyaladigindan emin ol. Kaydedilmedi.' -ForegroundColor Red; return }
[Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY', $key, 'User')
try { if ((Get-Clipboard -Raw).Trim() -eq $key) { Set-Clipboard -Value ' '; Write-Host 'Anahtar panodan silindi.' } } catch {}
Write-Host ('Kaydedildi (sonu ...' + (Show-End $key) + ').') -ForegroundColor Green
Write-Host 'Bil Bakalim aciksa kapatip yeniden ac; panelde "Serbest sohbet: hazir" yazar.'
