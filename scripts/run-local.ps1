# Script para iniciar o CapIAu-Talho localmente no Windows com ambiente virtual dedicado
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

Set-Location $ProjectRoot

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "🎬 CapIAu-Talho — Inicializando Localmente (.venv)" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

$VenvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    Write-Host "[INFO] Ambiente .venv não encontrado. Criando ambiente virtual Python 3.12..." -ForegroundColor Yellow
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        uv venv .venv --python 3.12
        uv pip install -r requirements.txt
    } else {
        py -3.12 -m venv .venv
        & "$VenvPython" -m pip install --upgrade pip
        & "$VenvPython" -m pip install -r requirements.txt
    }
}

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Write-Host "[AVISO] Arquivo .env não encontrado. Criando a partir de .env.example..." -ForegroundColor Yellow
        Copy-Item ".env.example" ".env"
    }
}

Write-Host "`nIniciando servidor Uvicorn em http://localhost:8000 ..." -ForegroundColor Green
& "$VenvPython" -m uvicorn src.api.server:app --host 127.0.0.1 --port 8000 --reload
