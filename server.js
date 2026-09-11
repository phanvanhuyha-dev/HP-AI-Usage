const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { scanClaude } = require('./scanners/claude');
const { scanCodex } = require('./scanners/codex');
const { scanAntigravityAndGemini } = require('./scanners/antigravity');
const { loadEnv } = require('./lib/env');

// Tải biến môi trường từ .env
loadEnv();

const PORT = parseInt(process.env.PORT || '6736', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const WIDGET_LAUNCHER = path.join(__dirname, 'widget-desktop.ps1');
const TASKBAR_EXE = path.join(__dirname, 'HP-AI-Usage.exe');
const TASKBAR_BAT = path.join(__dirname, 'start-taskbar-widget.bat');

// Bộ nhớ đệm (cache) dữ liệu
let usageCache = null;
let lastScanTime = 0;
let isScanning = false;
let activeScanPromise = null;
// Vòng quét đang chạy có ép các bộ quét bỏ qua bộ đệm riêng hay không
let activeScanForcesProviders = false;
// Hàng đợi tối đa một vòng quét ép, gộp mọi lần bấm Làm mới trùng nhau
let queuedForcedScan = null;
const CACHE_TTL_MS = 15000;
const liveUsageClients = new Set();

const PROVIDER_NAMES = {
    claude: 'Claude',
    chatgpt: 'ChatGPT',
    antigravity: 'AntiGravity',
    gemini: 'Gemini'
};

// Chỗ giữ tạm cho nhà cung cấp chưa quét xong, để lần tải đầu tiên vẫn vẽ được
// khung màn hình thay vì phải chờ bộ quét chậm nhất.
function pendingProviders() {
    const pending = {};
    for (const [id, name] of Object.entries(PROVIDER_NAMES)) {
        pending[id] = { id, name, status: 'loading', metrics: [] };
    }
    return pending;
}

// Ghi lên một socket đã hỏng thường không ném lỗi đồng bộ, nên phải tự kiểm tra
// trạng thái luồng trước khi ghi, thay vì chỉ dựa vào try/catch.
function sendUsageEvent(res, data) {
    if (res.writableEnded || res.destroyed) return false;
    try {
        res.write(`event: usage\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
    } catch {
        return false;
    }
}

function broadcastUsage(data) {
    for (const client of liveUsageClients) {
        if (!sendUsageEvent(client, data)) {
            liveUsageClients.delete(client);
        }
    }
}

function withTimeout(promise, ms, fallback) {
    let timer;
    const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
    });
    return Promise.race([
        promise.then(res => { clearTimeout(timer); return res; }),
        timeoutPromise
    ]);
}

/**
 * Quét toàn bộ 4 nhà cung cấp (Claude, ChatGPT, AntiGravity, Gemini)
 */
async function fetchAllUsage(force = false, forceProviders = force) {
    const now = Date.now();
    if (!force && usageCache && (now - lastScanTime < CACHE_TTL_MS)) {
        return usageCache;
    }

    if (isScanning) {
        if (!force && usageCache) return usageCache;

        // Yêu cầu ép làm mới va vào một vòng quét không ép: vòng đang chạy vẫn để
        // các bộ quét dùng bộ đệm riêng của chúng, nên trả về nó là nuốt mất ý
        // định của người dùng. Xếp thêm đúng một vòng ép ngay sau đó.
        if (forceProviders && !activeScanForcesProviders) {
            if (!queuedForcedScan) {
                queuedForcedScan = Promise.resolve(activeScanPromise)
                    .catch(() => {})
                    .then(() => {
                        queuedForcedScan = null;
                        return fetchAllUsage(true, true);
                    });
            }
            return queuedForcedScan;
        }
        return activeScanPromise;
    }

    isScanning = true;
    activeScanForcesProviders = forceProviders;
    activeScanPromise = (async () => {
        const nextProviders = { ...(usageCache ? usageCache.providers : {}) };
        const publishPartial = (patch) => {
            Object.assign(nextProviders, patch);
            // Phát cả khi chưa có bộ đệm, để chính vòng quét đầu tiên cũng đẩy
            // được kết quả từng phần về trình duyệt.
            usageCache = {
                timestamp: new Date().toISOString(),
                providers: { ...pendingProviders(), ...nextProviders }
            };
            broadcastUsage(usageCache);
        };

        const claudeFallback = { id: 'claude', name: 'Claude', status: 'error', message: 'Quá thời gian quét Claude', metrics: [] };
        const claudeTask = withTimeout(
            scanClaude(forceProviders).catch(err => ({ id: 'claude', name: 'Claude', status: 'error', message: err.message, metrics: [] })),
            10000,
            claudeFallback
        ).then(result => {
            publishPartial({ claude: result });
            return result;
        });

        const codexFallback = { id: 'chatgpt', name: 'ChatGPT', status: 'error', message: 'Quá thời gian quét ChatGPT', metrics: [] };
        const codexTask = withTimeout(
            scanCodex(forceProviders).catch(err => ({ id: 'chatgpt', name: 'ChatGPT', status: 'error', message: err.message, metrics: [] })),
            10000,
            codexFallback
        ).then(result => {
            publishPartial({ chatgpt: result });
            return result;
        });

        const agGeminiFallback = {
            antigravity: { id: 'antigravity', name: 'AntiGravity', status: 'error', message: 'Quá thời gian quét AntiGravity', metrics: [] },
            gemini: { id: 'gemini', name: 'Gemini', status: 'error', message: 'Quá thời gian quét Gemini', metrics: [] }
        };
        const antigravityTask = withTimeout(
            scanAntigravityAndGemini().catch(err => ({
                antigravity: { id: 'antigravity', name: 'AntiGravity', status: 'error', message: err.message, metrics: [] },
                gemini: { id: 'gemini', name: 'Gemini', status: 'error', message: err.message, metrics: [] }
            })),
            10000,
            agGeminiFallback
        ).then(result => {
            publishPartial({ antigravity: result.antigravity, gemini: result.gemini });
            return result;
        });

        const [claude, codex, agGemini] = await Promise.all([
            claudeTask,
            codexTask,
            antigravityTask
        ]);

        usageCache = {
            timestamp: new Date().toISOString(),
            providers: {
                claude,
                chatgpt: codex,
                antigravity: agGemini.antigravity,
                gemini: agGemini.gemini
            }
        };
        lastScanTime = Date.now();
        broadcastUsage(usageCache);
        return usageCache;
    })();

    try {
        const timeoutGuard = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Vòng quét quá thời gian tối đa (15s)')), 15000)
        );
        return await Promise.race([activeScanPromise, timeoutGuard]);
    } catch (err) {
        console.error('Vòng quét gặp lỗi:', err.message);
        return usageCache || { timestamp: new Date().toISOString(), providers: pendingProviders() };
    } finally {
        isScanning = false;
        activeScanPromise = null;
        activeScanForcesProviders = false;
    }
}

// Bắt đầu quét nền định kỳ
setInterval(() => {
    fetchAllUsage(true, false).catch(console.error);
}, CACHE_TTL_MS);

const MAX_BODY_BYTES = 64 * 1024;

// Đọc thân yêu cầu có chặn kích thước. Không có trần thì một tiến trình cục bộ
// gửi luồng dữ liệu vô hạn là đủ làm cạn bộ nhớ máy chủ.
function readBody(req, maxBytes = MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;

        req.on('data', chunk => {
            if (settled) return;
            size += chunk.length;
            if (size > maxBytes) {
                settled = true;
                const err = new Error(`Nội dung gửi lên vượt quá ${Math.round(maxBytes / 1024)} KB.`);
                err.statusCode = 413;
                reject(err);
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (settled) return;
            settled = true;
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        req.on('error', err => {
            if (settled) return;
            settled = true;
            reject(err);
        });
    });
}

function sendJson(res, statusCode, payload) {
    if (res.writableEnded) return;
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

// Các thao tác nhạy cảm phải kèm tiêu đề riêng. Một biểu mẫu từ trang web khác
// không đặt được tiêu đề tuỳ ý, còn fetch khác nguồn thì phải qua bước tiền kiểm
// và sẽ bị chặn ngay ở khâu kiểm tra Origin. Tiến trình cục bộ vẫn giả được tiêu
// đề này, nhưng tiến trình cục bộ vốn đã chạy thẳng PowerShell được rồi.
const TRUSTED_HEADER = 'x-hp-request';

function hasTrustedHeader(req, res) {
    if (req.headers[TRUSTED_HEADER] === '1') return true;
    sendJson(res, 403, {
        success: false,
        error: 'Yêu cầu thiếu tiêu đề xác thực nội bộ. Hãy thao tác từ giao diện HP-AI-Usage.'
    });
    return false;
}

// Tạo máy chủ HTTP.
// Toàn bộ phần xử lý nằm trong handleRequest và luôn được bọc bắt lỗi: nếu không,
// một ngoại lệ bất ngờ sẽ làm yêu cầu treo vĩnh viễn và Node báo unhandled rejection.
const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
        console.error('Lỗi chưa bắt được khi xử lý yêu cầu:', err && err.stack ? err.stack : err);
        if (res.headersSent) {
            res.end();
            return;
        }
        const statusCode = err && err.statusCode ? err.statusCode : 500;
        sendJson(res, statusCode, {
            success: false,
            error: statusCode === 413 ? err.message : 'Lỗi máy chủ nội bộ.'
        });
    });
});

async function handleRequest(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'");

    // Chỉ chấp nhận giao diện cùng origin; không cho website ngoài điều khiển API localhost.
    const requestOrigin = req.headers.origin;
    const allowedOrigins = new Set([
        `http://127.0.0.1:${PORT}`,
        `http://localhost:${PORT}`
    ]);
    if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Origin không được phép' }));
        return;
    }
    if (requestOrigin) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/api/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    // Luồng cập nhật trực tiếp: trình duyệt nhận dữ liệu ngay khi một vòng quét hoàn tất.
    if (pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive'
        });
        res.write('retry: 3000\n\n');
        liveUsageClients.add(res);
        if (usageCache) sendUsageEvent(res, usageCache);

        const heartbeat = setInterval(() => {
            if (res.writableEnded || res.destroyed) {
                clearInterval(heartbeat);
                liveUsageClients.delete(res);
                return;
            }
            try { res.write(': keep-alive\n\n'); } catch { /* dọn ở lần sau */ }
        }, 25000);

        const dropClient = () => {
            clearInterval(heartbeat);
            liveUsageClients.delete(res);
        };
        req.on('close', dropClient);
        res.on('close', dropClient);
        res.on('error', dropClient);
        return;
    }

    // API: Lấy dữ liệu hạn mức
    if (pathname === '/api/usage' && req.method === 'GET') {
        const force = parsedUrl.searchParams.get('force') === 'true';
        const data = await fetchAllUsage(force);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
        return;
    }

    // API: Làm mới tức thì
    if (pathname === '/api/refresh' && req.method === 'POST') {
        const data = await fetchAllUsage(true);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
        return;
    }

    // Mở widget bằng chế độ ứng dụng của Edge/Chrome để thanh tiêu đề hiện tên app,
    // thay vì để Document Picture-in-Picture bắt buộc hiển thị origin localhost.
    if (pathname === '/api/widget/open' && req.method === 'POST') {
        if (!hasTrustedHeader(req, res)) return;
        if (process.platform !== 'win32' || !fs.existsSync(WIDGET_LAUNCHER)) {
            res.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: 'Trình khởi chạy widget không khả dụng' }));
            return;
        }

        try {
            const launchResult = await new Promise((resolve) => {
                const launcher = spawn('powershell.exe', [
                    '-NoProfile',
                    '-ExecutionPolicy', 'Bypass',
                    '-File', WIDGET_LAUNCHER
                ], {
                    cwd: __dirname,
                    stdio: 'ignore',
                    windowsHide: false,
                    env: { ...process.env, HP_WIDGET_BACKGROUND: '1' }
                });
                let settled = false;
                const finish = (result) => {
                    if (settled) return;
                    settled = true;
                    resolve(result);
                };
                launcher.once('error', err => finish({ success: false, error: err.message }));
                launcher.once('exit', code => finish({
                    success: code === 0,
                    error: code === 0 ? null : `Launcher thoát với mã ${code}`
                }));
                setTimeout(() => finish({ success: false, error: 'Quá thời gian mở cửa sổ widget' }), 15000);
            });

            res.writeHead(launchResult.success ? 200 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(launchResult));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }

    // Mở thanh tác vụ HP-AI-Usage.exe
    if (pathname === '/api/taskbar/open' && req.method === 'POST') {
        if (!hasTrustedHeader(req, res)) return;
        if (process.platform !== 'win32' || (!fs.existsSync(TASKBAR_EXE) && !fs.existsSync(TASKBAR_BAT))) {
            res.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: 'Thanh tác vụ không khả dụng trên hệ thống này' }));
            return;
        }

        try {
            if (fs.existsSync(TASKBAR_EXE)) {
                const child = spawn(TASKBAR_EXE, [], {
                    cwd: __dirname,
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();
            } else {
                const child = spawn('cmd.exe', ['/c', TASKBAR_BAT], {
                    cwd: __dirname,
                    detached: true,
                    stdio: 'ignore'
                });
                child.unref();
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }

    // API: Lấy tùy chọn người dùng đã lưu
    if (pathname === '/api/preferences' && req.method === 'GET') {
        const prefs = loadPreferences();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(prefs));
        return;
    }

    // API: Lưu tùy chọn người dùng (ngôn ngữ, chế độ xem, độ mờ gương, thu gọn...)
    if (pathname === '/api/preferences' && req.method === 'POST') {
        const body = await readBody(req);
        try {
            const patch = JSON.parse(body || '{}');
            sendJson(res, 200, { success: true, preferences: savePreferences(patch) });
        } catch (err) {
            sendJson(res, 400, { success: false, error: err.message });
        }
        return;
    }

    // API: Lấy thông tin cấu hình hiện tại (khóa đã được che giấu an toàn)
    if (pathname === '/api/settings' && req.method === 'GET') {
        const mask = (key) => {
            if (!key || key.length < 6) return '';
            return `${key.slice(0, 4)}...${key.slice(-4)}`;
        };
        const settings = {
            hasGeminiKey: !!process.env.GEMINI_API_KEY,
            maskedGemini: mask(process.env.GEMINI_API_KEY)
        };
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(settings));
        return;
    }

    // API: Cập nhật cài đặt khóa API
    if (pathname === '/api/settings' && req.method === 'POST') {
        if (!hasTrustedHeader(req, res)) return;
        const body = await readBody(req);
        let settings;
        try {
            settings = JSON.parse(body);
            saveEnvSettings(settings);
        } catch (err) {
            sendJson(res, 400, { success: false, error: err.message });
            return;
        }
        // Làm mới dữ liệu sau khi cập nhật khóa
        const data = await fetchAllUsage(true);
        sendJson(res, 200, { success: true, data });
        return;
    }

    // Phục vụ tệp tĩnh trong thư mục public (bao gồm /widget hoặc ?view=widget -> widget.html)
    const isWidgetRequest = pathname === '/widget' || (pathname === '/' && parsedUrl.searchParams.get('view') === 'widget');

    // URL.pathname giữ nguyên phần trăm mã hóa, nên tệp có dấu cách hoặc chữ
    // tiếng Việt trong tên sẽ không tìm thấy nếu không giải mã trước.
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Đường dẫn không hợp lệ');
        return;
    }

    const relativePath = isWidgetRequest
        ? 'widget.html'
        : (decodedPath === '/' ? 'index.html' : decodedPath.replace(/^[\\/]+/, ''));
    const filePath = path.resolve(PUBLIC_DIR, relativePath);

    // Ngăn duyệt thư mục. So sánh bằng path.relative thay vì startsWith, vì
    // startsWith còn cho lọt cả thư mục anh em có tên bắt đầu giống nhau.
    const rel = path.relative(PUBLIC_DIR, filePath);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        // Dự án không có định tuyến phía trình duyệt, nên trả index.html cho mọi
        // đường dẫn sai chỉ khiến ảnh hoặc script gõ nhầm tên nhận về HTML kèm
        // mã 200, rất khó dò lỗi. Trả 404 thật.
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Không tìm thấy tệp yêu cầu');
            return;
        }

        serveFile(filePath, res, req, stats);
    });
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function serveFile(filePath, res, req, stats) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // no-store cũ bắt tải lại toàn bộ tài nguyên ở mỗi lần mở trang, kể cả tệp
    // biểu tượng nặng. Dùng thẻ phiên bản để trình duyệt hỏi lại rồi nhận 304,
    // vừa luôn có bản mới nhất vừa không tải lại thứ chưa đổi.
    const etag = `W/"${stats.size.toString(16)}-${Math.round(stats.mtimeMs).toString(16)}"`;
    const lastModified = stats.mtime.toUTCString();
    const cacheHeaders = {
        'Cache-Control': 'no-cache',
        'ETag': etag,
        'Last-Modified': lastModified
    };

    const ifNoneMatch = req.headers['if-none-match'];
    const ifModifiedSince = req.headers['if-modified-since'];
    const unchanged = ifNoneMatch
        ? ifNoneMatch === etag
        : ifModifiedSince === lastModified;

    if (unchanged) {
        res.writeHead(304, cacheHeaders);
        res.end();
        return;
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Lỗi máy chủ nội bộ khi đọc tệp');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType, ...cacheHeaders });
        res.end(content);
    });
}

// Các khóa mà giao diện Cài đặt được phép ghi vào .env
const EDITABLE_ENV_KEYS = ['GEMINI_API_KEY'];
const MAX_ENV_VALUE_LENGTH = 500;

function assertValidEnvValue(key, value) {
    if (typeof value !== 'string') {
        throw new Error(`Giá trị của ${key} phải là chuỗi ký tự.`);
    }
    if (value.length > MAX_ENV_VALUE_LENGTH) {
        throw new Error(`Giá trị của ${key} quá dài, tối đa ${MAX_ENV_VALUE_LENGTH} ký tự.`);
    }
    // Ký tự xuống dòng cho phép chèn thêm dòng cấu hình khác vào tệp .env
    if (/[\r\n]/.test(value)) {
        throw new Error(`Giá trị của ${key} không được chứa ký tự xuống dòng.`);
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
        throw new Error(`Giá trị của ${key} chứa ký tự điều khiển không hợp lệ.`);
    }
}

// Ghi đè giá trị của một khóa ngay tại dòng cũ, giữ nguyên vị trí trong tệp.
// Trả về false nếu tệp chưa có khóa đó.
function replaceEnvLine(lines, key, value) {
    let replaced = false;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1 || trimmed.slice(0, idx).trim() !== key) continue;
        lines[i] = `${key}=${value}`;
        replaced = true;
    }
    return replaced;
}

// Ghi ra tệp tạm rồi đổi tên, để một lần ghi hỏng giữa chừng
// không làm mất tệp cấu hình đang có.
function writeFileAtomic(targetPath, content) {
    const tmpPath = `${targetPath}.tmp-${process.pid}`;
    try {
        fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tmpPath, targetPath);
    } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch { /* tệp tạm có thể chưa tồn tại */ }
        throw err;
    }
}

function saveEnvSettings(newSettings) {
    if (!newSettings || typeof newSettings !== 'object') {
        throw new Error('Dữ liệu cài đặt không hợp lệ.');
    }

    const envPath = path.join(__dirname, '.env');
    const original = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

    // Giữ nguyên kiểu xuống dòng và dòng trống cuối tệp của bản gốc
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    const endsWithNewline = original === '' || /\r?\n$/.test(original);
    const lines = original === ''
        ? ['# Cấu hình HP-AI-Usage']
        : original.replace(/\r?\n$/, '').split(/\r?\n/);

    let changed = false;

    for (const key of EDITABLE_ENV_KEYS) {
        if (newSettings[key] === undefined) continue;
        assertValidEnvValue(key, newSettings[key]);

        const val = newSettings[key].trim();
        if (val === '') continue; // để trống nghĩa là giữ nguyên giá trị cũ

        const next = val === '__CLEAR__' ? '' : val;
        if (!replaceEnvLine(lines, key, next)) {
            lines.push(`${key}=${next}`);
        }
        if (next === '') {
            delete process.env[key];
        } else {
            process.env[key] = next;
        }
        changed = true;
    }

    // Không có gì thay đổi thì không đụng vào tệp
    if (!changed) return;

    writeFileAtomic(envPath, lines.join(newline) + (endsWithNewline ? newline : ''));
}

const PREFERENCES_FILE = path.join(__dirname, 'preferences.json');
const DEFAULT_PREFERENCES = {
    lang: 'en',
    viewMode: 'grid'
};

function loadPreferences() {
    try {
        if (fs.existsSync(PREFERENCES_FILE)) {
            const raw = fs.readFileSync(PREFERENCES_FILE, 'utf8');
            return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
        }
    } catch (e) {
        console.error('Lỗi nạp tùy chọn người dùng:', e.message);
    }
    return { ...DEFAULT_PREFERENCES };
}

function savePreferences(patch) {
    try {
        const current = loadPreferences();
        const safePatch = {};
        if (patch.lang === 'vi' || patch.lang === 'en') safePatch.lang = patch.lang;
        if (patch.viewMode === 'grid' || patch.viewMode === 'panel') safePatch.viewMode = patch.viewMode;
        const merged = { ...current, ...safePatch };
        fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(merged, null, 2), 'utf8');
        return merged;
    } catch (e) {
        console.error('Lỗi lưu tùy chọn người dùng:', e.message);
        return DEFAULT_PREFERENCES;
    }
}

// Không có móc này thì cổng bị chiếm sẽ làm tiến trình chết kèm vệt lỗi kỹ thuật,
// người dùng bấm start.bat chỉ thấy cửa sổ nháy rồi tắt mà không hiểu vì sao.
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Cổng ${PORT} đang bị một chương trình khác chiếm.`);
        console.error('Nhiều khả năng HP-AI-Usage đã chạy sẵn. Hãy mở http://127.0.0.1:' + PORT);
        console.error(`Nếu muốn dùng cổng khác, hãy sửa dòng PORT trong tệp .env.`);
    } else if (err.code === 'EACCES') {
        console.error(`Không có quyền mở cổng ${PORT}. Hãy chọn cổng lớn hơn 1024 trong tệp .env.`);
    } else {
        console.error('Máy chủ gặp lỗi:', err.message);
    }
    process.exit(1);
});

// Khởi chạy máy chủ
server.listen(PORT, '127.0.0.1', () => {
    console.log(`HP-AI-Usage Dashboard đang chạy tại: http://127.0.0.1:${PORT}`);
    // Quét lần đầu tiên ngay khi khởi động
    fetchAllUsage(true).catch(console.error);
});
