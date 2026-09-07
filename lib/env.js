const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

function parseEnvFile(content) {
    const values = {};
    for (const line of String(content).split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        values[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return values;
}

/**
 * Nạp tệp .env vào process.env.
 *
 * Không ghi đè biến đã có sẵn trong môi trường: biến do người dùng đặt trong cửa
 * sổ dòng lệnh phải thắng tệp cấu hình.
 */
function loadEnv(envPath = ENV_PATH) {
    try {
        if (!fs.existsSync(envPath)) return;
        const values = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
        for (const [key, value] of Object.entries(values)) {
            if (process.env[key] === undefined) {
                process.env[key] = value;
            }
        }
    } catch {
        // Thiếu hoặc hỏng .env không phải lỗi chặn khởi động
    }
}

module.exports = { loadEnv, parseEnvFile, ENV_PATH };
