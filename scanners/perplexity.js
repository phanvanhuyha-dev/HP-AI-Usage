const https = require('https');
const { providerResult } = require('../lib/provider');
const { loadEnv } = require('../lib/env');

// Nạp .env một lần khi nạp mô đun, để bộ quét vẫn chạy được khi gọi độc lập
// ngoài máy chủ. Bản cũ nạp lại ở mọi vòng quét và ghi đè vô điều kiện lên
// process.env, nên xoá mất biến người dùng đặt trong cửa sổ dòng lệnh.
loadEnv();

let cachedPerplexityResult = null;
let cachedPerplexityKey = '';
let lastPerplexityFetchTime = 0;
const PERPLEXITY_CACHE_TTL_MS = 60000;

/**
 * Thu thập dữ liệu và kiểm tra khóa API của Perplexity
 */
async function scanPerplexity(force = false) {
    try {
        const apiKey = process.env.PERPLEXITY_API_KEY;

        if (!apiKey) {
            cachedPerplexityResult = null;
            cachedPerplexityKey = '';
            return providerResult('perplexity', 'Perplexity', 'not_configured',
                'Chưa cấu hình PERPLEXITY_API_KEY. Hãy bấm vào Cài đặt để thêm khóa API.',
                { plan: 'Chưa có khóa API', messageKey: 'pplx_not_configured' });
        }

        const now = Date.now();
        if (!force && cachedPerplexityResult && cachedPerplexityKey === apiKey
            && now - lastPerplexityFetchTime < PERPLEXITY_CACHE_TTL_MS) {
            return cachedPerplexityResult;
        }

        const startTime = Date.now();
        const modelsResult = await fetchPerplexityModels(apiKey);
        const latency = Date.now() - startTime;

        if (!modelsResult.success) {
            return providerResult('perplexity', 'Perplexity', 'error',
                modelsResult.message || 'Không thể xác thực khóa API Perplexity.',
                { plan: 'Khóa API không hợp lệ', messageKey: 'pplx_invalid_key' });
        }

        const models = modelsResult.models || [];
        const maskedKey = `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;

        const metrics = [
            {
                id: 'pplx_auth',
                name: 'Trạng thái khóa API (Auth)',
                metricKey: 'auth_status',
                type: 'info',
                // Dữ liệu có cấu trúc để giao diện tự dựng câu chữ, thay vì phải
                // bóc tách ngược từ chuỗi đã dịch sẵn.
                httpStatus: 200,
                latencyMs: latency,
                value: 'Hoạt động tốt (200 OK)',
                label: `Độ trễ: ${latency}ms`
            },
            {
                id: 'pplx_models',
                name: 'Mô hình khả dụng (Models)',
                metricKey: 'available_models',
                type: 'info',
                count: models.length,
                value: `${models.length} mô hình AI sẵn sàng`,
                label: 'Sonar, Claude, GPT, Grok'
            },
            {
                id: 'pplx_console_link',
                name: 'Số dư tín dụng (Credit Balance)',
                metricKey: 'credit_balance',
                type: 'action_link',
                actionText: '↗ Perplexity Console',
                url: 'https://console.perplexity.ai/billing',
                note: 'Perplexity không cung cấp API tra cứu số dư cho tài khoản cá nhân. Hãy kiểm tra trực tiếp trên Console.'
            }
        ];

        cachedPerplexityResult = {
            id: 'perplexity',
            name: 'Perplexity',
            status: 'active',
            plan: 'Perplexity API',
            account: maskedKey,
            metrics,
            updatedAt: new Date().toISOString()
        };
        cachedPerplexityKey = apiKey;
        lastPerplexityFetchTime = now;
        return cachedPerplexityResult;
    } catch (err) {
        if (cachedPerplexityResult) return cachedPerplexityResult;
        return providerResult('perplexity', 'Perplexity', 'error', err.message);
    }
}

function fetchPerplexityModels(key) {
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.perplexity.ai',
            path: '/v1/models',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${key}`,
                'User-Agent': 'hp-ai-usage'
            },
            timeout: 6000
        }, (res) => {
            if (res.statusCode === 401 || res.statusCode === 403) {
                res.resume();
                resolve({ success: false, message: 'Khóa API Perplexity không hợp lệ (401 Unauthorized).' });
                return;
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.data && Array.isArray(parsed.data)) {
                        resolve({ success: true, models: parsed.data.map(m => m.id) });
                    } else {
                        resolve({ success: true, models: [] });
                    }
                } catch {
                    resolve({ success: true, models: [] });
                }
            });
        });

        req.on('error', (e) => resolve({ success: false, message: e.message }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, message: 'Quá thời gian kết nối tới máy chủ Perplexity.' });
        });
        req.end();
    });
}

module.exports = { scanPerplexity };
