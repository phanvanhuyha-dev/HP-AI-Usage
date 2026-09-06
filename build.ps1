# Biên dịch thanh tác vụ HP-AI-Usage từ AppTaskbar.cs thành HP-AI-Usage.exe
#
# Chỉ biên dịch AppTaskbar.cs, tệp C# duy nhất của thanh tác vụ.
#
# Cách dùng:
#   .\build.ps1           biên dịch, dừng lại nếu thanh tác vụ đang chạy
#   .\build.ps1 -Force    tự đóng thanh tác vụ đang chạy rồi biên dịch

param(
    [switch]$Force
)

$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $root

$src     = Join-Path $root 'AppTaskbar.cs'
$icon    = Join-Path $root 'public\favicon.ico'
$out     = Join-Path $root 'HP-AI-Usage.exe'
$tmpOut  = Join-Path $root 'HP-AI-Usage.build.exe'
$backup  = "$out.bak"

function Write-Step($text)  { Write-Host "  $text" }
function Write-Fail($text)  { Write-Host "  [LỖI] $text" -ForegroundColor Red }
function Write-Halt($text)  { Write-Host "  [DỪNG] $text" -ForegroundColor Yellow }

Write-Host ''
Write-Host '============================================================'
Write-Host '  Biên dịch thanh tác vụ HP-AI-Usage'
Write-Host '============================================================'
Write-Host ''

# 1. Tìm trình biên dịch C# của .NET Framework
$fx  = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $fx 'csc.exe'
if (-not (Test-Path $csc)) {
    $fx  = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319'
    $csc = Join-Path $fx 'csc.exe'
}
if (-not (Test-Path $csc)) {
    Write-Fail 'Không tìm thấy trình biên dịch C# csc.exe của .NET Framework 4.x.'
    Write-Step 'Máy cần có .NET Framework 4.x, vốn kèm sẵn trong Windows 10 và 11.'
    exit 1
}

if (-not (Test-Path $src)) {
    Write-Fail "Không tìm thấy mã nguồn: $src"
    exit 1
}

# 2. Tệp thực thi đang chạy sẽ bị khoá, không thể ghi đè
$running = Get-Process -Name 'HP-AI-Usage' -ErrorAction SilentlyContinue
if ($running) {
    if ($Force) {
        Write-Step 'Đang đóng thanh tác vụ đang chạy...'
        $running | Stop-Process -Force
        Start-Sleep -Milliseconds 800
    } else {
        Write-Halt 'Thanh tác vụ đang chạy nên tệp HP-AI-Usage.exe bị khoá.'
        Write-Step 'Nhấp chuột phải vào thanh, chọn "Thoát thanh tác vụ", rồi chạy lại.'
        Write-Step 'Hoặc chạy lệnh:  build.bat /force'
        exit 1
    }
}

# 3. Bộ tham chiếu tối thiểu cho WPF và JavaScriptSerializer
$references = @(
    (Join-Path $fx 'System.dll'),
    (Join-Path $fx 'System.Core.dll'),
    (Join-Path $fx 'System.Xaml.dll'),
    (Join-Path $fx 'System.Web.Extensions.dll'),
    (Join-Path $fx 'WPF\PresentationFramework.dll'),
    (Join-Path $fx 'WPF\PresentationCore.dll'),
    (Join-Path $fx 'WPF\WindowsBase.dll')
)
$missing = $references | Where-Object { -not (Test-Path $_) }
if ($missing) {
    Write-Fail 'Thiếu các tệp tham chiếu sau:'
    $missing | ForEach-Object { Write-Step $_ }
    exit 1
}

# 4. Biên dịch ra tệp tạm, chỉ thay thế bản cũ khi thành công
if (Test-Path $tmpOut) { Remove-Item $tmpOut -Force }

$cscArgs = @(
    '/nologo'
    '/target:winexe'
    '/platform:anycpu'
    '/optimize+'
    "/out:$tmpOut"
)
if (Test-Path $icon) { $cscArgs += "/win32icon:$icon" }
$cscArgs += ($references | ForEach-Object { "/reference:$_" })
$cscArgs += $src

Write-Step 'Đang biên dịch AppTaskbar.cs ...'
& $csc $cscArgs
$cscExit = $LASTEXITCODE

if ($cscExit -ne 0 -or -not (Test-Path $tmpOut)) {
    Write-Host ''
    Write-Fail "Biên dịch thất bại, mã lỗi $cscExit. Tệp HP-AI-Usage.exe hiện có được giữ nguyên."
    if (Test-Path $tmpOut) { Remove-Item $tmpOut -Force }
    exit 1
}

# 5. Sao lưu rồi thay thế
if (Test-Path $out) {
    Copy-Item $out $backup -Force
    Write-Step 'Đã sao lưu bản cũ thành HP-AI-Usage.exe.bak'
}
Move-Item $tmpOut $out -Force

$size = (Get-Item $out).Length
Write-Host ''
Write-Host ("  Hoàn tất: HP-AI-Usage.exe - {0:N0} byte" -f $size) -ForegroundColor Green
Write-Step 'Chạy thanh tác vụ bằng: start-taskbar-widget.bat'
Write-Host '============================================================'
Write-Host ''
exit 0
