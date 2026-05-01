// ==UserScript==
// @name         TikTok AutoLike Panel
// @namespace    https://github.com/eliaspc2/tiktok-autolike-userscript
// @version      1.1.4
// @homepageURL  https://github.com/eliaspc2/tiktok-autolike-userscript
// @downloadURL  https://raw.githubusercontent.com/eliaspc2/tiktok-autolike-userscript/main/tiktok-autolike.user.js
// @updateURL    https://raw.githubusercontent.com/eliaspc2/tiktok-autolike-userscript/main/tiktok-autolike.user.js
// @license      MIT
// @description  Floating control panel and launcher to automate likes on TikTok Web.
// @author       eliaspc2
// @match        https://www.tiktok.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  if (window.ttAutoLikePanel) {
    return;
  }

  const STORAGE_KEY = 'ttAutoLike.settings.v1';
  const PANEL_ID = 'tt-auto-like-panel';
  const LAUNCHER_ID = 'tt-auto-like-launcher';
  const DEFAULT_PANEL_POSITION = {
    top: 16,
    right: 16,
  };
  const DEFAULT_LAUNCHER_POSITION = {
    top: 16,
    right: 16,
  };
  const MODE_DEFAULT_VALUES = {
    c: 50000,
    m: 60,
  };
  const DEFAULTS = {
    mode: 'c',
    value: MODE_DEFAULT_VALUES.c,
    speed: 30,
    manualValue: false,
    panelHidden: false,
    top: DEFAULT_PANEL_POSITION.top,
    left: null,
    launcherTop: DEFAULT_LAUNCHER_POSITION.top,
    launcherLeft: null,
  };

  const state = {
    running: false,
    paused: false,
    status: 'idle',
    count: 0,
    startTime: 0,
    delayMin: 18,
    delayMax: 38,
    mode: DEFAULTS.mode,
    manualValue: DEFAULTS.manualValue,
    nextShort: 0,
    nextLong: 0,
    maxClicks: Infinity,
    endTime: Infinity,
    statsTimer: null,
  };

  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function clampInt(value, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return min;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  function clampFloat(value, min, max) {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) {
      return min;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  function loadSettings() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { ...DEFAULTS };
      }
      const parsed = JSON.parse(raw);
      const mode = parsed.mode === 'm' ? 'm' : 'c';
      const manualValue = Boolean(parsed.manualValue);
      return {
        mode,
        value: manualValue && Number.isFinite(parsed.value)
          ? parsed.value
          : MODE_DEFAULT_VALUES[mode],
        speed: Number.isFinite(parsed.speed) ? parsed.speed : DEFAULTS.speed,
        manualValue,
        panelHidden: Boolean(parsed.panelHidden),
        top: Number.isFinite(parsed.top) ? parsed.top : DEFAULTS.top,
        left: Number.isFinite(parsed.left) ? parsed.left : DEFAULTS.left,
        launcherTop: Number.isFinite(parsed.launcherTop) ? parsed.launcherTop : DEFAULTS.launcherTop,
        launcherLeft: Number.isFinite(parsed.launcherLeft) ? parsed.launcherLeft : DEFAULTS.launcherLeft,
      };
    } catch (err) {
      return { ...DEFAULTS };
    }
  }

  function saveSettings(extra) {
    const current = loadSettings();
    const next = {
      ...current,
      ...extra,
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      // Ignore storage failures and keep the script usable.
    }
  }

  function isVisible(el) {
    if (!el) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getLabel(el) {
    if (!el) {
      return '';
    }
    return [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.textContent,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  function findLikeTarget() {
    const visibleButtons = Array.from(
      document.querySelectorAll('button, div[role="button"], span[role="button"]'),
    ).filter(isVisible);

    const labeled = visibleButtons.find((el) => {
      const label = getLabel(el).toLowerCase();
      if (!label) {
        return false;
      }
      const isLike = /like|curtir|gostar/.test(label);
      const isUnlike = /unlike|descurtir|nao gostei|não gostei/.test(label);
      return isLike && !isUnlike;
    });

    if (labeled) {
      return labeled;
    }

    const icon = document.querySelector(
      'svg.text-color-UIShapePrimary, svg[class*="UIShapePrimary"], svg[data-e2e*="like"]',
    );
    if (icon) {
      return icon.closest('button, div[role="button"], div.cursor-pointer') || icon.parentElement;
    }

    return visibleButtons.find((el) => {
      const iconChild = el.querySelector('svg.text-color-UIShapePrimary');
      return Boolean(iconChild);
    }) || null;
  }

  function clickLikeTarget(target) {
    if (!target) {
      return false;
    }

    const clickable = target.closest
      ? target.closest('button, div[role="button"], div.cursor-pointer') || target
      : target;

    if (typeof clickable.click === 'function') {
      clickable.click();
      return true;
    }

    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
    });
    clickable.dispatchEvent(event);
    return true;
  }

  function chatFocused() {
    const el = document.activeElement;
    if (!el) {
      return false;
    }

    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
  }

  const saved = loadSettings();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.innerHTML = [
    '<style>',
    `#${PANEL_ID} {`,
    '  position: fixed;',
    `  top: ${DEFAULT_PANEL_POSITION.top}px;`,
    `  right: ${DEFAULT_PANEL_POSITION.right}px;`,
    '  left: auto;',
    '  transform: none;',
    '  z-index: 2147483647;',
    '  width: min(360px, calc(100vw - 24px));',
    '  color: #e5e7eb;',
    '  font: 14px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  user-select: none;',
    '  -webkit-user-select: none;',
    '}',
    `#${PANEL_ID} * { box-sizing: border-box; }`,
    `#${PANEL_ID} button,`,
    `#${PANEL_ID} input { font: inherit; }`,
    `#${PANEL_ID} .tt-card {`,
    '  overflow: hidden;',
    '  border-radius: 16px;',
    '  background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(17, 24, 39, 0.98));',
    '  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255, 255, 255, 0.08);',
    '  backdrop-filter: blur(12px);',
    '}',
    `#${PANEL_ID} .tt-header {`,
    '  display: flex;',
    '  align-items: flex-start;',
    '  justify-content: space-between;',
    '  gap: 12px;',
    '  padding: 12px 14px;',
    '  cursor: move;',
    '  background: linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(59, 130, 246, 0.16));',
    '  border-bottom: 1px solid rgba(255, 255, 255, 0.08);',
    '}',
    `#${PANEL_ID} .tt-header-copy { min-width: 0; }`,
    `#${PANEL_ID} .tt-header-controls {`,
    '  display: inline-flex;',
    '  align-items: flex-start;',
    '  gap: 8px;',
    '  flex: 0 0 auto;',
    '}',
    `#${PANEL_ID} .tt-title { font-weight: 700; letter-spacing: 0.02em; }`,
    `#${PANEL_ID} .tt-subtitle { font-size: 12px; color: rgba(229, 231, 235, 0.72); margin-top: 2px; }`,
    `#${PANEL_ID} .tt-pill {`,
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  min-width: 78px;',
    '  padding: 5px 10px;',
    '  border-radius: 999px;',
    '  font-size: 12px;',
    '  font-weight: 700;',
    '  letter-spacing: 0.04em;',
    '  text-transform: uppercase;',
    '  background: rgba(255, 255, 255, 0.08);',
    '  color: #d1d5db;',
    '}',
    `#${PANEL_ID}[data-status="running"] .tt-pill { background: rgba(16, 185, 129, 0.2); color: #86efac; }`,
    `#${PANEL_ID}[data-status="paused"] .tt-pill { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }`,
    `#${PANEL_ID}[data-status="finished"] .tt-pill,`,
    `#${PANEL_ID}[data-status="stopped"] .tt-pill { background: rgba(239, 68, 68, 0.2); color: #fca5a5; }`,
    `#${PANEL_ID} .tt-icon-button {`,
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  width: 28px;',
    '  height: 28px;',
    '  padding: 0;',
    '  border: 1px solid rgba(255, 255, 255, 0.12);',
    '  border-radius: 999px;',
    '  background: rgba(255, 255, 255, 0.08);',
    '  color: rgba(248, 113, 113, 0.95);',
    '  font-size: 18px;',
    '  font-weight: 700;',
    '  line-height: 1;',
    '  cursor: pointer;',
    '}',
    `#${PANEL_ID} .tt-icon-button:hover {`,
    '  background: rgba(239, 68, 68, 0.16);',
    '  border-color: rgba(239, 68, 68, 0.28);',
    '  color: #fecaca;',
    '}',
    `#${PANEL_ID} .tt-icon-button:active { transform: translateY(1px); }`,
    `#${PANEL_ID} .tt-body { padding: 14px; display: grid; gap: 12px; }`,
    `#${PANEL_ID} .tt-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }`,
    `#${PANEL_ID} .tt-btn {`,
    '  appearance: none;',
    '  border: 1px solid rgba(255, 255, 255, 0.12);',
    '  background: rgba(255, 255, 255, 0.06);',
    '  color: #e5e7eb;',
    '  border-radius: 10px;',
    '  padding: 7px 11px;',
    '  cursor: pointer;',
    '  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;',
    '}',
    `#${PANEL_ID} .tt-btn:hover { background: rgba(255, 255, 255, 0.11); }`,
    `#${PANEL_ID} .tt-btn:active { transform: translateY(1px); }`,
    `#${PANEL_ID} .tt-btn.active {`,
    '  background: linear-gradient(135deg, rgba(16, 185, 129, 0.92), rgba(5, 150, 105, 0.92));',
    '  border-color: rgba(16, 185, 129, 0.92);',
    '  color: #ffffff;',
    '  box-shadow: 0 10px 20px rgba(16, 185, 129, 0.25);',
    '}',
    `#${PANEL_ID} .tt-field {`,
    '  width: 100%;',
    '  padding: 8px 10px;',
    '  border-radius: 10px;',
    '  border: 1px solid rgba(255, 255, 255, 0.12);',
    '  background: rgba(255, 255, 255, 0.05);',
    '  color: #f9fafb;',
    '  text-align: center;',
    '  outline: none;',
    '}',
    `#${PANEL_ID} .tt-field:focus { border-color: rgba(34, 197, 94, 0.65); box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15); }`,
    `#${PANEL_ID} .tt-label { font-size: 12px; color: rgba(229, 231, 235, 0.7); margin-bottom: 6px; }`,
    `#${PANEL_ID} .tt-slider-row { display: flex; align-items: center; gap: 10px; }`,
    `#${PANEL_ID} .tt-slider-row span { font-size: 12px; color: rgba(229, 231, 235, 0.75); min-width: 36px; }`,
    `#${PANEL_ID} .tt-slider { width: 100%; direction: rtl; }`,
    `#${PANEL_ID} .tt-metrics {`,
    '  display: grid;',
    '  gap: 6px;',
    '  padding-top: 12px;',
    '  border-top: 1px solid rgba(255, 255, 255, 0.08);',
    '  font-size: 13px;',
    '  color: rgba(229, 231, 235, 0.85);',
    '}',
    `#${PANEL_ID} .tt-metrics strong { color: #ffffff; }`,
    `#${LAUNCHER_ID} {`,
    '  position: fixed;',
    `  top: ${DEFAULT_LAUNCHER_POSITION.top}px;`,
    `  right: ${DEFAULT_LAUNCHER_POSITION.right}px;`,
    '  left: auto;',
    '  display: none;',
    '  align-items: center;',
    '  justify-content: center;',
    '  width: 54px;',
    '  height: 54px;',
    '  padding: 0;',
    '  border: 1px solid rgba(255, 255, 255, 0.10);',
    '  border-radius: 18px;',
    '  background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(17, 24, 39, 0.98));',
    '  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.34), 0 0 0 1px rgba(255, 255, 255, 0.04);',
    '  color: #f8fafc;',
    '  cursor: pointer;',
    '  z-index: 2147483647;',
    '  user-select: none;',
    '  -webkit-user-select: none;',
    '}',
    `#${LAUNCHER_ID}:hover {`,
    '  box-shadow: 0 20px 46px rgba(0, 0, 0, 0.40), 0 0 0 1px rgba(255, 255, 255, 0.08);',
    '}',
    `#${LAUNCHER_ID} .tt-launcher-label {`,
    '  font-weight: 800;',
    '  font-size: 16px;',
    '  letter-spacing: 0.04em;',
    '  line-height: 1;',
    '}',
    `#${LAUNCHER_ID} .tt-launcher-dot {`,
    '  position: absolute;',
    '  top: 8px;',
    '  right: 8px;',
    '  width: 12px;',
    '  height: 12px;',
    '  border-radius: 999px;',
    '  background: #ef4444;',
    '  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18);',
    '}',
    `#${LAUNCHER_ID}[data-status="running"] .tt-launcher-dot {`,
    '  background: #22c55e;',
    '  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);',
    '}',
    `#${LAUNCHER_ID}[data-status="paused"] .tt-launcher-dot,`,
    `#${LAUNCHER_ID}[data-status="chat"] .tt-launcher-dot {`,
    '  background: #f59e0b;',
    '  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);',
    '}',
    `#${LAUNCHER_ID}[data-status="stopped"] .tt-launcher-dot,`,
    `#${LAUNCHER_ID}[data-status="finished"] .tt-launcher-dot,`,
    `#${LAUNCHER_ID}[data-status="idle"] .tt-launcher-dot {`,
    '  background: #ef4444;',
    '  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18);',
    '}',
    '</style>',
    '<div class="tt-card">',
    '  <div class="tt-header" id="tt-drag">',
    '    <div class="tt-header-copy">',
    '      <div class="tt-title">TikTok AutoLike</div>',
    '      <div class="tt-subtitle">Greasemonkey userscript</div>',
    '    </div>',
    '    <div class="tt-header-controls">',
    '      <div class="tt-pill" id="tt-status">Idle</div>',
    '      <button class="tt-icon-button tt-close" id="tt-close" type="button" aria-label="Fechar painel" title="Fechar painel">&times;</button>',
    '    </div>',
    '  </div>',
    '  <div class="tt-body">',
    `    <input id="tt-value" class="tt-field" type="number" value="${MODE_DEFAULT_VALUES.c}" min="1" step="1" />`,
    '    <div class="tt-row">',
    '      <button class="tt-btn active" id="tt-mode-clicks" type="button">Clicks</button>',
    '      <button class="tt-btn" id="tt-mode-minutes" type="button">Minutes</button>',
    '    </div>',
    '    <div>',
    '      <div class="tt-label">Speed</div>',
    '      <div class="tt-slider-row">',
    '        <span>Slow</span>',
    '        <input id="tt-slider" class="tt-slider" type="range" min="5" max="120" value="30" />',
    '        <span>Fast</span>',
    '      </div>',
    '    </div>',
    '    <div class="tt-row">',
    '      <button class="tt-btn" id="tt-slow" type="button">Slow</button>',
    '      <button class="tt-btn active" id="tt-normal" type="button">Normal</button>',
    '      <button class="tt-btn" id="tt-fast" type="button">Fast</button>',
    '      <button class="tt-btn" id="tt-turbo" type="button">Turbo</button>',
    '    </div>',
    '    <div class="tt-row">',
    '      <button class="tt-btn" id="tt-start" type="button">Start</button>',
    '      <button class="tt-btn" id="tt-pause" type="button">Pause</button>',
    '      <button class="tt-btn" id="tt-stop" type="button">Stop</button>',
    '    </div>',
    '    <div class="tt-metrics">',
    '      <div>Status: <strong id="tt-status-text">Idle</strong></div>',
    '      <div>Likes sent: <strong id="tt-likes">0</strong></div>',
    '      <div>Time: <strong id="tt-time">0s</strong></div>',
    '      <div>Likes/min: <strong id="tt-rate">0</strong></div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('');

  const launcher = document.createElement('button');
  launcher.id = LAUNCHER_ID;
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Abrir TikTok AutoLike');
  launcher.title = 'Abrir TikTok AutoLike';
  launcher.innerHTML = [
    '<span class="tt-launcher-label">TT</span>',
    '<span class="tt-launcher-dot" aria-hidden="true"></span>',
  ].join('');

  const valueInput = panel.querySelector('#tt-value');
  const statusPill = panel.querySelector('#tt-status');
  const statusText = panel.querySelector('#tt-status-text');
  const likesText = panel.querySelector('#tt-likes');
  const timeText = panel.querySelector('#tt-time');
  const rateText = panel.querySelector('#tt-rate');
  const slider = panel.querySelector('#tt-slider');
  const modeClicks = panel.querySelector('#tt-mode-clicks');
  const modeMinutes = panel.querySelector('#tt-mode-minutes');
  const slow = panel.querySelector('#tt-slow');
  const normal = panel.querySelector('#tt-normal');
  const fast = panel.querySelector('#tt-fast');
  const turbo = panel.querySelector('#tt-turbo');
  const startButton = panel.querySelector('#tt-start');
  const pauseButton = panel.querySelector('#tt-pause');
  const stopButton = panel.querySelector('#tt-stop');
  const closeButton = panel.querySelector('#tt-close');
  const dragHandle = panel.querySelector('#tt-drag');

  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let launcherDragging = false;
  let launcherDragMoved = false;
  let launcherDragOffsetX = 0;
  let launcherDragOffsetY = 0;

  function setActive(group, active) {
    group.forEach((button) => button.classList.remove('active'));
    if (active) {
      active.classList.add('active');
    }
  }

  function syncSpeedPreset() {
    const speed = clampInt(slider.value, 5, 120);

    let active = normal;
    if (speed >= 75) {
      active = slow;
    } else if (speed >= 35) {
      active = normal;
    } else if (speed >= 15) {
      active = fast;
    } else {
      active = turbo;
    }

    setActive([slow, normal, fast, turbo], active);
  }

  function setSpeed(value) {
    const speed = clampInt(value, 5, 120);
    slider.value = String(speed);
    state.delayMin = speed;
    state.delayMax = speed + 20;
    syncSpeedPreset();
    saveSettings({ speed });
  }

  function setMode(mode) {
    state.mode = mode === 'm' ? 'm' : 'c';
    setActive([modeClicks, modeMinutes], state.mode === 'c' ? modeClicks : modeMinutes);

    if (!state.manualValue) {
      valueInput.value = String(MODE_DEFAULT_VALUES[state.mode]);
      saveSettings({ mode: state.mode, value: clampFloat(valueInput.value, 1, 1000000) });
    } else {
      saveSettings({ mode: state.mode });
    }
  }

  function setStatus(status) {
    const normalized = String(status || 'idle').toLowerCase();
    const label = normalized.toUpperCase();

    state.status = normalized;
    panel.dataset.status = normalized;
    launcher.dataset.status = normalized;
    statusPill.textContent = label;
    statusText.textContent = label;
    launcher.title = `TikTok AutoLike: ${label}. Clique para abrir o painel.`;
    launcher.setAttribute('aria-label', `TikTok AutoLike ${label}`);
  }

  function updateStats() {
    if (!state.running) {
      return;
    }

    const elapsed = (Date.now() - state.startTime) / 1000;
    timeText.textContent = `${Math.floor(elapsed)}s`;
    rateText.textContent = elapsed > 0 ? String(Math.round((state.count / elapsed) * 60)) : '0';
  }

  function savePanelPosition() {
    const top = Math.round(panel.getBoundingClientRect().top);
    const left = Math.round(panel.getBoundingClientRect().left);
    saveSettings({ top, left });
  }

  function saveLauncherPosition() {
    const top = Math.round(launcher.getBoundingClientRect().top);
    const left = Math.round(launcher.getBoundingClientRect().left);
    saveSettings({ launcherTop: top, launcherLeft: left });
  }

  function applySavedPosition() {
    if (Number.isFinite(saved.left)) {
      panel.style.left = `${saved.left}px`;
      panel.style.top = `${saved.top}px`;
      panel.style.transform = 'none';
      panel.style.right = 'auto';
    } else {
      panel.style.left = 'auto';
      panel.style.right = `${DEFAULT_PANEL_POSITION.right}px`;
      panel.style.top = `${saved.top}px`;
      panel.style.transform = 'none';
    }
  }

  function applySavedLauncherPosition() {
    if (Number.isFinite(saved.launcherLeft)) {
      launcher.style.left = `${saved.launcherLeft}px`;
      launcher.style.top = `${saved.launcherTop}px`;
      launcher.style.right = 'auto';
      launcher.style.bottom = 'auto';
    } else {
      launcher.style.left = 'auto';
      launcher.style.right = `${DEFAULT_LAUNCHER_POSITION.right}px`;
      launcher.style.top = `${saved.launcherTop}px`;
      launcher.style.bottom = 'auto';
    }
  }

  function applySavedControls() {
    state.mode = saved.mode;
    state.manualValue = saved.manualValue;
    valueInput.value = String(saved.value);
    slider.value = String(saved.speed);
    syncSpeedPreset();
    setMode(state.mode);
    setSpeed(saved.speed);
  }

  function showPanel(options = {}) {
    const { persist = true } = options;
    panel.style.display = '';
    launcher.style.display = 'none';
    if (persist) {
      saveSettings({ panelHidden: false });
    }
  }

  function hidePanel(options = {}) {
    const { persist = true } = options;
    panel.style.display = 'none';
    launcher.style.display = 'flex';
    if (persist) {
      saveSettings({ panelHidden: true });
    }
  }

  function startRun() {
    if (state.running) {
      return;
    }

    const value = clampFloat(valueInput.value, 1, 1000000);
    state.count = 0;
    state.startTime = Date.now();
    state.nextShort = rand(200, 350);
    state.nextLong = rand(600, 900);
    state.running = true;
    state.paused = false;

    if (state.mode === 'c') {
      state.maxClicks = Math.max(1, Math.floor(value));
      state.endTime = Infinity;
    } else {
      state.maxClicks = Infinity;
      state.endTime = Date.now() + Math.max(1, value) * 60000;
    }

    likesText.textContent = '0';
    timeText.textContent = '0s';
    rateText.textContent = '0';
    setStatus('running');

    if (state.statsTimer) {
      window.clearInterval(state.statsTimer);
    }
    state.statsTimer = window.setInterval(updateStats, 500);
    tick();
  }

  function pauseRun() {
    if (!state.running) {
      return;
    }

    state.paused = !state.paused;
    setStatus(state.paused ? 'paused' : 'running');
  }

  function stopRun(nextStatus = 'stopped') {
    state.running = false;
    state.paused = false;
    if (state.statsTimer) {
      window.clearInterval(state.statsTimer);
      state.statsTimer = null;
    }
    setStatus(nextStatus);
  }

  function tick() {
    if (!state.running) {
      return;
    }

    if (chatFocused()) {
      setStatus('chat');
      window.setTimeout(tick, 500);
      return;
    }

    if (state.paused) {
      setStatus('paused');
      window.setTimeout(tick, 200);
      return;
    }

    if (state.count >= state.maxClicks || Date.now() >= state.endTime) {
      stopRun('finished');
      return;
    }

    const target = findLikeTarget();
    if (target) {
      clickLikeTarget(target);
      state.count += 1;
      likesText.textContent = String(state.count);
    }

    let delay = rand(state.delayMin, state.delayMax);
    let reason = 'running';

    if (state.count >= state.nextShort) {
      delay = rand(200, 600);
      state.nextShort += rand(200, 350);
      reason = 'short break';
    }

    if (state.count >= state.nextLong) {
      delay = rand(800, 1600);
      state.nextLong += rand(600, 900);
      reason = 'long break';
    }

    setStatus(reason);
    window.setTimeout(tick, delay);
  }

  function closePanel() {
    hidePanel();
  }

  function updateModeFromInput() {
    state.manualValue = true;
    saveSettings({ manualValue: true, value: clampFloat(valueInput.value, 1, 1000000) });
  }

  function handleCloseIntent(event) {
    event.preventDefault();
    event.stopPropagation();
    closePanel();
  }

  dragHandle.addEventListener('mousedown', function (event) {
    if (event.button !== 0 || event.target.closest('.tt-header-controls')) {
      return;
    }

    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    panel.style.transform = 'none';
    panel.style.right = 'auto';
    document.body.style.userSelect = 'none';
    event.preventDefault();
  });

  document.addEventListener('mousemove', function (event) {
    if (!dragging) {
      return;
    }

    panel.style.left = `${Math.max(0, event.clientX - dragOffsetX)}px`;
    panel.style.top = `${Math.max(0, event.clientY - dragOffsetY)}px`;
  });

  document.addEventListener('mouseup', function () {
    if (!dragging) {
      return;
    }

    dragging = false;
    document.body.style.userSelect = '';
    savePanelPosition();
  });

  launcher.addEventListener('click', function () {
    if (launcherDragMoved) {
      launcherDragMoved = false;
      return;
    }

    showPanel();
  });

  launcher.addEventListener('mousedown', function (event) {
    if (event.button !== 0) {
      return;
    }

    launcherDragging = true;
    launcherDragMoved = false;
    const rect = launcher.getBoundingClientRect();
    launcherDragOffsetX = event.clientX - rect.left;
    launcherDragOffsetY = event.clientY - rect.top;
    document.body.style.userSelect = 'none';
    event.preventDefault();
  });

  document.addEventListener('mousemove', function (event) {
    if (!launcherDragging) {
      return;
    }

    const left = Math.max(8, Math.min(event.clientX - launcherDragOffsetX, window.innerWidth - launcher.offsetWidth - 8));
    const top = Math.max(8, Math.min(event.clientY - launcherDragOffsetY, window.innerHeight - launcher.offsetHeight - 8));
    launcher.style.left = `${left}px`;
    launcher.style.top = `${top}px`;
    launcher.style.right = 'auto';
    launcher.style.bottom = 'auto';
    launcherDragMoved = true;
  });

  document.addEventListener('mouseup', function () {
    if (!launcherDragging) {
      return;
    }

    launcherDragging = false;
    document.body.style.userSelect = '';
    saveLauncherPosition();
    window.setTimeout(function () {
      launcherDragMoved = false;
    }, 0);
  });

  valueInput.addEventListener('input', updateModeFromInput);

  modeClicks.addEventListener('click', function () {
    setMode('c');
    if (!state.manualValue) {
      valueInput.value = String(MODE_DEFAULT_VALUES.c);
    }
  });

  modeMinutes.addEventListener('click', function () {
    setMode('m');
    if (!state.manualValue) {
      valueInput.value = String(MODE_DEFAULT_VALUES.m);
    }
  });

  slider.addEventListener('input', function () {
    setSpeed(slider.value);
  });

  slow.addEventListener('click', function () {
    slider.value = '90';
    setSpeed(90);
  });

  normal.addEventListener('click', function () {
    slider.value = '45';
    setSpeed(45);
  });

  fast.addEventListener('click', function () {
    slider.value = '25';
    setSpeed(25);
  });

  turbo.addEventListener('click', function () {
    slider.value = '10';
    setSpeed(10);
  });

  startButton.addEventListener('click', startRun);
  pauseButton.addEventListener('click', pauseRun);
  stopButton.addEventListener('click', stopRun);
  closeButton.addEventListener('mousedown', handleCloseIntent);
  closeButton.addEventListener('click', handleCloseIntent);

  const mountPoint = document.body || document.documentElement;
  mountPoint.appendChild(panel);
  mountPoint.appendChild(launcher);
  applySavedPosition();
  applySavedLauncherPosition();
  applySavedControls();
  setStatus('idle');
  window.ttAutoLikePanel = panel;
  if (saved.panelHidden) {
    hidePanel({ persist: false });
  } else {
    showPanel({ persist: false });
  }
})();
