# Script tạo Shortcut HP-AI-Usage Taskbar trên Desktop
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath "HP-AI-Usage Taskbar.lnk"
# Thu muc du an suy ra tu vi tri script, khong ghi cung duong dan may ai ca
$WorkingDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$ExePath = Join-Path $WorkingDir "HP-AI-Usage.exe"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $ExePath
$Shortcut.Arguments = ""
$Shortcut.WorkingDirectory = $WorkingDir
$Shortcut.IconLocation = "$ExePath, 0"
$Shortcut.Description = "HP-AI-Usage - Thanh Ngang Tiện Ích Trên Taskbar Windows 11"
$Shortcut.Save()

Write-Host "Đã tạo thành công lối tắt 'HP-AI-Usage Taskbar' trên Desktop tại: $ShortcutPath"
