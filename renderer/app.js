'use strict';

// `api` is the bridge exposed by preload.js (window.api).

const PARTITION = 'persist:twitch';
const AR = 16 / 9;
const GAP = 4;
const DEFAULT_MAX = 16;
const MAX_OPTIONS = [16, 24, 32, 48]; // above 16 only "at your own risk", see openLimitDialog()
const INFO_REFRESH_MS = 60_000;

const ICONS = {
  shuffle: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  cast: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 3H3a2 2 0 0 0-2 2v3h2V5h18v14h-7v2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM1 18v3h3a3 3 0 0 0-3-3zm0-4v2a5 5 0 0 1 5 5h2a7 7 0 0 0-7-7zm0-4v2a9 9 0 0 1 9 9h2A11 11 0 0 0 1 10z"/></svg>',
  dongle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="M11 2h2v5h-2z"/><circle cx="12" cy="13" r="2" fill="currentColor"/></svg>',
  tvbox: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 9 12 4l8 5-8 5z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 9v6l8 5 8-5V9"/></svg>',
  tv: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="M8 19h8v2H8z"/></svg>',
  monitor: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="M10 16h4v3h3v2H7v-2h3z"/></svg>',
  warn: '<svg class="tri" viewBox="0 0 24 24"><path fill="#ffc400" stroke="#2a1f00" stroke-width="1" stroke-linejoin="round" d="M12 2.5 23 21.5H1z"/><path fill="#2a1f00" d="M10.9 8.6h2.2l-.35 7h-1.5zM12 17.1a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>',
  reload: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M17.7 6.3A8 8 0 1 0 19.7 14h-2.1a6 6 0 1 1-1.4-6.2L13 11h7V4z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4-6.3-6.3-6.3 6.3-1.4-1.4L10.6 12 4.3 5.7l1.4-1.4 6.3 6.3 6.3-6.3z"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v10h3v2l2.5-2H19V5H5z"/></svg>',
  fsOn: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/></svg>',
  fsOff: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 4h2v6H4V8h4zm6 0h2v4h4v2h-6zM4 14h6v6H8v-4H4zm10 0h6v2h-4v4h-2z"/></svg>',
};

// Injected into every player: reports mouse activity (webviews swallow mouse
// events, so the host can't see hovers) and turns the player's own fullscreen
// button / double-click into "this stream solo + app fullscreen".
const GUEST_JS = `(() => {
  if (window.__tmv) return;
  window.__tmv = true;
  let last = 0;
  addEventListener('mousemove', e => {
    const now = Date.now();
    if (now - last > 200) { last = now; console.log('TMV:move:' + Math.round(e.clientX) + ':' + Math.round(e.clientY)); }
  }, true);
  addEventListener('mousedown', () => console.log('TMV:down'), true);
  const fs = function () { console.log('TMV:fullscreen'); return Promise.resolve(); };
  for (const k of ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen']) {
    try { Element.prototype[k] = fs; } catch (e) {}
  }
})();`;

// Popout chat follows Twitch's own theme setting; force dark once per session.
const CHAT_JS = `(() => {
  try {
    if (sessionStorage.getItem('tmvTheme')) return;
    sessionStorage.setItem('tmvTheme', '1');
    if (localStorage.getItem('twilight.theme') !== '1') {
      localStorage.setItem('twilight.theme', '1');
      location.reload();
    }
  } catch (e) {}
})();`;

const AUDIO_MODES = ['featured', 'all', 'none'];
const AUDIO_LABELS = { featured: 'Geluid: uitgelicht', all: 'Geluid: alle', none: 'Geluid: uit' };
const LAYOUTS = ['featured', 'grid', 'solo'];

const state = {
  channels: [],
  featured: null,
  layout: 'featured',
  audio: 'featured',
  chat: false,
  hideBar: false,
  maxStreams: DEFAULT_MAX,
  lurk: false,
  lurkDelay: 60, // seconds
  lurkSolo: true, // hide the small streams while lurking
  lurkReturn: null, // layout to go back to when lurking stops
};

const tiles = new Map(); // login -> tile
const info = {}; // login -> Twitch user info (displayName, stream, ...)
let muteOverride = {}; // login -> bool, set with the speaker button on a tile
let lastAudio = 'featured';
let soloReturn = null; // layout to go back to after a double-click solo
let fullscreen = false;
let user = null;

const $ = sel => document.querySelector(sel);
const body = document.body;
const stage = $('#stage');
const bar = $('#bar');
const addInput = $('#addInput');
const chipsEl = $('#chips');
const followedMenu = $('#followedMenu');
const accountMenu = $('#accountMenu');

const nf = new Intl.NumberFormat('nl-NL');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const displayName = ch => (info[ch] && info[ch].displayName) || ch;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function gridRects(n, W, H) {
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((W - GAP * (cols - 1)) / cols, ((H - GAP * (rows - 1)) / rows) * AR);
    if (!best || w > best.w + 0.5) best = { cols, rows, w };
  }
  const { cols, rows, w } = best;
  const h = w / AR;
  const oy = (H - (rows * h + (rows - 1) * GAP)) / 2;
  const rects = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
    const ox = (W - (inRow * w + (inRow - 1) * GAP)) / 2;
    rects.push({ x: ox + c * (w + GAP), y: oy + r * (h + GAP), w, h });
  }
  return rects;
}

// "Featured" layout: one big stream, the others small around it. Several
// arrangements are tried (column(s) on the right, row(s) below, an L around
// it) and the one with the biggest featured stream wins, as long as the small
// streams stay at least TILE_RATIO of its width.
const TILE_RATIO = 0.25;

// Column(s) of small streams to the right of the featured one.
function sideArrangement(k, W, H, cols) {
  const rows = Math.ceil(k / cols);
  const maxT = ((H - GAP * (rows - 1)) / rows) * AR;
  let fw = Math.min(H * AR, (W - cols * GAP) / (1 + cols * TILE_RATIO));
  const t = Math.min(maxT, (W - fw - cols * GAP) / cols);
  fw = Math.min(H * AR, W - cols * t - cols * GAP);
  if (fw <= 0 || t <= 0) return null;

  const fh = fw / AR;
  const th = t / AR;
  const totalW = fw + cols * (t + GAP);
  const totalH = Math.max(fh, rows * th + (rows - 1) * GAP);
  const ox = (W - totalW) / 2;
  const oy = (H - totalH) / 2;
  const small = [];
  for (let i = 0; i < k; i++) {
    const c = Math.floor(i / rows);
    const inCol = Math.min(rows, k - c * rows);
    const colY = oy + (totalH - (inCol * th + (inCol - 1) * GAP)) / 2;
    small.push({ x: ox + fw + GAP + c * (t + GAP), y: colY + (i % rows) * (th + GAP), w: t, h: th });
  }
  return { featured: { x: ox, y: oy + (totalH - fh) / 2, w: fw, h: fh }, small, t };
}

// Row(s) of small streams below the featured one.
function bottomArrangement(k, W, H, rows) {
  const perRow = Math.ceil(k / rows);
  const maxT = (W - GAP * (perRow - 1)) / perRow;
  let fh = Math.min(W / AR, (H - rows * GAP) / (1 + rows * TILE_RATIO));
  const t = Math.min(maxT, ((H - fh - rows * GAP) / rows) * AR);
  fh = Math.min(W / AR, H - rows * (t / AR + GAP));
  if (fh <= 0 || t <= 0) return null;

  const fw = fh * AR;
  const th = t / AR;
  const totalW = Math.max(fw, perRow * t + (perRow - 1) * GAP);
  const totalH = fh + rows * (th + GAP);
  const ox = (W - totalW) / 2;
  const oy = (H - totalH) / 2;
  const small = [];
  for (let i = 0; i < k; i++) {
    const r = Math.floor(i / perRow);
    const inRow = Math.min(perRow, k - r * perRow);
    const rowX = ox + (totalW - (inRow * t + (inRow - 1) * GAP)) / 2;
    small.push({ x: rowX + (i % perRow) * (t + GAP), y: oy + fh + GAP + r * (th + GAP), w: t, h: th });
  }
  return { featured: { x: ox + (totalW - fw) / 2, y: oy, w: fw, h: fh }, small, t };
}

// m x m cells: featured takes (m-1)², the others fill the right column and bottom row.
function lArrangement(k, W, H, m) {
  const colSlots = m - 1;
  if (k <= colSlots || k > 2 * m - 1) return null;
  const cellW = Math.min((W - GAP * (m - 1)) / m, ((H - GAP * (m - 1)) / m) * AR);
  const cellH = cellW / AR;
  const total = { w: m * cellW + (m - 1) * GAP, h: m * cellH + (m - 1) * GAP };
  const ox = (W - total.w) / 2;
  const oy = (H - total.h) / 2;
  const featured = { x: ox, y: oy, w: (m - 1) * cellW + (m - 2) * GAP, h: (m - 1) * cellH + (m - 2) * GAP };
  const inRow = k - colSlots;
  const small = [];
  for (let i = 0; i < k; i++) {
    if (i < colSlots) {
      small.push({ x: ox + featured.w + GAP, y: oy + i * (cellH + GAP), w: cellW, h: cellH });
    } else {
      const col = m - inRow + (i - colSlots); // right-aligned so the L stays closed
      small.push({ x: ox + col * (cellW + GAP), y: oy + (m - 1) * (cellH + GAP), w: cellW, h: cellH });
    }
  }
  return { featured, small, t: cellW };
}

function featuredRects(others, W, H) {
  const k = others.length;
  const candidates = [];
  for (let n = 1; n <= 3; n++) candidates.push(sideArrangement(k, W, H, n), bottomArrangement(k, W, H, n));
  for (let m = 3; m <= 9; m++) candidates.push(lArrangement(k, W, H, m));

  let best = null;
  let bestScore = -1;
  for (const c of candidates) {
    if (!c) continue;
    const ratio = c.t / c.featured.w;
    const score = c.featured.w ** 2 * (ratio >= TILE_RATIO ? 1 : (ratio / TILE_RATIO) ** 2);
    if (score > bestScore + 1) {
      best = c;
      bestScore = score;
    }
  }
  best.small.forEach(r => { r.small = true; });
  return best;
}

function computeLayout(W, H) {
  const rects = new Map();
  const list = state.channels;
  if (!list.length) return rects;

  if (state.layout === 'solo' || list.length === 1) {
    for (const ch of list) rects.set(ch, ch === state.featured ? { x: 0, y: 0, w: W, h: H } : null);
  } else if (state.layout === 'grid') {
    gridRects(list.length, W, H).forEach((r, i) => rects.set(list[i], r));
  } else {
    const others = list.filter(ch => ch !== state.featured);
    const { featured, small } = featuredRects(others, W, H);
    rects.set(state.featured, featured);
    others.forEach((ch, i) => rects.set(ch, small[i]));
  }
  return rects;
}

function layout() {
  const rects = computeLayout(stage.clientWidth, stage.clientHeight);
  for (const [ch, t] of tiles) {
    const r = rects.get(ch) || null;
    t.rect = r;
    t.el.classList.toggle('hidden', !r);
    t.el.classList.toggle('featured', ch === state.featured);
    t.el.classList.toggle('small', Boolean(r && r.small));
    t.el.classList.toggle('compact', Boolean(r && r.w < 560));
    if (r) {
      Object.assign(t.el.style, {
        left: `${Math.round(r.x)}px`,
        top: `${Math.round(r.y)}px`,
        width: `${Math.round(r.w)}px`,
        height: `${Math.round(r.h)}px`,
      });
    }
  }
  applyAudio();
  applyQualities();
}

// ---------------------------------------------------------------------------
// Video quality: the featured stream up to 1080p, the small ones up to 720p.
// Twitch has no official per-player setting, so this uses the player's own
// internal API (mediaPlayerInstance.setQuality), found via React's fiber tree.
// A quality you pick yourself in a player's menu is left alone; the app only
// steps in again when the player falls back to "auto" (e.g. after a reload).
// ---------------------------------------------------------------------------
const QUALITY_FEATURED = 1080;
const QUALITY_SMALL = 720;

const qualityJs = (target, force) => `(() => {
  const fiberKey = el => Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
  const findPlayer = () => {
    for (const video of document.querySelectorAll('video')) {
      // The <video> itself is not managed by React: start at the nearest
      // ancestor that is, and walk up the fiber tree from there.
      let el = video;
      while (el && !fiberKey(el)) el = el.parentElement;
      if (!el) continue;
      for (let f = el[fiberKey(el)], i = 0; f && i < 80; i++, f = f.return) {
        const p = f.memoizedProps && f.memoizedProps.mediaPlayerInstance;
        if (p && typeof p.getQualities === 'function' && typeof p.setQuality === 'function') return p;
      }
    }
    return null;
  };
  const p = findPlayer();
  if (!p) return 'wait';
  const auto = typeof p.isAutoQualityMode === 'function' ? p.isAutoQualityMode() : true;
  if (!${force} && !auto) return 'manual';
  const h = q => { const m = String((q && q.name) || '').match(/(\\d+)p/); return m ? Number(m[1]) : 0; };
  const list = (p.getQualities() || []).filter(q => h(q) > 0).sort((a, b) => h(b) - h(a));
  if (!list.length) return 'wait';
  const pick = list.find(q => h(q) <= ${target}) || list[list.length - 1];
  const cur = p.getQuality && p.getQuality();
  if (!auto && cur && cur.name === pick.name) return 'ok';
  if (typeof p.setAutoQualityMode === 'function') p.setAutoQualityMode(false);
  p.setQuality(pick);
  return 'set ' + pick.name;
})()`;

function applyQuality(t, force) {
  if (!t.ready) return;
  const target = t.ch === state.featured ? QUALITY_FEATURED : QUALITY_SMALL;
  t.wv.executeJavaScript(qualityJs(target, force))
    .then(res => { if (res !== 'wait') t.qTarget = target; })
    .catch(() => {});
}

// Only tiles whose target changed (or that are not set yet) are forced.
function applyQualities() {
  for (const t of tiles.values()) {
    const target = t.ch === state.featured ? QUALITY_FEATURED : QUALITY_SMALL;
    if (t.qTarget !== target) applyQuality(t, true);
  }
}

// Players that are still loading, or that reset themselves to "auto".
setInterval(() => { for (const t of tiles.values()) applyQuality(t, t.qTarget === undefined || t.qTarget === null); }, 10000);

let resizeTimer = null;
new ResizeObserver(() => {
  // No slide animation while the window itself is being resized.
  body.classList.add('no-anim');
  layout();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => body.classList.remove('no-anim'), 200);
}).observe(stage);

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
function isMuted(t) {
  if (!t.rect) return true;
  if (t.ch in muteOverride) return muteOverride[t.ch];
  if (state.layout === 'solo') return t.ch !== state.featured;
  if (state.audio === 'none') return true;
  if (state.audio === 'all') return false;
  return t.ch !== state.featured;
}

function applyAudio() {
  for (const t of tiles.values()) {
    const muted = isMuted(t);
    if (t.ready) {
      try { t.wv.setAudioMuted(muted); } catch { /* webview not attached yet */ }
    }
    t.sndBtn.innerHTML = muted ? ICONS.mute : ICONS.vol;
    t.sndBtn.classList.toggle('muted-on', muted);
    t.sndBtn.title = muted ? 'Geluid aanzetten' : 'Dempen';
    t.el.classList.toggle('audio', !muted && state.channels.length > 1);
  }
}

function setAudio(mode) {
  if (state.audio !== 'none') lastAudio = state.audio;
  state.audio = mode;
  muteOverride = {};
  changed();
}

// ---------------------------------------------------------------------------
// Tiles (one <webview> per stream; never re-parented, so it never reloads)
// ---------------------------------------------------------------------------
function playerUrl(ch) {
  return `https://player.twitch.tv/?channel=${encodeURIComponent(ch)}&parent=twitch.tv&player=popout&muted=false`;
}

function createTile(ch) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.innerHTML = `
    <div class="tbar">
      <div class="label"><span class="dot"></span><span class="name"></span><span class="viewers"></span><span class="title"></span></div>
      <button class="feat" title="Uitlichten">${ICONS.star}</button>
      <button class="snd"></button>
      <button class="rel" title="Herladen">${ICONS.reload}</button>
      <button class="rem" title="Verwijderen">${ICONS.close}</button>
    </div>
    <div class="catcher"><span>★ Uitlichten</span></div>`;

  const wv = document.createElement('webview');
  wv.setAttribute('partition', PARTITION);
  wv.setAttribute('webpreferences', 'autoplayPolicy=no-user-gesture-required');
  wv.setAttribute('src', playerUrl(ch));
  el.prepend(wv);

  const t = { ch, el, wv, ready: false, rect: null, uiTimer: null, sndBtn: el.querySelector('.snd') };

  wv.addEventListener('dom-ready', () => {
    t.ready = true;
    t.qTarget = null; // new page: quality has to be set again
    wv.executeJavaScript(GUEST_JS).catch(() => {});
    applyAudio();
    setTimeout(() => applyQuality(t, true), 4000);
  });
  wv.addEventListener('console-message', e => onGuestMessage(t, e.message || ''));

  el.querySelector('.feat').addEventListener('click', () => feature(ch));
  el.querySelector('.catcher').addEventListener('click', () => feature(ch));
  el.querySelector('.rel').addEventListener('click', () => wv.reload());
  el.querySelector('.rem').addEventListener('click', () => removeChannel(ch));
  t.sndBtn.addEventListener('click', e => {
    e.stopPropagation();
    muteOverride[ch] = !isMuted(t);
    applyAudio();
  });

  stage.appendChild(el);
  tiles.set(ch, t);
  updateTileLabel(t);
  return t;
}

function updateTileLabel(t) {
  const u = info[t.ch];
  const live = Boolean(u && u.stream);
  t.el.querySelector('.dot').classList.toggle('live', live);
  t.el.querySelector('.name').textContent = displayName(t.ch);
  t.el.querySelector('.viewers').textContent = live ? `${nf.format(u.stream.viewersCount)} kijkers` : (u ? 'offline' : '');
  const title = live ? [u.stream.game && u.stream.game.displayName, u.stream.title].filter(Boolean).join(' · ') : '';
  t.el.querySelector('.title').textContent = title;
  t.el.querySelector('.label').title = title;
}

function showTileUi(t) {
  t.el.classList.add('show-ui');
  clearTimeout(t.uiTimer);
  t.uiTimer = setTimeout(() => t.el.classList.remove('show-ui'), 2500);
}

function onGuestMessage(t, msg) {
  if (!msg.startsWith('TMV:')) return;
  const [, type, , y] = msg.split(':');
  if (type === 'move') {
    showTileUi(t);
    if (isAutohide() && t.rect && t.rect.y + Number(y) < 10) showBar();
  } else if (type === 'down') {
    closePopovers();
  } else if (type === 'fullscreen') {
    toggleSoloFullscreen(t.ch);
  }
}

function toggleSoloFullscreen(ch) {
  if (fullscreen && state.layout === 'solo' && state.featured === ch) {
    if (soloReturn) setLayout(soloReturn);
    soloReturn = null;
    api.setFullscreen(false);
    return;
  }
  if (state.layout !== 'solo') soloReturn = state.layout;
  state.featured = ch;
  muteOverride = {};
  setLayout('solo');
  api.setFullscreen(true);
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
function parseChannels(text) {
  const names = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(s => {
      const m = s.match(/twitch\.tv\/(?:popout\/)?([a-zA-Z0-9_]{2,25})/i);
      return (m ? m[1] : s.replace(/^@/, '')).toLowerCase();
    })
    .filter(s => /^[a-z0-9_]{2,25}$/.test(s));
  return [...new Set(names)];
}

async function addChannels(names, { featureFirst = false } = {}) {
  names = names.filter(n => !state.channels.includes(n));
  if (!names.length) return;

  let valid = names;
  try {
    const found = await api.channelInfo(names);
    for (const u of found) info[u.login.toLowerCase()] = u;
    const ok = new Set(found.map(u => u.login.toLowerCase()));
    const missing = names.filter(n => !ok.has(n));
    if (missing.length) toast(`Kanaal niet gevonden: ${missing.join(', ')}`);
    valid = names.filter(n => ok.has(n));
  } catch {
    // Twitch API unreachable: add them anyway, the player will show any problem.
  }

  for (const n of valid) {
    if (state.channels.length >= state.maxStreams) {
      toast(`Maximaal ${state.maxStreams} streams tegelijk${state.maxStreams === DEFAULT_MAX ? " (meer kan via je accountmenu, op eigen risico)" : ""}`);
      break;
    }
    state.channels.push(n);
    createTile(n);
  }
  if (valid.length && (featureFirst || !state.featured)) state.featured = valid[0];
  changed();
}

function removeChannel(ch) {
  const t = tiles.get(ch);
  if (t) t.el.remove();
  tiles.delete(ch);
  delete muteOverride[ch];
  state.channels = state.channels.filter(c => c !== ch);
  if (state.featured === ch) state.featured = state.channels[0] || null;
  changed();
}

function feature(ch) {
  if (!state.channels.includes(ch) || state.featured === ch) return;
  state.featured = ch;
  muteOverride = {};
  changed();
  if (state.lurk && !lurkSwitching) lurkSchedule(); // your own choice gets a full turn
}

function featureOffset(delta) {
  const n = state.channels.length;
  if (n < 2) return;
  const i = state.channels.indexOf(state.featured);
  feature(state.channels[(i + delta + n) % n]);
}

function setLayout(l) {
  if (!LAYOUTS.includes(l)) return;
  if (l !== 'solo') soloReturn = null;
  if (!lurkLayoutChange) state.lurkReturn = null; // a layout you pick yourself wins
  state.layout = l;
  muteOverride = {};
  changed();
}

async function refreshInfo() {
  if (!state.channels.length) return;
  try {
    const list = await api.channelInfo(state.channels);
    for (const u of list) info[u.login.toLowerCase()] = u;
  } catch {
    return;
  }
  renderChips();
  tiles.forEach(updateTileLabel);
  updateChat();
}

// ---------------------------------------------------------------------------
// Chips in the top bar (click = feature, drag = reorder, middle click = remove)
// ---------------------------------------------------------------------------
let dragCh = null;

function renderChips() {
  chipsEl.innerHTML = '';
  state.channels.forEach((ch, i) => {
    const u = info[ch];
    const live = Boolean(u && u.stream);
    const chip = document.createElement('div');
    chip.className = `chip${ch === state.featured ? ' featured' : ''}`;
    chip.draggable = true;
    chip.title = live
      ? `${displayName(ch)} — live, ${nf.format(u.stream.viewersCount)} kijkers\n${u.stream.title || ''}`
      : `${displayName(ch)} — offline`;
    chip.innerHTML = `
      <span class="num">${i < 9 ? i + 1 : ''}</span>
      ${u && u.profileImageURL ? `<img src="${esc(u.profileImageURL)}" alt="">` : ''}
      <span class="dot${live ? ' live' : ''}"></span>
      <span class="name">${esc(displayName(ch))}</span>
      <span class="x" title="Verwijderen">✕</span>`;

    chip.addEventListener('click', e => (e.target.closest('.x') ? removeChannel(ch) : feature(ch)));
    chip.addEventListener('auxclick', e => { if (e.button === 1) removeChannel(ch); });
    chip.addEventListener('dragstart', e => {
      dragCh = ch;
      chip.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    chip.addEventListener('dragend', () => {
      dragCh = null;
      renderChips();
    });
    chip.addEventListener('dragover', e => {
      if (!dragCh || dragCh === ch) return;
      e.preventDefault();
      e.stopPropagation();
      chipsEl.querySelectorAll('.drop-before').forEach(c => c.classList.remove('drop-before'));
      chip.classList.add('drop-before');
    });
    chip.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      moveChannel(dragCh, ch);
    });
    chipsEl.appendChild(chip);
  });
}

chipsEl.addEventListener('wheel', e => {
  chipsEl.scrollLeft += e.deltaY || e.deltaX;
  e.preventDefault();
}, { passive: false });
chipsEl.addEventListener('dragover', e => { if (dragCh) e.preventDefault(); });
chipsEl.addEventListener('drop', e => {
  e.preventDefault();
  moveChannel(dragCh, null);
});

function moveChannel(ch, beforeCh) {
  if (!ch || ch === beforeCh) return;
  const list = state.channels.filter(c => c !== ch);
  const idx = beforeCh ? list.indexOf(beforeCh) : list.length;
  list.splice(idx, 0, ch);
  state.channels = list;
  changed();
}

// ---------------------------------------------------------------------------
// Chat (popout chat of the featured stream)
// ---------------------------------------------------------------------------
let chatWv = null;
let chatChannel = null;

function updateChat() {
  const open = state.chat && Boolean(state.featured);
  body.classList.toggle('chat-open', open);
  $('#chatTitle').textContent = state.featured ? `Chat — ${displayName(state.featured)}` : 'Chat';
  if (!open || chatChannel === state.featured) return;

  chatChannel = state.featured;
  const url = `https://www.twitch.tv/popout/${encodeURIComponent(chatChannel)}/chat?popout=`;
  if (!chatWv) {
    chatWv = document.createElement('webview');
    chatWv.setAttribute('partition', PARTITION);
    chatWv.setAttribute('src', url);
    chatWv.addEventListener('dom-ready', () => chatWv.executeJavaScript(CHAT_JS).catch(() => {}));
    $('#chatHost').appendChild(chatWv);
  } else {
    chatWv.loadURL(url);
  }
}

// ---------------------------------------------------------------------------
// Top bar / controls
// ---------------------------------------------------------------------------
function isAutohide() {
  return fullscreen || state.hideBar;
}

let barTimer = null;
function showBar() {
  body.classList.add('bar-visible');
  scheduleBarHide();
}

function scheduleBarHide() {
  clearTimeout(barTimer);
  barTimer = setTimeout(() => {
    const busy = bar.matches(':hover') || document.activeElement === addInput || !followedMenu.hidden || !accountMenu.hidden;
    if (busy) scheduleBarHide();
    else body.classList.remove('bar-visible');
  }, 1800);
}

document.addEventListener('mousemove', e => {
  if (isAutohide() && e.clientY < 8) showBar();
});
bar.addEventListener('mouseleave', () => { if (isAutohide()) scheduleBarHide(); });

function updateControls() {
  body.classList.toggle('autohide', isAutohide());
  body.classList.toggle('has-streams', state.channels.length > 0);
  body.classList.remove('layout-featured', 'layout-grid', 'layout-solo');
  body.classList.add(`layout-${state.layout}`);
  document.querySelectorAll('#layoutSeg button').forEach(b => b.classList.toggle('on', b.dataset.layout === state.layout));
  const audioBtn = $('#audioBtn');
  audioBtn.innerHTML = `${state.audio === 'none' ? ICONS.mute : ICONS.vol}<span>${AUDIO_LABELS[state.audio]}</span>`;
  $('#chatBtn').innerHTML = `${ICONS.chat}<span>Chat</span>`;
  $('#chatBtn').classList.toggle('on', state.chat);
  $('#fsBtn').innerHTML = fullscreen ? ICONS.fsOff : ICONS.fsOn;
  $('#fsBtn').title = fullscreen ? 'Volledig scherm verlaten (F / Esc)' : 'Volledig scherm (F / F11)';
}

let saveTimer = null;
function changed() {
  if (state.featured && !state.channels.includes(state.featured)) state.featured = state.channels[0] || null;
  renderChips();
  layout();
  updateChat();
  updateControls();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveConfig({ ...state }), 300);
}

$('#addForm').addEventListener('submit', e => {
  e.preventDefault();
  if (suggestIndex >= 0 && suggestions[suggestIndex]) {
    pickSuggestion(suggestions[suggestIndex]);
    return;
  }
  closeSuggest();
  const names = parseChannels(addInput.value);
  if (!names.length) {
    if (addInput.value.trim()) toast('Geen geldige kanaalnaam');
    return;
  }
  addInput.value = '';
  addChannels(names, { featureFirst: state.channels.length === 0 });
});

// ---------------------------------------------------------------------------
// Autocomplete for "Kanaal toevoegen" (Twitch channel search)
// ---------------------------------------------------------------------------
const suggestEl = $('#suggest');
let suggestions = [];
let suggestIndex = -1;
let suggestTimer = null;
let suggestSeq = 0;

function closeSuggest() {
  clearTimeout(suggestTimer);
  suggestSeq++; // ignore answers that are still on their way
  suggestions = [];
  suggestIndex = -1;
  suggestEl.hidden = true;
}

function renderSuggest() {
  if (!suggestions.length) {
    suggestEl.hidden = true;
    return;
  }
  suggestEl.innerHTML = '';
  suggestions.forEach((u, i) => {
    const login = u.login.toLowerCase();
    const added = state.channels.includes(login);
    const live = Boolean(u.stream);
    const item = document.createElement('div');
    item.className = `item${i === suggestIndex ? ' active' : ''}${added ? ' added' : ''}`;
    item.innerHTML = `
      ${u.profileImageURL ? `<img src="${esc(u.profileImageURL)}" alt="">` : '<span class="noimg"></span>'}
      <div class="meta">
        <div>${esc(u.displayName || u.login)}${added ? ' ✓' : ''}</div>
        <div class="sub">${live ? esc((u.stream.game && u.stream.game.displayName) || 'Live') : 'offline'}</div>
      </div>
      ${live ? `<span class="vc">● ${nf.format(u.stream.viewersCount)}</span>` : ''}`;
    // mousedown instead of click, so the input does not lose focus first
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      pickSuggestion(u);
    });
    item.addEventListener('mousemove', () => {
      if (suggestIndex === i) return;
      suggestIndex = i;
      suggestEl.querySelectorAll('.item').forEach((el, j) => el.classList.toggle('active', j === i));
    });
    suggestEl.appendChild(item);
  });
  positionPopover(suggestEl, addInput);
  suggestEl.hidden = false;
}

function pickSuggestion(u) {
  const login = u.login.toLowerCase();
  info[login] = u;
  addInput.value = '';
  closeSuggest();
  if (state.channels.includes(login)) feature(login);
  else addChannels([login], { featureFirst: state.channels.length === 0 });
}

addInput.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  const text = addInput.value.trim();
  // Several names or a link: no suggestions, Enter adds them as typed.
  if (text.length < 2 || /[\s,;/]/.test(text)) {
    closeSuggest();
    return;
  }
  suggestTimer = setTimeout(async () => {
    const seq = ++suggestSeq;
    let list = [];
    try {
      list = await api.searchChannels(text);
    } catch {
      list = [];
    }
    if (seq !== suggestSeq || addInput.value.trim() !== text) return; // outdated answer
    suggestions = list;
    suggestIndex = list.length ? 0 : -1;
    renderSuggest();
  }, 220);
});

addInput.addEventListener('keydown', e => {
  if (suggestEl.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = suggestions.length;
    suggestIndex = (suggestIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    renderSuggest();
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    closeSuggest();
  }
});

addInput.addEventListener('blur', () => setTimeout(closeSuggest, 100));

document.querySelectorAll('#layoutSeg button').forEach(b => b.addEventListener('click', () => setLayout(b.dataset.layout)));
$('#audioBtn').addEventListener('click', () => setAudio(AUDIO_MODES[(AUDIO_MODES.indexOf(state.audio) + 1) % AUDIO_MODES.length]));
$('#chatBtn').addEventListener('click', () => toggleChat());
$('#chatClose').addEventListener('click', () => toggleChat(false));
$('#fsBtn').addEventListener('click', () => api.setFullscreen());
$('#helpBtn').addEventListener('click', () => toggleHelp());
$('#helpClose').addEventListener('click', () => toggleHelp(false));
$('#help').addEventListener('click', e => { if (e.target.id === 'help') toggleHelp(false); });
$('#followedBtn').addEventListener('click', () => openFollowed());

function toggleChat(on = !state.chat) {
  state.chat = on;
  changed();
}

function toggleHelp(on = $('#help').hidden) {
  $('#help').hidden = !on;
}

// ---------------------------------------------------------------------------
// Popovers: followed live channels & account
// ---------------------------------------------------------------------------
function positionPopover(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 390))}px`;
}

function closePopovers() {
  followedMenu.hidden = true;
  accountMenu.hidden = true;
  lurkMenu.hidden = true;
}

document.addEventListener('mousedown', e => {
  if (!e.target.closest('.popover, #followedBtn, #account, #lurkMore')) closePopovers();
});

// ---------------------------------------------------------------------------
// Lurken: automatically feature a random live stream every few seconds/minutes.
// "Random" uses a shuffled bag, so everyone gets a turn before anyone repeats.
// ---------------------------------------------------------------------------
const LURK_DELAYS = [15, 30, 60, 120, 300, 600];
const lurkMenu = $('#lurkMenu');
let lurkTimer = null;
let lurkNextAt = 0;
let lurkBag = [];
let lurkSwitching = false;
let lurkWarned = false;
let lurkLayoutChange = false;

// While lurking with "hide small streams", switch to Solo and remember the
// layout to return to afterwards.
function lurkApplyLayout() {
  lurkLayoutChange = true;
  if (state.lurk && state.lurkSolo && state.layout !== 'solo') {
    const back = state.layout;
    setLayout('solo');
    state.lurkReturn = back;
  } else if ((!state.lurk || !state.lurkSolo) && state.lurkReturn) {
    const back = state.lurkReturn;
    state.lurkReturn = null;
    setLayout(back);
  }
  lurkLayoutChange = false;
  changed();
}

const fmtDelay = sec => (sec < 60 ? `${sec} s` : `${sec / 60} min`);

function lurkCandidates() {
  // Offline channels are skipped; channels without info yet are allowed.
  return state.channels.filter(ch => ch !== state.featured && (!info[ch] || info[ch].stream));
}

function lurkPick() {
  const cands = lurkCandidates();
  if (!cands.length) return null;
  lurkBag = lurkBag.filter(c => cands.includes(c));
  if (!lurkBag.length) {
    lurkBag = [...cands];
    for (let i = lurkBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lurkBag[i], lurkBag[j]] = [lurkBag[j], lurkBag[i]];
    }
  }
  return lurkBag.shift();
}

function lurkSchedule() {
  clearTimeout(lurkTimer);
  lurkTimer = null;
  lurkNextAt = state.lurk ? Date.now() + state.lurkDelay * 1000 : 0;
  if (state.lurk) lurkTimer = setTimeout(lurkStep, state.lurkDelay * 1000);
  renderLurk();
}

function lurkStep() {
  const ch = lurkPick();
  if (ch) {
    lurkWarned = false;
    lurkSwitching = true;
    feature(ch);
    lurkSwitching = false;
    toast(`Lurken: ${displayName(ch)}`);
  } else if (!lurkWarned) {
    lurkWarned = true;
    toast('Lurken wacht: er is geen andere live stream om naar te wisselen');
  }
  lurkSchedule();
}

function setLurk(on) {
  state.lurk = on;
  lurkBag = [];
  lurkWarned = false;
  lurkApplyLayout();
  lurkSchedule();
  toast(on ? `Lurken aan: elke ${fmtDelay(state.lurkDelay)} een willekeurige live stream` : 'Lurken uit');
}

function renderLurk() {
  const btn = $('#lurkBtn');
  let label = 'Lurken';
  if (state.lurk && lurkNextAt) {
    const left = Math.max(0, Math.ceil((lurkNextAt - Date.now()) / 1000));
    label += ` · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }
  btn.innerHTML = `${ICONS.shuffle}<span>${label}</span>`;
  btn.classList.toggle('on', state.lurk);
  $('#lurkCtl').classList.toggle('on', state.lurk);
  btn.title = state.lurk
    ? `Lurken staat aan: elke ${fmtDelay(state.lurkDelay)} een willekeurige live stream. Klik om te stoppen (K).`
    : `Lurken: wissel automatisch naar een willekeurige live stream uit je overzicht, elke ${fmtDelay(state.lurkDelay)} (K)`;
}

function openLurkMenu() {
  if (!lurkMenu.hidden) return closePopovers();
  closePopovers();
  lurkMenu.innerHTML = '<div class="hint">Wissel elke…</div>' + LURK_DELAYS.map(sec =>
    `<button class="item lurk-opt${sec === state.lurkDelay ? ' active' : ''}" data-sec="${sec}">${fmtDelay(sec)}${sec === state.lurkDelay ? '<span class="check">✓</span>' : ''}</button>`).join('');
  lurkMenu.insertAdjacentHTML('beforeend', `<label class="lurk-check"><input type="checkbox" id="lurkSoloChk"${state.lurkSolo ? ' checked' : ''}> Kleine streams verbergen</label>`);
  $('#lurkSoloChk').addEventListener('change', e => {
    state.lurkSolo = e.target.checked;
    lurkApplyLayout();
  });
  lurkMenu.querySelectorAll('.lurk-opt').forEach(b => b.addEventListener('click', () => {
    state.lurkDelay = Number(b.dataset.sec);
    closePopovers();
    changed();
    if (state.lurk) lurkSchedule(); else renderLurk();
    toast(`Lurken wisselt elke ${fmtDelay(state.lurkDelay)}${state.lurk ? '' : ' (zet Lurken aan met de knop)'}`);
  }));
  positionPopover(lurkMenu, $('#lurkCtl'));
  lurkMenu.hidden = false;
}

$('#lurkBtn').addEventListener('click', () => setLurk(!state.lurk));
$('#lurkMore').addEventListener('click', () => openLurkMenu());
setInterval(() => { if (state.lurk) renderLurk(); }, 1000);

async function openFollowed() {
  if (!followedMenu.hidden) return closePopovers();
  closePopovers();
  positionPopover(followedMenu, $('#followedBtn'));
  followedMenu.hidden = false;
  followedMenu.innerHTML = '<div class="hint">Laden…</div>';

  let list;
  try {
    list = await api.followedLive();
  } catch (err) {
    // Electron prefixes IPC errors with "Error invoking remote method ...: Error: "
    const detail = String((err && err.message) || err).replace(/^.*?Error: /, '');
    followedMenu.innerHTML = `<div class="hint">Kon je gevolgde kanalen niet ophalen.<br><span class="muted">${esc(detail)}</span></div>`;
    return;
  }
  if (list === null) {
    followedMenu.innerHTML = '<div class="hint">Log in om je gevolgde kanalen te zien.<br><button class="btn primary">Inloggen bij Twitch</button></div>';
    followedMenu.querySelector('button').addEventListener('click', () => { closePopovers(); api.login(); });
    return;
  }
  if (!list.length) {
    followedMenu.innerHTML = '<div class="hint">Geen van je gevolgde kanalen is nu live.</div>';
    return;
  }

  list.sort((a, b) => b.stream.viewersCount - a.stream.viewersCount);
  followedMenu.innerHTML = '';
  for (const u of list) {
    const login = u.login.toLowerCase();
    info[login] = u;
    const item = document.createElement('button');
    item.className = `item${state.channels.includes(login) ? ' added' : ''}`;
    item.title = u.stream.title || '';
    item.innerHTML = `
      <img src="${esc(u.profileImageURL)}" alt="">
      <div class="meta">
        <div>${esc(u.displayName)}${state.channels.includes(login) ? ' ✓' : ''}</div>
        <div class="sub">${esc((u.stream.game && u.stream.game.displayName) || '')}</div>
      </div>
      <span class="vc">● ${nf.format(u.stream.viewersCount)}</span>`;
    item.addEventListener('click', async () => {
      if (state.channels.includes(login)) {
        feature(login);
      } else {
        await addChannels([login]);
        if (state.channels.includes(login)) { // not added when the maximum is reached
          item.classList.add('added');
          item.querySelector('.meta div').textContent = `${u.displayName} ✓`;
        }
      }
    });
    followedMenu.appendChild(item);
  }
}

function renderAccount() {
  const acc = $('#account');
  const empty = $('#emptyAccount');
  if (!user) {
    acc.innerHTML = '<button class="btn primary" title="Log in zodat Turbo / abonnementen gelden (geen reclame)">Inloggen</button>';
    acc.querySelector('button').addEventListener('click', () => api.login());
    empty.innerHTML = `<div>Log in met je Twitch-account zodat je Turbo geldt en je geen reclame ziet.</div>
      <button class="btn primary">Inloggen bij Twitch</button>`;
    empty.querySelector('button').addEventListener('click', () => api.login());
    return;
  }

  const name = user.displayName || user.login || 'Ingelogd';
  let badge = '';
  if (user.turbo === true) badge = '<span class="badge" title="Turbo actief: geen reclame">Turbo</span>';
  else if (user.turbo === false) badge = '<span class="badge warn" title="Dit account heeft geen Turbo: je kunt reclame zien bij kanalen waar je niet op geabonneerd bent">Geen Turbo</span>';
  const risk = state.maxStreams > DEFAULT_MAX
    ? `<span class="risk-dot" title="Streamlimiet verhoogd naar ${state.maxStreams} (eigen risico)">${ICONS.warn}</span>` : '';
  acc.innerHTML = `<div class="acct" title="Account">${user.avatar ? `<img src="${esc(user.avatar)}" alt="">` : ''}<span>${esc(name)}</span>${badge}${risk}</div>`;
  acc.querySelector('.acct').addEventListener('click', () => toggleAccountMenu());
  empty.innerHTML = `<div>Ingelogd als <b>${esc(name)}</b> ${badge}</div>`;
}

function toggleAccountMenu() {
  if (!accountMenu.hidden) return closePopovers();
  closePopovers();
  accountMenu.innerHTML = `
    <div class="hint">Ingelogd als <b>${esc(user.displayName || user.login)}</b></div>
    <button class="item cast-item" data-act="cast">${ICONS.cast}<span>Op tv tonen</span><span class="beta-tag">Beta</span>${castState.status === 'casting' ? `<span class="cast-tag">● ${esc(castState.device ? castState.device.name : 'tv')}</span>` : ''}</button>
    <button class="item" data-act="reload">Alle streams herladen</button>
    <button class="item risk-item" data-act="limit">${ICONS.warn}<span>Max. aantal streams: <b>${state.maxStreams}</b></span>${state.maxStreams > DEFAULT_MAX ? '<span class="risk-tag">eigen risico</span>' : ''}</button>
    <button class="item" data-act="logout">Uitloggen</button>`;
  accountMenu.querySelector('[data-act=reload]').addEventListener('click', () => { closePopovers(); reloadAll(); });
  accountMenu.querySelector('[data-act=limit]').addEventListener('click', () => { closePopovers(); openLimitDialog(); });
  accountMenu.querySelector('[data-act=cast]').addEventListener('click', () => { closePopovers(); openCastDialog(); });
  accountMenu.querySelector('[data-act=logout]').addEventListener('click', () => { closePopovers(); api.logout(); });
  accountMenu.hidden = false;
  const r = $('#account').getBoundingClientRect();
  accountMenu.style.top = `${r.bottom + 6}px`;
  accountMenu.style.left = `${Math.max(8, r.right - 260)}px`;
}

// Raising the stream limit above 16 is allowed, but only after an explicit
// "own risk" confirmation (numbers from a load test on a Ryzen 9 5900X +
// RTX 3060 Ti: smooth up to 32, about a third of the frames dropped at 48).
const LIMIT_INFO = {
  16: ['Standaard', 'Aanbevolen. Werkt op de meeste pc’s.'],
  24: ['Snelle pc', 'Moderne videokaart en minstens 100 Mbit/s internet.'],
  32: ['Zeer snelle pc', 'Krachtige videokaart en processor, minstens 150 Mbit/s.'],
  48: ['Experimenteel', 'Haperend beeld verwacht, ook op een snelle pc.'],
};

function openLimitDialog() {
  const modal = $('#limitModal');
  let choice = state.maxStreams;
  modal.querySelector('.limit-options').innerHTML = MAX_OPTIONS.map(n => `
    <label class="limit-opt${n > DEFAULT_MAX ? ' over' : ''}${n === 48 ? ' extreme' : ''}">
      <input type="radio" name="limit" value="${n}"${n === choice ? ' checked' : ''}>
      <span class="num">${n}</span>
      <span class="txt"><b>${LIMIT_INFO[n][0]}</b><span>${LIMIT_INFO[n][1]}</span></span>
    </label>`).join('');
  const ack = modal.querySelector('#limitAck');
  const save = modal.querySelector('#limitSave');
  ack.checked = state.maxStreams > DEFAULT_MAX;
  const update = () => {
    const risky = choice > DEFAULT_MAX;
    modal.querySelector('.risk-ack').classList.toggle('needed', risky);
    save.disabled = risky && !ack.checked;
    save.textContent = risky ? `Op eigen risico instellen op ${choice}` : 'Opslaan';
    save.classList.toggle('warn-btn', risky);
    save.classList.toggle('primary', !risky);
  };
  modal.querySelectorAll('input[name=limit]').forEach(r => r.addEventListener('change', () => { choice = Number(r.value); update(); }));
  ack.onchange = update;
  save.onclick = () => {
    state.maxStreams = choice;
    modal.hidden = true;
    changed();
    renderAccount();
    const n = state.channels.length;
    if (n > choice) toast(`Limiet is nu ${choice}. Je hebt ${n} streams open; nieuwe kun je pas toevoegen onder de ${choice}.`);
    else toast(choice > DEFAULT_MAX ? `Limiet verhoogd naar ${choice} streams (eigen risico)` : `Limiet terug naar ${choice} streams`);
  };
  modal.querySelector('#limitCancel').onclick = () => { modal.hidden = true; };
  modal.onclick = e => { if (e.target === modal) modal.hidden = true; };
  update();
  modal.hidden = false;
}

// ---------------------------------------------------------------------------
// Casting to a TV
// ---------------------------------------------------------------------------
const castModal = $('#castModal');
let castState = { status: 'stopped', device: null, message: '' };
let castDevices = [];
let castSearching = false;
let castMedia = null; // captured window + sound
let castRecorder = null;
let castChain = Promise.resolve();

function deviceIcon(d) {
  const m = `${d.model} ${d.name}`.toLowerCase();
  if (/shield|google tv|android tv|box/.test(m)) return ICONS.tvbox;
  if (/chromecast/.test(m)) return ICONS.dongle;
  return ICONS.tv;
}

function renderCastDevices() {
  const host = $('#castDevices');
  if (castSearching && !castDevices.length) {
    host.innerHTML = '<div class="cast-empty"><span class="spinner"></span>Zoeken naar Chromecast, Shield en andere Cast-apparaten…</div>';
    return;
  }
  if (!castDevices.length) {
    host.innerHTML = `<div class="cast-empty">Geen apparaten gevonden.<br><span class="muted">Staat de tv of Shield aan en zit hij op hetzelfde netwerk? Een VPN kan het zoeken blokkeren.</span></div>`;
    return;
  }
  host.innerHTML = '';
  for (const d of castDevices) {
    const active = castState.device && castState.device.id === d.id;
    const status = active ? castState.status : 'idle';
    const card = document.createElement('div');
    card.className = `cast-device ${status}`;
    card.innerHTML = `
      <div class="dev-icon">${deviceIcon(d)}</div>
      <div class="dev-meta"><b>${esc(d.name)}</b><span>${esc(d.model || 'Cast-apparaat')}</span></div>
      <div class="dev-action">${
        status === 'connecting' ? '<span class="spinner"></span>Verbinden…'
          : status === 'casting' ? '<span class="live-dot"></span>Bezig <button class="btn stop">Stoppen</button>'
            : '<button class="btn primary go">Casten</button>'}</div>`;
    const go = card.querySelector('.go');
    if (go) go.addEventListener('click', () => startCast(d));
    const stop = card.querySelector('.stop');
    if (stop) stop.addEventListener('click', () => api.castStop());
    host.appendChild(card);
  }
}

async function refreshCastDevices() {
  castSearching = true;
  renderCastDevices();
  try {
    castDevices = await api.castDiscover();
  } catch {
    castDevices = [];
  }
  castSearching = false;
  renderCastDevices();
}

async function renderScreens() {
  const host = $('#castScreens');
  let list = [];
  try { list = await api.listScreens(); } catch { /* ignore */ }
  host.innerHTML = '';
  list.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = `cast-screen${s.current ? ' current' : ''}`;
    row.innerHTML = `
      <div class="dev-icon">${ICONS.monitor}</div>
      <div class="dev-meta"><b>${esc(s.label || `Scherm ${i + 1}`)}</b><span>${s.width}×${s.height}${s.primary ? ' · hoofdscherm' : ''}</span></div>
      <div class="dev-action">${s.current ? '<span class="muted">Hier staat de app</span>' : '<button class="btn">Hier tonen</button>'}</div>`;
    const b = row.querySelector('button');
    if (b) b.addEventListener('click', async () => { castModal.hidden = true; await api.moveToScreen(s.id); });
    host.appendChild(row);
  });
}

function openCastDialog() {
  $('#castHeadIcon').innerHTML = ICONS.cast;
  castModal.hidden = false;
  renderCastDevices();
  if (!castDevices.length || castState.status !== 'casting') refreshCastDevices();
  renderScreens();
}

async function startCast(device) {
  // Screen capture must start right after the click (a user gesture).
  await api.castPrepare($('#castMute').checked);
  try {
    if (castMedia) castMedia.getTracks().forEach(t => t.stop());
    castMedia = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: true });
  } catch (err) {
    toast(`Opnemen voor casten lukt niet: ${err.message}`);
    return;
  }
  castState = { status: 'connecting', device, message: '' };
  renderCastDevices();
  api.castStart(device.id);
}

function castRecorderStart() {
  castRecorderStop(false);
  if (!castMedia) return;
  const mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(castMedia, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
  rec.ondataavailable = e => {
    if (rec !== castRecorder || !e.data || !e.data.size) return; // ignore the tail of an old recording
    const blob = e.data;
    castChain = castChain.then(() => blob.arrayBuffer()).then(buf => { if (rec === castRecorder) api.castChunk(buf); });
  };
  castRecorder = rec;
  rec.start(250);
}

function castRecorderStop(release) {
  const rec = castRecorder;
  castRecorder = null;
  if (rec && rec.state !== 'inactive') rec.stop();
  if (release && castMedia) {
    castMedia.getTracks().forEach(t => t.stop());
    castMedia = null;
  }
}

api.onCastRecorder(cmd => (cmd === 'start' ? castRecorderStart() : castRecorderStop(true)));

api.onCastState(s => {
  const before = castState.status;
  castState = s;
  if (s.status === 'error') {
    castRecorderStop(true);
    toast(`Casten mislukt: ${s.message}`);
  } else if (s.status === 'stopped' && before !== 'stopped') {
    toast(s.message ? `Casten gestopt: ${s.message}` : 'Casten gestopt');
  } else if (s.status === 'casting' && before === 'connecting') {
    toast(`Bezig met casten naar ${s.device ? s.device.name : 'je tv'}`);
  }
  const btn = $('#castBtn');
  btn.hidden = s.status !== 'casting' && s.status !== 'connecting';
  btn.innerHTML = `${ICONS.cast}<span>${s.status === 'connecting' ? 'Verbinden…' : esc(s.device ? s.device.name : 'tv')}</span>`;
  if (!castModal.hidden) renderCastDevices();
});

$('#castBtn').addEventListener('click', () => openCastDialog());
$('#castClose').addEventListener('click', () => { castModal.hidden = true; });
$('#castRefresh').addEventListener('click', () => refreshCastDevices());
$('#castMiracast').addEventListener('click', () => api.openMiracast());
$('#castFeedback').addEventListener('click', () => api.castFeedback());
castModal.addEventListener('click', e => { if (e.target === castModal) castModal.hidden = true; });

function reloadAll() {
  for (const t of tiles.values()) t.wv.reload();
  if (chatWv) chatWv.reload();
}

async function refreshUser() {
  try {
    user = await api.getUser();
  } catch {
    user = null;
  }
  renderAccount();
}

api.onAuthChanged(async () => {
  const before = user && user.login;
  await refreshUser();
  const after = user && user.login;
  if (before === after) return;
  // Players only pick up the new login after a reload.
  reloadAll();
  toast(after ? `Ingelogd als ${user.displayName || after} — streams worden herladen` : 'Uitgelogd');
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
function handleShortcut(k) {
  if ((!$('#limitModal').hidden || !castModal.hidden) && k !== 'escape') return false; // dialog open
  if (/^[1-9]$/.test(k)) {
    const ch = state.channels[Number(k) - 1];
    if (ch) feature(ch);
    return true;
  }
  switch (k) {
    case 'f': api.setFullscreen(); return true;
    case 'escape':
      if (!castModal.hidden) castModal.hidden = true;
      else if (!$('#limitModal').hidden) $('#limitModal').hidden = true;
      else if (!$('#help').hidden) toggleHelp(false);
      else if (!followedMenu.hidden || !accountMenu.hidden) closePopovers();
      else if (fullscreen) api.setFullscreen(false);
      return true;
    case 'l': setLayout(LAYOUTS[(LAYOUTS.indexOf(state.layout) + 1) % LAYOUTS.length]); return true;
    case 'u': setLayout('featured'); return true;
    case 'g': setLayout('grid'); return true;
    case 's': setLayout('solo'); return true;
    case 'c': toggleChat(); return true;
    case 'k': setLurk(!state.lurk); return true;
    case 'h':
      state.hideBar = !state.hideBar;
      changed();
      toast(state.hideBar ? 'Menubalk verborgen — beweeg de muis naar boven' : 'Menubalk vast');
      return true;
    case 'm': setAudio(state.audio === 'none' ? lastAudio : 'none'); return true;
    case 'r': { const t = tiles.get(state.featured); if (t) t.wv.reload(); return true; }
    case 'n':
    case 'arrowright': featureOffset(1); return true;
    case 'arrowleft': featureOffset(-1); return true;
    case '?': toggleHelp(); return true;
    default: return false;
  }
}

document.addEventListener('keydown', e => {
  if (e.target === addInput) {
    if (e.key === 'Escape' && suggestEl.hidden) addInput.blur();
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (handleShortcut(e.key.toLowerCase())) e.preventDefault();
});
api.onShortcut(k => handleShortcut(k));

api.onFullscreenChanged(on => {
  fullscreen = on;
  if (!on && soloReturn) {
    setLayout(soloReturn);
    soloReturn = null;
  }
  body.classList.remove('bar-visible');
  updateControls();
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
(async function init() {
  const [saved, args] = await Promise.all([api.loadConfig(), api.args()]);
  if (saved) {
    for (const key of Object.keys(state)) if (key in saved) state[key] = saved[key];
  }
  if (args.channels) state.channels = parseChannels(args.channels.replace(/,/g, ' '));
  if (args.layout) state.layout = args.layout;
  if (args.chat) state.chat = args.chat === '1';
  $('#appVersion').textContent = `· v${args.version}`;

  if (!MAX_OPTIONS.includes(state.maxStreams)) state.maxStreams = DEFAULT_MAX;
  state.channels = parseChannels((state.channels || []).join(' ')).slice(0, state.maxStreams);
  if (!LAYOUTS.includes(state.layout)) state.layout = 'featured';
  if (!AUDIO_MODES.includes(state.audio)) state.audio = 'featured';
  if (!state.channels.includes(state.featured)) state.featured = state.channels[0] || null;
  if (!LURK_DELAYS.includes(state.lurkDelay)) state.lurkDelay = 60;
  state.lurk = state.lurk === true;
  state.lurkSolo = state.lurkSolo !== false;
  if (!LAYOUTS.includes(state.lurkReturn)) state.lurkReturn = null;

  fullscreen = await api.isFullscreen();
  state.channels.forEach(createTile);
  changed();
  refreshUser();
  refreshInfo();
  setInterval(refreshInfo, INFO_REFRESH_MS);
  lurkSchedule(); // also resumes lurking if it was on when the app closed
})();
