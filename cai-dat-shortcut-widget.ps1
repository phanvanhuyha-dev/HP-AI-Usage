# Script tự động tạo Shortcut HP-AI-Usage Widget trên Desktop của Windows
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath "HP-AI-Usage Widget.lnk"
# Thu muc du an suy ra tu vi tri script, khong ghi cung duong dan may ai ca
$WorkingDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$IconPath = Join-Path $WorkingDir "public\favicon.ico"

# Tìm trình duyệt Edge hoặc Chrome để mở ở chế độ App riêng biệt (không có thanh URL, chạy như widget máy tính)
$edgePath1 = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$edgePath2 = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"

$targetApp = ""
if (Test-Path $edgePath1) {
    $targetApp = $edgePath1
} elseif (Test-Path $edgePath2) {
    $targetApp = $edgePath2
} elseif (Test-Path $chromePath) {
    $targetApp = $chromePath
}

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
if ($targetApp -ne "") {
    $Shortcut.TargetPath = $targetApp
    $Shortcut.Arguments = '--app="http://127.0.0.1:6736/widget" --window-size=390,680'
} else {
    $Shortcut.TargetPath = Join-Path $WorkingDir "start-widget.bat"
}

$Shortcut.WorkingDirectory = $WorkingDir
$Shortcut.IconLocation = "$IconPath, 0"
$Shortcut.Description = "HP-AI-Usage - Tiện Ích Thu Nhỏ (Desktop Widget)"
$Shortcut.Save()

Write-Host "Đã tạo thành công biểu tượng HP-AI-Usage Widget trên Desktop tại: $ShortcutPath"
