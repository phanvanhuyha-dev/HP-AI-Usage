const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { providerResult, quotaMetric } = require('../lib/provider');

const execFileAsync = promisify(execFile);

// Ghi nhớ thông tin máy chủ ngôn ngữ để không phải dò lại ở mỗi vòng quét.
// Việc dò tìm phải gọi PowerShell và netstat, rất tốn thời gian.
let cachedServerInfo = null;
let cachedServerInfoAt = 0;
const DISCOVERY_TTL_MS = 60000;

function notRunningPair() {
    return {
        antigravity: providerResult('antigravity', 'AntiGravity', 'not_running',
            'Chưa phát hiện tiến trình AntiGravity IDE (language_server_windows_x.exe). Hãy mở ứng dụng AntiGravity.',
            { messageKey: 'antigravity_not_running' }),
        gemini: providerResult('gemini', 'Gemini', 'not_running',
            'AntiGravity IDE chưa chạy để lấy hạn mức nhóm mô hình Gemini.',
            { messageKey: 'gemini_not_running' })
    };
}

function errorPair(message, messageKey) {
    const extra = messageKey ? { messageKey } : {};
    return {
        antigravity: providerResult('antigravity', 'AntiGravity', 'error', message, extra),
        gemini: providerResult('gemini', 'Gemini', 'error', message, extra)
    };
}

/**
 * Tạo mã định danh ổn định cho một hạn mức.
 *
 * Bản cũ dùng `quota_${Math.random()}` khi thiếu bucketId, nên mã đổi sau mỗi vòng
 * quét và mọi thứ gắn theo mã, ví dụ tính năng ghim chỉ số của widget, đều hỏng.
 */
function stableBucketId(group, bucket, windowType, index) {
    if (bucket.bucketId) return String(bucket.bucketId);
    const parts = [
        group.displayName || 'group',
        bucket.displayName || bucket.name || `bucket${index}`,
        windowType
    ];
    const slug = parts.join('_')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return `quota_${slug}`;
}

/**
 * Quét thông tin hạn mức của AntiGravity và Gemini từ máy chủ ngôn ngữ cục bộ
 */
async function scanAntigravityAndGemini() {
    try {
        const { data, found } = await fetchQuotaSummary();
        if (!found) return notRunningPair();
        if (!isValidQuotaResponse(data)) {
            return errorPair('Không lấy được thông tin hạn mức từ máy chủ AntiGravity.', 'antigravity_quota_error');
        }

        const geminiMetrics = [];
        const agMetrics = [];

        for (const group of data.response.groups) {
            const isGeminiGroup = /gemini/i.test(group.displayName || '');
            const targetMetrics = isGeminiGroup ? geminiMetrics : agMetrics;
            if (!Array.isArray(group.buckets)) continue;

            group.buckets.forEach((b, index) => {
                const remainingFrac = b.remainingFraction !== undefined ? b.remainingFraction : 1;
                const isWeekly = b.window === 'weekly' || /weekly/i.test(b.displayName || '');
                const windowType = isWeekly ? 'weekly' : 'session';
                const windowLabel = isWeekly ? 'Tuần (Weekly)' : 'Phiên làm việc (5h)';

                targetMetrics.push(quotaMetric({
                    id: stableBucketId(group, b, windowType, index),
                    name: `${group.displayName} - ${windowLabel}`,
                    metricKey: isWeekly ? 'group_weekly' : 'group_session',
                    metricParams: { name: group.displayName },
                    windowType,
                    usedPercent: (1 - remainingFrac) * 100,
                    resetsAt: b.resetTime || null,
                    description: b.description || ''
                }));
            });

            // Sắp xếp để phiên 5h luôn hiển thị trước hạn mức tuần
            targetMetrics.sort((a, b) => (a.windowType === 'session' ? 0 : 1) - (b.windowType === 'session' ? 0 : 1));
        }

        const updatedAt = new Date().toISOString();
        return {
            antigravity: {
                id: 'antigravity',
                name: 'AntiGravity',
                status: 'active',
                plan: 'Google DeepMind IDE',
                account: 'Phiên cục bộ (Active)',
                metrics: agMetrics,
                updatedAt
            },
            gemini: {
                id: 'gemini',
                name: 'Gemini',
                status: 'active',
                plan: 'Gemini Pro & Flash Pool',
                account: 'Tích hợp AntiGravity',
                metrics: geminiMetrics,
                updatedAt
            }
        };
    } catch (err) {
        return errorPair(err.message);
    }
}

/**
 * Đọc bảng cổng đang lắng nghe của một tiến trình, so khớp đúng cột PID.
 *
 * Bản cũ dùng "netstat -ano | findstr <pid>", tức là so khớp chuỗi con trên cả
 * dòng: mã tiến trình 1234 khớp luôn cả tiến trình 12345 lẫn cổng 1234 nằm ở
 * cột khác. Ở đây tự tách cột và chỉ nhận dòng có đúng PID ở cột cuối.
 */
async function listListeningPorts(pid) {
    let stdout = '';
    try {
        ({ stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', 'TCP'], {
            timeout: 5000,
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024
        }));
    } catch {
        return [];
    }

    const loopback = [];
    const others = [];

    for (const line of stdout.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        // Proto | Địa chỉ nội bộ | Địa chỉ ngoài | Trạng thái | PID
        if (parts.length < 5) continue;
        if (parts[3] !== 'LISTENING') continue;
        if (Number(parts[4]) !== pid) continue;

        const local = parts[1];
        const port = Number(local.slice(local.lastIndexOf(':') + 1));
        if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;

        // Máy chủ ngôn ngữ nghe trên loopback, ưu tiên thử các cổng đó trước
        const host = local.slice(0, local.lastIndexOf(':'));
        if (host === '127.0.0.1' || host === '[::1]') loopback.push(port);
        else others.push(port);
    }

    return [...new Set([...loopback, ...others])];
}

/**
 * Phát hiện tiến trình máy chủ ngôn ngữ của AntiGravity trên Windows.
 * Toàn bộ việc gọi tiến trình con là bất đồng bộ, không chặn vòng lặp sự kiện.
 */
async function discoverLanguageServer() {
    return Promise.race([
        (async () => {
            let stdout = '';
            try {
                const script = "Get-CimInstance Win32_Process -Filter \"name like 'language_server%'\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress";
                ({ stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
                    timeout: 6000,
                    windowsHide: true,
                    maxBuffer: 4 * 1024 * 1024
                }));
            } catch {
                return null;
            }

            const raw = stdout ? stdout.trim() : '';
            if (!raw) return null;

            let list;
            try {
                list = JSON.parse(raw);
            } catch {
                return null;
            }

            for (const item of Array.isArray(list) ? list : [list]) {
                if (!item) continue;
                const pid = Number(item.ProcessId);
                if (!Number.isInteger(pid)) continue;

                const csrfMatch = String(item.CommandLine || '').match(/--csrf_token[=\s]+([^\s]+)/);
                if (!csrfMatch) continue;

                const ports = await listListeningPorts(pid);
                if (ports.length > 0) {
                    return { pid, csrf: csrfMatch[1], ports };
                }
            }
            return null;
        })(),
        new Promise(resolve => setTimeout(() => resolve(null), 7000))
    ]);
}

function isValidQuotaResponse(data) {
    return !!(data && data.response && Array.isArray(data.response.groups));
}

/**
 * Lấy bảng hạn mức, ưu tiên dùng lại thông tin đã ghi nhớ.
 * Chỉ dò tìm lại khi bộ nhớ đệm hết hạn hoặc cổng cũ không còn trả lời.
 */
async function fetchQuotaSummary() {
    if (cachedServerInfo && Date.now() - cachedServerInfoAt < DISCOVERY_TTL_MS) {
        const data = await queryQuotaSummary(cachedServerInfo.port, cachedServerInfo.csrf);
        if (isValidQuotaResponse(data)) return { data, found: true };
        cachedServerInfo = null;
    }

    const info = await discoverLanguageServer();
    if (!info) {
        cachedServerInfo = null;
        return { data: null, found: false };
    }

    // Một tiến trình có thể lắng nghe nhiều cổng, thử lần lượt cho tới khi có
    // cổng trả lời đúng, thay vì đoán bừa cổng đầu tiên như bản cũ.
    for (const port of info.ports) {
        const data = await queryQuotaSummary(port, info.csrf);
        if (isValidQuotaResponse(data)) {
            cachedServerInfo = { pid: info.pid, csrf: info.csrf, port };
            cachedServerInfoAt = Date.now();
            return { data, found: true };
        }
    }

    return { data: null, found: true };
}

/**
 * Gửi yêu cầu truy vấn hạn mức đến Language Server qua HTTPS nội bộ
 */
function queryQuotaSummary(port, csrf) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (val) => {
            if (settled) return;
            settled = true;
            resolve(val);
        };

        const timer = setTimeout(() => {
            done(null);
        }, 5000);

        const body = JSON.stringify({
            metadata: {
                ideName: 'antigravity',
                extensionName: 'antigravity',
                ideVersion: 'unknown',
                locale: 'en'
            }
        });

        const req = https.request({
            hostname: '127.0.0.1',
            port: port,
            path: '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary',
            method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/json',
                'Connect-Protocol-Version': '1',
                'x-codeium-csrf-token': csrf,
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 4000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                clearTimeout(timer);
                try {
                    done(JSON.parse(data));
                } catch {
                    done(null);
                }
            });
        });

        req.on('error', () => {
            clearTimeout(timer);
            done(null);
        });
        req.on('timeout', () => {
            req.destroy();
            clearTimeout(timer);
            done(null);
        });
        req.write(body);
        req.end();
    });
}

module.exports = { scanAntigravityAndGemini };
