const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { providerResult, quotaMetric } = require('../lib/provider');

// Bộ nhớ đệm và cơ chế lùi khi bị giới hạn tần suất, giống cách làm ở claude.js.
// Không có hai thứ này thì mỗi vòng quét 15 giây lại gọi một lần, tức khoảng 240
// lượt mỗi giờ tới một điểm cuối không công bố.
let cachedCodexResult = null;
let lastCodexFetchTime = 0;
let codexRateLimitCooldownUntil = 0;
let codexRateLimitCount = 0;
const CODEX_CACHE_TTL_MS = 60000;
const CODEX_RATE_LIMIT_BASE_MS = 300000;
const CODEX_RATE_LIMIT_MAX_MS = 3600000;

function codexError(message, extra = {}) {
    return providerResult('chatgpt', 'ChatGPT', 'error', message, extra);
}

// Dữ liệu cũ phải được đánh dấu stale, nếu không giao diện sẽ hiển thị số của
// lần đồng bộ trước như thể vừa cập nhật.
function staleCodexResult(reason, retryAt) {
    if (!cachedCodexResult) return null;
    return {
        ...cachedCodexResult,
        stale: true,
        syncStatus: reason,
        syncRetryAt: retryAt ? new Date(retryAt).toISOString() : null,
        message: reason === 'rate_limited'
            ? 'ChatGPT đang giới hạn tần suất đồng bộ; số liệu này là bản gần nhất và sẽ tự cập nhật lại.'
            : 'Chưa lấy được số liệu ChatGPT mới; đang hiển thị bản đồng bộ gần nhất.'
    };
}

function buildCodexResult(usageData) {
    const metrics = [];
    const rateLimit = usageData.rate_limit || {};

    // 1. Cửa sổ phiên (Primary window - thường là 5 giờ)
    if (rateLimit.primary_window) {
        const w = rateLimit.primary_window;
        metrics.push(quotaMetric({
            id: 'chatgpt_primary',
            name: 'Cửa sổ phiên (Session - 5h)',
            metricKey: 'session_5h',
            windowType: 'session',
            usedPercent: w.used_percent,
            resetsAt: w.reset_at ? new Date(w.reset_at * 1000).toISOString() : null
        }));
    }

    // 2. Cửa sổ tuần (Secondary window - 7 ngày)
    if (rateLimit.secondary_window) {
        const w = rateLimit.secondary_window;
        metrics.push(quotaMetric({
            id: 'chatgpt_weekly',
            name: 'Hạn mức tuần (Weekly - 7d)',
            metricKey: 'weekly_7d',
            windowType: 'weekly',
            usedPercent: w.used_percent,
            resetsAt: w.reset_at ? new Date(w.reset_at * 1000).toISOString() : null
        }));
    }

    // 3. Tín dụng đặt lại hạn mức (Rate limit reset credits)
    if (usageData.rate_limit_reset_credits) {
        const available = usageData.rate_limit_reset_credits.available_count || 0;
        metrics.push({
            id: 'chatgpt_credits',
            name: 'Lượt khôi phục hạn mức (Reset Credits)',
            metricKey: 'reset_credits',
            type: 'counter',
            count: available,
            label: `${available} lượt khả dụng`
        });
    }

    const planName = usageData.plan_type
        ? `ChatGPT ${usageData.plan_type.charAt(0).toUpperCase() + usageData.plan_type.slice(1)}`
        : 'ChatGPT Plus';

    return {
        id: 'chatgpt',
        name: 'ChatGPT',
        status: 'active',
        plan: planName,
        account: usageData.email || 'Cục bộ',
        metrics,
        updatedAt: new Date().toISOString()
    };
}

/**
 * Thu thập dữ liệu hạn mức ChatGPT / Codex từ tệp xác thực auth.json
 */
async function scanCodex(force = false) {
    try {
        const credPath = path.join(os.homedir(), '.codex', 'auth.json');
        if (!fs.existsSync(credPath)) {
            return providerResult('chatgpt', 'ChatGPT', 'not_configured',
                'Chưa tìm thấy tệp xác thực Codex CLI (~/.codex/auth.json).',
                { messageKey: 'codex_not_configured' });
        }

        let creds;
        try {
            creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        } catch {
            return codexError('Tệp auth.json của Codex bị lỗi cú pháp.', { messageKey: 'codex_bad_auth' });
        }

        const token = creds.tokens?.access_token || creds.tokens?.accessToken || creds.access_token;
        if (!token) {
            return providerResult('chatgpt', 'ChatGPT', 'not_logged_in',
                'Không tìm thấy mã truy cập (access token) trong auth.json.',
                { messageKey: 'codex_not_logged_in' });
        }

        const now = Date.now();

        // Nhánh hạ nhiệt luôn thoát, kể cả khi chưa có bộ đệm
        if (now < codexRateLimitCooldownUntil) {
            return staleCodexResult('rate_limited', codexRateLimitCooldownUntil) || codexError(
                'Máy chủ ChatGPT đang giới hạn tần suất yêu cầu (429). Hệ thống sẽ tự kết nối lại sau ít phút.',
                { messageKey: 'codex_rate_limited', syncStatus: 'rate_limited', syncRetryAt: new Date(codexRateLimitCooldownUntil).toISOString() }
            );
        }

        if (!force && cachedCodexResult && now - lastCodexFetchTime < CODEX_CACHE_TTL_MS) {
            return cachedCodexResult;
        }

        const response = await fetchCodexUsage(token);

        if (response.success && response.data) {
            cachedCodexResult = buildCodexResult(response.data);
            lastCodexFetchTime = now;
            codexRateLimitCount = 0;
            codexRateLimitCooldownUntil = 0;
            return cachedCodexResult;
        }

        if (response.statusCode === 429) {
            codexRateLimitCount += 1;
            const cooldownMs = Math.min(
                CODEX_RATE_LIMIT_MAX_MS,
                CODEX_RATE_LIMIT_BASE_MS * (2 ** (codexRateLimitCount - 1))
            );
            codexRateLimitCooldownUntil = now + cooldownMs;
            console.log(`ChatGPT rate limited (429). Tạm dừng đồng bộ ${Math.round(cooldownMs / 60000)} phút.`);
            return staleCodexResult('rate_limited', codexRateLimitCooldownUntil) || codexError(
                'Máy chủ ChatGPT đang giới hạn tần suất yêu cầu (429). Hệ thống sẽ tự kết nối lại sau ít phút.',
                { syncStatus: 'rate_limited', syncRetryAt: new Date(codexRateLimitCooldownUntil).toISOString() }
            );
        }

        return staleCodexResult('connection_error', now + CODEX_CACHE_TTL_MS)
            || codexError(response.message || 'Không thể kết nối đến máy chủ ChatGPT hoặc mã truy cập đã hết hạn.',
                { messageKey: 'codex_connection_error' });
    } catch (err) {
        return staleCodexResult('connection_error', Date.now() + CODEX_CACHE_TTL_MS) || codexError(err.message);
    }
}

function fetchCodexUsage(token) {
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'chatgpt.com',
            path: '/backend-api/wham/usage',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'codex'
            },
            timeout: 7000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    resolve({
                        success: false,
                        statusCode: res.statusCode,
                        message: `Máy chủ ChatGPT trả về mã lỗi ${res.statusCode}.`
                    });
                    return;
                }
                try {
                    resolve({ success: true, statusCode: 200, data: JSON.parse(data) });
                } catch {
                    resolve({ success: false, statusCode: 200, message: 'Lỗi phân tích cú pháp dữ liệu từ ChatGPT.' });
                }
            });
        });

        req.on('error', (err) => resolve({ success: false, message: `Lỗi kết nối mạng: ${err.message}` }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, message: 'Quá thời gian kết nối tới máy chủ ChatGPT (Timeout).' });
        });
        req.end();
    });
}

module.exports = { scanCodex };
