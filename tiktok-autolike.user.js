// ==UserScript==
// @name         TikTok AutoLike Panel
// @namespace    https://github.com/eliaspc2/tiktok-autolike-userscript
// @version      1.3.0
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
    left: 16,
    bottom: 16,
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
    status: 'idle',
    running: false,
    paused: false,
    count: 0,
    accumulatedElapsedMs: 0,
    currentRunStartedAt: 0,
    sessionTotalMs: null,
    maxClicks: null,
    nextShort: 0,
    nextLong: 0,
    top: DEFAULT_PANEL_POSITION.top,
    left: null,
    launcherTop: null,
    launcherLeft: null,
  };

  const state = {
    running: false,
    paused: false,
    status: 'idle',
    count: 0,
    delayMin: 18,
    delayMax: 38,
    mode: DEFAULTS.mode,
    manualValue: DEFAULTS.manualValue,
    accumulatedElapsedMs: DEFAULTS.accumulatedElapsedMs,
    currentRunStartedAt: DEFAULTS.currentRunStartedAt,
    sessionTotalMs: DEFAULTS.sessionTotalMs,
    nextShort: 0,
    nextLong: 0,
    maxClicks: Infinity,
    statsTimer: null,
  };

  let soundBootstrapActive = false;
  let soundBootstrapDone = false;
  let soundBootstrapInterval = null;
  let soundBootstrapObserver = null;
  const soundBootstrapState = {
    phase: 'loading',
    detail: 'Waiting for page and player',
    attempts: 0,
    docReadyState: document.readyState,
    readyDocs: 0,
    mutedDocs: 0,
    targetDocs: 0,
    totalDocs: 0,
    lastSeenAt: Date.now(),
    failed: false,
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
        status: typeof parsed.status === 'string' ? parsed.status : DEFAULTS.status,
        running: Boolean(parsed.running),
        paused: Boolean(parsed.paused),
        count: Number.isFinite(parsed.count) ? parsed.count : DEFAULTS.count,
        accumulatedElapsedMs: Number.isFinite(parsed.accumulatedElapsedMs)
          ? parsed.accumulatedElapsedMs
          : DEFAULTS.accumulatedElapsedMs,
        currentRunStartedAt: Number.isFinite(parsed.currentRunStartedAt)
          ? parsed.currentRunStartedAt
          : DEFAULTS.currentRunStartedAt,
        sessionTotalMs: Number.isFinite(parsed.sessionTotalMs)
          ? parsed.sessionTotalMs
          : DEFAULTS.sessionTotalMs,
        maxClicks: Number.isFinite(parsed.maxClicks) ? parsed.maxClicks : DEFAULTS.maxClicks,
        nextShort: Number.isFinite(parsed.nextShort) ? parsed.nextShort : DEFAULTS.nextShort,
        nextLong: Number.isFinite(parsed.nextLong) ? parsed.nextLong : DEFAULTS.nextLong,
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
    '  display: grid;',
    '  grid-template-columns: minmax(0, 1fr) auto;',
    '  gap: 12px;',
    '  align-items: start;',
    '  padding: 12px 14px;',
    '  position: relative;',
    '  background: linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(59, 130, 246, 0.16));',
    '  border-bottom: 1px solid rgba(255, 255, 255, 0.08);',
    '}',
    `#${PANEL_ID} .tt-header-copy { min-width: 0; flex: 1 1 auto; cursor: move; }`,
    `#${PANEL_ID} .tt-header-controls {`,
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: 8px;',
    '  flex: 0 0 auto;',
    '  justify-self: end;',
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
    '  width: 34px;',
    '  height: 34px;',
    '  padding: 0;',
    '  border: 1px solid rgba(255, 255, 255, 0.12);',
    '  border-radius: 999px;',
    '  background: rgba(255, 255, 255, 0.08);',
    '  color: rgba(248, 113, 113, 0.95);',
    '  font-size: 18px;',
    '  font-weight: 700;',
    '  line-height: 1;',
    '  cursor: pointer;',
    '  flex: 0 0 auto;',
    '  position: static;',
    '  z-index: 3;',
    '  min-width: 34px;',
    '  min-height: 34px;',
    '  touch-action: manipulation;',
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
    `#${PANEL_ID} .tt-boot-line {`,
    '  padding-top: 6px;',
    '  border-top: 1px solid rgba(255, 255, 255, 0.06);',
    '  font-size: 12px;',
    '  color: rgba(229, 231, 235, 0.78);',
    '}',
    `#${PANEL_ID} .tt-boot-detail {`,
    '  font-size: 11px;',
    '  color: rgba(229, 231, 235, 0.62);',
    '  line-height: 1.3;',
    '  word-break: break-word;',
    '}',
    `#${LAUNCHER_ID} {`,
    '  position: fixed;',
    '  top: auto;',
    '  right: auto;',
    `  left: ${DEFAULT_LAUNCHER_POSITION.left}px;`,
    `  bottom: ${DEFAULT_LAUNCHER_POSITION.bottom}px;`,
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
    '  <div class="tt-header">',
    '    <div class="tt-header-copy" id="tt-drag">',
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
    '      <div class="tt-boot-line">Boot: <strong id="tt-boot-phase">LOADING</strong></div>',
    '      <div class="tt-boot-detail" id="tt-boot-detail">Waiting for page and player</div>',
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
  const bootPhaseText = panel.querySelector('#tt-boot-phase');
  const bootDetailText = panel.querySelector('#tt-boot-detail');
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
    updateLauncherTitle();
  }

  function normalizeBootPhase(phase) {
    const normalized = String(phase || 'loading').toLowerCase();
    if (['loading', 'mounting', 'ready', 'trying-unmute', 'unmuted', 'failed'].includes(normalized)) {
      return normalized;
    }

    return 'loading';
  }

  function updateLauncherTitle() {
    const statusLabel = String(state.status || 'idle').toUpperCase();
    const bootLabel = String(soundBootstrapState.phase || 'loading').toUpperCase();
    const detail = soundBootstrapState.detail ? ` · ${soundBootstrapState.detail}` : '';

    launcher.title = `TikTok AutoLike: ${statusLabel} · Boot: ${bootLabel}${detail}. Clique para abrir o painel.`;
    launcher.setAttribute('aria-label', `TikTok AutoLike ${statusLabel}, boot ${bootLabel}`);
  }

  function renderBootState(next = {}) {
    if (next.phase) {
      soundBootstrapState.phase = normalizeBootPhase(next.phase);
    }

    if (typeof next.detail === 'string') {
      soundBootstrapState.detail = next.detail;
    }

    if (Number.isFinite(next.attempts)) {
      soundBootstrapState.attempts = next.attempts;
    }

    if (typeof next.docReadyState === 'string') {
      soundBootstrapState.docReadyState = next.docReadyState;
    }

    if (Number.isFinite(next.readyDocs)) {
      soundBootstrapState.readyDocs = next.readyDocs;
    }

    if (Number.isFinite(next.mutedDocs)) {
      soundBootstrapState.mutedDocs = next.mutedDocs;
    }

    if (Number.isFinite(next.targetDocs)) {
      soundBootstrapState.targetDocs = next.targetDocs;
    }

    if (Number.isFinite(next.totalDocs)) {
      soundBootstrapState.totalDocs = next.totalDocs;
    }

    if (typeof next.failed === 'boolean') {
      soundBootstrapState.failed = next.failed;
    }

    soundBootstrapState.lastSeenAt = Date.now();

    if (bootPhaseText) {
      bootPhaseText.textContent = soundBootstrapState.phase.replace(/-/g, ' ').toUpperCase();
    }

    if (bootDetailText) {
      const pieces = [
        `doc ${soundBootstrapState.docReadyState}`,
        `docs ${soundBootstrapState.totalDocs}`,
        `ready ${soundBootstrapState.readyDocs}`,
        `muted ${soundBootstrapState.mutedDocs}`,
        `targets ${soundBootstrapState.targetDocs}`,
        `tries ${soundBootstrapState.attempts}`,
      ];
      if (soundBootstrapState.failed) {
        pieces.push('failed');
      }
      bootDetailText.textContent = soundBootstrapState.detail
        ? `${soundBootstrapState.detail} · ${pieces.join(' · ')}`
        : pieces.join(' · ');
    }

    updateLauncherTitle();
  }

  function collectSoundBootstrapSnapshot() {
    const docs = collectAccessibleDocuments();
    const docReadyState = document.readyState;
    let readyDocs = 0;
    let mutedDocs = 0;
    let targetDocs = 0;
    const entries = [];

    for (const doc of docs) {
      const videos = Array.from(doc.querySelectorAll('video'));
      const ready = videos.some((video) => video.readyState >= 2);
      const target = findSoundTarget(doc);
      const muted = isAudioLikelyMuted(doc, target);

      if (ready) {
        readyDocs += 1;
      }

      if (muted) {
        mutedDocs += 1;
      }

      if (target) {
        targetDocs += 1;
      }

      entries.push({
        doc,
        ready,
        muted,
        target,
      });
    }

    return {
      docReadyState,
      totalDocs: docs.length,
      readyDocs,
      mutedDocs,
      targetDocs,
      entries,
    };
  }

  function describeBootPhase(snapshot) {
    if (snapshot.docReadyState === 'loading') {
      return {
        phase: 'loading',
        detail: 'Waiting for the page to finish loading',
      };
    }

    if (snapshot.readyDocs === 0) {
      return {
        phase: 'mounting',
        detail: 'TikTok player still mounting',
      };
    }

    if (snapshot.mutedDocs === 0) {
      return {
        phase: 'unmuted',
        detail: 'Audio already appears active',
      };
    }

    if (soundBootstrapDone) {
      return {
        phase: 'unmuted',
        detail: 'Audio activation confirmed',
      };
    }

    if (soundBootstrapActive) {
      return {
        phase: 'trying-unmute',
        detail: snapshot.targetDocs > 0
          ? 'Target found, trying unmute'
          : 'Ready player, waiting for sound target',
      };
    }

    return {
      phase: 'ready',
      detail: snapshot.targetDocs > 0
        ? 'Player ready and sound target visible'
        : 'Player ready, sound target not visible',
    };
  }

  function activateSoundFromSnapshot(snapshot) {
    let attempted = false;

    for (const entry of snapshot.entries) {
      if (!entry.ready) {
        continue;
      }

      if (!entry.muted) {
        continue;
      }

      if (entry.target) {
        attempted = true;
        if (dispatchSoundActivationSequence(entry.target, entry.doc)) {
          continue;
        }
      }

      if (dispatchMuteShortcut(entry.doc)) {
        attempted = true;
      }
    }

    return attempted;
  }

  function getElapsedMs(now = Date.now()) {
    return state.accumulatedElapsedMs + (state.running && !state.paused && state.currentRunStartedAt
      ? now - state.currentRunStartedAt
      : 0);
  }

  function getRemainingMs(now = Date.now()) {
    if (!Number.isFinite(state.sessionTotalMs)) {
      return Infinity;
    }

    return Math.max(0, state.sessionTotalMs - getElapsedMs(now));
  }

  function persistRuntimeState(extra = {}) {
    const sessionTotalMs = Number.isFinite(state.sessionTotalMs) ? state.sessionTotalMs : null;
    const maxClicks = Number.isFinite(state.maxClicks) ? state.maxClicks : null;
    const liveElapsedMs = state.running && !state.paused && state.currentRunStartedAt
      ? Date.now() - state.currentRunStartedAt
      : 0;
    const accumulatedElapsedMs = state.accumulatedElapsedMs + liveElapsedMs;
    const currentRunStartedAt = state.running && !state.paused ? 0 : state.currentRunStartedAt;

    saveSettings({
      status: state.status,
      running: state.running,
      paused: state.paused,
      count: state.count,
      accumulatedElapsedMs,
      currentRunStartedAt,
      sessionTotalMs,
      maxClicks,
      nextShort: state.nextShort,
      nextLong: state.nextLong,
      ...extra,
    });
  }

  function updateStats() {
    const elapsed = getElapsedMs();
    const elapsedSeconds = elapsed / 1000;
    timeText.textContent = `${Math.floor(elapsedSeconds)}s`;
    rateText.textContent = elapsedSeconds > 0 ? String(Math.round((state.count / elapsedSeconds) * 60)) : '0';
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

  function collectAccessibleDocuments(rootDoc = document) {
    const docs = [];
    const queue = [rootDoc];
    const seen = new Set();

    while (queue.length > 0) {
      const doc = queue.shift();
      if (!doc || seen.has(doc)) {
        continue;
      }

      seen.add(doc);
      docs.push(doc);

      Array.from(doc.querySelectorAll('iframe')).forEach((frame) => {
        try {
          const childDoc = frame.contentDocument;
          if (childDoc) {
            queue.push(childDoc);
          }
        } catch (err) {
          // Ignore cross-origin frames and keep scanning the rest.
        }
      });
    }

    return docs;
  }

  function isAudioLikelyMuted(doc = document, providedTarget = null) {
    const videos = Array.from(doc.querySelectorAll('video'));
    if (videos.some((video) => video.muted || video.volume === 0)) {
      return true;
    }

    const soundTarget = providedTarget || findSoundTarget(doc);
    if (!soundTarget) {
      return false;
    }

    const label = getLabel(soundTarget).toLowerCase();
    return /unmute|tap to unmute|turn on sound|sound on|enable sound|audio on|volume on|speaker on/.test(label);
  }

  function findSoundTarget(doc = document) {
    const candidates = Array.from(
      doc.querySelectorAll('button, div[role="button"], span[role="button"], [aria-label], [title], [data-e2e]'),
    ).filter(isVisible);

    const labeled = candidates.find((el) => {
      const label = getLabel(el).toLowerCase();
      if (!label) {
        return false;
      }

      return /unmute|tap to unmute|turn on sound|sound on|enable sound|audio on|volume on|speaker on|ligar som|ativar som/.test(label);
    });

    if (labeled) {
      return labeled;
    }

    const speakerIcon = Array.from(doc.querySelectorAll('svg')).find((svg) => {
      const viewBox = svg.getAttribute('viewBox') || '';
      if (viewBox !== '0 0 48 48') {
        return false;
      }

      const pathData = Array.from(svg.querySelectorAll('path'))
        .map((path) => path.getAttribute('d') || '')
        .join(' ');

      return /M4 19a3 3 0 0 1 3-3h4\.15/.test(pathData) && /M37\.43 37\.44/.test(pathData);
    });

    if (speakerIcon) {
      return findClickableAncestor(speakerIcon);
    }

    const icon = doc.querySelector(
      'svg[class*="sound"], svg[class*="volume"], svg[data-e2e*="sound"], svg[data-e2e*="mute"]',
    );
    if (icon) {
      return findClickableAncestor(icon);
    }

    return null;
  }

  function findClickableAncestor(node) {
    let current = node;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const label = (current.getAttribute('aria-label') || current.getAttribute('title') || '').toLowerCase();
      if (
        current.matches?.('button, [role="button"], [tabindex], [data-e2e], .cursor-pointer') ||
        current.getAttribute('onclick') ||
        /unmute|sound on|turn on sound|enable sound|volume|speaker|ligar som|ativar som/.test(label)
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return node.parentElement || node;
  }

  function dispatchSoundActivationSequence(target, doc = document) {
    if (!target || typeof target.dispatchEvent !== 'function') {
      return false;
    }

    const view = doc.defaultView || window;
    const rect = typeof target.getBoundingClientRect === 'function' ? target.getBoundingClientRect() : null;
    const clientX = rect && Number.isFinite(rect.left) ? Math.round(rect.left + rect.width / 2) : 0;
    const clientY = rect && Number.isFinite(rect.top) ? Math.round(rect.top + rect.height / 2) : 0;
    const pointerInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
    };
    const mouseDownInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
    };
    const mouseUpInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view,
      clientX,
      clientY,
      button: 0,
      buttons: 0,
    };

    try {
      if (typeof PointerEvent === 'function') {
        target.dispatchEvent(new PointerEvent('pointerdown', { ...pointerInit, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        target.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }));
      }
    } catch (err) {
      // Ignore PointerEvent constructor limitations and keep trying the mouse path.
    }

    try {
      target.dispatchEvent(new MouseEvent('mousedown', mouseDownInit));
      target.dispatchEvent(new MouseEvent('mouseup', mouseUpInit));
      target.dispatchEvent(new MouseEvent('click', { ...mouseUpInit, buttons: 0 }));
    } catch (err) {
      // Ignore synthetic mouse failures and fall back to the native click helper.
    }

    try {
      if (typeof target.click === 'function') {
        target.click();
      }
    } catch (err) {
      // Ignore native click failures.
    }

    return true;
  }

  function createMuteShortcutEvent(doc) {
    const event = new KeyboardEvent('keydown', {
      key: 'm',
      code: 'KeyM',
      keyCode: 77,
      which: 77,
      charCode: 0,
      location: 0,
      repeat: false,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: doc.defaultView || window,
    });

    try {
      Object.defineProperties(event, {
        keyCode: { get: () => 77 },
        which: { get: () => 77 },
        charCode: { get: () => 0 },
      });
    } catch (err) {
      // Ignore if the browser refuses to redefine legacy key fields.
    }

    return event;
  }

  function dispatchMuteShortcut(doc = document) {
    const target = doc.body || doc.documentElement || doc;
    if (!target || typeof target.dispatchEvent !== 'function') {
      return false;
    }

    try {
      target.dispatchEvent(createMuteShortcutEvent(doc));
      return true;
    } catch (err) {
      return false;
    }
  }

  function stopSoundBootstrap() {
    soundBootstrapActive = false;

    if (soundBootstrapInterval) {
      window.clearInterval(soundBootstrapInterval);
      soundBootstrapInterval = null;
    }

    if (soundBootstrapObserver) {
      soundBootstrapObserver.disconnect();
      soundBootstrapObserver = null;
    }
  }

  function attemptSoundActivation() {
    if (soundBootstrapDone) {
      return true;
    }

    const snapshot = collectSoundBootstrapSnapshot();
    soundBootstrapState.attempts += 1;
    renderBootState(snapshot);

    const phaseInfo = describeBootPhase(snapshot);
    renderBootState({
      ...snapshot,
      ...phaseInfo,
      attempts: soundBootstrapState.attempts,
    });

    if (snapshot.readyDocs === 0 || snapshot.mutedDocs === 0) {
      if (snapshot.mutedDocs === 0 && snapshot.readyDocs > 0) {
        soundBootstrapDone = true;
        stopSoundBootstrap();
      }
      return snapshot.mutedDocs === 0;
    }

    const attempted = activateSoundFromSnapshot(snapshot);
    const afterSnapshot = collectSoundBootstrapSnapshot();
    const afterPhase = describeBootPhase(afterSnapshot);

    renderBootState({
      ...afterSnapshot,
      ...afterPhase,
      attempts: soundBootstrapState.attempts,
    });

    if (afterSnapshot.mutedDocs === 0) {
      soundBootstrapDone = true;
      stopSoundBootstrap();
      return true;
    }

    return attempted;
  }

  function activateSound() {
    return activateSoundFromSnapshot(collectSoundBootstrapSnapshot());
  }

  function activateSoundAtStartup() {
    if (soundBootstrapActive || soundBootstrapDone) {
      attemptSoundActivation();
      return;
    }

    soundBootstrapActive = true;
    const startTime = Date.now();
    const maxWait = 60000;
    const initialSnapshot = collectSoundBootstrapSnapshot();
    renderBootState({
      ...initialSnapshot,
      ...describeBootPhase(initialSnapshot),
      attempts: soundBootstrapState.attempts,
    });

    attemptSoundActivation();

    soundBootstrapInterval = window.setInterval(() => {
      if (soundBootstrapDone) {
        stopSoundBootstrap();
        return;
      }

      if (Date.now() - startTime >= maxWait) {
        const failedSnapshot = collectSoundBootstrapSnapshot();
        renderBootState({
          ...failedSnapshot,
          phase: 'failed',
          detail: 'Sound bootstrap timed out',
          attempts: soundBootstrapState.attempts,
          failed: true,
        });
        soundBootstrapState.failed = true;
        stopSoundBootstrap();
        return;
      }

      attemptSoundActivation();
    }, 750);

    if (typeof MutationObserver === 'function' && document.documentElement) {
      soundBootstrapObserver = new MutationObserver(() => {
        attemptSoundActivation();
      });

      soundBootstrapObserver.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }

    ['readystatechange', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'play', 'playing', 'volumechange'].forEach((eventName) => {
      document.addEventListener(eventName, attemptSoundActivation, true);
    });

    document.addEventListener('visibilitychange', attemptSoundActivation, true);
    window.addEventListener('focus', attemptSoundActivation, true);
    window.addEventListener('load', attemptSoundActivation, true);
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
    if (Number.isFinite(saved.launcherLeft) && Number.isFinite(saved.launcherTop)) {
      launcher.style.left = `${saved.launcherLeft}px`;
      launcher.style.top = `${saved.launcherTop}px`;
      launcher.style.right = 'auto';
      launcher.style.bottom = 'auto';
    } else {
      launcher.style.left = `${DEFAULT_LAUNCHER_POSITION.left}px`;
      launcher.style.bottom = `${DEFAULT_LAUNCHER_POSITION.bottom}px`;
      launcher.style.right = 'auto';
      launcher.style.top = 'auto';
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

  function restorePersistedRunState() {
    state.count = Number.isFinite(saved.count) ? saved.count : 0;
    state.accumulatedElapsedMs = Number.isFinite(saved.accumulatedElapsedMs) ? saved.accumulatedElapsedMs : 0;
    state.sessionTotalMs = Number.isFinite(saved.sessionTotalMs)
      ? saved.sessionTotalMs
      : (state.mode === 'm' ? Math.max(1, clampFloat(valueInput.value, 1, 1000000)) * 60000 : Infinity);
    state.maxClicks = Number.isFinite(saved.maxClicks)
      ? saved.maxClicks
      : (state.mode === 'c' ? Math.max(1, Math.floor(clampFloat(valueInput.value, 1, 1000000))) : Infinity);
    state.nextShort = Number.isFinite(saved.nextShort) ? saved.nextShort : rand(200, 350);
    state.nextLong = Number.isFinite(saved.nextLong) ? saved.nextLong : rand(600, 900);
    state.running = Boolean(saved.running);
    state.paused = Boolean(saved.paused);

    likesText.textContent = String(state.count);
    updateStats();

    if (!state.running) {
      const restoredStatus = ['stopped', 'finished', 'idle'].includes(saved.status) ? saved.status : 'idle';
      setStatus(restoredStatus);
      return;
    }

    state.currentRunStartedAt = state.paused ? 0 : Date.now();

    if (state.count >= state.maxClicks || getRemainingMs() <= 0) {
      stopRun('finished');
      return;
    }

    setStatus(state.paused ? 'paused' : 'running');
    persistRuntimeState();

    if (state.statsTimer) {
      window.clearInterval(state.statsTimer);
    }
    state.statsTimer = window.setInterval(updateStats, 500);
    tick();
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
    state.accumulatedElapsedMs = 0;
    state.currentRunStartedAt = Date.now();
    state.sessionTotalMs = state.mode === 'm' ? Math.max(1, value) * 60000 : Infinity;
    state.nextShort = rand(200, 350);
    state.nextLong = rand(600, 900);
    state.running = true;
    state.paused = false;

    if (state.mode === 'c') {
      state.maxClicks = Math.max(1, Math.floor(value));
    } else {
      state.maxClicks = Infinity;
    }

    likesText.textContent = '0';
    timeText.textContent = '0s';
    rateText.textContent = '0';
    setStatus('running');
    persistRuntimeState();

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

    if (state.paused) {
      state.paused = false;
      state.currentRunStartedAt = Date.now();
      setStatus('running');
    } else {
      if (state.currentRunStartedAt) {
        state.accumulatedElapsedMs += Date.now() - state.currentRunStartedAt;
      }
      state.currentRunStartedAt = 0;
      state.paused = true;
      setStatus('paused');
    }

    persistRuntimeState();
  }

  function stopRun(nextStatus = 'stopped') {
    state.running = false;
    state.paused = false;
    state.currentRunStartedAt = 0;
    if (state.statsTimer) {
      window.clearInterval(state.statsTimer);
      state.statsTimer = null;
    }
    setStatus(nextStatus);
    persistRuntimeState();
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

    if (state.count >= state.maxClicks || getRemainingMs() <= 0) {
      stopRun('finished');
      return;
    }

    const target = findLikeTarget();
    if (target) {
      clickLikeTarget(target);
      state.count += 1;
      likesText.textContent = String(state.count);
      persistRuntimeState();
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
    persistRuntimeState();
    window.setTimeout(tick, delay);
  }

  function closePanel() {
    hidePanel();
  }

  function handleSessionUnload() {
    if (state.running || state.paused) {
      persistRuntimeState();
    }
  }

  function updateModeFromInput() {
    state.manualValue = true;
    saveSettings({ manualValue: true, value: clampFloat(valueInput.value, 1, 1000000) });
  }

  function handleCloseIntent(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
    }
    closePanel();
  }

  function handleClosePointer(event) {
    handleCloseIntent(event);
  }

  dragHandle.addEventListener('mousedown', function (event) {
    if (event.button !== 0) {
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
  closeButton.addEventListener('pointerdown', handleClosePointer);
  closeButton.addEventListener('mousedown', handleClosePointer);
  closeButton.addEventListener('click', handleCloseIntent);
  panel.addEventListener('pointerdown', function (event) {
    if (event.target && typeof event.target.closest === 'function' && event.target.closest('#tt-close')) {
      handleCloseIntent(event);
    }
  }, true);
  panel.addEventListener('mousedown', function (event) {
    if (event.target && typeof event.target.closest === 'function' && event.target.closest('#tt-close')) {
      handleCloseIntent(event);
    }
  }, true);
  panel.addEventListener('click', function (event) {
    if (event.target && typeof event.target.closest === 'function' && event.target.closest('#tt-close')) {
      handleCloseIntent(event);
    }
  }, true);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && panel.style.display !== 'none') {
      handleCloseIntent(event);
    }
  }, true);
  window.addEventListener('beforeunload', handleSessionUnload);
  window.addEventListener('pagehide', handleSessionUnload);

  const mountPoint = document.body || document.documentElement;
  mountPoint.appendChild(panel);
  mountPoint.appendChild(launcher);
  activateSoundAtStartup();
  applySavedPosition();
  applySavedLauncherPosition();
  applySavedControls();
  window.ttAutoLikePanel = panel;
  if (saved.panelHidden) {
    hidePanel({ persist: false });
  } else {
    showPanel({ persist: false });
  }
  restorePersistedRunState();
})();
