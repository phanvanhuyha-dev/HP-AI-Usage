/**
 * HP-AI-Usage Windows Edition - Logic điều khiển bảng điều khiển tinh gọn & đa ngôn ngữ
 */

document.addEventListener('DOMContentLoaded', () => {
    const ui = window.UsageUI;
    if (!ui) throw new Error('UsageUI is required');
    const i18n = window.UsageI18n;
    if (!i18n) throw new Error('UsageI18n is required');
    const appWrapper = document.getElementById('app-wrapper');
    const providersContainer = document.getElementById('providers-container');
    const refreshBtn = document.getElementById('refresh-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const lastUpdatedText = document.getElementById('last-updated-text');
    const activeProvidersCount = document.getElementById('active-providers-count');
    const activeMetricsCount = document.getElementById('active-metrics-count');
    const warningMetricsCount = document.getElementById('warning-metrics-count');
    const pillWarningBox = document.getElementById('pill-warning-box');
    const urgentAlert = document.getElementById('urgent-alert');
    const urgentAlertBadge = document.getElementById('urgent-alert-badge');
    const urgentAlertText = document.getElementById('urgent-alert-text');
    const viewModeHint = document.getElementById('view-mode-hint');

    // Chuyển đổi ngôn ngữ & chế độ xem
    const langViBtn = document.getElementById('lang-vi-btn');
    const langEnBtn = document.getElementById('lang-en-btn');
    const viewGridBtn = document.getElementById('view-grid-btn');
    const viewPanelBtn = document.getElementById('view-panel-btn');
    const textViewGrid = document.getElementById('text-view-grid');
    const textViewPanel = document.getElementById('text-view-panel');
    const btnRefreshText = document.getElementById('btn-refresh-text');
    const btnOpenPipWidget = document.getElementById('btn-open-pip-widget');
    const btnPipText = document.getElementById('btn-pip-text');
    const btnOpenTaskbar = document.getElementById('btn-open-taskbar');
    const btnTaskbarText = document.getElementById('btn-taskbar-text');
    const footerLocalNote = document.getElementById('footer-local-note');
    const connectionStatusDot = document.getElementById('connection-status-dot');

    // Modal
    const settingsModal = document.getElementById('settings-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalDesc = document.getElementById('modal-desc');
    const labelGeminiKey = document.getElementById('label-gemini-key');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalSaveBtn = document.getElementById('modal-save-btn');
    const inputGemini = document.getElementById('input-gemini-key');
    const toast = document.getElementById('toast');

    let currentData = null;
    // Mặc định tiếng Anh. Chỉ khi người dùng tự chọn tiếng Việt thì lựa chọn đó
    // mới được lưu lại và dùng cho các lần mở sau.
    let currentLang = localStorage.getItem('openusage_lang') || 'en';
    // Phải khai báo trước phần khởi tạo, vì connectLiveUpdates được gọi ngay ở đó
    let liveSource = null;

    // Từ điển đa ngôn ngữ (Tiếng Việt & English)
    const DICTIONARY = {
        vi: {
            ready: 'sẵn sàng',
            metrics: 'hạn mức',
            warnings: 'cảnh báo',
            connecting: 'Đang kết nối...',
            refresh: 'Làm mới',
            refreshing: 'Đang tải...',
            pipBtn: 'Ghim Widget',
            pipSuccess: 'Đã mở tiện ích nổi luôn trên cùng (Always-on-top)',
            pipFallback: 'Đang mở cửa sổ Tiện ích thu nhỏ...',
            taskbarBtn: 'Ghim Taskbar',
            taskbarSuccess: 'Đã mở thanh ngang tiện ích trên Taskbar',
            taskbarError: 'Không thể mở thanh tác vụ HP-AI-Usage.exe',
            grid: 'Lưới',
            panel: 'Bảng bên',
            quotaAlert: 'CẢNH BÁO HẠN MỨC',
            limitReached: 'Cần được kiểm tra.',
            settingsTitle: 'Cài đặt cấu hình (Settings)',
            settingsDesc: 'Cấu hình thêm các khóa giao diện lập trình ứng dụng (API key) để theo dõi. Thông tin được lưu an toàn trong tệp .env cục bộ.',
            geminiKeyLabel: 'Khóa API Google Gemini (GEMINI_API_KEY):',
            geminiKeyNote: 'Hiện chưa được sử dụng: hạn mức Gemini đang đọc qua AntiGravity IDE. Khóa này chỉ được lưu sẵn cho lần mở rộng sau.',
            cancel: 'Hủy',
            save: 'Lưu cấu hình',
            saving: 'Đang lưu...',
            localOnly: 'Dữ liệu đọc nội bộ an toàn (Local-only)',
            viewGridHint: 'Chế độ xem: Toàn màn hình',
            viewPanelHint: 'Chế độ xem: Bảng bên',
            accountLabel: 'Tài khoản',
            localDefault: 'Cục bộ',
            statusReady: 'Sẵn sàng',
            statusPending: 'Chờ kiểm tra',
            resetsIn: 'Đặt lại:',
            resetting: 'Đang đặt lại...',
            toastRefreshSuccess: 'Đã làm mới dữ liệu hạn mức thành công',
            toastSettingsSuccess: 'Đã cập nhật cài đặt thành công',
            toastRefreshError: 'Lỗi khi làm mới: ',
            loadingText: 'Đang nạp dữ liệu hạn mức từ máy tính của bạn...',
            loadingMetricsCount: 'Đang tải…',
            noUsageInfo: 'Chưa có thông tin sử dụng.',
            fileProtocolTitle: 'Đang mở trực tiếp tệp HTML (file://) - Cần chạy qua máy chủ',
            fileProtocolDesc: 'Ứng dụng HP-AI-Usage cần máy chủ nội bộ trên máy tính để đọc an toàn các chỉ số hạn mức (Claude, ChatGPT, AntiGravity, Gemini). Trình duyệt chặn toàn bộ lệnh đọc dữ liệu khi mở trực tiếp tệp bằng giao thức file://.',
            fileProtocolStep1: 'Kiểm tra máy tính đã cài Node.js (phiên bản LTS từ https://nodejs.org).',
            fileProtocolStep2: 'Nhấp đúp chuột vào tệp start.bat trong thư mục ứng dụng để khởi động máy chủ.',
            fileProtocolStep3: 'Mở trình duyệt tại địa chỉ http://127.0.0.1:6736.',
            openLocalServerBtn: 'Mở màn hình tổng hợp: http://127.0.0.1:6736',
            offlineTitle: 'Không thể kết nối đến máy chủ nội bộ (Offline)',
            offlineDesc: 'Máy chủ tại 127.0.0.1:6736 chưa khởi động hoặc đã bị dừng.',
            offlineInstruction: 'Hãy kiểm tra cửa sổ dòng lệnh start.bat có đang chạy hay không. Nếu chưa, hãy nhấp đúp vào start.bat để khởi động lại.',
            retryConnectionBtn: 'Thử lại kết nối',
            controlLabels: {
                'refresh-btn': { title: 'Làm mới dữ liệu tức thì', aria: 'Làm mới' },
                'btn-open-pip-widget': { title: 'Mở tiện ích ghim trên cùng', aria: 'Ghim Widget' },
                'btn-open-taskbar': { title: 'Mở thanh ngang trên taskbar', aria: 'Ghim Taskbar' },
                'settings-btn': { title: 'Cài đặt khóa API', aria: 'Cài đặt' },
                'lang-vi-btn': { title: 'Tiếng Việt' },
                'lang-en-btn': { title: 'English' },
                'view-grid-btn': { title: 'Hiển thị dạng lưới' },
                'view-panel-btn': { title: 'Thu gọn thành bảng bên' },
                'modal-close-btn': { aria: 'Đóng' }
            }
        },
        en: {
            ready: 'ready',
            metrics: 'quotas',
            warnings: 'warnings',
            connecting: 'Connecting...',
            refresh: 'Refresh',
            refreshing: 'Refreshing...',
            pipBtn: 'Pin Widget',
            pipSuccess: 'Opened Always-on-top Floating Widget',
            pipFallback: 'Opening Desktop Widget window...',
            taskbarBtn: 'Pin Taskbar',
            taskbarSuccess: 'Opened Taskbar mini-bar',
            taskbarError: 'Could not open HP-AI-Usage.exe taskbar app',
            grid: 'Grid',
            panel: 'Side Panel',
            quotaAlert: 'QUOTA ALERT',
            limitReached: 'Needs attention.',
            settingsTitle: 'Settings',
            settingsDesc: 'Configure additional API keys to monitor. Credentials are saved safely in your local .env file.',
            geminiKeyLabel: 'Google Gemini API Key (GEMINI_API_KEY):',
            geminiKeyNote: 'Not used yet: Gemini quotas are read through AntiGravity IDE. This key is only stored for a future extension.',
            cancel: 'Cancel',
            save: 'Save Settings',
            saving: 'Saving...',
            localOnly: 'Secure local-only data',
            viewGridHint: 'View Mode: Full Screen',
            viewPanelHint: 'View Mode: Side Panel',
            accountLabel: 'Account',
            localDefault: 'Local',
            statusReady: 'Ready',
            statusPending: 'Check needed',
            resetsIn: 'Resets:',
            resetting: 'Resetting...',
            toastRefreshSuccess: 'Usage metrics refreshed successfully',
            toastSettingsSuccess: 'Settings updated successfully',
            toastRefreshError: 'Refresh error: ',
            loadingText: 'Loading usage metrics from your computer...',
            loadingMetricsCount: 'Loading...',
            noUsageInfo: 'No usage information available.',
            fileProtocolTitle: 'Opened via file:// - Local Server Required',
            fileProtocolDesc: 'HP-AI-Usage requires a local server to securely read quotas from your computer (Claude, ChatGPT, AntiGravity, Gemini). Browsers block API calls when HTML files are opened directly via file://.',
            fileProtocolStep1: 'Make sure Node.js is installed (download LTS from https://nodejs.org).',
            fileProtocolStep2: 'Double-click start.bat in the app folder to start the local server.',
            fileProtocolStep3: 'Open your browser at http://127.0.0.1:6736.',
            openLocalServerBtn: 'Open dashboard: http://127.0.0.1:6736',
            offlineTitle: 'Cannot connect to local server (Offline)',
            offlineDesc: 'The server at 127.0.0.1:6736 is not running or unreachable.',
            offlineInstruction: 'Please check if start.bat is running in a terminal window. If not, double-click start.bat to launch the server.',
            retryConnectionBtn: 'Retry Connection',
            controlLabels: {
                'refresh-btn': { title: 'Refresh data now', aria: 'Refresh' },
                'btn-open-pip-widget': { title: 'Open the always-on-top widget', aria: 'Pin Widget' },
                'btn-open-taskbar': { title: 'Open the taskbar mini-bar', aria: 'Pin Taskbar' },
                'settings-btn': { title: 'API key settings', aria: 'Settings' },
                'lang-vi-btn': { title: 'Vietnamese' },
                'lang-en-btn': { title: 'English' },
                'view-grid-btn': { title: 'Grid view' },
                'view-panel-btn': { title: 'Side panel view' },
                'modal-close-btn': { aria: 'Close' }
            }
        }
    };

    // Biểu tượng SVG tối giản
    const PROVIDER_ICONS = {
        claude: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17.5 12a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>`,
        chatgpt: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 12 2.1 12.5"/><path d="m12 12 6.3 7.8"/><path d="m12 12-6.3 7.8"/><path d="M12 12 5.7 4.2"/><path d="m12 12 6.3-7.8"/></svg>`,
        antigravity: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
        gemini: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 24c-.4 0-.8-.3-.9-.7L8.6 15.4 0 12.9c-.4-.1-.7-.5-.7-.9s.3-.8.7-.9l8.6-2.5L11.1.7c.1-.4.5-.7.9-.7s.8.3.9.7l2.5 7.9 8.6 2.5c.4.1.7.5.7.9s-.3.8-.7.9l-8.6 2.5-2.5 7.9c-.1.4-.5.7-.9.7z"/></svg>`
    };

    const PROVIDER_NAMES = {
        claude: 'Claude',
        chatgpt: 'ChatGPT',
        antigravity: 'AntiGravity',
        gemini: 'Gemini'
    };

    // Dùng chung từ usage-ui.js thay vì chép lại ở từng giao diện
    const escapeHTML = ui.escapeHTML;
    const safeUrl = ui.safeUrl;

    // Kênh đồng bộ thời gian thực giữa các tab và cửa sổ (BroadcastChannel)
    const syncChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('openusage_sync') : null;
    if (syncChannel) {
        syncChannel.onmessage = (event) => {
            const data = event.data;
            if (!data) return;
            if (data.type === 'lang' && data.value && data.value !== currentLang) {
                setLanguage(data.value, true, false);
            }
            if (data.type === 'viewMode' && data.value) {
                setViewMode(data.value, false, false);
            }
        };
    }

    const isFileProtocol = window.location.protocol === 'file:';

    // Trình duyệt đã biết chính xác địa chỉ và cổng đang kết nối, không cần
    // ghi cứng 127.0.0.1:6736 trong HTML rồi sai khi người dùng đổi cổng.
    const footerHost = document.getElementById('footer-host');
    if (footerHost) footerHost.textContent = isFileProtocol ? 'file://' : (window.location.host || '127.0.0.1:6736');

    // 1. Khởi tạo ngôn ngữ & chế độ xem tức thì từ bộ nhớ đệm cục bộ
    setLanguage(currentLang, false, false);
    initViewMode();

    if (isFileProtocol) {
        lastUpdatedText.textContent = 'Offline';
        connectionStatusDot.classList.add('offline');
        renderFileProtocolWarning();
        // Vẫn gán sự kiện cho các nút điều hướng để đổi ngôn ngữ / giao diện
        langViBtn.addEventListener('click', () => setLanguage('vi'));
        langEnBtn.addEventListener('click', () => setLanguage('en'));
        viewGridBtn.addEventListener('click', () => setViewMode('grid'));
        viewPanelBtn.addEventListener('click', () => setViewMode('panel'));
        return;
    }

    // Đồng bộ từ tệp cấu hình máy chủ (đảm bảo không bị mất tùy chọn sau mỗi lần refresh hoặc xóa cache)
    fetch('/api/preferences')
        .then(res => res.json())
        .then(prefs => {
            if (prefs.lang && prefs.lang !== currentLang) {
                setLanguage(prefs.lang, true, false);
            }
            if (prefs.viewMode) {
                const currentIsPanel = appWrapper.classList.contains('is-side-panel');
                const serverIsPanel = prefs.viewMode === 'panel';
                if (currentIsPanel !== serverIsPanel) {
                    setViewMode(prefs.viewMode, false, false);
                }
            }
        })
        .catch(() => { });

    // 2. Tải dữ liệu ban đầu
    loadUsageData();
    connectLiveUpdates();

    // Chỉ hỏi vòng khi luồng sự kiện không hoạt động. Khi luồng chạy bình thường,
    // máy chủ đã đẩy dữ liệu rồi nên hỏi thêm chỉ tạo yêu cầu và lượt vẽ thừa.
    setInterval(() => {
        if (document.hidden || isLiveConnected()) return;
        loadUsageData(false, true);
    }, 30000);

    // Cập nhật bộ đếm ngược thời gian mỗi giây, bỏ qua khi cửa sổ đang bị ẩn
    setInterval(() => {
        if (document.hidden) return;
        updateLiveCountdowns();
    }, 1000);

    // Sự kiện chuyển đổi ngôn ngữ
    langViBtn.addEventListener('click', () => setLanguage('vi'));
    langEnBtn.addEventListener('click', () => setLanguage('en'));

    // Sự kiện chuyển đổi chế độ xem
    viewGridBtn.addEventListener('click', () => setViewMode('grid'));
    viewPanelBtn.addEventListener('click', () => setViewMode('panel'));

    function setLanguage(lang, reRender = true, broadcast = true) {
        currentLang = lang;
        document.documentElement.lang = lang;
        try { localStorage.setItem('openusage_lang', lang); } catch (e) { }

        if (broadcast) {
            fetch('/api/preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lang })
            }).catch(() => { });
            if (syncChannel) syncChannel.postMessage({ type: 'lang', value: lang });
        }

        if (lang === 'en') {
            langEnBtn.classList.add('active');
            langViBtn.classList.remove('active');
            langEnBtn.setAttribute('aria-pressed', 'true');
            langViBtn.setAttribute('aria-pressed', 'false');
        } else {
            langViBtn.classList.add('active');
            langEnBtn.classList.remove('active');
            langViBtn.setAttribute('aria-pressed', 'true');
            langEnBtn.setAttribute('aria-pressed', 'false');
        }

        const dict = DICTIONARY[lang];

        // Cập nhật các nhãn tĩnh trong DOM
        if (textViewGrid) textViewGrid.textContent = dict.grid;
        if (textViewPanel) textViewPanel.textContent = dict.panel;
        if (btnRefreshText) btnRefreshText.textContent = dict.refresh;
        if (btnPipText) btnPipText.textContent = dict.pipBtn;
        if (btnTaskbarText) btnTaskbarText.textContent = dict.taskbarBtn;
        if (footerLocalNote) footerLocalNote.textContent = dict.localOnly;
        if (urgentAlertBadge) urgentAlertBadge.textContent = dict.quotaAlert;

        const loadingTextEl = document.getElementById('loading-text');
        if (loadingTextEl) loadingTextEl.textContent = dict.loadingText;

        // Chú thích và nhãn trợ năng cũng phải đổi theo ngôn ngữ, trước đây
        // chúng bị bỏ quên nên luôn là tiếng Việt.
        for (const [id, attrs] of Object.entries(dict.controlLabels)) {
            const el = document.getElementById(id);
            if (!el) continue;
            if (attrs.title) el.setAttribute('title', attrs.title);
            if (attrs.aria) el.setAttribute('aria-label', attrs.aria);
        }

        // Modal
        if (modalTitle) modalTitle.textContent = dict.settingsTitle;
        if (modalDesc) modalDesc.textContent = dict.settingsDesc;
        if (labelGeminiKey) labelGeminiKey.textContent = dict.geminiKeyLabel;
        const geminiNote = document.getElementById('note-gemini-key');
        if (geminiNote) geminiNote.textContent = dict.geminiKeyNote;
        if (modalCancelBtn) modalCancelBtn.textContent = dict.cancel;
        if (modalSaveBtn) modalSaveBtn.textContent = dict.save;

        // Cập nhật chỉ dẫn chế độ xem
        const isPanel = appWrapper.classList.contains('is-side-panel');
        if (viewModeHint) viewModeHint.textContent = isPanel ? dict.viewPanelHint : dict.viewGridHint;

        if (!currentData) {
            const activeMetricsCount = document.getElementById('active-metrics-count');
            if (activeMetricsCount && !isFileProtocol && !providersContainer.querySelector('.empty-server-notice.offline-card')) {
                activeMetricsCount.textContent = dict.loadingMetricsCount || 'Đang tải…';
            }
        }

        if (isFileProtocol) {
            renderFileProtocolWarning();
            return;
        }

        if (providersContainer.querySelector('.empty-server-notice.offline-card')) {
            renderServerOfflineWarning();
            return;
        }

        if (reRender && currentData) {
            renderDashboard(currentData, true);
        }
    }

    function initViewMode() {
        const saved = localStorage.getItem('openusage_view_mode') || 'grid';
        setViewMode(saved, false, false);
    }

    function setViewMode(mode, save = true, broadcast = true) {
        const dict = DICTIONARY[currentLang];
        if (mode === 'panel') {
            appWrapper.classList.add('is-side-panel');
            viewPanelBtn.classList.add('active');
            viewGridBtn.classList.remove('active');
            viewPanelBtn.setAttribute('aria-pressed', 'true');
            viewGridBtn.setAttribute('aria-pressed', 'false');
            if (viewModeHint) viewModeHint.textContent = dict.viewPanelHint;
        } else {
            appWrapper.classList.remove('is-side-panel');
            viewGridBtn.classList.add('active');
            viewPanelBtn.classList.remove('active');
            viewGridBtn.setAttribute('aria-pressed', 'true');
            viewPanelBtn.setAttribute('aria-pressed', 'false');
            if (viewModeHint) viewModeHint.textContent = dict.viewGridHint;
        }
        if (save) {
            try { localStorage.setItem('openusage_view_mode', mode); } catch (e) { }
        }
        if (broadcast) {
            fetch('/api/preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ viewMode: mode })
            }).catch(() => { });
            if (syncChannel) syncChannel.postMessage({ type: 'viewMode', value: mode });
        }
    }

    // Xử lý nút làm mới
    refreshBtn.addEventListener('click', () => {
        const icon = refreshBtn.querySelector('.icon-spin-target');
        icon.classList.add('spinning');
        refreshBtn.disabled = true;
        const dict = DICTIONARY[currentLang];

        fetch('/api/refresh', { method: 'POST' })
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
            .then(data => {
                currentData = data;
                renderDashboard(data);
                showToast(dict.toastRefreshSuccess);
            })
            .catch(err => {
                showToast(dict.toastRefreshError + err.message);
            })
            .finally(() => {
                icon.classList.remove('spinning');
                refreshBtn.disabled = false;
            });
    });

    // Mở widget bằng cửa sổ ứng dụng để thanh tiêu đề hiện tên app thay vì origin localhost.
    if (btnOpenPipWidget) {
        btnOpenPipWidget.addEventListener('click', async () => {
            if (btnOpenPipWidget.disabled) return;
            const dict = DICTIONARY[currentLang];
            const widgetWidth = 460;
            btnOpenPipWidget.disabled = true;
            btnOpenPipWidget.setAttribute('aria-busy', 'true');
            try {
                const response = await fetch('/api/widget/open', {
                    method: 'POST',
                    headers: { 'X-HP-Request': '1' }
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                showToast(dict.pipSuccess);
            } catch (err) {
                console.warn('Không mở được chế độ ứng dụng, dùng cửa sổ độc lập:', err);
                const screenW = window.screen.availWidth || 1920;
                const leftPos = Math.max(0, screenW - widgetWidth - 20);
                window.open(
                    `/widget?v=13&lang=${encodeURIComponent(currentLang)}`,
                    'HP_AI_Usage_Widget',
                    `popup=yes,width=460,height=220,left=${leftPos},top=60,resizable=yes,scrollbars=yes`
                );
                showToast(dict.pipFallback);
            } finally {
                btnOpenPipWidget.disabled = false;
                btnOpenPipWidget.removeAttribute('aria-busy');
            }
        });
    }

    // Mở thanh tác vụ HP-AI-Usage.exe
    if (btnOpenTaskbar) {
        btnOpenTaskbar.addEventListener('click', async () => {
            if (btnOpenTaskbar.disabled) return;
            const dict = DICTIONARY[currentLang];
            btnOpenTaskbar.disabled = true;
            btnOpenTaskbar.setAttribute('aria-busy', 'true');
            try {
                const response = await fetch('/api/taskbar/open', {
                    method: 'POST',
                    headers: { 'X-HP-Request': '1' }
                });
                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.error || `HTTP ${response.status}`);
                }
                showToast(dict.taskbarSuccess);
            } catch (err) {
                console.warn('Không thể khởi chạy thanh tác vụ:', err);
                showToast(dict.taskbarError || ('Lỗi: ' + err.message));
            } finally {
                btnOpenTaskbar.disabled = false;
                btnOpenTaskbar.removeAttribute('aria-busy');
            }
        });
    }

    // Cài đặt
    // Cài đặt
    // Ghi nhớ nơi tiêu điểm bàn phím đang đứng để trả lại khi đóng hộp thoại
    let focusBeforeModal = null;

    function closeSettingsModal() {
        if (settingsModal.classList.contains('hidden')) return;
        settingsModal.classList.add('hidden');
        settingsModal.setAttribute('aria-hidden', 'true');
        if (focusBeforeModal && typeof focusBeforeModal.focus === 'function') {
            focusBeforeModal.focus();
        }
        focusBeforeModal = null;
    }

    settingsBtn.addEventListener('click', () => {
        focusBeforeModal = document.activeElement;
        settingsModal.classList.remove('hidden');
        settingsModal.setAttribute('aria-hidden', 'false');
        settingsModal.querySelector('.modal-card').focus();
        fetch('/api/settings')
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
            .then(info => {
                if (info.hasGeminiKey) {
                    inputGemini.placeholder = currentLang === 'en'
                        ? `Configured (${info.maskedGemini}) - Leave blank to keep`
                        : `Đã cấu hình (${info.maskedGemini}) - Để trống để giữ nguyên`;
                }
            })
            .catch(() => { });
    });

    modalCloseBtn.addEventListener('click', closeSettingsModal);
    modalCancelBtn.addEventListener('click', closeSettingsModal);

    // Đóng hộp thoại khi bấm ra ngoài vùng mờ hoặc ấn phím Escape
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettingsModal();
    });

    window.addEventListener('keydown', (e) => {
        if (settingsModal.classList.contains('hidden')) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            closeSettingsModal();
            return;
        }

        // Giữ tiêu điểm bàn phím ở trong hộp thoại
        if (e.key === 'Tab') {
            const card = settingsModal.querySelector('.modal-card');
            const focusable = [...card.querySelectorAll('button:not([disabled]), a[href], input:not([disabled])')];
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }, true);

    modalSaveBtn.addEventListener('click', () => {
        const dict = DICTIONARY[currentLang];
        const payload = {
            GEMINI_API_KEY: inputGemini.value.trim()
        };

        modalSaveBtn.disabled = true;
        modalSaveBtn.textContent = dict.saving;

        fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-HP-Request': '1' },
            body: JSON.stringify(payload)
        })
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
            .then(res => {
                if (res.success) {
                    closeSettingsModal();
                    inputGemini.value = '';
                    currentData = res.data;
                    renderDashboard(res.data);
                    showToast(dict.toastSettingsSuccess);
                } else {
                    showToast('Lỗi: ' + res.error);
                }
            })
            .catch(err => showToast('Lỗi kết nối: ' + err.message))
            .finally(() => {
                modalSaveBtn.disabled = false;
                modalSaveBtn.textContent = dict.save;
            });
    });

    function renderFileProtocolWarning() {
        const dict = DICTIONARY[currentLang];
        const activeCount = document.getElementById('active-providers-count');
        const activeMetrics = document.getElementById('active-metrics-count');
        if (activeCount) activeCount.textContent = '0 / 4';
        if (activeMetrics) activeMetrics.textContent = 'Offline';

        providersContainer.innerHTML = `
            <div class="empty-server-notice file-protocol-card">
                <div class="notice-icon-box warn">
                    <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                </div>
                <h2 class="notice-title">${escapeHTML(dict.fileProtocolTitle)}</h2>
                <p class="notice-desc">${escapeHTML(dict.fileProtocolDesc)}</p>
                <div class="notice-steps">
                    <div class="step-item"><span class="step-num">1</span> <span>${escapeHTML(dict.fileProtocolStep1)}</span></div>
                    <div class="step-item"><span class="step-num">2</span> <span>${escapeHTML(dict.fileProtocolStep2)}</span></div>
                    <div class="step-item"><span class="step-num">3</span> <span>${escapeHTML(dict.fileProtocolStep3)}</span></div>
                </div>
                <div class="notice-actions">
                    <a href="http://127.0.0.1:6736" class="btn btn-primary btn-notice">${escapeHTML(dict.openLocalServerBtn)} ↗</a>
                </div>
            </div>
        `;
    }

    function renderServerOfflineWarning(err) {
        const dict = DICTIONARY[currentLang];
        const activeCount = document.getElementById('active-providers-count');
        const activeMetrics = document.getElementById('active-metrics-count');
        if (activeCount) activeCount.textContent = '0 / 4';
        if (activeMetrics) activeMetrics.textContent = 'Offline';

        providersContainer.innerHTML = `
            <div class="empty-server-notice offline-card">
                <div class="notice-icon-box error">
                    <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                    </svg>
                </div>
                <h2 class="notice-title">${escapeHTML(dict.offlineTitle)}</h2>
                <p class="notice-desc">${escapeHTML(dict.offlineDesc)}</p>
                <p class="notice-subdesc">${escapeHTML(dict.offlineInstruction)}</p>
                <div class="notice-actions">
                    <button type="button" id="btn-retry-connection" class="btn btn-primary btn-notice">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
                        </svg>
                        ${escapeHTML(dict.retryConnectionBtn)}
                    </button>
                </div>
            </div>
        `;

        const retryBtn = document.getElementById('btn-retry-connection');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                providersContainer.innerHTML = `
                    <div class="loading-state">
                        <div class="loader-spinner"></div>
                        <p id="loading-text">${escapeHTML(dict.loadingText)}</p>
                    </div>
                `;
                loadUsageData(true);
            });
        }
    }

    function loadUsageData(force = false, background = false) {
        if (isFileProtocol) return;
        const dict = DICTIONARY[currentLang];
        if (!background) {
            lastUpdatedText.textContent = dict.connecting;
        }

        fetch(`/api/usage${force ? '?force=true' : ''}`)
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
            .then(data => {
                currentData = data;
                connectionStatusDot.classList.remove('offline');
                renderDashboard(data);
            })
            .catch(err => {
                lastUpdatedText.textContent = 'Offline';
                connectionStatusDot.classList.add('offline');
                console.error('Fetch error:', err);
                if (!currentData) {
                    renderServerOfflineWarning(err);
                }
            });
    }

    function isLiveConnected() {
        return !!liveSource && liveSource.readyState === EventSource.OPEN;
    }

    function connectLiveUpdates() {
        if (!window.EventSource) return;
        liveSource = new EventSource('/api/events');
        liveSource.addEventListener('usage', event => {
            try {
                const data = JSON.parse(event.data);
                if (!data || !data.providers) return;
                currentData = data;
                connectionStatusDot.classList.remove('offline');
                renderDashboard(data);
            } catch (err) {
                console.error('Live update error:', err);
            }
        });
        // Trước đây luồng đứt mà chấm trạng thái vẫn xanh
        liveSource.addEventListener('open', () => {
            connectionStatusDot.classList.remove('offline');
        });
        liveSource.addEventListener('error', () => {
            if (liveSource.readyState !== EventSource.OPEN) {
                connectionStatusDot.classList.add('offline');
            }
        });
    }

    let lastRenderedSignature = '';

    function renderDashboard(data, force = false) {
        if (!data || !data.providers) return;

        // Vẽ lại toàn bộ thẻ làm mất tiêu điểm bàn phím và khởi động lại hiệu ứng.
        // Dữ liệu không đổi thì chỉ cần cập nhật đồng hồ, không dựng lại thẻ.
        const signature = JSON.stringify(data.providers);
        if (!force && signature === lastRenderedSignature) {
            updateTimestamp(data);
            return;
        }
        lastRenderedSignature = signature;

        const dict = DICTIONARY[currentLang];
        const providers = data.providers;
        const providerKeys = ['claude', 'chatgpt', 'antigravity', 'gemini'];

        let activeCount = 0;
        let totalMetrics = 0;
        let warningCount = 0;
        let warningsList = [];

        providersContainer.innerHTML = '';

        providerKeys.forEach(key => {
            const p = providers[key] || { id: key, name: PROVIDER_NAMES[key], status: 'not_configured', metrics: [] };

            if (p.status === 'active') {
                activeCount++;
            }

            const metrics = Array.isArray(p.metrics) ? p.metrics : [];
            totalMetrics += metrics.filter(ui.isQuotaMetric).length;

            metrics.forEach(m => {
                const severity = ui.getMetricSeverity(m);
                if (severity === 'warning' || severity === 'critical') {
                    warningCount++;
                    warningsList.push(`${p.name} ${localizeMetric(m)}: ${ui.getUsedPercent(m)}% ${currentLang === 'en' ? 'used' : 'đã sử dụng'}`);
                }
            });

            // Đang quét dở thì chưa kết luận gì, không dựng cờ cảnh báo
            if (p.status !== 'active' && p.status !== 'loading') {
                warningCount++;
                warningsList.push(`${p.name}: ${localizeStatus(p.status)}`);
            }
            if (p.stale) {
                warningCount++;
                warningsList.push(`${p.name}: ${currentLang === 'en' ? 'waiting to sync' : 'đang chờ đồng bộ'}`);
            }

            // Dữ liệu méo của một nhà cung cấp không được làm hỏng cả bảng
            try {
                providersContainer.appendChild(createProviderCard(key, p));
            } catch (err) {
                console.error(`Không vẽ được thẻ ${key}:`, err);
                const fallback = document.createElement('div');
                fallback.className = `provider-card card-${key}`;
                const note = document.createElement('div');
                note.className = 'card-empty-state';
                note.textContent = currentLang === 'en'
                    ? `Could not display ${p.name || key}.`
                    : `Không hiển thị được ${p.name || key}.`;
                fallback.appendChild(note);
                providersContainer.appendChild(fallback);
            }
        });

        // Cập nhật thống kê trên thanh tiêu đề
        activeProvidersCount.textContent = `${activeCount} / ${providerKeys.length} ${dict.ready}`;
        activeMetricsCount.textContent = `${totalMetrics} ${dict.metrics}`;

        if (warningCount > 0) {
            pillWarningBox.classList.remove('hidden');
            warningMetricsCount.textContent = `${warningCount} ${dict.warnings}`;

            urgentAlert.classList.remove('hidden');
            urgentAlertText.textContent = `${warningsList.join(' • ')}. ${dict.limitReached}`;
        } else {
            pillWarningBox.classList.add('hidden');
            urgentAlert.classList.add('hidden');
        }

        updateTimestamp(data);
    }

    function updateTimestamp(data) {
        const d = new Date(data.timestamp || Date.now());
        const locale = currentLang === 'en' ? 'en-US' : 'vi-VN';
        lastUpdatedText.textContent = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function createProviderCard(key, p) {
        const dict = DICTIONARY[currentLang];
        const card = document.createElement('div');
        card.className = `provider-card card-${key}`;

        const glow = document.createElement('div');
        glow.className = 'card-brand-glow';
        card.appendChild(glow);

        // Header
        const header = document.createElement('div');
        header.className = 'card-header';

        const titleGroup = document.createElement('div');
        titleGroup.className = 'card-title-group';

        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'provider-icon-wrapper';
        iconWrapper.innerHTML = PROVIDER_ICONS[key] || 'AI';

        const titleMeta = document.createElement('div');
        titleMeta.className = 'card-title-meta';

        // Khi active hiển thị chấm trạng thái tinh gọn, khi có cảnh báo/lỗi hiển thị badge chi tiết
        const isErrorOrNotRunning = p.status !== 'active';
        const staleTooltip = escapeHTML(p.message || (currentLang === 'en' ? 'Stale data - waiting to sync' : 'Dữ liệu cũ - đang chờ đồng bộ'));
        const badgeHtml = p.stale
            ? `<span class="card-badge badge-stale" title="${staleTooltip}">${currentLang === 'en' ? 'Waiting to sync' : 'Chờ đồng bộ'}</span>`
            : isErrorOrNotRunning
                ? `<span class="card-badge badge-${escapeHTML(p.status)}">${escapeHTML(localizeStatus(p.status))}</span>`
                : `<span class="badge-status-dot active" title="${localizeStatus('active')}"></span>`;

        titleMeta.innerHTML = `
            <div class="card-name-row">
                <h2>${escapeHTML(p.name || PROVIDER_NAMES[key])}</h2>
                ${badgeHtml}
            </div>
            <span class="plan-badge">${escapeHTML(localizePlan(p.plan))}</span>
        `;

        titleGroup.appendChild(iconWrapper);
        titleGroup.appendChild(titleMeta);
        header.appendChild(titleGroup);
        card.appendChild(header);

        // Metrics
        const metricsContainer = document.createElement('div');
        metricsContainer.className = 'card-metrics';

        if (p.status === 'active' && p.metrics && p.metrics.length > 0) {
            p.metrics.forEach(m => {
                const metricRow = document.createElement('div');
                metricRow.className = 'metric-row';

                if (m.type === 'counter') {
                    const label = currentLang === 'en' ? `${m.count} available` : `${m.count} lượt khả dụng`;
                    metricRow.innerHTML = `
                        <div class="metric-info">
                            <span class="metric-name">${escapeHTML(localizeMetric(m))}</span>
                            <span class="metric-percentage normal">${escapeHTML(label)}</span>
                        </div>
                    `;
                } else if (m.type === 'status') {
                    const statusVal = currentLang === 'en' ? 'Active / Ready' : 'Sẵn sàng hoạt động';
                    metricRow.innerHTML = `
                        <div class="metric-info">
                            <span class="metric-name">${escapeHTML(localizeMetric(m))}</span>
                            <span class="metric-percentage normal">${statusVal}</span>
                        </div>
                    `;
                } else if (m.type === 'info') {
                    metricRow.innerHTML = `
                        <div class="metric-info">
                            <span class="metric-name" title="${escapeHTML(m.name)}">${escapeHTML(localizeMetric(m))}</span>
                            <span class="metric-badge-info">${escapeHTML(m.value)}</span>
                        </div>
                        ${m.label ? `<div class="metric-sublabel">${escapeHTML(m.label)}</div>` : ''}
                    `;
                } else {
                    const used = ui.getUsedPercent(m);
                    const severity = ui.getMetricSeverity(m);
                    const usedLabel = currentLang === 'en' ? `${used}% used` : `Đã sử dụng ${used}%`;

                    metricRow.innerHTML = `
                        <div class="metric-info">
                            <span class="metric-name" title="${escapeHTML(m.name)}">${escapeHTML(localizeMetric(m))}</span>
                            <span class="metric-percentage ${severity}">${usedLabel}</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill ${severity}" style="width: ${used}%"></div>
                        </div>
                        ${m.resetsAt ? `
                            <div class="metric-reset-countdown" data-resets-at="${escapeHTML(m.resetsAt)}">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <polyline points="12 6 12 12 16 14"/>
                                </svg>
                                <span class="countdown-text">${formatCountdown(m.resetsAt)}</span>
                            </div>
                        ` : ''}
                    `;
                }
                metricsContainer.appendChild(metricRow);
            });
        } else {
            const emptyState = document.createElement('div');
            emptyState.className = 'card-empty-state';
            emptyState.textContent = localizeMessage(p) || dict.noUsageInfo;
            metricsContainer.appendChild(emptyState);
        }

        card.appendChild(metricsContainer);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'card-footer';
        const accountText = (p.account === 'Cục bộ' || p.account === 'Phiên cục bộ (Active)')
            ? (currentLang === 'en' ? 'Local' : 'Cục bộ')
            : (p.account || (currentLang === 'en' ? 'Local' : 'Cục bộ'));

        const statusClass = p.status === 'active' ? 'ready' : 'pending';
        const statusText = p.status === 'active' ? dict.statusReady : dict.statusPending;

        footer.innerHTML = `
            <span class="account-tag" title="${escapeHTML(accountText)}">${escapeHTML(dict.accountLabel)}: ${escapeHTML(accountText)}</span>
            <span class="footer-status ${statusClass}" title="${statusText}">
                <span class="footer-dot">●</span>
                <span class="footer-text">${statusText}</span>
            </span>
        `;
        card.appendChild(footer);

        return card;
    }

    // Toàn bộ phần chuyển ngữ nay dựa trên khóa ổn định do bộ quét gửi lên,
    // thay vì dò chuỗi con hai chiều như trước.
    function localizeMetric(metric) {
        return i18n.metricLabel(metric, currentLang);
    }

    function localizePlan(plan) {
        return i18n.planLabel(plan, currentLang);
    }

    function localizeMessage(provider) {
        return i18n.messageLabel(provider, currentLang);
    }

    function localizeStatus(status) {
        return i18n.statusLabel(status, currentLang);
    }

    function formatCountdown(isoString) {
        if (!isoString) return '';
        const dict = DICTIONARY[currentLang];
        const target = new Date(isoString);
        const now = new Date();
        const diff = target - now;

        if (diff <= 0) return dict.resetting;
        return `${dict.resetsIn} ${formatTimeDiff(diff)}`;
    }

    function formatTimeDiff(ms) {
        const totalSec = Math.floor(ms / 1000);
        const days = Math.floor(totalSec / 86400);
        const hours = Math.floor((totalSec % 86400) / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        const seconds = totalSec % 60;

        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
    }

    function updateLiveCountdowns() {
        const elements = document.querySelectorAll('[data-resets-at]');
        elements.forEach(el => {
            const iso = el.getAttribute('data-resets-at');
            const textSpan = el.querySelector('.countdown-text');
            if (textSpan && iso) {
                textSpan.textContent = formatCountdown(iso);
            }
        });
    }

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 2500);
    }
});
