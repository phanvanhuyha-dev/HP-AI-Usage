const assert = require('node:assert/strict');
const ui = require('./public/usage-ui');

function quota(usedPercent, remainingPercent) {
    return { name: 'Quota', usedPercent, remainingPercent };
}

assert.equal(ui.getMetricSeverity(quota(59, 41)), 'normal');
assert.equal(ui.getMetricSeverity(quota(60, 40)), 'warning');
assert.equal(ui.getMetricSeverity(quota(85, 15)), 'critical');
assert.equal(ui.getRemainingPercent({ usedPercent: 71 }), 29);

const healthy = ui.getProviderSummary({
    id: 'claude',
    name: 'Claude',
    status: 'active',
    metrics: [quota(20, 80), quota(70, 30)]
});
assert.equal(healthy.topMetric.usedPercent, 70);
assert.equal(healthy.remainingPercent, 30);
assert.equal(healthy.severity, 'warning');

const failedProvider = ui.getProviderSummary({
    id: 'mock-provider',
    name: 'Mock Provider',
    status: 'error',
    metrics: []
});
assert.equal(failedProvider.providerState, 'error');
assert.equal(failedProvider.severity, 'critical');
assert.equal(failedProvider.remainingPercent, null);

const activeInfoProvider = ui.getProviderSummary({
    id: 'mock-provider',
    name: 'Mock Provider',
    status: 'active',
    metrics: [{ type: 'info', value: '200 OK' }]
});
assert.equal(activeInfoProvider.severity, 'normal');

const sorted = ui.sortByAttention([healthy, failedProvider, activeInfoProvider]);
assert.equal(sorted[0].id, 'mock-provider');
assert.equal(sorted[0].status, 'error');

// Kiểm thử ưu tiên hạn mức phiên 5 giờ (session) hơn hạn mức tuần (weekly)
const sessionWeeklyProvider = ui.getProviderSummary({
    id: 'antigravity',
    name: 'AntiGravity',
    status: 'active',
    metrics: [
        { id: '3p-weekly', name: 'Claude and GPT models - Tuần (Weekly)', usedPercent: 70, remainingPercent: 30 },
        { id: '3p-5h', name: 'Claude and GPT models - Phiên làm việc (5h)', usedPercent: 5, remainingPercent: 95 }
    ]
});
assert.equal(sessionWeeklyProvider.topMetric.id, '3p-5h');
assert.equal(sessionWeeklyProvider.topMetric.usedPercent, 5);

// Kiểm thử trường hợp hạn mức tuần cạn kiệt 100% thì ưu tiên cảnh báo tuần
const exhaustedWeeklyProvider = ui.getProviderSummary({
    id: 'claude',
    name: 'Claude',
    status: 'active',
    metrics: [
        { id: 'claude_weekly', name: 'Hạn mức tuần (Weekly - 7d)', usedPercent: 100, remainingPercent: 0 },
        { id: 'claude_session', name: 'Phiên làm việc (Session - 5h)', usedPercent: 20, remainingPercent: 80 }
    ]
});
assert.equal(exhaustedWeeklyProvider.topMetric.id, 'claude_weekly');
assert.equal(exhaustedWeeklyProvider.topMetric.usedPercent, 100);

// Kiểm thử trường hợp chỉ định preferredMetricId
const customPinnedProvider = ui.getProviderSummary({
    id: 'claude',
    name: 'Claude',
    status: 'active',
    metrics: [
        { id: 'claude_weekly', name: 'Hạn mức tuần (Weekly - 7d)', usedPercent: 22, remainingPercent: 78 },
        { id: 'claude_session', name: 'Phiên làm việc (Session - 5h)', usedPercent: 3, remainingPercent: 97 }
    ]
}, 'claude', { preferredMetricId: 'claude_weekly' });
assert.equal(customPinnedProvider.topMetric.id, 'claude_weekly');

// Kiểm thử đi qua đúng đường mà widget dùng: getProviderSummaries với bản đồ ghim
// theo nhà cung cấp. Bài kiểm thử cũ chỉ gọi thẳng getProviderSummary nên không
// bắt được lỗi widget truyền vào dạng rút gọn { claude: 'claude_weekly' }.
const pinFixture = {
    claude: {
        id: 'claude',
        name: 'Claude',
        status: 'active',
        metrics: [
            { id: 'claude_session', name: 'Phiên làm việc (Session - 5h)', usedPercent: 3, remainingPercent: 97 },
            { id: 'claude_weekly', name: 'Hạn mức tuần (Weekly - 7d)', usedPercent: 22, remainingPercent: 78 }
        ]
    },
    chatgpt: {
        id: 'chatgpt',
        name: 'ChatGPT',
        status: 'active',
        metrics: [
            { id: 'chatgpt_primary', name: 'Cửa sổ phiên (Session - 5h)', usedPercent: 8, remainingPercent: 92 },
            { id: 'chatgpt_weekly', name: 'Hạn mức tuần (Weekly - 7d)', usedPercent: 44, remainingPercent: 56 }
        ]
    }
};

function summaryById(summaries, id) {
    return summaries.find(item => item.id === id);
}

// Không ghim: giữ quy tắc ưu tiên phiên 5 giờ
const noPin = ui.getProviderSummaries(pinFixture, {});
assert.equal(summaryById(noPin, 'claude').topMetric.id, 'claude_session');

// Ghim dạng rút gọn, đúng dạng widget đang lưu trong localStorage
const shorthandPin = ui.getProviderSummaries(pinFixture, { claude: 'claude_weekly' });
assert.equal(summaryById(shorthandPin, 'claude').topMetric.id, 'claude_weekly');
assert.equal(summaryById(shorthandPin, 'claude').usedPercent, 22);

// Ghim của nhà cung cấp này không được ảnh hưởng nhà cung cấp khác
assert.equal(summaryById(shorthandPin, 'chatgpt').topMetric.id, 'chatgpt_primary');

// Ghim dạng đầy đủ vẫn phải chạy
const objectPin = ui.getProviderSummaries(pinFixture, { claude: { preferredMetricId: 'claude_weekly' } });
assert.equal(summaryById(objectPin, 'claude').topMetric.id, 'claude_weekly');

// Ghim vào chỉ số không còn tồn tại thì quay về quy tắc ưu tiên, không được vỡ
const stalePin = ui.getProviderSummaries(pinFixture, { claude: 'khong_ton_tai' });
assert.equal(summaryById(stalePin, 'claude').topMetric.id, 'claude_session');

// Tùy chọn dùng chung cho mọi nhà cung cấp vẫn giữ nguyên hành vi cũ
const sharedPin = ui.getProviderSummaries(pinFixture, { preferredMetricId: 'claude_weekly' });
assert.equal(summaryById(sharedPin, 'claude').topMetric.id, 'claude_weekly');
assert.equal(summaryById(sharedPin, 'chatgpt').topMetric.id, 'chatgpt_primary');

// Tham số tùy chọn khuyết hoặc sai kiểu không được làm vỡ mô hình
assert.equal(summaryById(ui.getProviderSummaries(pinFixture), 'claude').topMetric.id, 'claude_session');
assert.equal(summaryById(ui.getProviderSummaries(pinFixture, null), 'claude').topMetric.id, 'claude_session');
assert.equal(ui.getProviderSummary(pinFixture.claude, 'claude', 'claude_weekly').topMetric.id, 'claude_weekly');

console.log('UI model tests passed.');

