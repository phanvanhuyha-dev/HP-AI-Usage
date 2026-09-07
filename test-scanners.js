/**
 * Kiểm thử hình dạng dữ liệu mà các bộ quét trả về.
 *
 * Bản cũ chỉ gọi mạng thật rồi in kết quả ra màn hình, không có một câu khẳng
 * định nào, nên không phát hiện được gì. Ở đây kiểm tra hợp đồng dữ liệu: mọi
 * kết quả phải có đủ trường bắt buộc, mọi chỉ số hạn mức phải nằm trong 0 tới
 * 100, và mọi khóa i18n gửi lên đều phải có nhãn tương ứng.
 */
const assert = require('node:assert/strict');
const { scanClaude } = require('./scanners/claude');
const { scanCodex } = require('./scanners/codex');
const { scanAntigravityAndGemini } = require('./scanners/antigravity');
const i18n = require('./public/i18n');
const ui = require('./public/usage-ui');

const VALID_STATUS = new Set(['active', 'loading', 'not_running', 'not_configured', 'not_logged_in', 'error']);
const METRIC_KEYS = new Set(Object.keys(i18n.METRIC_LABELS.vi));
const MESSAGE_KEYS = new Set(Object.keys(i18n.MESSAGE_LABELS.vi));

let checks = 0;
function check(label, fn) {
    fn();
    checks++;
    console.log('  OK   ' + label);
}

function assertProviderShape(name, p) {
    check(name + ': có đủ id, name, status, metrics', () => {
        assert.ok(p, 'kết quả rỗng');
        assert.equal(typeof p.id, 'string');
        assert.equal(typeof p.name, 'string');
        assert.ok(VALID_STATUS.has(p.status), `trạng thái lạ: ${p.status}`);
        assert.ok(Array.isArray(p.metrics), 'metrics phải là mảng');
    });

    check(name + ': mọi chỉ số hạn mức nằm trong 0 tới 100', () => {
        for (const m of p.metrics.filter(ui.isQuotaMetric)) {
            assert.ok(m.usedPercent >= 0 && m.usedPercent <= 100, `${m.id} = ${m.usedPercent}`);
            assert.equal(m.usedPercent + m.remainingPercent, 100, `${m.id} cộng không ra 100`);
        }
    });

    check(name + ': mã định danh chỉ số ổn định, không sinh ngẫu nhiên', () => {
        for (const m of p.metrics) {
            assert.equal(typeof m.id, 'string');
            assert.ok(!/^quota_0\.\d+$/.test(m.id), `mã ngẫu nhiên: ${m.id}`);
        }
    });

    check(name + ': mọi khóa i18n gửi lên đều có nhãn', () => {
        for (const m of p.metrics) {
            if (m.metricKey) assert.ok(METRIC_KEYS.has(m.metricKey), `thiếu nhãn cho ${m.metricKey}`);
        }
        if (p.messageKey) assert.ok(MESSAGE_KEYS.has(p.messageKey), `thiếu nhãn cho ${p.messageKey}`);
    });

    check(name + ': không còn trường severity thừa ở bộ quét', () => {
        for (const m of p.metrics) {
            assert.equal(m.severity, undefined, `${m.id} vẫn còn severity`);
        }
    });

    check(name + ': trạng thái khác active thì phải kèm lời giải thích', () => {
        if (p.status !== 'active' && p.status !== 'loading') {
            assert.ok(p.message || p.messageKey, 'thiếu message');
        }
    });
}

(async () => {
    console.log('\n=== Kiểm thử hợp đồng dữ liệu của bộ quét ===\n');

    const [claude, codex, agGemini] = await Promise.all([
        scanClaude(),
        scanCodex(),
        scanAntigravityAndGemini()
    ]);

    assertProviderShape('claude', claude);
    assertProviderShape('chatgpt', codex);
    assertProviderShape('antigravity', agGemini.antigravity);
    assertProviderShape('gemini', agGemini.gemini);

    check('claude: tên gói đọc từ phiên đăng nhập, không ghi cứng', () => {
        if (claude.status !== 'active') return;
        assert.notEqual(claude.plan, 'Claude Pro / Subscription');
        assert.ok(/^Claude /.test(claude.plan), `tên gói lạ: ${claude.plan}`);
    });

    check('mô hình giao diện tóm tắt được cả 4 nhà cung cấp', () => {
        const summaries = ui.getProviderSummaries({
            claude, chatgpt: codex,
            antigravity: agGemini.antigravity, gemini: agGemini.gemini
        }, {});
        assert.equal(summaries.length, 4);
    });

    console.log('\nTrạng thái hiện tại:');
    for (const [id, p] of Object.entries({ claude, chatgpt: codex, antigravity: agGemini.antigravity, gemini: agGemini.gemini })) {
        const top = p.metrics.filter(ui.isQuotaMetric).sort(ui.compareMetricsPriority)[0];
        console.log('  ' + id.padEnd(12) + p.status.padEnd(16)
            + (top ? `${top.usedPercent}% ${i18n.metricLabel(top, 'vi')}` : (p.plan || '')));
    }

    console.log('\nTất cả ' + checks + ' khẳng định đều đạt.');
})().catch(err => {
    console.error('\nTHẤT BẠI: ' + err.message);
    process.exit(1);
});
