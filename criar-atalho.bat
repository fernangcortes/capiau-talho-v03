@echo off
chcp 65001 >nul
title CapIAu - Criando Atalhos...
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\create_shortcut.ps1"
pause
