'use strict';
const { app, BrowserWindow, ipcMain, protocol, dialog, shell, session, safeStorage, systemPreferences, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Advisor } = require('./advisor');
const { Updater } = require('./updater');

const APP_TITLE = '小柯機器人跳棋遊戲';
const APP_ROOT = path.join(__dirname, '..', '..');
const argv = process.argv.slice(1);
const argVal = (name) => { const a = argv.find((s) => s.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : null; };
const PROFILE = argVal('profile');

app.setName(APP_TITLE);
app.setPath('userData', path.join(app.getPath('appData'), 'xiaoke-checkers' + (PROFILE ? '-' + PROFILE.replace(/[^\w-]/g, '') : '')));
if (!PROFILE && !app.requestSingleInstanceLock()) app.quit();

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// ---------------- 設定 ----------------
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
function defaults() {
  return {
    playerName: os.userInfo().username || '棋友',
    level: 2,
    players: 2,
    server: { mode: 'public', host: '', port: 9000, path: '/', key: 'peerjs', secure: false },
    stun: 'stun:stun.l.google.com:19302\nstun:stun.cloudflare.com:3478',
    turn: { urls: '', username: '', credential: '' },
    music: { volume: 0.45, shuffle: false, autoplay: true, track: 0, enabled: true },
    sfx: true,
    view: 'tilt',
    autoUpdate: true,
    advisor: { apiKeyEnc: '', model: 'claude-opus-5-5', effort: 'low' },
  };
}
let settings = defaults();
function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
    const d = defaults();
    settings = { ...d, ...raw, server: { ...d.server, ...(raw.server || {}) }, turn: { ...d.turn, ...(raw.turn || {}) }, music: { ...d.music, ...(raw.music || {}) }, advisor: { ...d.advisor, ...(raw.advisor || {}) } };
  } catch { settings = defaults(); saveSettings(); }
}
function saveSettings() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2), 'utf8');
}
// 給畫面用的設定（不含金鑰本身）
function publicSettings() {
  const s = JSON.parse(JSON.stringify(settings));
  s.advisor = { model: settings.advisor.model, effort: settings.advisor.effort, hasKey: !!getApiKey(), envKey: !!process.env.ANTHROPIC_API_KEY };
  return s;
}
function getApiKey() {
  const enc = settings.advisor.apiKeyEnc;
  if (enc) {
    try {
      if (enc.startsWith('plain:')) return Buffer.from(enc.slice(6), 'base64').toString('utf8');
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch { /* 解密失敗視同沒有 */ }
  }
  return process.env.ANTHROPIC_API_KEY || '';
}
function setApiKey(key) {
  key = String(key || '').trim();
  if (!key) { settings.advisor.apiKeyEnc = ''; return; }
  settings.advisor.apiKeyEnc = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key).toString('base64')
    : 'plain:' + Buffer.from(key, 'utf8').toString('base64');
}

// ---------------- 視窗 ----------------
let win = null;
function iconPath() {
  const p = path.join(APP_ROOT, 'build', 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}
function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1120, minHeight: 720,
    title: APP_TITLE + (PROFILE ? ` [${PROFILE}]` : ''),
    icon: iconPath(),
    backgroundColor: '#1b1410',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL('app://local/src/renderer/index.html');
  win.once('ready-to-show', () => {
    if (argv.includes('--hidden')) return;
    if (!PROFILE) win.maximize(); // 棋盤越大越好看
    win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  win.on('closed', () => { win = null; advisor.cancelAll(); });
}

// ---------------- app:// 協定（支援 Range，音樂可拖曳進度） ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
function userMusicDir() { return path.join(app.getPath('userData'), 'music'); }
function resolveAppUrl(u) {
  const url = new URL(u);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  let base;
  if (url.host === 'local') base = APP_ROOT;
  else if (url.host === 'user-music') base = userMusicDir();
  else return null;
  const abs = path.normalize(path.join(base, rel));
  if (!abs.startsWith(path.normalize(base + path.sep)) && abs !== path.normalize(base)) return null;
  // 只允許程式自己的檔案
  if (url.host === 'local' && !/^(src|assets|node_modules|build)[\\/]/.test(path.relative(APP_ROOT, abs))) return null;
  return abs;
}
function registerProtocol() {
  protocol.handle('app', async (req) => {
    const abs = resolveAppUrl(req.url);
    if (!abs) return new Response('forbidden', { status: 403 });
    let st;
    try { st = fs.statSync(abs); } catch { return new Response('not found', { status: 404 }); }
    if (!st.isFile()) return new Response('not found', { status: 404 });
    const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.get('range');
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? Number(m[1]) : 0;
      let end = m && m[2] ? Number(m[2]) : st.size - 1;
      if (!m[1] && m[2]) { start = st.size - Number(m[2]); end = st.size - 1; }
      end = Math.min(end, st.size - 1);
      if (start > end || start >= st.size) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
      const len = end - start + 1;
      const buf = Buffer.alloc(len);
      const fd = fs.openSync(abs, 'r');
      try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
      return new Response(buf, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(len) } });
    }
    return new Response(fs.readFileSync(abs), { status: 200, headers: { ...headers, 'Content-Length': String(st.size) } });
  });
}

// ---------------- 棋譜 ----------------
function gamesDir() { return path.join(app.getPath('userData'), 'games'); }
function safeId(id) { return String(id || '').replace(/[^\w.-]/g, ''); }
function readGame(file) {
  try { return JSON.parse(fs.readFileSync(path.join(gamesDir(), file), 'utf8')); } catch { return null; }
}
function listGameFiles() {
  try { return fs.readdirSync(gamesDir()).filter((f) => f.endsWith('.json')).sort().reverse(); } catch { return []; }
}

// ---------------- AI 軍師 ----------------
const advisor = new Advisor({ getKey: getApiKey, getSettings: () => settings.advisor });

// ---------------- IPC ----------------
function handle(ch, fn) { ipcMain.handle(ch, (e, ...a) => fn(...a)); }

handle('settings:get', () => publicSettings());
handle('settings:set', (patch) => {
  patch = patch || {};
  for (const k of ['playerName', 'level', 'players', 'stun', 'sfx', 'view', 'autoUpdate', 'aivai', 'netCfg']) if (k in patch) settings[k] = patch[k];
  if (patch.server) settings.server = { ...settings.server, ...patch.server };
  if (patch.turn) settings.turn = { ...settings.turn, ...patch.turn };
  if (patch.music) settings.music = { ...settings.music, ...patch.music };
  if (patch.advisor) {
    if ('apiKey' in patch.advisor) setApiKey(patch.advisor.apiKey);
    if (patch.advisor.model) settings.advisor.model = String(patch.advisor.model);
    if (patch.advisor.effort) settings.advisor.effort = String(patch.advisor.effort);
  }
  saveSettings();
  return publicSettings();
});
handle('sys:info', () => ({ platform: process.platform, arch: process.arch, version: app.getVersion(), packaged: app.isPackaged, profile: PROFILE || '', userData: app.getPath('userData'), electron: process.versions.electron }));

// ---------------- 版本更新 ----------------
const updater = new Updater();
handle('update:check', () => updater.check());
ipcMain.handle('update:download', async (e) => {
  const file = await updater.download((got, total) => { if (!e.sender.isDestroyed()) e.sender.send('update:progress', { got, total }); });
  return file;
});
handle('update:install', (file) => updater.install(file));
handle('update:openPage', () => { if (updater.info && updater.info.page) shell.openExternal(updater.info.page); else shell.openExternal('https://github.com/achir1015/xiaoke-checkers/releases/latest'); });
handle('sys:askMicrophone', async () => {
  if (process.platform === 'darwin') {
    const st = systemPreferences.getMediaAccessStatus('microphone');
    if (st !== 'granted') return systemPreferences.askForMediaAccess('microphone');
  }
  return true;
});
handle('win:attention', (title, body) => {
  if (!win) return;
  if (!win.isFocused()) {
    win.flashFrame(true);
    try { if (Notification.isSupported()) new Notification({ title: title || APP_TITLE, body: body || '' }).show(); } catch {}
  }
});
handle('app:openExternal', (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

handle('games:save', (rec) => {
  fs.mkdirSync(gamesDir(), { recursive: true });
  const id = safeId(rec.id) || (new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex'));
  const data = { ...rec, id };
  fs.writeFileSync(path.join(gamesDir(), id + '.json'), JSON.stringify(data), 'utf8');
  return id;
});
handle('games:list', () => listGameFiles().map((f) => {
  const g = readGame(f);
  if (!g) return null;
  return { id: g.id || f.replace(/\.json$/, ''), date: g.date, mode: g.mode, n: g.n, names: g.names || [], result: g.result, plies: (g.moves || []).length, mySeat: g.mySeat };
}).filter(Boolean));
handle('games:all', () => listGameFiles().map(readGame).filter(Boolean));
handle('games:get', (id) => readGame(safeId(id) + '.json'));
handle('games:delete', (id) => {
  const p = path.join(gamesDir(), safeId(id) + '.json');
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return true;
});
handle('games:export', async (name, text) => {
  const r = await dialog.showSaveDialog(win, { title: '匯出棋譜', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: '棋譜', extensions: [path.extname(name).slice(1) || 'txt'] }] });
  if (r.canceled || !r.filePath) return '';
  fs.writeFileSync(r.filePath, text, 'utf8');
  return r.filePath;
});
handle('games:pickImport', async () => {
  const r = await dialog.showOpenDialog(win, { title: '匯入棋譜（可多選）', properties: ['openFile', 'multiSelections'], filters: [{ name: '棋譜', extensions: ['json', 'txt'] }] });
  if (r.canceled) return [];
  return r.filePaths.slice(0, 500).map((p) => {
    try {
      const buf = fs.readFileSync(p);
      if (buf.length > 5 * 1024 * 1024) return { name: path.basename(p), error: '檔案太大' };
      const text = buf.toString('utf8');
      return { name: path.basename(p), text };
    } catch (e) { return { name: path.basename(p), error: String(e.message || e) }; }
  });
});

handle('music:list', () => {
  const out = [];
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'assets', 'music', 'tracks.json'), 'utf8'));
    for (const t of meta) if (fs.existsSync(path.join(APP_ROOT, 'assets', 'music', t.file))) out.push({ title: t.title, url: 'app://local/assets/music/' + t.file, builtin: true, seconds: t.seconds });
  } catch {}
  try {
    for (const f of fs.readdirSync(userMusicDir())) {
      if (/\.(mp3|m4a|ogg|wav)$/i.test(f)) out.push({ title: f.replace(/\.[^.]+$/, ''), url: 'app://user-music/' + encodeURIComponent(f), builtin: false, file: f });
    }
  } catch {}
  return out;
});
handle('music:add', async () => {
  const r = await dialog.showOpenDialog(win, { title: '加入自己的音樂', properties: ['openFile', 'multiSelections'], filters: [{ name: '音樂', extensions: ['mp3', 'm4a', 'ogg', 'wav'] }] });
  if (r.canceled) return 0;
  fs.mkdirSync(userMusicDir(), { recursive: true });
  for (const p of r.filePaths) fs.copyFileSync(p, path.join(userMusicDir(), path.basename(p)));
  return r.filePaths.length;
});
handle('music:remove', (file) => {
  const p = path.join(userMusicDir(), path.basename(String(file || '')));
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return true;
});

ipcMain.on('advisor:ask', (e, id, payload) => advisor.ask(e.sender, id, payload));
ipcMain.on('advisor:cancel', (e, id) => advisor.cancel(id));
handle('advisor:test', () => advisor.test());

// ---------------- 啟動 ----------------
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  loadSettings();
  registerProtocol();
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write'].includes(perm));
  createWindow();
});
