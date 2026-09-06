/**
 * Từ điển dùng chung cho cả bảng điều khiển và widget.
 *
 * Trước đây máy chủ sinh ra chuỗi tiếng Việt rồi trình duyệt dịch ngược lại bằng
 * cách dò chuỗi con hai chiều, nên tên ngắn khớp nhầm tên dài, mô hình con của
 * Claude sinh động thì không dịch được, và hai bản từ điển ở app.js với widget.js
 * đã lệch nhau. Ở đây bộ quét gửi khóa ổn định, còn nhãn hiển thị nằm một chỗ.
 */
(function initUsageI18n(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.UsageI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createUsageI18n() {

    const METRIC_LABELS = {
        vi: {
            session_5h: 'Phiên 5 giờ',
            weekly_7d: 'Hạn mức tuần',
            model: p => `Mô hình ${p.name}`,
            group_session: p => `${p.name} (5h)`,
            group_weekly: p => `${p.name} (tuần)`,
            reset_credits: 'Lượt đặt lại',
            auth_status: 'Xác thực API',
            available_models: 'Mô hình khả dụng',
            credit_balance: 'Số dư tín dụng'
        },
        en: {
            session_5h: '5-hour session',
            weekly_7d: 'Weekly limit',
            model: p => `${p.name} model`,
            group_session: p => `${p.name} (5h)`,
            group_weekly: p => `${p.name} (weekly)`,
            reset_credits: 'Reset credits',
            auth_status: 'API authentication',
            available_models: 'Available models',
            credit_balance: 'Credit balance'
        }
    };

    const STATUS_LABELS = {
        vi: {
            active: 'Sẵn sàng',
            loading: 'Đang tải…',
            not_running: 'Chưa mở ứng dụng',
            not_configured: 'Chưa cấu hình',
            not_logged_in: 'Chưa đăng nhập',
            error: 'Lỗi kết nối'
        },
        en: {
            active: 'Ready',
            loading: 'Loading…',
            not_running: 'App is closed',
            not_configured: 'Setup needed',
            not_logged_in: 'Not signed in',
            error: 'Connection error'
        }
    };

    const MESSAGE_LABELS = {
        vi: {
            claude_not_configured: 'Chưa tìm thấy phiên Claude Code. Hãy chạy lệnh "claude" trên cửa sổ dòng lệnh để đăng nhập.',
            claude_bad_credentials: 'Tệp thông tin xác thực (.credentials.json) bị lỗi định dạng JSON.',
            claude_not_logged_in: 'Không tìm thấy mã truy cập trong tệp thông tin xác thực Claude Code.',
            claude_rate_limited: 'Anthropic đang giới hạn tần suất yêu cầu. Hệ thống sẽ tự kết nối lại sau ít phút.',
            claude_connection_error: 'Không kết nối được máy chủ Anthropic, hoặc phiên đăng nhập cần được làm mới.',
            codex_not_configured: 'Chưa tìm thấy tệp xác thực Codex CLI (~/.codex/auth.json).',
            codex_bad_auth: 'Tệp auth.json của Codex bị lỗi cú pháp.',
            codex_not_logged_in: 'Không tìm thấy mã truy cập trong tệp auth.json.',
            codex_rate_limited: 'ChatGPT đang giới hạn tần suất yêu cầu. Hệ thống sẽ tự kết nối lại sau ít phút.',
            codex_connection_error: 'Không kết nối được máy chủ ChatGPT, hoặc mã truy cập đã hết hạn.',
            antigravity_not_running: 'Chưa phát hiện AntiGravity IDE. Hãy mở ứng dụng AntiGravity.',
            gemini_not_running: 'AntiGravity IDE chưa chạy nên chưa lấy được hạn mức Gemini.',
            antigravity_quota_error: 'Không lấy được thông tin hạn mức từ máy chủ AntiGravity.',
            pplx_not_configured: 'Chưa cấu hình khóa API Perplexity. Hãy bấm vào Cài đặt để thêm.',
            pplx_invalid_key: 'Khóa API Perplexity không hợp lệ.'
        },
        en: {
            claude_not_configured: 'Claude Code is not signed in. Run "claude" in a terminal to authenticate.',
            claude_bad_credentials: 'The Claude credentials file (.credentials.json) is not valid JSON.',
            claude_not_logged_in: 'No access token found in the Claude Code credentials file.',
            claude_rate_limited: 'Anthropic is rate limiting requests. HP-AI-Usage will retry in a few minutes.',
            claude_connection_error: 'Could not reach Anthropic, or the session needs to be refreshed.',
            codex_not_configured: 'Codex CLI credentials not found (~/.codex/auth.json).',
            codex_bad_auth: 'The Codex auth.json file is not valid JSON.',
            codex_not_logged_in: 'No access token found in auth.json.',
            codex_rate_limited: 'ChatGPT is rate limiting requests. HP-AI-Usage will retry in a few minutes.',
            codex_connection_error: 'Could not reach ChatGPT, or the access token has expired.',
            antigravity_not_running: 'AntiGravity IDE is not running. Please launch the app.',
            gemini_not_running: 'AntiGravity IDE is not running, so Gemini quotas are unavailable.',
            antigravity_quota_error: 'Could not read quota information from the AntiGravity server.',
            pplx_not_configured: 'No Perplexity API key configured. Add one in Settings.',
            pplx_invalid_key: 'The Perplexity API key is not valid.'
        }
    };

    const PLAN_LABELS = {
        vi: {
            'Google DeepMind IDE': 'DeepMind IDE',
            'Gemini Pro & Flash Pool': 'Gemini Pool',
            'Perplexity API': 'Perplexity API'
        },
        en: {
            'Google DeepMind IDE': 'DeepMind IDE',
            'Gemini Pro & Flash Pool': 'Gemini Pool',
            'Perplexity API': 'Perplexity API'
        }
    };

    function pickLang(lang) {
        return lang === 'en' ? 'en' : 'vi';
    }

    // Nhãn chỉ số: ưu tiên khóa ổn định, chỉ rơi về tên do máy chủ gửi khi
    // gặp một loại chỉ số mà từ điển chưa biết.
    function metricLabel(metric, lang) {
        if (!metric) return '';
        const table = METRIC_LABELS[pickLang(lang)];
        const entry = metric.metricKey ? table[metric.metricKey] : null;
        if (typeof entry === 'function') return entry(metric.metricParams || {});
        if (typeof entry === 'string') return entry;
        return metric.name || '';
    }

    function statusLabel(status, lang) {
        const table = STATUS_LABELS[pickLang(lang)];
        return table[status] || status || '';
    }

    // Thông báo: khóa ổn định trước, nếu bộ quét chưa gắn khóa thì dùng nguyên văn.
    function messageLabel(provider, lang) {
        if (!provider) return '';
        const table = MESSAGE_LABELS[pickLang(lang)];
        if (provider.messageKey && table[provider.messageKey]) return table[provider.messageKey];
        return provider.message || '';
    }

    function planLabel(plan, lang) {
        if (!plan) return pickLang(lang) === 'en' ? 'Standard' : 'Gói chuẩn';
        return PLAN_LABELS[pickLang(lang)][plan] || plan;
    }

    return {
        METRIC_LABELS,
        STATUS_LABELS,
        MESSAGE_LABELS,
        PLAN_LABELS,
        pickLang,
        metricLabel,
        statusLabel,
        messageLabel,
        planLabel
    };
});
