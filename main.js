'use strict';

const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, protocol, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// All Twitch content (players, chat, login) shares this persistent session,
// so one login applies everywhere and Turbo / subscriptions remove the ads.
const PARTITION = 'persist:twitch';
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const GQL_URL = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // Twitch web client

// The UI is served from its own app:// scheme instead of file://, so the
// file:// protocol can stay locked down (GrantFileProtocolExtraPrivileges
// fuse off) and the UI can only read files from its own folder.
const UI_ROOT = path.join(__dirname, 'renderer');
const UI_URL = 'app://ui/index.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);

function serveUi(request) {
  const u = new URL(request.url);
  const file = path.normalize(path.join(UI_ROOT, decodeURIComponent(u.pathname)));
  if (u.host !== 'ui' || !file.startsWith(UI_ROOT + path.sep)) return new Response('Not found', { status: 404 });
  try {
    return new Response(fs.readFileSync(file), {
      headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

// --- Command line options for automated testing ----------------------------
// Only available when running from source (`electron .`), never in the
// installed app: --capture-script runs arbitrary JS inside the UI.
const DEV = !app.isPackaged;
function arg(name) {
  if (!DEV) return null;
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const PROFILE_DIR = arg('profile');
const CAPTURE_FILE = arg('capture');
const CAPTURE_DELAY = Number(arg('capture-delay') || 15000);
const CAPTURE_SCRIPT = arg('capture-script'); // JS run in the UI before capturing

if (PROFILE_DIR) app.setPath('userData', path.resolve(PROFILE_DIR));

// One instance only: two instances would fight over the same profile.
if (!CAPTURE_FILE && !app.requestSingleInstanceLock()) app.exit(0);

// --- URL helpers -------------------------------------------------------------
function parseUrl(url) {
  try { return new URL(url); } catch { return null; }
}

function isTwitchHost(host) {
  return host === 'twitch.tv' || host.endsWith('.twitch.tv');
}

// Hand a link to the normal browser, but only web links: other protocols
// (file:, ms-*, search-ms:, ...) could start programs on the PC.
function openInBrowser(url) {
  const u = parseUrl(url);
  if (u && (u.protocol === 'https:' || u.protocol === 'http:')) shell.openExternal(u.href);
}

// IPC is only accepted from our own UI page, never from anything that may
// have ended up in the main window.
function fromUi(event) {
  return Boolean(event.senderFrame) && event.senderFrame.url === UI_URL;
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.userAgentFallback = CHROME_UA;

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'multiview-config.json');

let mainWin = null;
let loginWin = null;

// --- Config ----------------------------------------------------------------
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE(), JSON.stringify(cfg, null, 2));
  } catch (err) {
    console.error('Config opslaan mislukt:', err);
  }
}

// --- Twitch account --------------------------------------------------------
function twitchSession() {
  return session.fromPartition(PARTITION);
}

async function getAuthToken() {
  const cookies = await twitchSession().cookies.get({ url: 'https://www.twitch.tv', name: 'auth-token' });
  return cookies.length ? cookies[0].value : null;
}

async function gql(query, variables) {
  const token = await getAuthToken();
  const headers = { 'Client-Id': GQL_CLIENT_ID, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `OAuth ${token}`;
  const res = await fetch(GQL_URL, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  if (!res.ok) throw new Error(`Twitch GQL ${res.status}`);
  return res.json();
}

async function getUser() {
  const token = await getAuthToken();
  if (!token) return null;
  const loginCookie = await twitchSession().cookies.get({ url: 'https://www.twitch.tv', name: 'login' });
  const user = { login: loginCookie.length ? loginCookie[0].value : null, displayName: null, avatar: null, turbo: null };
  try {
    const r = await gql('query { currentUser { login displayName profileImageURL(width: 70) hasTurbo } }');
    const cu = r.data && r.data.currentUser;
    if (cu) {
      user.login = cu.login;
      user.displayName = cu.displayName;
      user.avatar = cu.profileImageURL;
      user.turbo = cu.hasTurbo;
    }
  } catch (err) {
    console.warn('Gebruikersinfo ophalen mislukt:', err.message);
  }
  return user;
}

const STREAM_FIELDS = 'login displayName profileImageURL(width: 50) stream { viewersCount title game { displayName } }';

async function getChannelInfo(logins) {
  if (!logins.length) return [];
  const r = await gql(`query($logins: [String!]) { users(logins: $logins) { ${STREAM_FIELDS} } }`, { logins });
  return ((r.data && r.data.users) || []).filter(Boolean);
}

async function getFollowedLive() {
  const r = await gql(`query { currentUser { followedLiveUsers(first: 100) { edges { node { ${STREAM_FIELDS} } } } } }`);
  const cu = r.data && r.data.currentUser;
  if (!cu) return null; // not logged in
  return cu.followedLiveUsers.edges.map(e => e.node).filter(n => n && n.stream);
}

function openLogin() {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return;
  }
  loginWin = new BrowserWindow({
    width: 520,
    height: 800,
    parent: mainWin,
    title: 'Inloggen bij Twitch',
    backgroundColor: '#0e0e10',
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // The login window stays on twitch.tv; any other link opens in the browser.
  const keepOnTwitch = (event, url) => {
    const u = parseUrl(url);
    if (u && u.protocol === 'https:' && isTwitchHost(u.hostname)) return;
    event.preventDefault();
    openInBrowser(url);
  };
  loginWin.webContents.on('will-navigate', keepOnTwitch);
  loginWin.webContents.on('will-redirect', keepOnTwitch);
  loginWin.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: 'deny' };
  });
  loginWin.loadURL('https://www.twitch.tv/login');
  loginWin.on('closed', () => { loginWin = null; });
}

async function logout() {
  await twitchSession().clearStorageData();
  notifyAuthChanged();
}

let authNotifyTimer = null;
function notifyAuthChanged() {
  clearTimeout(authNotifyTimer);
  authNotifyTimer = setTimeout(() => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('auth-changed');
  }, 800);
}

// --- Fullscreen --------------------------------------------------------------
function setFullscreen(on) {
  if (!mainWin) return;
  mainWin.setFullScreen(on);
}

// --- Keyboard shortcuts while focus is inside a player ---------------------
// Keys pressed inside a <webview> never reach the host page, so they are
// intercepted here and forwarded to the UI.
const PLAYER_SHORTCUTS = new Set(['f', 'escape', 'l', 'g', 'u', 's', 'c', 'h', 'm', 'r', 'n', 'arrowleft', 'arrowright', '?',
  '1', '2', '3', '4', '5', '6', '7', '8', '9']);

function hookGuest(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      setFullscreen(!mainWin.isFullScreen());
      return;
    }
    if (input.control || input.alt || input.meta) return;
    let isPlayer = false;
    try { isPlayer = new URL(contents.getURL()).hostname === 'player.twitch.tv'; } catch { /* not loaded yet */ }
    const key = input.key.toLowerCase();
    if (isPlayer && PLAYER_SHORTCUTS.has(key)) {
      event.preventDefault();
      mainWin.webContents.send('shortcut', key);
    } else if (key === 'escape' && mainWin.isFullScreen()) {
      setFullscreen(false);
    }
  });

  // Links ("Watch on Twitch", chat links, ...) open in the normal browser.
  contents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: 'deny' };
  });
  // Players must stay on player.twitch.tv and the chat on its popout page;
  // anything else goes to the browser.
  const stayOnPage = (event, url) => {
    const u = parseUrl(url);
    const cur = parseUrl(contents.getURL());
    const isPlayer = u && u.hostname === 'player.twitch.tv';
    const isChat = u && isTwitchHost(u.hostname) && u.pathname.startsWith('/popout/');
    let allowed = false;
    if (u && u.protocol === 'https:') {
      if (!cur) allowed = isPlayer || isChat; // first load, nothing committed yet
      else if (cur.hostname === 'player.twitch.tv') allowed = isPlayer;
      else allowed = isChat;
    }
    if (!allowed) {
      event.preventDefault();
      openInBrowser(url);
    }
  };
  contents.on('will-navigate', stayOnPage);
  contents.on('will-redirect', stayOnPage);
}

// Permissions for Twitch pages: fullscreen and copying text only. No camera,
// microphone, location, notifications, ...
const TWITCH_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

function twitchPermissionAllowed(permission, origin) {
  const u = parseUrl(origin || '');
  return TWITCH_PERMISSIONS.has(permission) && Boolean(u) && u.protocol === 'https:' && isTwitchHost(u.hostname);
}

// --- Main window -------------------------------------------------------------
function createWindow() {
  const cfg = readConfig();
  const bounds = cfg.windowBounds || { width: 1600, height: 900 };

  mainWin = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 450,
    title: 'Twitch MultiView',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0e0e10',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  if (cfg.maximized) mainWin.maximize();
  if (cfg.fullscreen && !CAPTURE_FILE) mainWin.setFullScreen(true);

  // The main window only ever shows our own UI. Block every navigation away
  // from it (e.g. a link or file dropped onto the window), so no other page
  // can get hold of the `api` bridge from preload.js.
  mainWin.webContents.on('will-navigate', event => event.preventDefault());
  mainWin.webContents.on('will-redirect', event => event.preventDefault());
  mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Only our own Twitch webviews may be attached, always in the shared session.
  mainWin.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    delete params.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.autoplayPolicy = 'no-user-gesture-required';
    const src = parseUrl(params.src);
    const ok = mainWin.webContents.getURL() === UI_URL && src && src.protocol === 'https:'
      && (src.hostname === 'player.twitch.tv' || src.hostname === 'www.twitch.tv');
    if (!ok) event.preventDefault();
    params.partition = PARTITION;
  });

  mainWin.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      setFullscreen(!mainWin.isFullScreen());
    }
  });

  mainWin.on('enter-full-screen', () => mainWin.webContents.send('fullscreen-changed', true));
  mainWin.on('leave-full-screen', () => mainWin.webContents.send('fullscreen-changed', false));

  mainWin.on('close', () => {
    const c = readConfig();
    c.fullscreen = mainWin.isFullScreen();
    c.maximized = mainWin.isMaximized();
    if (!c.fullscreen && !c.maximized) c.windowBounds = mainWin.getBounds();
    writeConfig(c);
  });

  mainWin.loadURL(UI_URL);

  if (CAPTURE_FILE) {
    mainWin.webContents.on('console-message', e => console.log(`[ui] ${e.message}`));
    setTimeout(async () => {
      try {
        if (CAPTURE_SCRIPT) {
          await mainWin.webContents.executeJavaScript(fs.readFileSync(CAPTURE_SCRIPT, 'utf8'));
          await new Promise(r => setTimeout(r, 2500));
        }
        // Capture through the OS (like a real screenshot), so video in
        // hardware overlays is included too.
        const size = mainWin.getContentSize();
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: size[0] + 40, height: size[1] + 80 } });
        const src = sources.find(s => s.id === mainWin.getMediaSourceId());
        const img = src ? src.thumbnail : await mainWin.webContents.capturePage();
        fs.writeFileSync(CAPTURE_FILE, img.toPNG());
        console.log('Screenshot opgeslagen:', CAPTURE_FILE);
        if (loginWin && !loginWin.isDestroyed()) {
          const loginFile = CAPTURE_FILE.replace(/\.png$/i, '-login.png');
          fs.writeFileSync(loginFile, (await loginWin.webContents.capturePage()).toPNG());
          console.log('Login-screenshot opgeslagen:', loginFile, loginWin.webContents.getURL());
        }
      } catch (err) {
        console.error('Screenshot mislukt:', err);
      }
      app.exit(0);
    }, CAPTURE_DELAY);
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', serveUi);

  const ses = twitchSession();
  ses.setUserAgent(CHROME_UA);
  ses.setPermissionRequestHandler((wc, permission, cb, details) =>
    cb(twitchPermissionAllowed(permission, details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, permission, origin) => twitchPermissionAllowed(permission, origin));
  // Our own UI needs no permissions at all (Electron's default is "allow").
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  ses.cookies.on('changed', (e, cookie) => {
    if (cookie.name !== 'auth-token') return;
    notifyAuthChanged();
    // Close the login window shortly after a successful login.
    if (loginWin && !loginWin.isDestroyed()) {
      getAuthToken().then(token => {
        if (token && loginWin && !loginWin.isDestroyed()) setTimeout(() => loginWin && !loginWin.isDestroyed() && loginWin.close(), 1200);
      });
    }
  });

  app.on('web-contents-created', (e, contents) => {
    if (contents.getType() === 'webview') hookGuest(contents);
  });

  // Every IPC call must come from our own UI page.
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
    if (!fromUi(event)) throw new Error(`Geweigerd: ${channel}`);
    return fn(...args);
  });
  const isLoginList = v => Array.isArray(v) && v.length <= 100 && v.every(s => typeof s === 'string' && /^[a-z0-9_]{1,25}$/i.test(s));

  handle('config:load', () => readConfig().state || null);
  handle('config:save', state => {
    if (!state || typeof state !== 'object' || JSON.stringify(state).length > 20_000) return;
    const c = readConfig();
    c.state = state;
    writeConfig(c);
  });
  handle('auth:user', () => getUser());
  handle('auth:login', () => openLogin());
  handle('auth:logout', () => logout());
  handle('twitch:channels', logins => (isLoginList(logins) ? getChannelInfo(logins) : []));
  handle('twitch:followed', () => getFollowedLive());
  handle('window:fullscreen', on => setFullscreen(typeof on === 'boolean' ? on : !mainWin.isFullScreen()));
  handle('window:isFullscreen', () => mainWin.isFullScreen());
  handle('app:args', () => ({
    channels: arg('channels'),
    layout: arg('layout'),
    chat: arg('chat'),
    version: app.getVersion(),
  }));

  createWindow();
});

app.on('second-instance', () => {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();
});

app.on('window-all-closed', () => app.quit());
