'use strict';

const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// All Twitch content (players, chat, login) shares this persistent session,
// so one login applies everywhere and Turbo / subscriptions remove the ads.
const PARTITION = 'persist:twitch';
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const GQL_URL = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // Twitch web client

// --- Command line options (mainly used for automated testing) -------------
function arg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const PROFILE_DIR = arg('profile');
const CAPTURE_FILE = arg('capture');
const CAPTURE_DELAY = Number(arg('capture-delay') || 15000);
const CAPTURE_SCRIPT = arg('capture-script'); // JS run in the UI before capturing

if (PROFILE_DIR) app.setPath('userData', path.resolve(PROFILE_DIR));

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
    webPreferences: { partition: PARTITION },
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
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    let host = '';
    try { host = new URL(url).hostname; } catch { /* ignore */ }
    const current = contents.getURL();
    // Players and chat must stay on their page; anything else goes to the browser.
    if (current.includes('player.twitch.tv') && host !== 'player.twitch.tv') {
      event.preventDefault();
      shell.openExternal(url);
    } else if (current.includes('/popout/') && current.includes('/chat') && !url.includes('/popout/')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
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
      webviewTag: true,
    },
  });
  if (cfg.maximized) mainWin.maximize();
  if (cfg.fullscreen && !CAPTURE_FILE) mainWin.setFullScreen(true);

  // Only our own Twitch webviews may be attached, always in the shared session.
  mainWin.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.autoplayPolicy = 'no-user-gesture-required';
    if (!/^https:\/\/(player|www)\.twitch\.tv\//.test(params.src)) event.preventDefault();
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

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));

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

  const ses = twitchSession();
  ses.setUserAgent(CHROME_UA);
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(['fullscreen', 'clipboard-sanitized-write', 'media'].includes(permission)));
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

  ipcMain.handle('config:load', () => readConfig().state || null);
  ipcMain.handle('config:save', (e, state) => {
    const c = readConfig();
    c.state = state;
    writeConfig(c);
  });
  ipcMain.handle('auth:user', () => getUser());
  ipcMain.handle('auth:login', () => openLogin());
  ipcMain.handle('auth:logout', () => logout());
  ipcMain.handle('twitch:channels', (e, logins) => getChannelInfo(logins));
  ipcMain.handle('twitch:followed', () => getFollowedLive());
  ipcMain.handle('window:fullscreen', (e, on) => setFullscreen(on === undefined ? !mainWin.isFullScreen() : on));
  ipcMain.handle('window:isFullscreen', () => mainWin.isFullScreen());
  ipcMain.handle('shell:open', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.handle('app:args', () => ({
    channels: arg('channels'),
    layout: arg('layout'),
    chat: arg('chat'),
    testMode: Boolean(CAPTURE_FILE),
    version: app.getVersion(),
  }));

  createWindow();
});

app.on('window-all-closed', () => app.quit());
