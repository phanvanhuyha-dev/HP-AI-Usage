/**
 * Khuôn dựng kết quả trả về của một nhà cung cấp.
 *
 * Trước đây khối { id, name, status, message, metrics: [] } được viết tay khoảng
 * mười lăm lần trong bốn bộ quét, mỗi nơi lệch một chút.
 */
function providerResult(id, name, status, message, extra = {}) {
    return {
        id,
        name,
        status,
        message,
        metrics: [],
        ...extra
    };
}

/**
 * Dựng một chỉ số hạn mức theo phần trăm đã dùng.
 *
 * Không gắn kèm trường severity: ngưỡng cảnh báo chỉ được định nghĩa một nơi duy
 * nhất là getMetricSeverity trong public/usage-ui.js. Trước đây ngưỡng 85 và 60
 * bị chép lại ở sáu nhánh trong các bộ quét, và thanh tác vụ còn chép lệch thành
 * 90 và 75 nên cùng một con số lại hiện hai màu khác nhau.
 */
function quotaMetric({ id, name, metricKey, metricParams, usedPercent, resetsAt = null, windowType, description }) {
    const used = Math.max(0, Math.min(100, Math.round(Number(usedPercent) || 0)));
    const metric = {
        id,
        name,
        usedPercent: used,
        remainingPercent: 100 - used,
        resetsAt
    };
    // Khóa ổn định để giao diện tự dựng nhãn theo ngôn ngữ. Trường name giữ lại
    // làm phương án dự phòng và cho các chỗ đọc trực tiếp như thanh tác vụ.
    if (metricKey) metric.metricKey = metricKey;
    if (metricParams) metric.metricParams = metricParams;
    if (windowType) metric.windowType = windowType;
    if (description) metric.description = description;
    return metric;
}

module.exports = { providerResult, quotaMetric };
