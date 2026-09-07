document.addEventListener('DOMContentLoaded', () => {
    const ui = window.UsageUI;
    if (!ui) throw new Error('UsageUI is required');
    const i18n = window.UsageI18n;
    if (!i18n) throw new Error('UsageI18n is required');

    const content = document.getElementById('widget-content');
    const statusText = document.getElementById('widget-status-text');
    const liveDot = document.getElementById('footer-live-dot');
    const footerHint = document.getElementById('footer-hint');
    const detailOverlay = document.getElementById('provider-detail-overlay');
    const detailCard = detailOverlay.querySelector('.detail-card');
    const detailTitle = document.getElementById('provider-detail-title');
    const detailKicker = document.getElementById('provider-detail-kicker');
    const detailContent = document.getElementById('provider-detail-content');
    const detailClose = document.getElementById('provider-detail-close');
    detailOverlay.classList.add('hidden');

    const urlParams = new URLSearchParams(window.location.search);
    const urlLang = urlParams.get('lang');
    const liveUpdatesEnabled = urlParams.get('static') !== '1';
    function checkIsTaskbar() {
        return urlParams.get('mode') === 'taskbar' || window.innerHeight <= 65 || window.outerHeight <= 65;
    }
    let isTaskbarMode = checkIsTaskbar();
    const dragHandle = document.getElementById('widget-drag-handle');
    const expandBtn = document.getElementById('taskbar-expand-btn');

    function syncTaskbarUI() {
        isTaskbarMode = checkIsTaskbar();
        if (isTaskbarMode) {
            document.body.classList.add('is-taskbar-mode');
            if (dragHandle) dragHandle.classList.remove('hidden');
            if (expandBtn) expandBtn.classList.remove('hidden');
        } else {
            document.body.classList.remove('is-taskbar-mode');
            if (dragHandle) dragHandle.classList.add('hidden');
            if (expandBtn) expandBtn.classList.add('hidden');
        }
    }
    syncTaskbarUI();
    window.addEventListener('resize', () => {
        syncTaskbarUI();
        if (currentData) renderWidget(currentData);
    });

    let currentLang = urlLang || localStorage.getItem('openusage_lang') || 'en';
    let currentData = null;
    let lastSuccessfulFetch = 0;
    let selectedProviderId = null;
    let liveUsageSource = null;
    let hasStaleProviders = false;
    let pinnedMetrics = {};
    try {
        pinnedMetrics = JSON.parse(localStorage.getItem('openusage_pinned_metrics') || '{}');
    } catch {
        pinnedMetrics = {};
    }

    const TEXT = {
        vi: {
            connecting: 'Đang kết nối…',
            updatedNow: 'Vừa cập nhật',
            updatedAgo: value => `Cập nhật ${value} trước`,
            used: value => `Đã sử dụng ${value}%`,
            stale: 'Dữ liệu cũ - đang chờ sync',
            syncWaiting: 'Có nguồn đang chờ đồng bộ',
            reset: value => `Đặt lại ${value}`,
            apiOk: 'OK',
            serviceReady: 'Sẵn sàng',
            noData: 'Chưa có dữ liệu',
            openFull: 'Mở đầy đủ ↗',
            details: 'CHI TIẾT DỊCH VỤ',
            showingOnTile: 'Đang hiện trên ô',
            clickToPin: 'Bấm để ghim lên ô',
            resetPin: 'Bấm để hoàn tác ghim',
        },
        en: {
            connecting: 'Connecting…',
            updatedNow: 'Updated just now',
            updatedAgo: value => `Updated ${value} ago`,
            used: value => `${value}% used`,
            stale: 'Stale data - waiting to sync',
            syncWaiting: 'A provider is waiting to sync',
            reset: value => `Resets in ${value}`,
            apiOk: 'OK',
            serviceReady: 'Ready',
            noData: 'No data',
            openFull: 'Open dashboard ↗',
            details: 'SERVICE DETAILS',
            showingOnTile: 'On tile',
            clickToPin: 'Click to pin',
            resetPin: 'Click to unpin',
        }
    };

    const syncChannel = typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('openusage_sync')
        : null;
    if (syncChannel) {
        syncChannel.onmessage = event => {
            if (event.data && event.data.type === 'lang') setLanguage(event.data.value);
        };
    }

    function text() {
        return TEXT[currentLang] || TEXT.vi;
    }

    // Dùng chung từ usage-ui.js thay vì chép lại ở từng giao diện
    const escapeHTML = ui.escapeHTML;
    const safeUrl = ui.safeUrl;

    function localizeMetric(metric) {
        return i18n.metricLabel(metric, currentLang);
    }

    function localizeStatus(status) {
        return i18n.statusLabel(status, currentLang);
    }

    function localizeMessage(provider) {
        return i18n.messageLabel(provider, currentLang);
    }

    function formatDuration(ms) {
        if (!Number.isFinite(ms) || ms <= 0) return currentLang === 'en' ? 'now' : 'bây giờ';
        const totalMinutes = Math.max(1, Math.floor(ms / 60000));
        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        if (days > 0) return `${days}${currentLang === 'en' ? 'd' : ' ngày'} ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    function formatReset(isoString) {
        if (!isoString) return '';
        return text().reset(formatDuration(new Date(isoString).getTime() - Date.now()));
    }

    function formatCountdown(isoString) {
        const resetAt = new Date(isoString).getTime();
        if (!isoString || !Number.isFinite(resetAt)) return '';
        const totalSeconds = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const clock = [hours, minutes, seconds]
            .map((value, index) => index === 0 && days === 0 ? String(value) : String(value).padStart(2, '0'))
            .join(':');
        return `◷ ${days > 0 ? `${days}d ` : ''}${clock}`;
    }

    function providerTile(summary) {
        const statusTextValue = localizeStatus(summary.status);
        let center;
        let metricLabel;
        let resetLabel = '';
        let resetAt = '';

        if (summary.providerState !== 'active') {
            center = '<span class="tile-state-icon">!</span>';
            metricLabel = statusTextValue;
            resetLabel = localizeMessage(summary.raw) || '';
        } else if (summary.topMetric) {
            center = `<svg class="progress-ring" viewBox="0 0 100 100" aria-hidden="true">
                <circle class="ring-track" cx="50" cy="50" r="40" pathLength="100"/>
                <circle class="ring-value" cx="50" cy="50" r="40" pathLength="100"/>
            </svg><span class="tile-number${summary.usedPercent >= 100 ? ' is-three-digit' : ''}">${summary.usedPercent}<small>%</small></span>`;
            metricLabel = localizeMetric(summary.topMetric);
            resetAt = summary.raw.stale ? '' : (summary.topMetric.resetsAt || '');
            resetLabel = summary.raw.stale ? text().stale : formatCountdown(resetAt);
        } else {
            center = `<span class="tile-state-icon"><span class="tile-number status-word">${escapeHTML(text().apiOk)}</span></span>`;
            metricLabel = text().serviceReady;
        }

        return `<button type="button" class="widget-tile ${escapeHTML(summary.id)} is-${summary.severity}${summary.raw.stale ? ' is-stale' : ''}" data-provider-id="${escapeHTML(summary.id)}" style="--progress:${summary.usedPercent ?? 0}">
            <span class="tile-top">
                <span class="tile-provider"><span class="tile-dot" aria-hidden="true"></span><span class="tile-name">${escapeHTML(summary.name)}</span></span>
                <span class="tile-arrow" aria-hidden="true">↗</span>
            </span>
            <span class="tile-center">${center}</span>
            <span class="tile-bottom">
                <span class="tile-metric">${escapeHTML(metricLabel)}</span>
                ${resetLabel ? `<span class="tile-reset${resetAt ? ' is-countdown' : ''}"${resetAt ? ` data-reset-at="${escapeHTML(resetAt)}" title="${escapeHTML(formatReset(resetAt))}"` : ''}>${escapeHTML(resetLabel)}</span>` : ''}
            </span>
        </button>`;
    }

    function getPillName(id, name) {
        switch (id) {
            case 'claude': return 'Claude';
            case 'antigravity': return 'AG';
            case 'chatgpt': return 'GPT';
            case 'gemini': return 'Gemini';
            default: return name;
        }
    }

    function taskbarPill(summary) {
        const statusTextValue = localizeStatus(summary.status);
        const metricLabel = summary.topMetric ? localizeMetric(summary.topMetric) : statusTextValue;
        // Nguon dang loi thi khong co so lieu, ve thanh day 100% de bi doc nham
        // thanh da dung het han muc.
        const hasQuota = summary.usedPercent != null;
        const usedPercent = hasQuota ? summary.usedPercent : 0;
        const pillName = getPillName(summary.id, summary.name);
        const resetLabel = summary.raw.stale ? text().stale : (summary.topMetric?.resetsAt ? formatCountdown(summary.topMetric.resetsAt) : '');
        const tooltip = `${summary.name}: ${usedPercent}% (${metricLabel})${resetLabel ? ' • ' + resetLabel : ''}`;

        return `<button type="button" class="taskbar-pill ${escapeHTML(summary.id)} is-${summary.severity}${summary.raw.stale ? ' is-stale' : ''}" data-provider-id="${escapeHTML(summary.id)}" title="${escapeHTML(tooltip)}">
            <span class="pill-left">
                <span class="pill-dot" aria-hidden="true"></span>
                <span class="pill-name">${escapeHTML(pillName)}</span>
            </span>
            <span class="pill-right">
                <span class="pill-value">${summary.providerState !== 'active' ? '!' : `${usedPercent}%`}</span>
                <span class="pill-bar-track"><span class="pill-bar-fill" style="width: ${hasQuota ? Math.min(100, Math.max(0, usedPercent)) : 0}%"></span></span>
            </span>
        </button>`;
    }

    function renderWidget(data) {
        if (!data || !data.providers) return;
        const summaries = ui.getProviderSummaries(data.providers, pinnedMetrics);
        hasStaleProviders = summaries.some(item => item.raw.stale);
        const attentionCount = summaries.filter(item => item.severity !== 'normal').length;
        const overallSeverity = summaries.some(item => item.severity === 'critical')
            ? 'critical'
            : attentionCount ? 'warning' : 'normal';

        if (isTaskbarMode) {
            content.innerHTML = summaries.map(taskbarPill).join('');
        } else {
            content.innerHTML = summaries.map(providerTile).join('');
        }
        footerHint.textContent = text().openFull;
        liveDot.className = `live-dot is-${overallSeverity}`;
        updateAgeLabel();

        if (selectedProviderId && !detailOverlay.classList.contains('hidden')) {
            const selected = summaries.find(item => item.id === selectedProviderId);
            if (selected) renderDetail(selected);
        }
    }

    function detailMetric(metric, summary) {
        const severity = ui.getMetricSeverity(metric);
        const name = escapeHTML(localizeMetric(metric));
        if (ui.isQuotaMetric(metric)) {
            const used = ui.getUsedPercent(metric);
            const isCurrentTop = summary && summary.topMetric && summary.topMetric.id === metric.id;
            const isCustomPinned = pinnedMetrics[summary.id] === metric.id;
            const badge = isCurrentTop
                ? `<span class="detail-badge is-active" title="${escapeHTML(text().showingOnTile)}">✓ ${escapeHTML(text().showingOnTile)}</span>`
                : `<span class="detail-badge is-selectable" title="${escapeHTML(text().clickToPin)}">${escapeHTML(text().clickToPin)}</span>`;

            return `<div class="detail-metric is-${severity} is-clickable" data-metric-id="${escapeHTML(metric.id)}" data-provider-id="${escapeHTML(summary.id)}" role="button" tabindex="0" title="${escapeHTML(isCustomPinned ? text().resetPin : text().clickToPin)}">
                <div class="detail-metric-head">
                    <span class="detail-metric-name">${name} ${badge}</span>
                    <span class="detail-metric-value">${escapeHTML(text().used(used))}</span>
                </div>
                ${metric.resetsAt ? `<div class="detail-metric-note" data-reset-at="${escapeHTML(metric.resetsAt)}">${escapeHTML(formatReset(metric.resetsAt))}</div>` : ''}
            </div>`;
        }
        if (metric.type === 'action_link') {
            return `<div class="detail-metric"><div class="detail-metric-name">${name}</div><a class="detail-action" href="${escapeHTML(safeUrl(metric.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(metric.actionText || 'Open ↗')}</a></div>`;
        }
        const value = metric.label || metric.value || metric.count || text().noData;
        return `<div class="detail-metric"><div class="detail-metric-head"><span class="detail-metric-name">${name}</span><span class="detail-metric-value">${escapeHTML(value)}</span></div></div>`;
    }

    function renderDetail(summary) {
        detailKicker.textContent = text().details;
        detailTitle.textContent = summary.name;
        if (summary.metrics.length) {
            detailContent.innerHTML = summary.metrics.map(m => detailMetric(m, summary)).join('');
        } else {
            const statusValue = localizeStatus(summary.status);
            detailContent.innerHTML = `<div class="detail-status"><strong>${escapeHTML(statusValue)}</strong><br>${escapeHTML(localizeMessage(summary.raw) || text().noData)}</div>`;
        }
    }

    // Lop phu chi tiet chi dung o che do o vuong. O che do thanh ngang, mot cu
    // nhap se mo thang bang dieu khien nen ham nay khong duoc goi toi.
    function openDetail(providerId) {
        if (!currentData) return;
        const summary = ui.getProviderSummaries(currentData.providers, pinnedMetrics)
            .find(item => item.id === providerId);
        if (!summary) return;
        selectedProviderId = providerId;
        renderDetail(summary);
        detailContent.scrollTop = 0;
        detailOverlay.classList.remove('hidden');
        detailOverlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('detail-open');
        detailClose.focus();
    }

    function closeDetail() {
        if (detailOverlay.classList.contains('hidden')) return;
        detailOverlay.classList.add('hidden');
        detailOverlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('detail-open');
        const tile = content.querySelector(`[data-provider-id="${selectedProviderId}"]`);
        if (tile) tile.focus();
    }

    function updateCountdowns() {
        document.querySelectorAll('[data-reset-at]').forEach(element => {
            if (!element.dataset.resetAt) return;
            if (element.classList.contains('tile-reset')) {
                element.textContent = formatCountdown(element.dataset.resetAt);
                element.title = formatReset(element.dataset.resetAt);
            } else {
                element.textContent = formatReset(element.dataset.resetAt);
            }
        });
    }

    function updateAgeLabel() {
        if (!lastSuccessfulFetch) return;
        if (hasStaleProviders) {
            statusText.textContent = text().syncWaiting;
            return;
        }
        const age = Date.now() - lastSuccessfulFetch;
        statusText.textContent = age < 15000 ? text().updatedNow : text().updatedAgo(formatDuration(age));
    }

    function applyUsageData(data) {
        if (!data || !data.providers) return;
        currentData = data;
        lastSuccessfulFetch = new Date(data.timestamp || Date.now()).getTime();
        renderWidget(data);
    }

    async function fetchUsage() {
        if (window.location.protocol === 'file:') return;
        try {
            const response = await fetch('/api/usage');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            applyUsageData(await response.json());
        } catch (error) {
            console.error('Widget usage fetch failed:', error);
            statusText.textContent = localizeStatus('error');
            liveDot.className = 'live-dot is-critical';
            if (!currentData) {
                content.innerHTML = `
                    <div style="padding:14px 10px;text-align:center;font-size:11px;color:#94a3b8;line-height:1.4;">
                        <div style="color:#ef4444;font-weight:600;margin-bottom:6px;">Máy chủ Offline / Server Offline</div>
                        <div>Không kết nối được 127.0.0.1:6736. Hãy chạy start.bat.</div>
                    </div>
                `;
            }
        }
    }

    function connectLiveUpdates() {
        if (!liveUpdatesEnabled || !window.EventSource || liveUsageSource) return;
        liveUsageSource = new EventSource('/api/events');
        liveUsageSource.addEventListener('usage', event => {
            try {
                applyUsageData(JSON.parse(event.data));
            } catch (error) {
                console.error('Widget live update failed:', error);
            }
        });
    }

    function setLanguage(lang) {
        currentLang = lang === 'en' ? 'en' : 'vi';
        document.documentElement.lang = currentLang;
        try { localStorage.setItem('openusage_lang', currentLang); } catch {}
        footerHint.textContent = text().openFull;
        if (currentData) renderWidget(currentData);
        else statusText.textContent = text().connecting;
    }

    content.addEventListener('click', event => {
        const tile = event.target.closest('[data-provider-id]');
        if (tile) {
            if (isTaskbarMode) {
                window.open('/', '_blank');
            } else {
                openDetail(tile.dataset.providerId);
            }
        }
    });

    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            window.open('/', '_blank');
        });
    }

    if (dragHandle) {
        dragHandle.addEventListener('dblclick', () => {
            window.open('/', '_blank');
        });
    }

    function handleMetricPinToggle(row) {
        if (!row) return;
        const metricId = row.dataset.metricId;
        const providerId = row.dataset.providerId;
        if (!metricId || !providerId) return;

        if (pinnedMetrics[providerId] === metricId) {
            delete pinnedMetrics[providerId];
        } else {
            pinnedMetrics[providerId] = metricId;
        }
        try {
            localStorage.setItem('openusage_pinned_metrics', JSON.stringify(pinnedMetrics));
        } catch {}
        if (currentData) renderWidget(currentData);
    }

    detailContent.addEventListener('click', event => {
        const row = event.target.closest('.detail-metric.is-clickable');
        if (row) handleMetricPinToggle(row);
    });

    detailContent.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            const row = event.target.closest('.detail-metric.is-clickable');
            if (row) {
                event.preventDefault();
                handleMetricPinToggle(row);
            }
        }
    });

    detailClose.addEventListener('click', closeDetail);
    detailOverlay.addEventListener('click', event => {
        if (event.target === detailOverlay) closeDetail();
    });
    window.addEventListener('keydown', event => {
        if (detailOverlay.classList.contains('hidden')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDetail();
            return;
        }
        if (event.key === 'Tab') {
            const focusable = [...detailCard.querySelectorAll('button:not([disabled]), a[href]')];
            const first = focusable[0] || detailCard;
            const last = focusable.at(-1) || detailCard;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });
    window.addEventListener('pageshow', event => {
        if (event.persisted) closeDetail();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - lastSuccessfulFetch > 30000) fetchUsage();
    });

    setLanguage(currentLang);

    if (window.location.protocol === 'file:') {
        statusText.textContent = 'Offline (file://)';
        liveDot.className = 'live-dot is-critical';
        content.innerHTML = `
            <div style="padding:14px 10px;text-align:center;font-size:11px;color:#94a3b8;line-height:1.4;">
                <div style="color:#f59e0b;font-weight:600;margin-bottom:6px;">Chạy qua start.bat / Run start.bat</div>
                <div>Widget cần máy chủ 127.0.0.1:6736 để đọc dữ liệu.</div>
                <div style="margin-top:8px;"><a href="http://127.0.0.1:6736/widget" style="color:#60a5fa;text-decoration:none;">http://127.0.0.1:6736/widget ↗</a></div>
            </div>
        `;
        return;
    }

    fetch('/api/preferences')
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then(preferences => {
            if (!urlLang && preferences.lang) setLanguage(preferences.lang);
        })
        .catch(() => {})
        .finally(() => {
            fetchUsage();
            connectLiveUpdates();
        });

    // Dự phòng khi EventSource bị trình duyệt hoặc phần mềm bảo mật chặn.
    window.setInterval(() => {
        if (document.hidden) return;
        if (liveUsageSource && liveUsageSource.readyState === EventSource.OPEN) return;
        fetchUsage();
    }, 30000);
    window.setInterval(() => {
        if (document.hidden) return;
        updateCountdowns();
        updateAgeLabel();
    }, 1000);
});
