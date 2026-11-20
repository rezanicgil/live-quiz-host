@echo off
chcp 65001 >nul
title Bil Bakalim
cd /d "%~dp0"
if not exist node_modules (
  echo Ilk kurulum yapiliyor, bir iki dakika surebilir...
  call npm install
)
node server/server.js --open
pause
