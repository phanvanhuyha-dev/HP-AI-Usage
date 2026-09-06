# Script khởi chạy HP-AI-Usage Desktop Widget và ghim trên cùng (Always-on-top)
if ($env:HP_WIDGET_BACKGROUND -eq "1") {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ConsoleWindowHelper {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
    [ConsoleWindowHelper]::ShowWindow([ConsoleWindowHelper]::GetConsoleWindow(), 0) | Out-Null
}

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Helper {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;

    public static bool PinMatchingWindow(int x, int y, int cx, int cy) {
        bool pinned = false;
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            StringBuilder sb = new StringBuilder(512);
            int len = GetWindowText(hWnd, sb, 512);
            if (len <= 0) return true;
            string title = sb.ToString();
            bool isHpWidget = title.Equals("HP-AI-Usage", StringComparison.OrdinalIgnoreCase) ||
                title.IndexOf("HP-AI-Usage", StringComparison.OrdinalIgnoreCase) >= 0 &&
                (title.IndexOf("Widget", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 title.IndexOf("Ti?n Ích", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 title.IndexOf("Tiện Ích", StringComparison.OrdinalIgnoreCase) >= 0);
            if (isHpWidget) {
                SetWindowPos(hWnd, HWND_TOPMOST, x, y, cx, cy, SWP_SHOWWINDOW);
                pinned = true;
            }
            return true;
        }, IntPtr.Zero);
        return pinned;
    }
}
"@

# Thu muc du an suy ra tu vi tri script, khong ghi cung duong dan may ai ca
$WorkingDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $WorkingDir

# 1. Kiểm tra máy chủ cục bộ 6736 đã chạy chưa, nếu chưa thì tự động khởi động
$serverRunning = $false
try {
    $res = Invoke-RestMethod -Uri "http://127.0.0.1:6736/api/usage" -TimeoutSec 2 -ErrorAction SilentlyContinue
    if ($res) { $serverRunning = $true }
} catch {
    $serverRunning = $false
}

if (-not $serverRunning) {
    Write-Host "Đang khởi động máy chủ nền HP-AI-Usage..."
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $WorkingDir -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

# 2. Tính toán kích thước và vị trí thanh bên (sidetab mép phải màn hình)
Add-Type -AssemblyName System.Windows.Forms
$primaryScreen = [System.Windows.Forms.Screen]::PrimaryScreen
$screenWidth = $primaryScreen.WorkingArea.Width
$screenHeight = $primaryScreen.WorkingArea.Height

$widgetWidth = 460
$widgetHeight = [Math]::Min(220, $screenHeight - 80)
$widgetLeft = [Math]::Max(0, $screenWidth - $widgetWidth - 15)
$widgetTop = 40

# 3. Tìm trình duyệt Microsoft Edge hoặc Google Chrome
$edgePath1 = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$edgePath2 = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"

$browserPath = ""
if (Test-Path $edgePath1) { $browserPath = $edgePath1 }
elseif (Test-Path $edgePath2) { $browserPath = $edgePath2 }
elseif (Test-Path $chromePath) { $browserPath = $chromePath }

$widgetUrl = "http://127.0.0.1:6736/widget"
$appArgs = "--app=`"$widgetUrl`" --window-size=$widgetWidth,$widgetHeight --window-position=$widgetLeft,$widgetTop"

if ($browserPath -ne "") {
    Write-Host "Đang mở tiện ích thu nhỏ (Widget) với trình duyệt: $browserPath"
    $proc = Start-Process -FilePath $browserPath -ArgumentList $appArgs -PassThru

    # Chờ cửa sổ khởi tạo rồi xác nhận đã hiện trước khi báo thành công.
    Start-Sleep -Milliseconds 750
    $pinned = $false
    if ($proc) {
        $proc.Refresh()
        $mainWindowHandle = $proc.MainWindowHandle
        if ($mainWindowHandle -and $mainWindowHandle -ne [IntPtr]::Zero) {
            $pinned = [Win32Helper]::SetWindowPos([IntPtr]$mainWindowHandle, [Win32Helper]::HWND_TOPMOST, $widgetLeft, $widgetTop, $widgetWidth, $widgetHeight, [Win32Helper]::SWP_SHOWWINDOW)
        }
    }
    for ($attempt = 0; -not $pinned -and $attempt -lt 12; $attempt++) {
        # Quét theo tiêu đề nếu Edge tái sử dụng một tiến trình có sẵn.
        $pinned = [Win32Helper]::PinMatchingWindow($widgetLeft, $widgetTop, $widgetWidth, $widgetHeight)
        if (-not $pinned) { Start-Sleep -Milliseconds 250 }
    }
    if (-not $pinned) { throw "Không xác nhận được cửa sổ HP-AI-Usage Widget." }
} else {
    Start-Process "http://127.0.0.1:6736/widget"
}

Write-Host "Tiện ích HP-AI-Usage Widget đã sẵn sàng."
