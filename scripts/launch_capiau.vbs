Set WshShell = CreateObject("WScript.Shell")
strScriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
strProjectRoot = CreateObject("Scripting.FileSystemObject").GetParentFolderName(strScriptDir)
strPS1 = strScriptDir & "\launch_capiau.ps1"
WshShell.CurrentDirectory = strProjectRoot
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & strPS1 & """", 0, False