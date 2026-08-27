# CapIAu-Talho — Launcher Inteligente
# Detecta se a porta 8000 ja esta ativa, se o Docker esta disponivel ou inicia localmente via Python.

$ErrorActionPreference = "SilentlyContinue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

function Test-CapiauPort {
    param([int]$Port = 8000, [int]$TimeoutMs = 800)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect("127.0.0.1", $Port, $null, $null)
        $success = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($success -and $tcp.Connected) {
            $tcp.EndConnect($iar)
            $tcp.Close()
            return $true
        }
        $tcp.Close()
        return $false
    } catch {
        return $false
    }
}

function Open-CapiauBrowser {
    Start-Process "http://localhost:8000"
}

# 1. Se a porta 8000 ja estiver ativa e respondendo, apenas abre o navegador
if (Test-CapiauPort -Port 8000 -TimeoutMs 1000) {
    Open-CapiauBrowser
    exit 0
}

# 2. Testa se o daemon do Docker esta rodando e responsivo
$dockerAvailable = $false
try {
    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = "docker"
    $pinfo.Arguments = "info --format '{{.ServerVersion}}'"
    $pinfo.RedirectStandardOutput = $true
    $pinfo.RedirectStandardError = $true
    $pinfo.UseShellExecute = $false
    $pinfo.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($pinfo)
    if ($p.WaitForExit(2500) -and $p.ExitCode -eq 0) {
        $dockerAvailable = $true
    } else {
        if (-not $p.HasExited) { $p.Kill() }
    }
} catch {
    $dockerAvailable = $false
}

if ($dockerAvailable) {
    # Inicia os containers em background via docker compose
    docker compose up -d

    # Aguarda o servidor subir na porta 8000 (ate 20 segundos)
    $maxTries = 20
    for ($i = 0; $i -lt $maxTries; $i++) {
        Start-Sleep -Milliseconds 1000
        if (Test-CapiauPort -Port 8000 -TimeoutMs 500) {
            Open-CapiauBrowser
            exit 0
        }
    }
    # Caso atinja o timeout, tenta abrir de qualquer forma
    Open-CapiauBrowser
    exit 0
}

# 3. Docker nao esta aberto / nao esta rodando -> Inicia servidor localmente via Python
$pythonExe = "python"
if (Test-Path "$ProjectRoot\.venv\Scripts\python.exe") {
    $pythonExe = "$ProjectRoot\.venv\Scripts\python.exe"
}

# Inicia o Uvicorn em uma janela de console do PowerShell dedicada
$psCmd = "cd '$ProjectRoot'; `$host.UI.RawUI.WindowTitle = 'CapIAu Server (Local Python)'; Write-Host '🎬 CapIAu-Talho rodando localmente via Python na porta 8000...' -ForegroundColor Cyan; & '$pythonExe' -m uvicorn src.api.server:app --host 127.0.0.1 --port 8000 --reload"

Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $psCmd -WorkingDirectory $ProjectRoot

# Aguarda o servidor local subir na porta 8000 (ate 15 segundos)
$maxTries = 15
for ($i = 0; $i -lt $maxTries; $i++) {
    Start-Sleep -Milliseconds 1000
    if (Test-CapiauPort -Port 8000 -TimeoutMs 500) {
        Open-CapiauBrowser
        exit 0
    }
}

# Abre o navegador
Open-CapiauBrowser
exit 0
