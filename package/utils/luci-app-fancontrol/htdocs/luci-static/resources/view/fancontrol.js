'use strict';
'require view';
'require fs';
'require form';
'require uci';
'require ui';
'require poll';

function pInt(v, d) { var n = parseInt(v); return isNaN(n) ? d : n; }
function isValidNumber(v) { return typeof v === 'number' && isFinite(v); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

var DEFAULT_CURVE = '20:0,35:0,50:77,70:159,100:255';

function buildCurveTable(C) {
    var rows = [
        E('tr', { style: 'background:' + C.surface }, [
            E('th', { class: 'th center', style: 'padding:5px;border:1px solid ' + C.border }, '#'),
            E('th', { class: 'th center', style: 'padding:5px;border:1px solid ' + C.border }, '°C'),
            E('th', { class: 'th center', style: 'padding:5px;border:1px solid ' + C.border }, 'PWM')
        ])
    ];
    var is = 'width:58px;text-align:center;padding:2px';

    for (var r = 0; r < 5; r++) {
        rows.push(E('tr', {}, [
            E('td', { class: 'td center', style: 'text-align:center;padding:3px;border:1px solid ' + C.border + ';color:' + C.accent }, 'P' + (r + 1)),
            E('td', { class: 'td center', style: 'padding:3px;border:1px solid ' + C.border }, [
                E('input', { class: 'cbi-input-text', id: 'fc-t' + r, type: 'number', min: 0, max: 100, step: 1, style: is })
            ]),
            E('td', { class: 'td center', style: 'padding:3px;border:1px solid ' + C.border }, [
                E('input', { class: 'cbi-input-text', id: 'fc-s' + r, type: 'number', min: 0, max: 255, step: 1, style: is })
            ])
        ]));
    }

    return E('table', { class: 'table cbi-section-table', style: 'width:100%;border-collapse:collapse;font-size:13px;color:' + C.text }, rows);
}

var THEME = {
    dark: {
        bg:'#1a1a2e', surface:'#2a2a3e', border:'#444', inputBg:'#1a1a2e', inputBorder:'#555',
        text:'#fff', textSec:'#888', textMuted:'#666',
        accent:'#00d4ff', cpu:'#e74c3c', pwm:'#2ecc71',
        gridLine:'#2a2a3e', axisLabel:'#555', axisTitle:'#666',
        fillArea:'rgba(0,212,255,0.06)', pointStroke:'#fff'
    },
    light: {
        bg:'#f5f6f8', surface:'#e8eaed', border:'#d0d3d7', inputBg:'#fff', inputBorder:'#c0c3c7',
        text:'#222', textSec:'#777', textMuted:'#999',
        accent:'#0066cc', cpu:'#c0392b', pwm:'#1e8449',
        gridLine:'#dde0e4', axisLabel:'#999', axisTitle:'#888',
        fillArea:'rgba(0,102,204,0.06)', pointStroke:'#333'
    }
};

var cachedTheme = null;

function detectTheme() {
    if (cachedTheme)
        return cachedTheme;

    // 1. 显式主题类: Argon 深色 / OpenWrt 主题标识
    if (document.body.classList.contains('dark') ||
        document.body.classList.contains('theme-dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark') {
        return (cachedTheme = 'dark');
    }
    if (document.body.classList.contains('light') ||
        document.body.classList.contains('theme-light') ||
        document.documentElement.getAttribute('data-theme') === 'light') {
        return (cachedTheme = 'light');
    }
    // 2. OS 级偏好 (Auto 模式下 Argon 等依赖此)
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return (cachedTheme = 'dark');
    }
    // 3. 回退: body 背景亮度检测 (避免每次都调用 getComputedStyle)
    var bg = getComputedStyle(document.body).backgroundColor;
    var m = bg.match(/[\d.]+/g);
    if (!m || m.length < 3) return (cachedTheme = 'dark');
    var r = +m[0], g = +m[1], b = +m[2];
    var lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return (cachedTheme = lum < 128 ? 'dark' : 'light');
}

return view.extend({
    load: function () { return uci.load('fancontrol'); },

    render: function () {
        var self = this;
        var C = THEME[detectTheme()];
        var m = new form.Map('fancontrol', _('Fan Control'));
        var intervalInput, failLimitInput, curveEditor;
        var lastSavedConfig = null;
        var applyStatusTimer = null;
        var initTimer = null;

        function normalizeInterval(v) {
            return clamp(pInt(v, 3), 1, 3600);
        }

        function normalizeFailLimit(v) {
            return clamp(pInt(v, 10), 1, 3600);
        }

        function setIntervalValue(v, persist) {
            var n = normalizeInterval(v);

            if (intervalInput)
                intervalInput.value = n;

            if (persist)
                uci.set('fancontrol', 'settings', 'interval', String(n));

            return n;
        }

        function setFailLimitValue(v, persist) {
            var n = normalizeFailLimit(v);

            if (failLimitInput)
                failLimitInput.value = n;

            if (persist)
                uci.set('fancontrol', 'settings', 'temp_fail_limit', String(n));

            return n;
        }

        function readSavedConfig() {
            return {
                curve: uci.get('fancontrol', 'settings', 'curve') || DEFAULT_CURVE,
                interval: String(normalizeInterval(uci.get('fancontrol', 'settings', 'interval') || '3')),
                tempFailLimit: String(normalizeFailLimit(uci.get('fancontrol', 'settings', 'temp_fail_limit') || '10'))
            };
        }

        function sameFanConfig(a, b) {
            return !!a && !!b &&
                a.curve === b.curve &&
                a.interval === b.interval &&
                a.tempFailLimit === b.tempFailLimit;
        }

        function showApplyStatus(type, message) {
            if (applyStatusTimer)
                window.clearTimeout(applyStatusTimer);

            ui.changes.displayStatus(type, E('p', message));

            applyStatusTimer = window.setTimeout(function () {
                applyStatusTimer = null;
                ui.changes.displayStatus(false);
            }, Math.max(1, L.env.apply_display || 3) * 1000);
        }

        function collectDesiredConfig() {
            var curve = curveEditor ? curveEditor.serialize() : { ok: true, value: document.getElementById('fc-hidden').value };

            if (!curve.ok) {
                ui.addNotification(null, E('p', _('Invalid fan curve input: %s').format(curve.message || _('Please enter a valid number.'))), 'danger');
                return null;
            }

            return {
                curve: curve.value,
                interval: String(normalizeInterval(intervalInput ? intervalInput.value : uci.get('fancontrol', 'settings', 'interval'))),
                tempFailLimit: String(normalizeFailLimit(failLimitInput ? failLimitInput.value : uci.get('fancontrol', 'settings', 'temp_fail_limit')))
            };
        }

        function applyConfigToWidgets(cfg) {
            setIntervalValue(cfg && cfg.interval || '3', false);
            setFailLimitValue(cfg && cfg.tempFailLimit || '10', false);

            if (curveEditor && curveEditor.setCurve)
                curveEditor.setCurve(cfg && cfg.curve || DEFAULT_CURVE);
        }

        function refreshChangeIndicator() {
            return uci.changes().then(function (changes) {
                ui.changes.renderChangeIndicator(changes);
                return changes;
            });
        }

        function stageFancontrolChanges() {
            var desiredConfig = collectDesiredConfig();

            if (!desiredConfig)
                return Promise.resolve({ ok: false, changed: false });

            if (sameFanConfig(desiredConfig, lastSavedConfig))
                return refreshChangeIndicator().then(function (changes) {
                    return { ok: true, changed: false, config: desiredConfig, changes: changes };
                });

            uci.set('fancontrol', 'settings', 'curve', desiredConfig.curve);
            uci.set('fancontrol', 'settings', 'interval', desiredConfig.interval);
            uci.set('fancontrol', 'settings', 'temp_fail_limit', desiredConfig.tempFailLimit);

            return uci.save().then(function () {
                lastSavedConfig = desiredConfig;
                return refreshChangeIndicator();
            }).then(function (changes) {
                return { ok: true, changed: true, config: desiredConfig, changes: changes };
            });
        }

        function hasFancontrolChanges(changes) {
            return !!(changes && changes.fancontrol && changes.fancontrol.length);
        }

        function hasAnyChanges(changes) {
            for (var config in changes)
                if (changes[config] && changes[config].length)
                    return true;

            return false;
        }

        function restartServiceAfterApply() {
            var timeout, onApplied;

            onApplied = function () {
                window.clearTimeout(timeout);
                fs.exec('/etc/init.d/fancontrol', ['restart']).then(function () {
                    uci.unload('fancontrol');
                    return uci.load('fancontrol');
                }).then(function () {
                    lastSavedConfig = readSavedConfig();
                    applyConfigToWidgets(lastSavedConfig);
                    return refreshChangeIndicator();
                }).then(function () {
                    pollStatus();
                }).catch(function (err) {
                    ui.addNotification(null, E('p', _('Unable to restart fancontrol: %s').format(err.message || err)), 'danger');
                });
            };

            document.addEventListener('uci-applied', onApplied, { once: true });

            timeout = window.setTimeout(function () {
                document.removeEventListener('uci-applied', onApplied);
            }, (Math.max(1, L.env.apply_rollback || 90) + Math.max(1, L.env.apply_display || 3) + 5) * 1000);
        }

        function resetLocalChanges() {
            uci.unload('fancontrol');

            return uci.load('fancontrol').then(function () {
                lastSavedConfig = readSavedConfig();
                applyConfigToWidgets(lastSavedConfig);
                return refreshChangeIndicator();
            });
        }

        // ====== 实时状态 ======
        var s0 = m.section(form.TypedSection, 'settings', _('Live Status'));
        s0.anonymous = true;
        s0.render = L.bind(function () {
            return E('div', { class: 'cbi-section' }, [
                E('div', { style: 'display:flex;gap:24px;justify-content:center;flex-wrap:wrap' }, [
                    E('div', { style: 'text-align:center' }, [
                        E('div', { style: 'font-size:11px;color:' + C.cpu }, _('CPU Temperature')),
                        E('div', { id: 'fs-cpu', style: 'font-size:24px;font-weight:bold;color:' + C.cpu }, '--°C')
                    ]),
                    E('div', { style: 'text-align:center' }, [
                        E('div', { style: 'font-size:11px;color:' + C.pwm }, _('Fan PWM')),
                        E('div', { id: 'fs-pwm', style: 'font-size:24px;font-weight:bold;color:' + C.pwm }, '--')
                    ])
                ])
            ]);
        }, s0);

        // ====== 采样间隔 ======
        var sI = m.section(form.TypedSection, 'settings', _('Fan Settings'));
        sI.anonymous = true;
        sI.render = L.bind(function () {
            return E('div', { class: 'cbi-section' }, [
                E('div', { class: 'cbi-value', style: 'text-align:center' }, [
                    E('div', { style: 'display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap' }, [
                        E('label', { for: 'fc-interval', style: 'font-size:12px;color:' + C.textSec }, _('Temperature sampling interval (s)')),
                        E('input', {
                            id: 'fc-interval',
                            type: 'number',
                            min: 1,
                            max: 3600,
                            step: 1,
                            class: 'cbi-input-text',
                            style: 'width:72px;text-align:center;padding:3px'
                        }),
                        E('label', { for: 'fc-fail-limit', style: 'font-size:12px;color:' + C.textSec }, _('Temperature failure threshold')),
                        E('input', {
                            id: 'fc-fail-limit',
                            type: 'number',
                            min: 1,
                            max: 3600,
                            step: 1,
                            class: 'cbi-input-text',
                            style: 'width:72px;text-align:center;padding:3px'
                        })
                    ])
                ])
            ]);
        }, sI);

        // ====== 曲线 ======
        var s1 = m.section(form.TypedSection, 'settings', _('Fan Curve'));
        s1.anonymous = true;
        s1.render = L.bind(function () {
            return E('div', { class: 'cbi-section' }, [
                E('div', { style: 'display:flex;gap:16px;align-items:flex-start;justify-content:center;flex-wrap:wrap;max-width:840px;margin:0 auto' }, [
                    E('div', { id: 'fc-graph', style: 'flex:0 1 500px;text-align:center' }),
                    E('div', { id: 'fc-table', style: 'flex:0 1 260px;min-width:170px;max-width:260px',
                    }, [ buildCurveTable(C) ])
                ]),
                E('input', { type: 'hidden', id: 'fc-hidden' })
            ]);
        }, s1);

        // ====== 初始化 ======
        initTimer = window.setTimeout(function () {
            initTimer = null;
            if (self.fancontrol)
                self.fancontrol.initTimer = null;

            lastSavedConfig = readSavedConfig();

            intervalInput = document.getElementById('fc-interval');
            failLimitInput = document.getElementById('fc-fail-limit');
            setIntervalValue(lastSavedConfig.interval, false);
            setFailLimitValue(lastSavedConfig.tempFailLimit, false);
            if (intervalInput) {
                intervalInput.onchange = function () { setIntervalValue(this.value, true); };
                intervalInput.onblur = function () { setIntervalValue(this.value, true); };
            }
            if (failLimitInput) {
                failLimitInput.onchange = function () { setFailLimitValue(this.value, true); };
                failLimitInput.onblur = function () { setFailLimitValue(this.value, true); };
            }

            // 曲线
            var cs = lastSavedConfig.curve;
            curveEditor = initCurveGraph(cs);

            // 轮询
            pollStatus();
            poll.add(pollStatus, 3);
            self.fancontrol.pollStatus = pollStatus;
        }, 300);

        var pollStatus = function () {
            fs.read('/var/run/fancontrol.json').then(function (raw) {
                var st = {};

                try {
                    st = JSON.parse(raw || '{}');
                } catch (e) {
                    st = {};
                }

                var hasCpu = st.cpu !== null && st.cpu !== undefined && st.cpu !== '';
                var c = Number(st.cpu);
                var p = Number(st.pwm);

                setText('fs-cpu', hasCpu && isValidNumber(c) && c >= -40 && c <= 125 ? c.toFixed(1) + '°C' : '--');
                setText('fs-pwm', isValidNumber(p) && p >= 0 ? p + ' / ' + Math.round(p / 255 * 100) + '%' : '--');
            }).catch(function () {
                setText('fs-cpu', '--');
                setText('fs-pwm', '--');
            });
        };

	        self.fancontrol = {
	            stage: stageFancontrolChanges,
	            hasChanges: hasFancontrolChanges,
	            hasAnyChanges: hasAnyChanges,
	            restartAfterApply: restartServiceAfterApply,
	            reset: resetLocalChanges,
	            showStatus: showApplyStatus,
            initTimer: initTimer,
            pollStatus: null
        };

        function setText(id, txt) { var e = document.getElementById(id); if (e) e.textContent = txt; }

        return m.render();
    },

    handleSave: function () {
        return this.fancontrol.stage().catch(function (err) {
            ui.addNotification(null, E('p', _('Failed to save configuration: %s').format(err.message || err)), 'danger');
        });
    },

    handleSaveApply: function (ev, mode) {
        return this.fancontrol.stage().then(function (res) {
            if (!res.ok)
                return;

	            if (this.fancontrol.hasChanges(res.changes))
	                this.fancontrol.restartAfterApply();

	            if (!this.fancontrol.hasAnyChanges(res.changes)) {
	                this.fancontrol.showStatus('notice', _('There are no changes to apply'));
	                return;
	            }

	            return ui.changes.apply(mode == '0');
	        }.bind(this)).catch(function (err) {
	            ui.addNotification(null, E('p', _('Unable to apply settings: %s').format(err.message || err)), 'danger');
	        });
    },

    handleReset: function () {
        return this.fancontrol.reset().catch(function (err) {
            ui.addNotification(null, E('p', _('Unable to reset form: %s').format(err.message || err)), 'danger');
        });
    },

    remove: function () {
        if (!this.fancontrol)
            return;

        if (this.fancontrol.initTimer)
            window.clearTimeout(this.fancontrol.initTimer);

        if (this.fancontrol.pollStatus)
            poll.remove(this.fancontrol.pollStatus);
    }
});

// ====== SVG ======
function initCurveGraph(curveStr) {
    var C = THEME[detectTheme()];
    var W = 500, H = 290, PL = 42, PR = 18, PT = 18, PB = 33;
    var pw = W - PL - PR, ph = H - PT - PB, maxT = 100, maxS = 255, N = 5;
    var GAP_T = 5;
    function xf(t) { return PL + t / maxT * pw; }
    function yf(s) { return PT + ph - s / maxS * ph; }
    function tx(px) { return Math.round((px - PL) / pw * maxT); }
    function ty(py) { return Math.round((PT + ph - py) / ph * maxS); }
    var container = document.getElementById('fc-graph'), dragIdx = -1;
    var hidden = document.getElementById('fc-hidden');

    function defaultPts() {
        return [
            { t: 20, s: 0 },
            { t: 35, s: 0 },
            { t: 50, s: 77 },
            { t: 70, s: 159 },
            { t: 100, s: 255 }
        ];
    }

    function normalizePts(inPts) {
        var out = [];

        for (var i = 0; i < N; i++) {
            var d = defaultPts()[i];
            var p = inPts && inPts[i] ? inPts[i] : d;
            out.push({
                t: clamp(pInt(p.t, d.t), 0, maxT),
                s: clamp(pInt(p.s, d.s), 0, maxS)
            });
        }

        for (var i = 1; i < N; i++) {
            if (out[i].t < out[i - 1].t + GAP_T)
                out[i].t = out[i - 1].t + GAP_T;
            if (out[i].s < out[i - 1].s)
                out[i].s = out[i - 1].s;
        }

        if (out[N - 1].t > maxT)
            out[N - 1].t = maxT;

        for (var i = N - 2; i >= 0; i--) {
            if (out[i].t > out[i + 1].t - GAP_T)
                out[i].t = out[i + 1].t - GAP_T;
        }

        for (var i = 0; i < N; i++) {
            out[i].t = clamp(out[i].t, 0, maxT);
            out[i].s = clamp(out[i].s, 0, maxS);
        }

        return out;
    }

    function parseCurve(str) {
        var out = defaultPts();
        var parts = (str || '').split(',');

        for (var i = 0; i < N && i < parts.length; i++) {
            var kv = parts[i].split(':');
            if (kv.length == 2) {
                out[i].t = pInt(kv[0], out[i].t);
                out[i].s = pInt(kv[1], out[i].s);
            }
        }

        return normalizePts(out);
    }

    var pts = parseCurve(curveStr);

    function curveString() { return pts.map(function (p) { return p.t + ':' + p.s; }).join(','); }

    function pointBounds(i) {
        return {
            tMin: i > 0 ? pts[i - 1].t + GAP_T : 0,
            tMax: i < N - 1 ? pts[i + 1].t - GAP_T : maxT,
            sMin: i > 0 ? pts[i - 1].s : 0,
            sMax: i < N - 1 ? pts[i + 1].s : maxS
        };
    }

    function clearInputState(input) {
        if (!input)
            return;
        input.style.borderColor = '';
        input.title = '';
        if (input.setCustomValidity)
            input.setCustomValidity('');
    }

    function markInput(input, message) {
        if (!input)
            return;
        input.style.borderColor = '#e74c3c';
        input.title = message;
        if (input.setCustomValidity)
            input.setCustomValidity(message);
    }

    function readInput(input) {
        var raw = input ? input.value.trim() : '';

        if (!/^-?[0-9]+$/.test(raw))
            return null;

        return parseInt(raw, 10);
    }

    function fail(input, row, message) {
        var full = 'P' + row + ': ' + message;
        markInput(input, full);
        return { ok: false, message: full, input: input };
    }

    function validateTable() {
        var next = [];

        for (var i = 0; i < N; i++) {
            var ti = document.getElementById('fc-t' + i), si = document.getElementById('fc-s' + i);
            clearInputState(ti);
            clearInputState(si);

            var t = readInput(ti);
            var s = readInput(si);

            if (t == null)
                return fail(ti, i + 1, _('Please enter a valid number.'));
            if (s == null)
                return fail(si, i + 1, _('Please enter a valid number.'));
            if (t < 0 || t > maxT)
                return fail(ti, i + 1, _('Temperature must be between 0 and 100°C.'));
            if (s < 0 || s > maxS)
                return fail(si, i + 1, _('PWM must be between 0 and 255.'));
            if (i > 0 && t < next[i - 1].t + GAP_T)
                return fail(ti, i + 1, _('Temperature must increase by at least 5°C.'));
            if (i > 0 && s < next[i - 1].s)
                return fail(si, i + 1, _('PWM must not decrease.'));

            next.push({ t: t, s: s });
        }

        return { ok: true, pts: next };
    }

    function commitTable() {
        var rv = validateTable();

        if (!rv.ok) {
            if (rv.input && rv.input.focus)
                rv.input.focus();
            return rv;
        }

        pts = rv.pts;
        render();
        return { ok: true, value: curveString() };
    }

    function clampCell(i, field) {
        var input = document.getElementById('fc-' + (field == 't' ? 't' : 's') + i);
        var value = readInput(input);

        if (value == null) {
            if (input)
                input.value = pts[i][field];
            clearInputState(input);
            return;
        }

        var b = pointBounds(i);

        if (field == 't')
            pts[i].t = clamp(value, b.tMin, b.tMax);
        else
            pts[i].s = clamp(value, b.sMin, b.sMax);

        clearInputState(input);
        render();
    }

    function render() {
        if (hidden)
            hidden.value = curveString();

        for (var i = 0; i < N; i++) {
            var ti = document.getElementById('fc-t' + i), si = document.getElementById('fc-s' + i);
            if (ti && ti !== document.activeElement) ti.value = pts[i].t;
            if (si && si !== document.activeElement) si.value = pts[i].s;
        }
        var s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="max-width:100%;height:auto;user-select:none">';
        for (var t = 0; t <= maxT; t += 10) s += '<line x1="' + xf(t) + '" y1="' + PT + '" x2="' + xf(t) + '" y2="' + (PT + ph) + '" stroke="' + C.gridLine + '" stroke-width="0.5"/>';
        for (var v = 0; v <= maxS; v += 25) s += '<line x1="' + PL + '" y1="' + yf(v) + '" x2="' + (PL + pw) + '" y2="' + yf(v) + '" stroke="' + C.gridLine + '" stroke-width="0.5"/>';
        s += '<text x="' + (PL + pw / 2) + '" y="' + (H - 4) + '" fill="' + C.axisTitle + '" font-size="11" text-anchor="middle">°C</text>';
        s += '<text x="12" y="' + (PT + ph / 2) + '" fill="' + C.axisTitle + '" font-size="11" text-anchor="middle" transform="rotate(-90,12,' + (PT + ph / 2) + ')">PWM</text>';
        for (var t = 0; t <= maxT; t += 20) s += '<text x="' + xf(t) + '" y="' + (PT + ph + 14) + '" fill="' + C.axisLabel + '" font-size="9" text-anchor="middle">' + t + '</text>';
        for (var v = 0; v <= maxS; v += 50) s += '<text x="' + (PL - 5) + '" y="' + (yf(v) + 4) + '" fill="' + C.axisLabel + '" font-size="9" text-anchor="end">' + v + '</text>';
        var d = 'M' + xf(0) + ',' + yf(pts[0].s) + ' L' + xf(pts[0].t) + ',' + yf(pts[0].s) + ' ';
        for (var i = 1; i < N; i++) d += 'L' + xf(pts[i].t) + ',' + yf(pts[i].s) + ' ';
        d += 'L' + xf(maxT) + ',' + yf(pts[N - 1].s);
        s += '<path d="' + d + ' L' + xf(maxT) + ',' + yf(0) + ' L' + xf(0) + ',' + yf(0) + ' Z" fill="' + C.fillArea + '"/>';
        s += '<path d="' + d + '" stroke="' + C.accent + '" stroke-width="2.5" fill="none" stroke-linejoin="round"/>';
        for (var i = 0; i < N; i++) {
            s += '<circle cx="' + xf(pts[i].t) + '" cy="' + yf(pts[i].s) + '" r="6" fill="' + C.accent + '" stroke="' + C.pointStroke + '" stroke-width="2" class="fpt" data-idx="' + i + '" style="cursor:grab"/>';
            s += '<text x="' + (xf(pts[i].t) + 10) + '" y="' + (yf(pts[i].s) - 7) + '" fill="' + C.text + '" font-size="10">' + pts[i].t + '°/' + pts[i].s + '</text>';
        }
        s += '</svg>';
        container.innerHTML = s;
        container.querySelectorAll('.fpt').forEach(function (c) {
            c.onmousedown = function (e) { dragIdx = +c.dataset.idx; e.preventDefault(); };
        });
        container.onmousemove = function (e) {
            if (dragIdx < 0) return;
            var r = container.querySelector('svg').getBoundingClientRect();
            var localX = (e.clientX - r.left) * W / r.width;
            var localY = (e.clientY - r.top) * H / r.height;
            var t = Math.max(0, Math.min(maxT, tx(localX)));
            var s = Math.max(0, Math.min(maxS, ty(localY)));
            var b = pointBounds(dragIdx);

            pts[dragIdx].t = clamp(t, b.tMin, b.tMax);
            pts[dragIdx].s = clamp(s, b.sMin, b.sMax);
            render();
        };
        container.onmouseup = function () { dragIdx = -1; };
        container.onmouseleave = function () { dragIdx = -1; };
    }

    render();

    for (var i = 0; i < N; i++) {
        (function (idx) {
            var ti = document.getElementById('fc-t' + idx), si = document.getElementById('fc-s' + idx);

            if (ti) {
                ti.oninput = validateTable;
                ti.onchange = function () { clampCell(idx, 't'); };
                ti.onblur = function () { clampCell(idx, 't'); };
                ti.onkeydown = function (e) { if (e.key == 'Enter') this.blur(); };
            }

            if (si) {
                si.oninput = validateTable;
                si.onchange = function () { clampCell(idx, 's'); };
                si.onblur = function () { clampCell(idx, 's'); };
                si.onkeydown = function (e) { if (e.key == 'Enter') this.blur(); };
            }
        })(i);
    }

    return {
        serialize: commitTable,
        setCurve: function (curve) {
            pts = parseCurve(curve);
            render();
        }
    };
}
