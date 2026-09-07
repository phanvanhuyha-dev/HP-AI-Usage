(function initUsageUI(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.UsageUI = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createUsageUI() {
    const PROVIDER_ORDER = ['claude', 'chatgpt', 'antigravity', 'gemini'];

    // Hai hàm này trước đây được chép nguyên văn ở cả app.js lẫn widget.js
    function escapeHTML(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    // Chỉ cho phép http và https, chặn javascript: và data: lọt vào thuộc tính href
    function safeUrl(value, base) {
        try {
            const origin = base || (typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1');
            const parsed = new URL(value, origin);
            return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '#';
        } catch {
            return '#';
        }
    }

    function clamp(value, min = 0, max = 100) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return min;
        return Math.min(max, Math.max(min, numeric));
    }

    function isQuotaMetric(metric) {
        return !!metric && Number.isFinite(Number(metric.usedPercent));
    }

    function getUsedPercent(metric) {
        return isQuotaMetric(metric) ? clamp(metric.usedPercent) : null;
    }

    function getRemainingPercent(metric) {
        if (!metric) return null;
        if (Number.isFinite(Number(metric.remainingPercent))) {
            return clamp(metric.remainingPercent);
        }
        const used = getUsedPercent(metric);
        return used === null ? null : clamp(100 - used);
    }

    function getMetricSeverity(metric) {
        const used = getUsedPercent(metric);
        if (used === null) return 'normal';
        if (used >= 85) return 'critical';
        if (used >= 60) return 'warning';
        return 'normal';
    }

    function getProviderState(provider) {
        const status = provider && provider.status ? provider.status : 'not_configured';
        if (status === 'active') return 'active';
        // Đang quét dở, chưa phải lỗi, không được tính là cảnh báo
        if (status === 'loading') return 'loading';
        if (status === 'not_running' || status === 'not_configured') return 'warning';
        return 'error';
    }

    function isSessionMetric(metric) {
        if (!metric) return false;
        if (metric.windowType === 'session' || metric.window === 'session' || metric.window === '5h') return true;
        const id = String(metric.id || '').toLowerCase();
        if (id.includes('session') || id.includes('primary') || id.includes('5h')) return true;
        const name = String(metric.name || '').toLowerCase();
        if (name.includes('5h') || name.includes('session') || name.includes('phiên')) return true;
        return false;
    }

    function isWeeklyMetric(metric) {
        if (!metric) return false;
        if (metric.windowType === 'weekly' || metric.window === 'weekly' || metric.window === '7d') return true;
        const id = String(metric.id || '').toLowerCase();
        if (id.includes('weekly') || id.includes('secondary') || id.includes('7d')) return true;
        const name = String(metric.name || '').toLowerCase();
        if (name.includes('weekly') || name.includes('tuần') || name.includes('7d')) return true;
        return false;
    }

    function compareMetricsPriority(a, b) {
        const aUsed = getUsedPercent(a) ?? 0;
        const bUsed = getUsedPercent(b) ?? 0;

        // 1. Nếu một hạn mức bị cạn kiệt hoàn toàn (>= 100%), ưu tiên cảnh báo hạn mức đó
        const aExhausted = aUsed >= 100;
        const bExhausted = bUsed >= 100;
        if (aExhausted !== bExhausted) {
            return aExhausted ? -1 : 1;
        }

        // 2. Ưu tiên hạn mức phiên làm việc (5-hour session) hơn hạn mức tuần (weekly)
        const aSession = isSessionMetric(a);
        const bSession = isSessionMetric(b);
        if (aSession !== bSession) {
            return aSession ? -1 : 1;
        }

        // 3. Nếu cùng nhóm ưu tiên, sắp xếp theo tỷ lệ phần trăm đã dùng cao hơn
        return bUsed - aUsed;
    }

    // Tùy chọn của một nhà cung cấp chấp nhận cả hai dạng:
    //   'claude_weekly'                         dạng rút gọn
    //   { preferredMetricId: 'claude_weekly' }  dạng đầy đủ
    function normalizeSummaryOptions(options) {
        if (typeof options === 'string') return { preferredMetricId: options };
        if (options && typeof options === 'object') return options;
        return {};
    }

    function getProviderSummary(provider, fallbackId, options = {}) {
        const safeOptions = normalizeSummaryOptions(options);
        const safeProvider = provider || {};
        const id = safeProvider.id || fallbackId || 'unknown';
        const metrics = Array.isArray(safeProvider.metrics) ? safeProvider.metrics : [];
        const quotaMetrics = metrics.filter(isQuotaMetric);
        const preferredMetricId = safeOptions.preferredMetricId || safeProvider.preferredMetricId;
        const topMetric = (preferredMetricId && quotaMetrics.find(m => m.id === preferredMetricId))
            || quotaMetrics.slice().sort(compareMetricsPriority)[0]
            || null;
        const providerState = getProviderState(safeProvider);
        const severity = providerState === 'error'
            ? 'critical'
            : providerState === 'warning'
                ? 'warning'
                : topMetric
                    ? getMetricSeverity(topMetric)
                    : 'normal';
        const remainingPercent = topMetric ? getRemainingPercent(topMetric) : null;
        const usedPercent = topMetric ? getUsedPercent(topMetric) : null;
        const infoMetric = metrics.find(metric => metric.type === 'info') || null;

        let priority = usedPercent || 0;
        if (severity === 'warning') priority += 300;
        if (severity === 'critical') priority += 600;
        if (providerState !== 'active') priority += 1000;

        return {
            id,
            name: safeProvider.name || id,
            plan: safeProvider.plan || '',
            account: safeProvider.account || '',
            status: safeProvider.status || 'not_configured',
            message: safeProvider.message || '',
            updatedAt: safeProvider.updatedAt || null,
            metrics,
            quotaMetrics,
            topMetric,
            infoMetric,
            remainingPercent,
            usedPercent,
            severity,
            providerState,
            priority,
            raw: safeProvider
        };
    }

    // Bản đồ tùy chọn theo nhà cung cấp, ví dụ { claude: 'claude_weekly' }.
    // Nếu không có mục riêng cho nhà cung cấp thì mới dùng tùy chọn dùng chung.
    function getSummaryOptionsFor(options, id) {
        if (!options || typeof options !== 'object') return {};
        if (options[id] !== undefined && options[id] !== null) {
            return normalizeSummaryOptions(options[id]);
        }
        if (typeof options.preferredMetricId === 'string') {
            return { preferredMetricId: options.preferredMetricId };
        }
        return {};
    }

    function getProviderSummaries(providers, options = {}) {
        const source = providers || {};
        return PROVIDER_ORDER.map(id => getProviderSummary(source[id], id, getSummaryOptionsFor(options, id)));
    }

    function sortByAttention(summaries) {
        return summaries.slice().sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return PROVIDER_ORDER.indexOf(a.id) - PROVIDER_ORDER.indexOf(b.id);
        });
    }

    function getAttentionItems(summaries) {
        return sortByAttention(summaries).filter(item => item.severity !== 'normal');
    }

    return {
        PROVIDER_ORDER,
        escapeHTML,
        safeUrl,
        clamp,
        isQuotaMetric,
        isSessionMetric,
        isWeeklyMetric,
        compareMetricsPriority,
        getUsedPercent,
        getRemainingPercent,
        getMetricSeverity,
        getProviderState,
        getProviderSummary,
        getProviderSummaries,
        sortByAttention,
        getAttentionItems
    };
});
