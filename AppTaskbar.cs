using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Shapes = System.Windows.Shapes;

namespace HPAIUsage {
    public class Program {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr", SetLastError = true)]
        private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

        [DllImport("user32.dll", EntryPoint = "SetWindowLong", SetLastError = true)]
        private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

        public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong) {
            if (IntPtr.Size == 8)
                return SetWindowLongPtr64(hWnd, nIndex, dwNewLong);
            else
                return new IntPtr(SetWindowLong32(hWnd, nIndex, dwNewLong.ToInt32()));
        }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern IntPtr LoadImage(IntPtr hinst, string lpszName, uint uType, int cxDesired, int cyDesired, uint fuLoad);

        [DllImport("shell32.dll", SetLastError = true)]
        public static extern void SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string AppID);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern uint RegisterWindowMessage(string lpString);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        // Vị trí con trỏ (pixel màn hình) lúc mở menu, để biết khi nào con trỏ rời xa
        private static POINT menuOpenPos;

        // Chiều cao thanh tác vụ Windows, dùng để nhấc menu lên cho khỏi bị che
        private static double taskbarHeight = 48;

        // Explorer khởi động lại sẽ phát thông điệp này, khi đó cửa sổ cha cũ đã
        // chết nên phải gắn lại toàn bộ kiểu cửa sổ và hook.
        private static uint WM_TASKBARCREATED = 0;

        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        public const uint SWP_NOMOVE = 0x0002;
        public const uint SWP_NOSIZE = 0x0001;
        public const uint SWP_NOACTIVATE = 0x0010;
        public const uint SWP_SHOWWINDOW = 0x0040;
        public const uint SWP_ASYNCWINDOWPOS = 0x4000;

        public const int GWL_EXSTYLE = -20;
        public const int GWL_HWNDPARENT = -8;

        public const int WS_EX_APPWINDOW = 0x00040000;
        public const int WS_EX_TOOLWINDOW = 0x00000080;
        public const int WS_EX_NOACTIVATE = 0x08000000;
        public const int WS_EX_TOPMOST = 0x00000008;

        public const uint WM_SETICON = 0x0080;
        public const uint IMAGE_ICON = 1;
        public const uint LR_LOADFROMFILE = 0x0010;

        private const int WM_WINDOWPOSCHANGING = 0x0046;

        [StructLayout(LayoutKind.Sequential)]
        public struct WINDOWPOS {
            public IntPtr hwnd;
            public IntPtr hwndInsertAfter;
            public int x;
            public int y;
            public int cx;
            public int cy;
            public uint flags;
        }

        public static IntPtr WindowHandle = IntPtr.Zero;

        private static Mutex appMutex;
        private static Window window;
        private static string workingDir;
        private static string posFile;
        private static string iconPath;
        private static string serverUrl = "http://127.0.0.1:6736";

        private static int defaultLeft = 2;
        private static int defaultTop = 0;
        private static bool currentShowInTaskbar = true;

        // UI Controls
        private static Border pillClaude;
        private static Shapes.Ellipse claudeDot;
        private static TextBlock claudePct;
        private static TextBlock claudeTime;

        private static Border pillChatGPT;
        private static Shapes.Ellipse chatGPTDot;
        private static TextBlock chatGPTPct;
        private static TextBlock chatGPTTime;

        private static Border pillAntiGravity;
        private static Shapes.Ellipse antiGravityDot;
        private static TextBlock antiGravityPct;
        private static TextBlock antiGravityTime;

        private static Border pillGemini;
        private static Shapes.Ellipse geminiDot;
        private static TextBlock geminiPct;
        private static TextBlock geminiTime;

        private static Border btnExpand;
        private static MenuItem menuDash;
        private static MenuItem menuRefresh;
        private static MenuItem menuResetPos;
        private static MenuItem menuStartup;
        private static MenuItem menuToggleTaskbar;
        private static MenuItem menuExit;

        // Tên giá trị trong khóa Run của registry để bật khởi động cùng Windows
        private const string STARTUP_REG_PATH = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string STARTUP_REG_NAME = "HP-AI-Usage";

        // Ngôn ngữ giao diện, đọc từ tùy chọn người dùng đã lưu ở bảng điều khiển.
        // Mặc định tiếng Anh, khớp với mặc định của web.
        private static string uiLang = "en";
        private static bool IsVi() { return uiLang == "vi"; }

        private static DispatcherTimer dataTimer;
        private static DispatcherTimer topmostWatchdog;
        private static DispatcherTimer countdownTimer;
        private static DispatcherTimer menuCloseTimer;

        // Trạng thái kéo thả: chỉ bắt đầu kéo khi chuột đã đi quá ngưỡng,
        // để một cú nhấp bình thường không bị nuốt mất.
        private static Point dragStart;
        private static bool dragArmed = false;
        private const double DRAG_THRESHOLD = 4.0;

        [STAThread]
        public static void Main(string[] args) {
            bool isNew = false;
            appMutex = new Mutex(true, "Global\\HPAIUsage_Taskbar_WPF_Mutex", out isNew);
            if (!isNew) {
                // Thoát im lặng khiến người dùng bấm lối tắt lần hai tưởng là hỏng.
                // Đưa cửa sổ đang chạy ra trước mặt thay vì không phản hồi gì.
                IntPtr existing = FindWindow(null, "HP-AI-Usage");
                if (existing != IntPtr.Zero) {
                    ShowWindow(existing, 9); // SW_RESTORE
                    SetForegroundWindow(existing);
                }
                return;
            }

            try {
                SetCurrentProcessExplicitAppUserModelID("HP.AI.Usage.Taskbar");
            } catch {}

            // Thư mục dự án luôn là nơi đặt tệp thực thi. Không được ghi cứng
            // đường dẫn của một máy cụ thể vào mã nguồn.
            workingDir = AppDomain.CurrentDomain.BaseDirectory;
            if (string.IsNullOrEmpty(workingDir)) {
                workingDir = Environment.CurrentDirectory;
            }
            posFile = Path.Combine(workingDir, "taskbar-pos.json");
            iconPath = Path.Combine(workingDir, "public", "favicon.ico");

            AppDomain.CurrentDomain.UnhandledException += (s, e) => {
                LogCrash("AppDomain", e.ExceptionObject);
            };

            WM_TASKBARCREATED = RegisterWindowMessage("TaskbarCreated");

            EnsureBackend();

            // Screen resolution calculations
            Rect workArea = SystemParameters.WorkArea;
            double screenH = SystemParameters.PrimaryScreenHeight;
            double taskbarH = Math.Max(40, screenH - workArea.Height);
            taskbarHeight = taskbarH;
            int barWidth = 300;
            int barHeight = 36;
            defaultLeft = 2;
            defaultTop = (int)workArea.Height + (int)((taskbarH - barHeight) / 2);

            int initLeft = defaultLeft;
            int initTop = defaultTop;
            currentShowInTaskbar = true;

            if (File.Exists(posFile)) {
                try {
                    string json = File.ReadAllText(posFile, Encoding.UTF8);
                    var js = new JavaScriptSerializer();
                    var dict = js.Deserialize<Dictionary<string, object>>(json);
                    if (dict != null) {
                        if (dict.ContainsKey("Left")) initLeft = Convert.ToInt32(dict["Left"]);
                        if (dict.ContainsKey("Top")) initTop = Convert.ToInt32(dict["Top"]);
                        if (dict.ContainsKey("ShowInTaskbar")) currentShowInTaskbar = Convert.ToBoolean(dict["ShowInTaskbar"]);
                    }
                } catch {}
            }

            // Kẹp vị trí vào vùng màn hình đang có thật. Bản PowerShell cũ có phần
            // kiểm tra này, bản C# đầu tiên bỏ mất: chỉ cần tháo màn hình phụ hoặc
            // đổi độ phân giải là thanh nằm ngoài vùng nhìn thấy, mà muốn mở menu
            // "Đặt lại vị trí" thì lại phải nhấp chuột phải vào chính cái thanh đó.
            double vsLeft = SystemParameters.VirtualScreenLeft;
            double vsTop = SystemParameters.VirtualScreenTop;
            double vsRight = vsLeft + SystemParameters.VirtualScreenWidth;
            double vsBottom = vsTop + SystemParameters.VirtualScreenHeight;

            // Phải còn nhìn thấy ít nhất một mẩu 80x20 của thanh
            bool offScreen = initLeft > vsRight - 80
                || initLeft + barWidth < vsLeft + 80
                || initTop > vsBottom - 20
                || initTop + barHeight < vsTop + 20;

            if (offScreen) {
                initLeft = defaultLeft;
                initTop = defaultTop;
            }

            string showInTbStr = currentShowInTaskbar ? "True" : "False";

            string xaml = string.Format(@"
<Window xmlns=""http://schemas.microsoft.com/winfx/2006/xaml/presentation""
        xmlns:x=""http://schemas.microsoft.com/winfx/2006/xaml""
        Title=""HP-AI-Usage""
        Height=""{0}"" Width=""{1}""
        WindowStyle=""None""
        AllowsTransparency=""True""
        Background=""Transparent""
        Topmost=""True""
        ShowInTaskbar=""{2}""
        WindowStartupLocation=""Manual""
        Icon=""{3}""
        Left=""{4}"" Top=""{5}"">
    <Window.Resources>
        <!-- Modern Dark ContextMenu Style (Khong co icon gutter mau trang) -->
        <Style TargetType=""{{x:Type ContextMenu}}"">
            <Setter Property=""Background"" Value=""#FF0F172A"" />
            <Setter Property=""BorderBrush"" Value=""#33FFFFFF"" />
            <Setter Property=""BorderThickness"" Value=""1"" />
            <Setter Property=""Padding"" Value=""4"" />
            <Setter Property=""HasDropShadow"" Value=""True"" />
            <!-- Bung lên trên thanh (thanh luôn ở đáy màn hình nên phía trên đủ chỗ),
                 tránh menu tràn xuống dưới và cắt mất mục cuối. -->
            <Setter Property=""Placement"" Value=""Top"" />
            <Setter Property=""VerticalOffset"" Value=""-4"" />
            <Setter Property=""Template"">
                <Setter.Value>
                    <ControlTemplate TargetType=""{{x:Type ContextMenu}}"">
                        <Border Background=""{{TemplateBinding Background}}""
                                BorderBrush=""{{TemplateBinding BorderBrush}}""
                                BorderThickness=""{{TemplateBinding BorderThickness}}""
                                CornerRadius=""8"">
                            <Border.Effect>
                                <DropShadowEffect BlurRadius=""12"" Opacity=""0.5"" ShadowDepth=""3"" Direction=""270"" Color=""#000000"" />
                            </Border.Effect>
                            <StackPanel IsItemsHost=""True"" Margin=""2"" />
                        </Border>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>

        <!-- Modern Dark MenuItem Style -->
        <Style TargetType=""{{x:Type MenuItem}}"">
            <Setter Property=""Foreground"" Value=""#F1F5F9"" />
            <Setter Property=""FontSize"" Value=""11"" />
            <Setter Property=""Padding"" Value=""10,6"" />
            <Setter Property=""Cursor"" Value=""Hand"" />
            <Setter Property=""Template"">
                <Setter.Value>
                    <ControlTemplate TargetType=""{{x:Type MenuItem}}"">
                        <Border x:Name=""ItemBorder"" Background=""Transparent"" CornerRadius=""5"" Padding=""{{TemplateBinding Padding}}"" Margin=""1"">
                            <Grid>
                                <ContentPresenter ContentSource=""Header"" VerticalAlignment=""Center"" />
                            </Grid>
                        </Border>
                        <ControlTemplate.Triggers>
                            <Trigger Property=""IsHighlighted"" Value=""True"">
                                <Setter TargetName=""ItemBorder"" Property=""Background"" Value=""#25FFFFFF"" />
                            </Trigger>
                            <Trigger Property=""IsEnabled"" Value=""False"">
                                <Setter Property=""Foreground"" Value=""#64748B"" />
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>

        <!-- Modern Dark Separator Style -->
        <Style TargetType=""{{x:Type Separator}}"">
            <Setter Property=""Template"">
                <Setter.Value>
                    <ControlTemplate TargetType=""{{x:Type Separator}}"">
                        <Border Height=""1"" Background=""#20FFFFFF"" Margin=""4,3"" />
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>

        <!-- Modern Dark ToolTip Style (Dark Acrylic, Placement Top) -->
        <Style TargetType=""{{x:Type ToolTip}}"">
            <Setter Property=""Background"" Value=""#FF0F172A"" />
            <Setter Property=""Foreground"" Value=""#F1F5F9"" />
            <Setter Property=""BorderBrush"" Value=""#33FFFFFF"" />
            <Setter Property=""BorderThickness"" Value=""1"" />
            <Setter Property=""FontSize"" Value=""11"" />
            <Setter Property=""Placement"" Value=""Top"" />
            <Setter Property=""VerticalOffset"" Value=""-6"" />
            <Setter Property=""HasDropShadow"" Value=""True"" />
            <Setter Property=""Template"">
                <Setter.Value>
                    <ControlTemplate TargetType=""{{x:Type ToolTip}}"">
                        <Border Background=""{{TemplateBinding Background}}""
                                BorderBrush=""{{TemplateBinding BorderBrush}}""
                                BorderThickness=""{{TemplateBinding BorderThickness}}""
                                CornerRadius=""6""
                                Padding=""10,8"">
                            <Border.Effect>
                                <DropShadowEffect BlurRadius=""10"" Opacity=""0.6"" ShadowDepth=""2"" Direction=""270"" Color=""#000000"" />
                            </Border.Effect>
                            <ContentPresenter />
                        </Border>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
    </Window.Resources>

    <Window.ContextMenu>
        <ContextMenu x:Name=""TaskbarContextMenu"">
            <MenuItem x:Name=""MenuDash"" Header=""Mở Bảng điều khiển (Dashboard) ↗"" FontWeight=""Bold"" />
            <MenuItem x:Name=""MenuRefresh"" Header=""Cập nhật dữ liệu ngay (Refresh)"" />
            <MenuItem x:Name=""MenuResetPos"" Header=""Đặt lại vị trí góc trái"" />
            <MenuItem x:Name=""MenuStartup"" Header=""Khởi động cùng Windows"" />
            <MenuItem x:Name=""MenuToggleTaskbar"" Header=""Ẩn biểu tượng khỏi thanh tác vụ"" />
            <Separator />
            <MenuItem x:Name=""MenuExit"" Header=""Thoát thanh tác vụ (Exit)"" />
        </ContextMenu>
    </Window.ContextMenu>

    <Border x:Name=""MainBorder"" CornerRadius=""7"" Background=""#F20B101B"" BorderBrush=""#33FFFFFF"" BorderThickness=""1"">
        <Border.Effect>
            <DropShadowEffect BlurRadius=""8"" Opacity=""0.6"" ShadowDepth=""1"" Direction=""270"" Color=""#000000"" />
        </Border.Effect>
        <Grid Margin=""2,1"">
            <Grid.ColumnDefinitions>
                <ColumnDefinition Width=""7"" />
                <ColumnDefinition Width=""*"" />
                <ColumnDefinition Width=""2"" />
                <ColumnDefinition Width=""*"" />
                <ColumnDefinition Width=""2"" />
                <ColumnDefinition Width=""*"" />
                <ColumnDefinition Width=""2"" />
                <ColumnDefinition Width=""*"" />
                <ColumnDefinition Width=""15"" />
            </Grid.ColumnDefinitions>

            <!-- 1. Drag Handle -->
            <TextBlock x:Name=""DragGrip"" Grid.Column=""0"" Text=""⋮"" Foreground=""#60FFFFFF"" FontSize=""10"" 
                       HorizontalAlignment=""Center"" VerticalAlignment=""Center"" Cursor=""SizeAll""
                       ToolTip=""Kéo để di chuyển vị trí thanh ngang. Nhấp đúp mở bảng điều khiển."" />

            <!-- 2. Claude Pill -->
            <Border x:Name=""PillClaude"" Grid.Column=""1"" CornerRadius=""4"" Background=""#14FFFFFF"" BorderBrush=""#20FFFFFF"" BorderThickness=""1"" Margin=""0,1"" Cursor=""Hand"">
                <Grid Margin=""2,0"">
                    <Grid.RowDefinitions>
                        <RowDefinition Height=""Auto"" />
                        <RowDefinition Height=""Auto"" />
                    </Grid.RowDefinitions>
                    <StackPanel Grid.Row=""0"" Orientation=""Horizontal"" VerticalAlignment=""Center"">
                        <Ellipse x:Name=""ClaudeDot"" Width=""4.5"" Height=""4.5"" Fill=""#EB7A50"" Margin=""0,0,2.5,0"" VerticalAlignment=""Center"" />
                        <TextBlock Text=""Claude"" FontSize=""8"" FontWeight=""SemiBold"" Foreground=""#F1F5F9"" />
                    </StackPanel>
                    <StackPanel Grid.Row=""1"" Orientation=""Horizontal"" VerticalAlignment=""Center"" Margin=""7,0,0,0"">
                        <TextBlock x:Name=""ClaudePct"" Text=""--%"" FontSize=""8"" FontWeight=""Bold"" Foreground=""#EB7A50"" />
                        <TextBlock x:Name=""ClaudeTime"" Text="""" FontSize=""7.5"" Foreground=""#94A3B8"" />
                    </StackPanel>
                </Grid>
            </Border>

            <!-- 3. ChatGPT Pill -->
            <Border x:Name=""PillChatGPT"" Grid.Column=""3"" CornerRadius=""4"" Background=""#14FFFFFF"" BorderBrush=""#20FFFFFF"" BorderThickness=""1"" Margin=""0,1"" Cursor=""Hand"">
                <Grid Margin=""2,0"">
                    <Grid.RowDefinitions>
                        <RowDefinition Height=""Auto"" />
                        <RowDefinition Height=""Auto"" />
                    </Grid.RowDefinitions>
                    <StackPanel Grid.Row=""0"" Orientation=""Horizontal"" VerticalAlignment=""Center"">
                        <Ellipse x:Name=""ChatGPTDot"" Width=""4.5"" Height=""4.5"" Fill=""#32D6AA"" Margin=""0,0,2.5,0"" VerticalAlignment=""Center"" />
                        <TextBlock Text=""GPT"" FontSize=""8"" FontWeight=""SemiBold"" Foreground=""#F1F5F9"" />
                    </StackPanel>
                    <StackPanel Grid.Row=""1"" Orientation=""Horizontal"" VerticalAlignment=""Center"" Margin=""7,0,0,0"">
                        <TextBlock x:Name=""ChatGPTPct"" Text=""--%"" FontSize=""8"" FontWeight=""Bold"" Foreground=""#32D6AA"" />
                        <TextBlock x:Name=""ChatGPTTime"" Text="""" FontSize=""7.5"" Foreground=""#94A3B8"" />
                    </StackPanel>
                </Grid>
            </Border>

            <!-- 4. AntiGravity Pill -->
            <Border x:Name=""PillAntiGravity"" Grid.Column=""5"" CornerRadius=""4"" Background=""#14FFFFFF"" BorderBrush=""#20FFFFFF"" BorderThickness=""1"" Margin=""0,1"" Cursor=""Hand"">
                <Grid Margin=""2,0"">
                    <Grid.RowDefinitions>
                        <RowDefinition Height=""Auto"" />
                        <RowDefinition Height=""Auto"" />
                    </Grid.RowDefinitions>
                    <StackPanel Grid.Row=""0"" Orientation=""Horizontal"" VerticalAlignment=""Center"">
                        <Ellipse x:Name=""AntiGravityDot"" Width=""4.5"" Height=""4.5"" Fill=""#23C9E8"" Margin=""0,0,2.5,0"" VerticalAlignment=""Center"" />
                        <TextBlock Text=""AG"" FontSize=""8"" FontWeight=""SemiBold"" Foreground=""#F1F5F9"" />
                    </StackPanel>
                    <StackPanel Grid.Row=""1"" Orientation=""Horizontal"" VerticalAlignment=""Center"" Margin=""7,0,0,0"">
                        <TextBlock x:Name=""AntiGravityPct"" Text=""--%"" FontSize=""8"" FontWeight=""Bold"" Foreground=""#23C9E8"" />
                        <TextBlock x:Name=""AntiGravityTime"" Text="""" FontSize=""7.5"" Foreground=""#94A3B8"" />
                    </StackPanel>
                </Grid>
            </Border>

            <!-- 5. Gemini Pill -->
            <Border x:Name=""PillGemini"" Grid.Column=""7"" CornerRadius=""4"" Background=""#14FFFFFF"" BorderBrush=""#20FFFFFF"" BorderThickness=""1"" Margin=""0,1"" Cursor=""Hand"">
                <Grid Margin=""2,0"">
                    <Grid.RowDefinitions>
                        <RowDefinition Height=""Auto"" />
                        <RowDefinition Height=""Auto"" />
                    </Grid.RowDefinitions>
                    <StackPanel Grid.Row=""0"" Orientation=""Horizontal"" VerticalAlignment=""Center"">
                        <Ellipse x:Name=""GeminiDot"" Width=""4.5"" Height=""4.5"" Fill=""#A98BFF"" Margin=""0,0,2.5,0"" VerticalAlignment=""Center"" />
                        <TextBlock Text=""Gemini"" FontSize=""8"" FontWeight=""SemiBold"" Foreground=""#F1F5F9"" />
                    </StackPanel>
                    <StackPanel Grid.Row=""1"" Orientation=""Horizontal"" VerticalAlignment=""Center"" Margin=""7,0,0,0"">
                        <TextBlock x:Name=""GeminiPct"" Text=""--%"" FontSize=""8"" FontWeight=""Bold"" Foreground=""#A98BFF"" />
                        <TextBlock x:Name=""GeminiTime"" Text="""" FontSize=""7.5"" Foreground=""#94A3B8"" />
                    </StackPanel>
                </Grid>
            </Border>

            <!-- 6. Expand Button -->
            <Border x:Name=""BtnExpand"" Grid.Column=""8"" CornerRadius=""4"" Background=""#10FFFFFF"" Margin=""1,3"" Cursor=""Hand""
                    ToolTip=""Mở bảng điều khiển đầy đủ (Dashboard) ↗"">
                <TextBlock Text=""↗"" Foreground=""#B0FFFFFF"" FontSize=""8.5"" FontWeight=""Bold""
                           HorizontalAlignment=""Center"" VerticalAlignment=""Center"" />
            </Border>
        </Grid>
    </Border>
</Window>", barHeight, barWidth, showInTbStr, iconPath, initLeft, initTop);

            window = (Window)XamlReader.Parse(xaml);

            // Hook Topmost and Win32 icon
            AttachTopmost(window, iconPath, currentShowInTaskbar);

            // Find controls
            pillClaude = (Border)window.FindName("PillClaude");
            claudeDot = (Shapes.Ellipse)window.FindName("ClaudeDot");
            claudePct = (TextBlock)window.FindName("ClaudePct");
            claudeTime = (TextBlock)window.FindName("ClaudeTime");

            pillChatGPT = (Border)window.FindName("PillChatGPT");
            chatGPTDot = (Shapes.Ellipse)window.FindName("ChatGPTDot");
            chatGPTPct = (TextBlock)window.FindName("ChatGPTPct");
            chatGPTTime = (TextBlock)window.FindName("ChatGPTTime");

            pillAntiGravity = (Border)window.FindName("PillAntiGravity");
            antiGravityDot = (Shapes.Ellipse)window.FindName("AntiGravityDot");
            antiGravityPct = (TextBlock)window.FindName("AntiGravityPct");
            antiGravityTime = (TextBlock)window.FindName("AntiGravityTime");

            pillGemini = (Border)window.FindName("PillGemini");
            geminiDot = (Shapes.Ellipse)window.FindName("GeminiDot");
            geminiPct = (TextBlock)window.FindName("GeminiPct");
            geminiTime = (TextBlock)window.FindName("GeminiTime");

            btnExpand = (Border)window.FindName("BtnExpand");

            menuDash = (MenuItem)window.FindName("MenuDash");
            menuRefresh = (MenuItem)window.FindName("MenuRefresh");
            menuResetPos = (MenuItem)window.FindName("MenuResetPos");
            menuStartup = (MenuItem)window.FindName("MenuStartup");
            menuToggleTaskbar = (MenuItem)window.FindName("MenuToggleTaskbar");
            menuExit = (MenuItem)window.FindName("MenuExit");

            // Event handlers
            // Bản cũ gọi DragMove ngay trong MouseLeftButtonDown ở cấp Window. Sự kiện
            // nổi bọt lên từ viên thuốc, mà DragMove mở một vòng lặp kéo chiếm chuột,
            // nên MouseLeftButtonUp của viên thuốc không bao giờ chạy: nhấp để mở bảng
            // điều khiển không ăn, nhấp đúp cũng bị nuốt. Ở đây chỉ kéo khi chuột đã
            // thực sự di chuyển quá ngưỡng.
            window.PreviewMouseLeftButtonDown += (s, e) => {
                dragStart = e.GetPosition(window);
                dragArmed = true;
            };

            window.MouseMove += (s, e) => {
                if (!dragArmed) return;
                if (e.LeftButton != MouseButtonState.Pressed) {
                    dragArmed = false;
                    return;
                }
                Point p = e.GetPosition(window);
                if (Math.Abs(p.X - dragStart.X) < DRAG_THRESHOLD && Math.Abs(p.Y - dragStart.Y) < DRAG_THRESHOLD) return;

                dragArmed = false;
                double beforeLeft = window.Left, beforeTop = window.Top;
                try {
                    window.DragMove();
                } catch {}
                if (window.Left != beforeLeft || window.Top != beforeTop) SavePosition();
                ForceTopmost();
            };

            window.PreviewMouseLeftButtonUp += (s, e) => { dragArmed = false; };

            window.MouseDoubleClick += (s, e) => { OpenDashboard(); };

            if (btnExpand != null) {
                btnExpand.MouseLeftButtonUp += (s, e) => {
                    OpenDashboard();
                    e.Handled = true;
                };
            }

            AddHoverEffect(pillClaude);
            AddHoverEffect(pillChatGPT);
            AddHoverEffect(pillAntiGravity);
            AddHoverEffect(pillGemini);
            AddHoverEffect(btnExpand);

            if (menuDash != null) menuDash.Click += (s, e) => { OpenDashboard(); };
            if (menuRefresh != null) menuRefresh.Click += (s, e) => { ForceRefresh(); };
            if (menuResetPos != null) menuResetPos.Click += (s, e) => {
                window.Left = defaultLeft;
                window.Top = defaultTop;
                SavePosition();
                ForceTopmost();
            };

            if (menuToggleTaskbar != null) {
                menuToggleTaskbar.Click += (s, e) => {
                    currentShowInTaskbar = !currentShowInTaskbar;
                    // WPF huỷ và tạo lại HWND ngay tại dòng dưới đây
                    window.ShowInTaskbar = currentShowInTaskbar;
                    // Gắn lại toàn bộ kiểu cửa sổ và hook lên handle mới
                    ApplyWindowStyles(window, iconPath);
                    ApplyMenuLanguage();
                    SavePosition();
                };
            }

            if (menuStartup != null) {
                RefreshStartupMenu();
                menuStartup.Click += (s, e) => {
                    SetStartupEnabled(!IsStartupEnabled());
                    RefreshStartupMenu();
                };
            }

            if (menuExit != null) menuExit.Click += (s, e) => { window.Close(); };

            // Menu tự đóng khi con trỏ rời xa. Cửa sổ luôn trên cùng khiến menu không
            // tự đóng như menu thường, và sự kiện MouseLeave của popup không đáng tin,
            // nên theo dõi thẳng vị trí con trỏ: rời quá xa điểm mở thì đóng.
            menuCloseTimer = new DispatcherTimer();
            menuCloseTimer.Interval = TimeSpan.FromMilliseconds(250);
            menuCloseTimer.Tick += (s, e) => {
                if (window.ContextMenu == null || !window.ContextMenu.IsOpen) {
                    menuCloseTimer.Stop();
                    return;
                }
                POINT c;
                if (!GetCursorPos(out c)) return;
                // Bán kính bao trọn menu, quy đổi theo tỉ lệ hiển thị (DPI)
                double dpi = 1.0;
                var src = PresentationSource.FromVisual(window);
                if (src != null && src.CompositionTarget != null) dpi = src.CompositionTarget.TransformToDevice.M11;
                int radius = (int)(320 * dpi);
                int dx = c.X - menuOpenPos.X;
                int dy = c.Y - menuOpenPos.Y;
                if (dx * dx + dy * dy > radius * radius) {
                    window.ContextMenu.IsOpen = false;
                    menuCloseTimer.Stop();
                }
            };

            // Tooltip của viên thuốc và menu chuột phải đều bung lên cùng chỗ nên đè
            // lên nhau. Tắt tooltip khi menu đang mở, bật lại khi menu đóng.
            if (window.ContextMenu != null) {
                var cm = window.ContextMenu;
                // Nhấc menu lên vừa đủ để mục cuối (Exit) vượt khỏi vùng taskbar.
                // Thanh nằm giữa taskbar nên chỉ lẫn vào (taskbar-bar)/2, cộng chút
                // lề cho thoáng. Nhấc cả chiều cao taskbar sẽ đẩy menu xa thanh.
                cm.VerticalOffset = -((taskbarHeight - 36) / 2 + 10);
                cm.Opened += (s, e) => {
                    SetPillTooltipsEnabled(false);
                    GetCursorPos(out menuOpenPos);
                    menuCloseTimer.Start();
                };
                cm.Closed += (s, e) => {
                    SetPillTooltipsEnabled(true);
                    menuCloseTimer.Stop();
                };
            }

            // Đặt nhãn menu theo ngôn ngữ mặc định ngay, tránh kẹt tiếng Việt của
            // XAML khi ngôn ngữ đang là tiếng Anh. UpdateUsageData sẽ đồng bộ tiếp.
            ApplyMenuLanguage();

            // Initial data update
            UpdateUsageData();

            // Data timer (15s)
            dataTimer = new DispatcherTimer();
            dataTimer.Interval = TimeSpan.FromSeconds(15);
            dataTimer.Tick += (s, e) => { UpdateUsageData(); };
            dataTimer.Start();

            // Topmost watchdog timer (300ms)
            topmostWatchdog = new DispatcherTimer();
            // Hook WM_WINDOWPOSCHANGING moi la co che chinh; bo hen gio nay chi la luoi
            // an toan, khong can chay 200 lan moi phut.
            topmostWatchdog.Interval = TimeSpan.FromSeconds(1);
            topmostWatchdog.Tick += (s, e) => { ForceTopmost(); };
            topmostWatchdog.Start();

            // Đồng hồ đếm ngược tới lúc hạn mức đặt lại, cập nhật mỗi giây mà không
            // gọi mạng: chỉ đọc lại mốc thời gian đã lưu ở mỗi viên thuốc.
            countdownTimer = new DispatcherTimer();
            countdownTimer.Interval = TimeSpan.FromSeconds(1);
            countdownTimer.Tick += (s, e) => { UpdateCountdowns(); };
            countdownTimer.Start();

            var app = new Application();

            // Ngoại lệ trên luồng giao diện WPF đi qua đây, không qua
            // AppDomain.UnhandledException. Thiếu móc này thì thanh tác vụ có thể
            // biến mất mà không để lại dấu vết nào.
            app.DispatcherUnhandledException += (s, e) => {
                LogCrash("Dispatcher", e.Exception);
                // Một lỗi vẽ giao diện không đáng để cả thanh biến mất
                e.Handled = true;
            };

            app.Run(window);

            if (dataTimer != null) dataTimer.Stop();
            if (topmostWatchdog != null) topmostWatchdog.Stop();
            if (countdownTimer != null) countdownTimer.Stop();
            if (menuCloseTimer != null) menuCloseTimer.Stop();
            if (appMutex != null) {
                appMutex.ReleaseMutex();
                appMutex.Dispose();
            }
        }

        // Ghi nối tiếp kèm mốc thời gian, để giữ được lịch sử nhiều lần lỗi
        private static void LogCrash(string source, object error) {
            try {
                string line = string.Format("[{0}] {1}: {2}{3}",
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), source, error, Environment.NewLine);
                File.AppendAllText(Path.Combine(workingDir, "crash.log"), line, Encoding.UTF8);
            } catch {}
        }

        private static void AttachTopmost(Window win, string iconFile, bool showInTb) {
            // SourceInitialized được bắn lại mỗi lần WPF tạo lại HWND, chẳng hạn khi
            // đổi ShowInTaskbar. Vì vậy phải gắn lại handle, kiểu cửa sổ, biểu tượng
            // và hook ở đây; ghi nhớ handle một lần rồi dùng mãi sẽ khiến cơ chế
            // luôn trên cùng thao tác trên một handle đã chết.
            win.SourceInitialized += (s, e) => { ApplyWindowStyles(win, iconFile); };
            win.Deactivated += (s, e) => { ForceTopmost(); };
            win.MouseEnter += (s, e) => { ForceTopmost(); };
        }

        // Gọi lại được nhiều lần, luôn dùng handle hiện hành của cửa sổ.
        private static void ApplyWindowStyles(Window win, string iconFile) {
            IntPtr handle = new WindowInteropHelper(win).Handle;
            if (handle == IntPtr.Zero) return;
            WindowHandle = handle;

            int exStyle = GetWindowLong(WindowHandle, GWL_EXSTYLE);
            exStyle |= WS_EX_TOPMOST;
            if (currentShowInTaskbar) {
                exStyle |= WS_EX_APPWINDOW;
                exStyle &= ~WS_EX_TOOLWINDOW;
            } else {
                exStyle |= WS_EX_TOOLWINDOW;
                exStyle &= ~WS_EX_APPWINDOW;
            }
            SetWindowLong(WindowHandle, GWL_EXSTYLE, exStyle);

            // Gắn biểu tượng Win32 thẳng lên HWND
            if (!string.IsNullOrEmpty(iconFile) && File.Exists(iconFile)) {
                try {
                    IntPtr hSmall = LoadImage(IntPtr.Zero, iconFile, IMAGE_ICON, 16, 16, LR_LOADFROMFILE);
                    IntPtr hBig = LoadImage(IntPtr.Zero, iconFile, IMAGE_ICON, 32, 32, LR_LOADFROMFILE);
                    if (hSmall != IntPtr.Zero) SendMessage(WindowHandle, WM_SETICON, new IntPtr(0), hSmall);
                    if (hBig != IntPtr.Zero) SendMessage(WindowHandle, WM_SETICON, new IntPtr(1), hBig);
                } catch {}
            }

            // Nhận thanh tác vụ làm cửa sổ cha
            IntPtr hTaskbar = FindWindow("Shell_TrayWnd", null);
            if (hTaskbar != IntPtr.Zero) {
                try {
                    SetWindowLongPtr(WindowHandle, GWL_HWNDPARENT, hTaskbar);
                } catch {}
            }

            // Hook WndProc trên nguồn hiện hành
            HwndSource source = HwndSource.FromHwnd(WindowHandle);
            if (source != null) {
                source.RemoveHook(WndProc);
                source.AddHook(WndProc);
            }

            ForceTopmost();
        }

        public static void SetTaskbarVisibility(bool show) {
            if (WindowHandle == IntPtr.Zero) return;
            int exStyle = GetWindowLong(WindowHandle, GWL_EXSTYLE);
            if (show) {
                exStyle |= WS_EX_APPWINDOW;
                exStyle &= ~WS_EX_TOOLWINDOW;
            } else {
                exStyle |= WS_EX_TOOLWINDOW;
                exStyle &= ~WS_EX_APPWINDOW;
            }
            SetWindowLong(WindowHandle, GWL_EXSTYLE, exStyle);
        }

        public static void ForceTopmost() {
            if (WindowHandle != IntPtr.Zero) {
                SetWindowPos(WindowHandle, HWND_TOPMOST, 0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS);
            }
        }

        private static IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled) {
            // Explorer vừa khởi động lại: cửa sổ cha cũ đã chết, gắn lại từ đầu
            if (WM_TASKBARCREATED != 0 && (uint)msg == WM_TASKBARCREATED && window != null) {
                window.Dispatcher.BeginInvoke(new Action(() => {
                    try { ApplyWindowStyles(window, iconPath); } catch {}
                }));
                return IntPtr.Zero;
            }

            if (msg == WM_WINDOWPOSCHANGING && lParam != IntPtr.Zero) {
                try {
                    WINDOWPOS wp = (WINDOWPOS)Marshal.PtrToStructure(lParam, typeof(WINDOWPOS));
                    wp.hwndInsertAfter = HWND_TOPMOST;
                    Marshal.StructureToPtr(wp, lParam, false);
                } catch {}
            }
            return IntPtr.Zero;
        }

        private static void AddHoverEffect(Border border) {
            if (border == null) return;
            var brushNormal = new SolidColorBrush(Color.FromArgb(20, 255, 255, 255));
            var brushHover = new SolidColorBrush(Color.FromArgb(45, 255, 255, 255));
            var borderNormal = new SolidColorBrush(Color.FromArgb(32, 255, 255, 255));
            var borderHover = new SolidColorBrush(Color.FromArgb(85, 255, 255, 255));

            border.MouseEnter += (s, e) => {
                border.Background = brushHover;
                border.BorderBrush = borderHover;
            };
            border.MouseLeave += (s, e) => {
                border.Background = brushNormal;
                border.BorderBrush = borderNormal;
            };
            border.MouseLeftButtonUp += (s, e) => {
                OpenDashboard();
                e.Handled = true;
            };
        }

        private static void OpenDashboard() {
            try {
                Process.Start(serverUrl);
            } catch {}
        }

        // Đường dẫn tệp thực thi hiện tại, bọc ngoặc kép phòng khi có dấu cách.
        private static string CurrentExePath() {
            try {
                return Process.GetCurrentProcess().MainModule.FileName;
            } catch {
                return null;
            }
        }

        private static bool IsStartupEnabled() {
            try {
                using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(STARTUP_REG_PATH, false)) {
                    if (key == null) return false;
                    return !string.IsNullOrEmpty(key.GetValue(STARTUP_REG_NAME) as string);
                }
            } catch {
                return false;
            }
        }

        private static void SetStartupEnabled(bool enabled) {
            try {
                using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(STARTUP_REG_PATH, true)) {
                    if (key == null) return;
                    if (enabled) {
                        string exe = CurrentExePath();
                        if (string.IsNullOrEmpty(exe)) return;
                        key.SetValue(STARTUP_REG_NAME, "\"" + exe + "\"");
                    } else {
                        if (key.GetValue(STARTUP_REG_NAME) != null) key.DeleteValue(STARTUP_REG_NAME, false);
                    }
                }
            } catch {}
        }

        private static void RefreshStartupMenu() {
            if (menuStartup == null) return;
            string label = IsVi() ? "Khởi động cùng Windows" : "Start with Windows";
            menuStartup.Header = (IsStartupEnabled() ? "✓ " : "") + label;
        }

        // Đặt nhãn menu theo ngôn ngữ đang chọn ở bảng điều khiển.
        private static void ApplyMenuLanguage() {
            bool vi = IsVi();
            if (menuDash != null) menuDash.Header = vi ? "Mở Bảng điều khiển (Dashboard) ↗" : "Open dashboard ↗";
            if (menuRefresh != null) menuRefresh.Header = vi ? "Cập nhật dữ liệu ngay (Refresh)" : "Refresh now";
            if (menuResetPos != null) menuResetPos.Header = vi ? "Đặt lại vị trí góc trái" : "Reset position to left";
            if (menuExit != null) menuExit.Header = vi ? "Thoát thanh tác vụ (Exit)" : "Exit";
            if (menuToggleTaskbar != null) {
                menuToggleTaskbar.Header = currentShowInTaskbar
                    ? (vi ? "Ẩn biểu tượng khỏi thanh tác vụ" : "Hide the taskbar icon")
                    : (vi ? "Hiện biểu tượng trên thanh tác vụ" : "Show the taskbar icon");
            }
            RefreshStartupMenu();
        }

        // Nhãn hạn mức theo khóa ổn định, trùng với public/i18n.js.
        private static string MetricLabel(Dictionary<string, object> m, string fallbackName) {
            string key = GetString(m, "metricKey");
            string pname = "";
            object mp;
            if (m.TryGetValue("metricParams", out mp)) {
                var pd = mp as Dictionary<string, object>;
                if (pd != null) pname = GetString(pd, "name");
            }
            bool vi = IsVi();
            switch (key) {
                case "session_5h": return vi ? "Phiên 5 giờ" : "5-hour session";
                case "weekly_7d": return vi ? "Hạn mức tuần" : "Weekly limit";
                case "model": return vi ? ("Mô hình " + pname) : (pname + " model");
                case "group_session": return pname + " (5h)";
                case "group_weekly": return pname + (vi ? " (tuần)" : " (weekly)");
                case "reset_credits": return vi ? "Lượt đặt lại" : "Reset credits";
                default: return string.IsNullOrEmpty(fallbackName) ? "" : fallbackName;
            }
        }

        private static void SetPillTooltipsEnabled(bool on) {
            foreach (var pill in new[] { pillClaude, pillChatGPT, pillAntiGravity, pillGemini }) {
                if (pill != null) ToolTipService.SetIsEnabled(pill, on);
            }
        }

        private static void SavePosition() {
            try {
                var dict = new Dictionary<string, object> {
                    { "Left", (int)window.Left },
                    { "Top", (int)window.Top },
                    { "ShowInTaskbar", currentShowInTaskbar }
                };
                var js = new JavaScriptSerializer();
                File.WriteAllText(posFile, js.Serialize(dict), Encoding.UTF8);
            } catch {}
        }

        private static void EnsureBackend() {
            bool running = false;
            try {
                var req = (HttpWebRequest)WebRequest.Create(serverUrl + "/api/health");
                req.Timeout = 2000;
                using (var resp = req.GetResponse()) {
                    running = true;
                }
            } catch {}

            if (!running) {
                try {
                    var psi = new ProcessStartInfo {
                        FileName = "node.exe",
                        Arguments = "server.js",
                        WorkingDirectory = workingDir,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };
                    Process.Start(psi);
                    Thread.Sleep(2000);
                } catch {}
            }
        }

        // Đọc mốc thời gian ISO 8601 (có Z hoặc offset) về UTC.
        // Phải dùng DateTimeOffset: tổ hợp DateTimeStyles.RoundtripKind với
        // AdjustToUniversal là không hợp lệ và ném ArgumentException.
        private static bool TryParseIsoUtc(string isoString, out DateTime utc) {
            utc = DateTime.MinValue;
            if (string.IsNullOrEmpty(isoString)) return false;
            try {
                utc = DateTimeOffset.Parse(isoString, CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind).UtcDateTime;
                return true;
            } catch {
                return false;
            }
        }

        // Đồng hồ đếm ngược chạy từng giây tới lúc hạn mức đặt lại.
        //   còn nhiều ngày : "3d 4h"
        //   trong ngày     : "3:24:15"  (giờ:phút:giây)
        //   dưới một giờ   : "24:15"    (phút:giây)
        private static string FormatCountdown(string isoString) {
            DateTime dt;
            if (!TryParseIsoUtc(isoString, out dt)) return "";
            TimeSpan diff = dt - DateTime.UtcNow;
            if (diff.TotalSeconds <= 0) return "0:00";
            if (diff.TotalDays >= 1) return string.Format("{0}d {1}h", (int)diff.TotalDays, diff.Hours);
            if (diff.TotalHours >= 1) return string.Format("{0}:{1:00}:{2:00}", (int)diff.TotalHours, diff.Minutes, diff.Seconds);
            return string.Format("{0}:{1:00}", diff.Minutes, diff.Seconds);
        }

        // Cập nhật cả bốn đồng hồ đếm ngược từ mốc thời gian đã lưu ở Tag của mỗi
        // ô, không gọi mạng. Ô nào không có mốc (đang lỗi hoặc dữ liệu cũ) thì bỏ qua.
        private static void UpdateCountdowns() {
            foreach (var t in new[] { claudeTime, chatGPTTime, antiGravityTime, geminiTime }) {
                if (t == null) continue;
                string iso = t.Tag as string;
                if (string.IsNullOrEmpty(iso)) continue;
                t.Text = " • " + FormatCountdown(iso);
            }
        }

        private static string FormatResetTimeFull(string isoString) {
            DateTime dt;
            bool vi = IsVi();
            if (!TryParseIsoUtc(isoString, out dt)) return vi ? "Không xác định" : "unknown";
            TimeSpan diff = dt - DateTime.UtcNow;
            if (diff.TotalMinutes <= 0) return vi ? "ngay bây giờ" : "now";
            if (diff.TotalDays >= 1) return vi
                ? string.Format("{0} ngày {1} giờ", (int)diff.TotalDays, diff.Hours)
                : string.Format("{0}d {1}h", (int)diff.TotalDays, diff.Hours);
            if (diff.TotalHours >= 1) return vi
                ? string.Format("{0} giờ {1} phút", (int)diff.TotalHours, diff.Minutes)
                : string.Format("{0}h {1}m", (int)diff.TotalHours, diff.Minutes);
            return vi ? string.Format("{0} phút", (int)diff.TotalMinutes) : string.Format("{0}m", (int)diff.TotalMinutes);
        }

        // Ngưỡng phải trùng với getMetricSeverity trong public/usage-ui.js,
        // nếu lệch thì cùng một con số sẽ hiện màu khác nhau giữa thanh tác vụ
        // và bảng điều khiển.
        private const int SEVERITY_CRITICAL = 85;
        private const int SEVERITY_WARNING = 60;
        private const string COLOR_CRITICAL = "#FF667F";
        private const string COLOR_WARNING = "#FFBF3F";
        private const string COLOR_UNKNOWN = "#7A8699";

        private static string GetSeverityColor(int percent, string defaultHex) {
            if (percent >= SEVERITY_CRITICAL) return COLOR_CRITICAL;
            if (percent >= SEVERITY_WARNING) return COLOR_WARNING;
            return defaultHex;
        }

        private static Brush HexBrush(string hex) {
            return (Brush)new BrushConverter().ConvertFromString(hex);
        }

        private static string GetString(Dictionary<string, object> d, string key) {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return "";
            return v.ToString();
        }

        private static int GetInt(Dictionary<string, object> d, string key) {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return -1;
            try { return Convert.ToInt32(v); } catch { return -1; }
        }

        private static bool GetBool(Dictionary<string, object> d, string key) {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return false;
            try { return Convert.ToBoolean(v); } catch { return false; }
        }

        // Không đọc được số thì phải nói rõ là không đọc được. Giữ nguyên con số cũ
        // là cách hỏng tệ nhất, vì người dùng tin đó là số hiện tại.
        private static void SetPillUnknown(Border pill, Shapes.Ellipse dot, TextBlock pctText, TextBlock timeText,
            string displayName, string reason) {
            if (pctText == null) return;
            Brush grey = HexBrush(COLOR_UNKNOWN);
            pctText.Text = "--%";
            pctText.Foreground = grey;
            if (dot != null) dot.Fill = grey;
            if (timeText != null) { timeText.Tag = null; timeText.Text = ""; }
            if (pill != null) {
                bool vi = IsVi();
                pill.ToolTip = string.Format("{0}: {1}\n• {2}\n{3}",
                    displayName,
                    vi ? "chưa đọc được số liệu" : "no data",
                    reason,
                    vi ? "(Nhấp chuột để mở bảng điều khiển chi tiết)" : "(Click to open the dashboard)");
            }
        }

        private static void MarkAllPillsUnknown(string reason) {
            SetPillUnknown(pillClaude, claudeDot, claudePct, claudeTime, "Claude", reason);
            SetPillUnknown(pillChatGPT, chatGPTDot, chatGPTPct, chatGPTTime, "ChatGPT", reason);
            SetPillUnknown(pillAntiGravity, antiGravityDot, antiGravityPct, antiGravityTime, "AntiGravity", reason);
            SetPillUnknown(pillGemini, geminiDot, geminiPct, geminiTime, "Gemini", reason);
        }

        private static bool IsSessionMetric(Dictionary<string, object> m) {
            string window = GetString(m, "windowType");
            if (window == "session") return true;
            if (window == "weekly") return false;
            return Regex.IsMatch(GetString(m, "name") + " " + GetString(m, "id"),
                "phiên|session|5h|primary", RegexOptions.IgnoreCase);
        }

        // Cùng thứ tự ưu tiên với compareMetricsPriority trong usage-ui.js:
        //   1. hạn mức đã cạn 100% được cảnh báo trước
        //   2. rồi mới tới hạn mức phiên 5 giờ
        //   3. cuối cùng là tỷ lệ đã dùng cao hơn
        private static Dictionary<string, object> PickMetric(ArrayList metrics) {
            Dictionary<string, object> best = null;
            int bestUsed = -1;
            bool bestExhausted = false;
            bool bestSession = false;

            foreach (var item in metrics) {
                var m = item as Dictionary<string, object>;
                if (m == null) continue;
                int used = GetInt(m, "usedPercent");
                if (used < 0) continue;

                bool exhausted = used >= 100;
                bool session = IsSessionMetric(m);

                bool better;
                if (best == null) {
                    better = true;
                } else if (exhausted != bestExhausted) {
                    better = exhausted;
                } else if (session != bestSession) {
                    better = session;
                } else {
                    better = used > bestUsed;
                }

                if (better) {
                    best = m;
                    bestUsed = used;
                    bestExhausted = exhausted;
                    bestSession = session;
                }
            }
            return best;
        }

        // Đọc ngôn ngữ người dùng đã chọn ở bảng điều khiển, cập nhật menu nếu đổi.
        private static void SyncLanguage() {
            try {
                string s;
                using (var wc = new WebClient()) {
                    wc.Encoding = Encoding.UTF8;
                    s = wc.DownloadString(serverUrl + "/api/preferences");
                }
                var js = new JavaScriptSerializer();
                var d = js.Deserialize<Dictionary<string, object>>(s);
                string lang = d != null ? GetString(d, "lang") : "";
                if ((lang == "vi" || lang == "en") && lang != uiLang) {
                    uiLang = lang;
                    ApplyMenuLanguage();
                }
            } catch {}
        }

        private static void UpdateUsageData() {
            SyncLanguage();

            string jsonStr;
            try {
                using (var wc = new WebClient()) {
                    wc.Encoding = Encoding.UTF8;
                    jsonStr = wc.DownloadString(serverUrl + "/api/usage");
                }
            } catch (Exception ex) {
                MarkAllPillsUnknown((IsVi() ? "Không kết nối được máy chủ HP-AI-Usage. " : "Cannot reach the HP-AI-Usage server. ") + ex.Message);
                return;
            }

            Dictionary<string, object> providers = null;
            try {
                var js = new JavaScriptSerializer();
                var data = js.Deserialize<Dictionary<string, object>>(jsonStr);
                if (data != null && data.ContainsKey("providers")) {
                    providers = data["providers"] as Dictionary<string, object>;
                }
            } catch (Exception ex) {
                MarkAllPillsUnknown((IsVi() ? "Dữ liệu trả về không đọc được. " : "Could not read the returned data. ") + ex.Message);
                return;
            }

            if (providers == null) {
                MarkAllPillsUnknown(IsVi() ? "Máy chủ không trả về danh sách dịch vụ." : "The server returned no provider list.");
                return;
            }

            UpdateProvider("claude", providers, pillClaude, claudeDot, claudePct, claudeTime, "#EB7A50", "Claude");
            UpdateProvider("chatgpt", providers, pillChatGPT, chatGPTDot, chatGPTPct, chatGPTTime, "#32D6AA", "ChatGPT");
            UpdateProvider("antigravity", providers, pillAntiGravity, antiGravityDot, antiGravityPct, antiGravityTime, "#23C9E8", "AntiGravity");
            UpdateProvider("gemini", providers, pillGemini, geminiDot, geminiPct, geminiTime, "#A98BFF", "Gemini");
        }

        // Ép máy chủ quét lại thật sự. Chạy trên luồng nền để không treo thanh.
        private static void ForceRefresh() {
            var worker = new Thread(() => {
                try {
                    using (var wc = new WebClient()) {
                        wc.Encoding = Encoding.UTF8;
                        wc.Headers[HttpRequestHeader.ContentType] = "application/json; charset=utf-8";
                        wc.UploadString(serverUrl + "/api/refresh", "POST", "{}");
                    }
                } catch {}
                if (window != null) {
                    window.Dispatcher.BeginInvoke(new Action(UpdateUsageData));
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private static void UpdateProvider(string key, Dictionary<string, object> providers,
            Border pill, Shapes.Ellipse dot, TextBlock pctText, TextBlock timeText, string brandColor, string displayName) {

            object rawProvider;
            if (!providers.TryGetValue(key, out rawProvider)) {
                SetPillUnknown(pill, dot, pctText, timeText, displayName, "Máy chủ không trả về dịch vụ này.");
                return;
            }

            var p = rawProvider as Dictionary<string, object>;
            if (p == null) {
                SetPillUnknown(pill, dot, pctText, timeText, displayName, "Dữ liệu dịch vụ không hợp lệ.");
                return;
            }

            string status = GetString(p, "status");
            if (status != "active") {
                string message = GetString(p, "message");
                SetPillUnknown(pill, dot, pctText, timeText, displayName,
                    string.IsNullOrEmpty(message) ? "Trạng thái: " + status : message);
                return;
            }

            var mList = p.ContainsKey("metrics") ? p["metrics"] as ArrayList : null;
            var chosen = (mList == null || mList.Count == 0) ? null : PickMetric(mList);
            if (chosen == null) {
                SetPillUnknown(pill, dot, pctText, timeText, displayName, "Dịch vụ chưa trả về hạn mức nào.");
                return;
            }

            int pct = GetInt(chosen, "usedPercent");
            if (pct < 0) pct = 0;

            // Máy chủ đánh dấu stale khi số liệu là bản đồng bộ cũ
            bool stale = GetBool(p, "stale");

            string resetsAt = GetString(chosen, "resetsAt");
            string metricName = GetString(chosen, "name");
            if (string.IsNullOrEmpty(metricName)) metricName = displayName;

            string resetsFull = FormatResetTimeFull(resetsAt);

            Brush brush = HexBrush(stale ? COLOR_UNKNOWN : GetSeverityColor(pct, brandColor));

            pctText.Text = pct + "%";
            pctText.Foreground = brush;
            dot.Fill = brush;

            // Lưu mốc đặt lại vào Tag để đồng hồ đếm ngược cập nhật mỗi giây.
            // Dữ liệu cũ (stale) thì hiện "cũ" và không đếm ngược.
            if (stale) {
                timeText.Tag = null;
                timeText.Text = IsVi() ? " • cũ" : " • old";
            } else if (!string.IsNullOrEmpty(resetsAt)) {
                timeText.Tag = resetsAt;
                timeText.Text = " • " + FormatCountdown(resetsAt);
            } else {
                timeText.Tag = null;
                timeText.Text = "";
            }

            bool vi = IsVi();
            string usedLine = vi ? ("Đã dùng " + pct + "%") : (pct + "% used");
            string staleNote = stale ? (vi ? "  (số liệu cũ, đang chờ đồng bộ)" : "  (stale, syncing)") : "";
            string limitLbl = vi ? "Hạn mức" : "Limit";
            string resetLbl = vi ? "Đặt lại sau" : "Resets in";
            string clickLbl = vi ? "(Nhấp chuột để mở bảng điều khiển chi tiết)" : "(Click to open the dashboard)";
            pill.ToolTip = string.Format("{0}: {1}{2}\n• {3}: {4}\n• {5}: {6}\n{7}",
                displayName, usedLine, staleNote,
                limitLbl, MetricLabel(chosen, metricName),
                resetLbl, resetsFull, clickLbl);
        }
    }
}
