'use strict';

// `api` is the bridge exposed by preload.js (window.api).

const PARTITION = 'persist:twitch';
const AR = 16 / 9;
const GAP = 4;
const MAX_CHANNELS = 16;
const INFO_REFRESH_MS = 60_000;

const ICONS = {
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
}

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
    wv.executeJavaScript(GUEST_JS).catch(() => {});
    applyAudio();
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
    if (state.channels.length >= MAX_CHANNELS) {
      toast(`Maximaal ${MAX_CHANNELS} streams tegelijk`);
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
  const names = parseChannels(addInput.value);
  if (!names.length) {
    if (addInput.value.trim()) toast('Geen geldige kanaalnaam');
    return;
  }
  addInput.value = '';
  addChannels(names, { featureFirst: state.channels.length === 0 });
});

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
}

document.addEventListener('mousedown', e => {
  if (!e.target.closest('.popover, #followedBtn, #account')) closePopovers();
});

async function openFollowed() {
  if (!followedMenu.hidden) return closePopovers();
  closePopovers();
  positionPopover(followedMenu, $('#followedBtn'));
  followedMenu.hidden = false;
  followedMenu.innerHTML = '<div class="hint">Laden…</div>';

  let list;
  try {
    list = await api.followedLive();
  } catch {
    followedMenu.innerHTML = '<div class="hint">Kon Twitch niet bereiken.</div>';
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
        item.classList.add('added');
        item.querySelector('.meta div').textContent = `${u.displayName} ✓`;
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
  acc.innerHTML = `<div class="acct" title="Account">${user.avatar ? `<img src="${esc(user.avatar)}" alt="">` : ''}<span>${esc(name)}</span>${badge}</div>`;
  acc.querySelector('.acct').addEventListener('click', () => toggleAccountMenu());
  empty.innerHTML = `<div>Ingelogd als <b>${esc(name)}</b> ${badge}</div>`;
}

function toggleAccountMenu() {
  if (!accountMenu.hidden) return closePopovers();
  closePopovers();
  accountMenu.innerHTML = `
    <div class="hint">Ingelogd als <b>${esc(user.displayName || user.login)}</b></div>
    <button class="item" data-act="reload">Alle streams herladen</button>
    <button class="item" data-act="logout">Uitloggen</button>`;
  accountMenu.querySelector('[data-act=reload]').addEventListener('click', () => { closePopovers(); reloadAll(); });
  accountMenu.querySelector('[data-act=logout]').addEventListener('click', () => { closePopovers(); api.logout(); });
  accountMenu.hidden = false;
  const r = $('#account').getBoundingClientRect();
  accountMenu.style.top = `${r.bottom + 6}px`;
  accountMenu.style.left = `${Math.max(8, r.right - 260)}px`;
}

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
  if (/^[1-9]$/.test(k)) {
    const ch = state.channels[Number(k) - 1];
    if (ch) feature(ch);
    return true;
  }
  switch (k) {
    case 'f': api.setFullscreen(); return true;
    case 'escape':
      if (!$('#help').hidden) toggleHelp(false);
      else if (!followedMenu.hidden || !accountMenu.hidden) closePopovers();
      else if (fullscreen) api.setFullscreen(false);
      return true;
    case 'l': setLayout(LAYOUTS[(LAYOUTS.indexOf(state.layout) + 1) % LAYOUTS.length]); return true;
    case 'u': setLayout('featured'); return true;
    case 'g': setLayout('grid'); return true;
    case 's': setLayout('solo'); return true;
    case 'c': toggleChat(); return true;
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
    if (e.key === 'Escape') addInput.blur();
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

  state.channels = parseChannels((state.channels || []).join(' ')).slice(0, MAX_CHANNELS);
  if (!LAYOUTS.includes(state.layout)) state.layout = 'featured';
  if (!AUDIO_MODES.includes(state.audio)) state.audio = 'featured';
  if (!state.channels.includes(state.featured)) state.featured = state.channels[0] || null;

  fullscreen = await api.isFullscreen();
  state.channels.forEach(createTile);
  changed();
  refreshUser();
  refreshInfo();
  setInterval(refreshInfo, INFO_REFRESH_MS);
})();
