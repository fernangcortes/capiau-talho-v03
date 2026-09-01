@echo off
chcp 65001 > nul
echo =========================================================
echo    Sincronizador da Wiki Oficial do CapIAu-Talho
echo =========================================================
python "%~dp0deploy_wiki.py"
pause
