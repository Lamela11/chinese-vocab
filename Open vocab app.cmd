@echo off
rem Opens the vocab app in your browser. Keep this window open while you study; close it to stop.
title Vocab app
cd /d "%~dp0"
set "PY=%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
if not exist "%PY%" set "PY=py"
"%PY%" tools\serve.py
if errorlevel 1 pause
