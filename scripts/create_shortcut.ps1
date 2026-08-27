# CapIAu-Talho — Gerador de Atalhos para Windows
$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$ProjectRoot = Split-Path -Parent $ScriptDir
$VbsPath = Join-Path $ScriptDir "launch_capiau.vbs"
$IconPath = Join-Path $ProjectRoot "src\ui\favicon.ico"
$DesktopPath = [Environment]::GetFolderPath("Desktop")

# Garante que o launch_capiau.vbs existe e esta em ASCII (sem UTF-8 BOM)
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
strScriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
strProjectRoot = CreateObject("Scripting.FileSystemObject").GetParentFolderName(strScriptDir)
strPS1 = strScriptDir & "\launch_capiau.ps1"
WshShell.CurrentDirectory = strProjectRoot
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & strPS1 & """", 0, False
"@
[System.IO.File]::WriteAllText($VbsPath, $vbsContent, [System.Text.Encoding]::ASCII)

$WshShell = New-Object -ComObject WScript.Shell

# 1. Cria atalho na pasta raiz do projeto
$ProjectShortcut = $WshShell.CreateShortcut((Join-Path $ProjectRoot "CapIAu.lnk"))
$ProjectShortcut.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$ProjectShortcut.Arguments = "`"$VbsPath`""
$ProjectShortcut.WorkingDirectory = $ProjectRoot
$ProjectShortcut.IconLocation = "$IconPath, 0"
$ProjectShortcut.Description = "CapIAu - Motor de Inteligência Cinematográfica"
$ProjectShortcut.Save()

# 2. Cria atalho na Area de Trabalho
$DesktopShortcut = $WshShell.CreateShortcut((Join-Path $DesktopPath "CapIAu.lnk"))
$DesktopShortcut.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$DesktopShortcut.Arguments = "`"$VbsPath`""
$DesktopShortcut.WorkingDirectory = $ProjectRoot
$DesktopShortcut.IconLocation = "$IconPath, 0"
$DesktopShortcut.Description = "CapIAu - Motor de Inteligência Cinematográfica"
$DesktopShortcut.Save()

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "🎬 CapIAu-Talho — Atalhos Configurados com Sucesso!" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "📍 Atalho na Area de Trabalho: $DesktopPath\CapIAu.lnk" -ForegroundColor Green
Write-Host "📍 Atalho na Pasta do Projeto: $ProjectRoot\CapIAu.lnk" -ForegroundColor Green
Write-Host "`n📌 Para fixar na Barra de Tarefas (Taskbar):" -ForegroundColor Yellow
Write-Host "   1. Va ate sua Area de Trabalho (Desktop)." -ForegroundColor White
Write-Host "   2. Clique com o botao direito no icone 'CapIAu'." -ForegroundColor White
Write-Host "   3. Selecione 'Fixar na barra de tarefas' (Pin to taskbar)." -ForegroundColor White
Write-Host "========================================================`n" -ForegroundColor Cyan
