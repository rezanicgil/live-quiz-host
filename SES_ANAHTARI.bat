@echo off
title Bil Bakalim - Azure ses anahtari
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ses-anahtar.ps1"
echo.
pause
