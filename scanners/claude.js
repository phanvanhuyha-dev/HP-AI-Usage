const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { providerResult, quotaMetric } = require('../lib/provider');

// Bộ nhớ đệm giữ trạng thái hợp lệ gần nhất (Stale-While-Revalidate)
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'claude_cache.json');
let cachedClaudeResult = loadDiskCache();
let lastClaudeFetchTime = cachedClaudeResult ? Date.now() : 0;
let claudeRateLimitCooldownUntil = 0;
let claudeRateLimitCount = 0;
let lastLocalLimitScanTime = 0;
let cachedLocalLimitSignal = null;
const CLAUDE_CACHE_TTL_MS = 300000;
const CLAUDE_RATE_LIMIT_BASE_MS = 300000;
const CLAUDE_RATE_LIMIT_MAX_MS = 3600000;

function loadDiskCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            if (parsed && Array.isArray(parsed.metrics) && parsed.metrics.length > 0) {
                return parsed;
            }
        }
    } catch {
        // ignore
    }
    return null;
}

function saveDiskCache(data) {
    try {
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch {
        // ignore
    }
}

/**
 * Dựng tên gói cước thật từ tệp phiên đăng nhập của Claude Code.
 *
 * Điểm cuối /api/oauth/usage không trả về tên gói, nên bản cũ ghi cứng
 * 'Claude Pro / Subscription' cho mọi tài khoản: người dùng gói Max 5x vẫn thấy
 * hiển thị là Pro. Thông tin thật nằm trong ~/.claude/.credentials.json:
 *   subscriptionType = "max", rateLimitTier = "default_claude_max_5x"
 */
function formatClaudePlan(oauth) {
    const sub = String(oauth?.subscriptionType || '').toLowerCase();
    const tier = String(oauth?.rateLimitTier || '').toLowerCase();

    // Bậc nhân nằm ở đuôi rateLimitTier, ví dụ default_claude_max_5x
    const multiplier = tier.match(/_(\d+)x$/);
    const suffix = multiplier ? ` ${multiplier[1]}x` : '';

    if (sub === 'max') return `Claude Max${suffix}`;
    if (sub === 'pro') return 'Claude Pro';
    if (sub === 'free') return 'Claude Free';
    if (sub === 'team') return `Claude Team${suffix}`;
    if (sub === 'enterprise') return 'Claude Enterprise';
    if (sub) return `Claude ${sub.charAt(0).toUpperCase() + sub.slice(1)}${suffix}`;
    return 'Claude';
}

function buildClaudeResult(usageData, updatedAt = new Date().toISOString(), plan = 'Claude') {
    const metrics = [];
    if (usageData.five_hour) {
        metrics.push(quotaMetric({
            id: 'claude_session',
            name: 'Phiên làm việc (Session - 5h)',
            metricKey: 'session_5h',
            windowType: 'session',
            usedPercent: usageData.five_hour.utilization,
            resetsAt: usageData.five_hour.resets_at
        }));
    }
    if (usageData.seven_day) {
        metrics.push(quotaMetric({
            id: 'claude_weekly',
            name: 'Hạn mức tuần (Weekly - 7d)',
            metricKey: 'weekly_7d',
            windowType: 'weekly',
            usedPercent: usageData.seven_day.utilization,
            resetsAt: usageData.seven_day.resets_at
        }));
    }
    if (Array.isArray(usageData.limits)) {
        for (const limit of usageData.limits) {
            if (!limit.scope?.model?.display_name) continue;
            const modelName = limit.scope.model.display_name;
            metrics.push(quotaMetric({
                id: `claude_${modelName.toLowerCase()}`,
                name: `Mô hình ${modelName}`,
                metricKey: 'model',
                metricParams: { name: modelName },
                usedPercent: limit.percent,
                resetsAt: limit.resets_at
            }));
        }
    }
    return {
        id: 'claude',
        name: 'Claude',
        status: 'active',
        plan,
        account: 'Cục bộ',
        metrics,
        updatedAt
    };
}

function loadClaudeLocalUsage() {
    try {
        const statePath = path.join(os.homedir(), '.claude.json');
        if (!fs.existsSync(statePath)) return null;
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const local = state.cachedUsageUtilization;
        if (!local || !local.utilization || !Number.isFinite(Number(local.fetchedAtMs))) return null;
        return { usageData: local.utilization, fetchedAtMs: Number(local.fetchedAtMs) };
    } catch {
        return null;
    }
}

function staleClaudeResult(reason, retryAt) {
    if (!cachedClaudeResult) return null;
    return {
        ...cachedClaudeResult,
        stale: true,
        syncStatus: reason,
        syncRetryAt: retryAt ? new Date(retryAt).toISOString() : null,
        message: reason === 'rate_limited'
            ? 'Anthropic đang giới hạn tần suất đồng bộ; số liệu này là bản gần nhất và sẽ tự cập nhật lại.'
            : 'Chưa thể lấy số liệu Claude mới; đang hiển thị bản đồng bộ gần nhất.'
    };
}

// Duyệt thư mục và đọc tệp bằng fs bất đồng bộ. Bản cũ dùng readdirSync và
// statSync trên từng tệp trong cây thư mục dự án, chặn vòng lặp sự kiện của máy chủ.
async function collectRecentClaudeTranscripts(rootDir, depth = 0, files = []) {
    if (depth > 3) return files;
    let entries;
    try {
        entries = await fsp.readdir(rootDir, { withFileTypes: true });
    } catch {
        return files; // thư mục không tồn tại hoặc không đọc được
    }

    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name);
        try {
            if (entry.isDirectory()) {
                await collectRecentClaudeTranscripts(entryPath, depth + 1, files);
            } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                const stat = await fsp.stat(entryPath);
                if (Date.now() - stat.mtimeMs < 86400000) {
                    files.push({ path: entryPath, mtimeMs: stat.mtimeMs, size: stat.size });
                }
            }
        } catch {
            // bỏ qua mục không đọc được, tiếp tục phần còn lại
        }
    }
    return files;
}

async function findLocalSessionLimitSignal() {
    const now = Date.now();
    if (now - lastLocalLimitScanTime < 15000) return cachedLocalLimitSignal;
    lastLocalLimitScanTime = now;
    cachedLocalLimitSignal = null;

    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    const files = (await collectRecentClaudeTranscripts(projectsDir))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 12);

    for (const file of files) {
        let handle;
        try {
            const tailSize = Math.min(file.size, 196608);
            const buffer = Buffer.alloc(tailSize);
            handle = await fsp.open(file.path, 'r');
            await handle.read(buffer, 0, tailSize, file.size - tailSize);
            await handle.close();
            handle = null;

            const lines = buffer.toString('utf8').split(/\r?\n/).reverse();
            for (const line of lines) {
                if (!line.includes("You've hit your session limit")) continue;
                let item;
                try { item = JSON.parse(line); } catch { continue; }
                const text = Array.isArray(item.message?.content)
                    ? item.message.content.filter(part => part.type === 'text').map(part => part.text || '').join(' ')
                    : '';
                if (!item.isApiErrorMessage || !/You've hit your session limit/i.test(text)) continue;
                const timestamp = new Date(item.timestamp || 0).getTime();
                if (Number.isFinite(timestamp) && now - timestamp < 86400000) {
                    cachedLocalLimitSignal = { timestamp };
                    return cachedLocalLimitSignal;
                }
            }
        } catch {
            // tiếp tục với bản ghi gần đây kế tiếp
            if (handle) {
                try { await handle.close(); } catch { /* đã đóng */ }
            }
        }
    }
    return null;
}

async function applyLocalSessionLimit(result) {
    if (!result || !Array.isArray(result.metrics)) return null;
    const signal = await findLocalSessionLimitSignal();
    if (!signal) return null;
    const sessionMetric = result.metrics.find(metric => metric.id === 'claude_session');
    const resetAt = sessionMetric?.resetsAt ? new Date(sessionMetric.resetsAt).getTime() : 0;
    const resultUpdatedAt = new Date(result.updatedAt || 0).getTime();
    if (!resetAt || resetAt <= Date.now() || signal.timestamp < resultUpdatedAt) return null;

    const { stale, syncStatus, syncRetryAt, message, ...cleanResult } = result;
    return {
        ...cleanResult,
        metrics: result.metrics.map(metric => metric.id === 'claude_session'
            ? { ...metric, usedPercent: 100, remainingPercent: 0 }
            : metric),
        updatedAt: new Date(signal.timestamp).toISOString(),
        syncSource: 'claude_local_limit_event'
    };
}

/**
 * Thu thập dữ liệu hạn mức của Claude từ tệp xác thực cục bộ
 */
async function scanClaude(force = false) {
    try {
        const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
        if (!fs.existsSync(credPath)) {
            return providerResult('claude', 'Claude', 'not_configured',
                'Chưa tìm thấy phiên Claude Code. Hãy chạy lệnh "claude" trên cửa sổ dòng lệnh để đăng nhập.',
                { plan: 'Chưa đăng nhập', messageKey: 'claude_not_configured' });
        }

        let creds;
        try {
            creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        } catch {
            return providerResult('claude', 'Claude', 'error',
                'Tệp thông tin xác thực (.credentials.json) bị lỗi định dạng JSON.',
                { plan: 'Lỗi định dạng', messageKey: 'claude_bad_credentials' });
        }

        const token = creds.claudeAiOauth?.accessToken || creds.accessToken || process.env.CLAUDE_CODE_OAUTH_TOKEN;
        if (!token) {
            return providerResult('claude', 'Claude', 'not_logged_in',
                'Không tìm thấy mã truy cập (access token) trong tệp thông tin xác thực Claude Code.',
                { plan: 'Chưa có Token', messageKey: 'claude_not_logged_in' });
        }

        const now = Date.now();
        const plan = formatClaudePlan(creds.claudeAiOauth);

        // Bộ đệm trên đĩa có thể được ghi từ phiên bản cũ, hoặc người dùng vừa
        // đổi gói, nên luôn đồng bộ lại tên gói theo tệp phiên đăng nhập.
        if (cachedClaudeResult && cachedClaudeResult.plan !== plan) {
            cachedClaudeResult = { ...cachedClaudeResult, plan };
        }

        const localUsage = loadClaudeLocalUsage();
        const cachedUpdatedAt = cachedClaudeResult ? new Date(cachedClaudeResult.updatedAt || 0).getTime() : 0;
        if (localUsage && localUsage.fetchedAtMs > cachedUpdatedAt) {
            cachedClaudeResult = buildClaudeResult(localUsage.usageData, new Date(localUsage.fetchedAtMs).toISOString(), plan);
            lastClaudeFetchTime = localUsage.fetchedAtMs;
            saveDiskCache(cachedClaudeResult);
            return cachedClaudeResult;
        }

        const localLimitResult = await applyLocalSessionLimit(cachedClaudeResult);
        if (localLimitResult) {
            cachedClaudeResult = localLimitResult;
            lastClaudeFetchTime = now;
            claudeRateLimitCount = 0;
            claudeRateLimitCooldownUntil = 0;
            saveDiskCache(cachedClaudeResult);
            return cachedClaudeResult;
        }

        // 1. Đang trong thời gian hạ nhiệt do Anthropic trả về 429 Rate Limit.
        //
        // Nhánh này phải LUÔN thoát. Bản cũ chỉ thoát khi đã có bộ đệm, nên đúng
        // vào lúc chưa có dữ liệu, tức máy mới cài hoặc lần đồng bộ đầu tiên thất
        // bại, thời gian hạ nhiệt không chặn gì cả: bộ hẹn giờ nền vẫn bắn yêu cầu
        // mỗi 15 giây trong khi nhật ký báo là đang tạm dừng.
        if (now < claudeRateLimitCooldownUntil) {
            return staleClaudeResult('rate_limited', claudeRateLimitCooldownUntil) || providerResult(
                'claude', 'Claude', 'error',
                'Anthropic đang giới hạn tần suất yêu cầu (429). Hệ thống sẽ tự kết nối lại sau ít phút.',
                {
                    plan,
                    messageKey: 'claude_rate_limited',
                    syncStatus: 'rate_limited',
                    syncRetryAt: new Date(claudeRateLimitCooldownUntil).toISOString()
                });
        }

        // 2. Nếu chưa hết hạn bộ đệm và không bị ép làm mới (force), tái sử dụng kết quả đệm
        if (!force && cachedClaudeResult && (now - lastClaudeFetchTime < CLAUDE_CACHE_TTL_MS)) {
            return cachedClaudeResult;
        }

        // 3. Thực hiện truy vấn mạng tới máy chủ Anthropic
        const response = await fetchClaudeUsage(token);

        if (response.success && response.data) {
            cachedClaudeResult = buildClaudeResult(response.data, new Date().toISOString(), plan);
            lastClaudeFetchTime = now;
            claudeRateLimitCount = 0;
            claudeRateLimitCooldownUntil = 0;
            saveDiskCache(cachedClaudeResult);
            return cachedClaudeResult;
        }

        // 4. Xử lý các trường hợp lỗi từ máy chủ Anthropic
        if (response.statusCode === 429) {
            claudeRateLimitCount += 1;
            const cooldownMs = Math.min(
                CLAUDE_RATE_LIMIT_MAX_MS,
                CLAUDE_RATE_LIMIT_BASE_MS * (2 ** (claudeRateLimitCount - 1))
            );
            claudeRateLimitCooldownUntil = now + cooldownMs;
            console.log(`Anthropic rate limited (429). Tạm dừng đồng bộ Claude ${Math.round(cooldownMs / 60000)} phút.`);
            return staleClaudeResult('rate_limited', claudeRateLimitCooldownUntil) || providerResult(
                'claude', 'Claude', 'error',
                'Máy chủ Anthropic đang tạm thời giới hạn tần suất yêu cầu (Rate Limit 429). Hệ thống sẽ tự kết nối lại trong ít phút.',
                {
                    plan,
                    syncStatus: 'rate_limited',
                    syncRetryAt: new Date(claudeRateLimitCooldownUntil).toISOString()
                });
        }

        // 5. Nếu gặp lỗi mạng hoặc lỗi khác, tái sử dụng dữ liệu đệm nếu có
        return staleClaudeResult('connection_error', now + CLAUDE_CACHE_TTL_MS) || providerResult(
            'claude', 'Claude', 'error',
            response.message || 'Không thể kết nối đến máy chủ Anthropic hoặc phiên đăng nhập cần được làm mới.',
            { plan: 'Lỗi kết nối', messageKey: 'claude_connection_error' });
    } catch (err) {
        return staleClaudeResult('connection_error', Date.now() + CLAUDE_CACHE_TTL_MS)
            || providerResult('claude', 'Claude', 'error', err.message);
    }
}

function fetchClaudeUsage(token) {
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.anthropic.com',
            path: '/api/oauth/usage',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'claude-code',
                'anthropic-version': '2023-06-01'
            },
            timeout: 8000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve({ success: true, data: JSON.parse(data) });
                    } catch (e) {
                        resolve({ success: false, statusCode: res.statusCode, message: 'Lỗi phân tích cú pháp dữ liệu từ Anthropic.' });
                    }
                } else {
                    resolve({ success: false, statusCode: res.statusCode, message: `Máy chủ Anthropic trả về mã lỗi ${res.statusCode}.` });
                }
            });
        });

        req.on('error', (err) => resolve({ success: false, message: `Lỗi kết nối mạng: ${err.message}` }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, message: 'Quá thời gian kết nối tới máy chủ Anthropic (Timeout).' });
        });
        req.end();
    });
}

module.exports = { scanClaude };
