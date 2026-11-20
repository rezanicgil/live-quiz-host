@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "PYTHONUTF8=1"
where py.exe >nul 2>&1
if errorlevel 1 goto python
py -3 "server\tts-pocket.py" --install
goto result
:python
python "server\tts-pocket.py" --install
:result
if errorlevel 1 goto failed
echo Model hazir. Oyunu yeniden actiginda Pocket otomatik secilir.
if not "%~1"=="--from-update" pause
exit /b 0
:failed
echo Kurulum tamamlanamadi. Internet baglantisini ve Python 3.10 veya ustunu kontrol et.
if not "%~1"=="--from-update" pause
exit /b 1
