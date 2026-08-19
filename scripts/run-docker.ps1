# Script para iniciar o CapIAu-Talho no Docker com hot-reload ativo
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

Set-Location $ProjectRoot

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "🎬 CapIAu-Talho — Inicializando via Docker" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Write-Host "[AVISO] Arquivo .env não encontrado. Criando a partir de .env.example..." -ForegroundColor Yellow
        Copy-Item ".env.example" ".env"
        Write-Host "[INFO] Configure suas chaves em .env (OPENROUTER_API_KEY, ASSEMBLYAI_API_KEY)" -ForegroundColor Yellow
    }
}

Write-Host "`nConstruindo e iniciando container Docker..." -ForegroundColor Green
docker compose up --build
