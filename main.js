const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, Notification, shell, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const adhan = require('adhan');
const { createDesktopPin, roundCorners } = require('./desktop-pin');

const APP_ID = 'com.todo.widget';
const DEFAULT_HOTKEY = 'Control+Alt+T';

// Keep data in %APPDATA%\todo-widget for every build, so the installed app and the development
// copy use the same folder. A --user-data-dir switch (used for test copies) still takes priority.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'todo-widget'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.setAppUserModelId(APP_ID);

let win = null;
let tray = null;
let pin = null;
let appIcon = null;
let state = {};
let quitting = false;
let saveTimer = null;
let activeHotkey = '';

const THEME_BG = { light: '#f6f6f3', dark: '#17171a' };

// ---------- persisted window state ----------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeState() {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(state));
  } catch {}
}

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeState, 300);
}

// ---------- saved data ----------
// Everything the widget stores (tasks, habits, notes, settings…) lives in widget-data.json and is
// written to disk within a moment of each change, and again when the app quits. It used to live in
// Chromium's localStorage, which could lose recent changes when the app was closed.
const dataFile = () => path.join(app.getPath('userData'), 'widget-data.json');
const previousDataFile = () => path.join(app.getPath('userData'), 'widget-data.previous.json');
let dataStore = null;
let dataTimer = null;
let dataDirty = false;

function readDataFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) return parsed.data;
  } catch {}
  return null;
}

function loadData() {
  if (dataStore) return { exists: true, data: dataStore };
  if (!fs.existsSync(dataFile())) return { exists: false, data: {} };
  let data = readDataFile(dataFile());
  if (data) {
    // Keep a copy of the last good file in case the next write is ever interrupted.
    try { fs.copyFileSync(dataFile(), previousDataFile()); } catch {}
  } else {
    data = readDataFile(previousDataFile());
    try { fs.renameSync(dataFile(), path.join(app.getPath('userData'), `widget-data.damaged-${Date.now()}.json`)); } catch {}
    if (!data) return { exists: false, data: {} };
    dataDirty = true;
  }
  dataStore = data;
  if (dataDirty) writeDataNow();
  return { exists: true, data };
}

function writeDataNow() {
  clearTimeout(dataTimer);
  dataTimer = null;
  if (!dataDirty || !dataStore) return;
  const json = JSON.stringify({ app: 'todo-widget', version: 1, savedAt: new Date().toISOString(), data: dataStore });
  const tmp = `${dataFile()}.tmp`;
  try {
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, dataFile());
    dataDirty = false;
  } catch {
    try {
      fs.writeFileSync(dataFile(), json, 'utf8');
      dataDirty = false;
    } catch (err) {
      console.warn('Could not save data:', err.message);
    }
  }
}

function scheduleDataWrite() {
  dataDirty = true;
  if (!dataTimer) dataTimer = setTimeout(writeDataNow, 200);
}

const isDataKey = (key) => typeof key === 'string' && key.startsWith('todo-widget.');

ipcMain.on('storage:load', (e) => {
  e.returnValue = loadData();
});
ipcMain.on('storage:set', (_e, key, value) => {
  if (!isDataKey(key)) return;
  dataStore ??= {};
  if (typeof value === 'string') dataStore[key] = value;
  else delete dataStore[key];
  scheduleDataWrite();
});
// Replaces everything at once (first start, restoring a backup) and writes before returning.
ipcMain.on('storage:replace', (e, data) => {
  const clean = {};
  for (const [key, value] of Object.entries(data || {})) if (isDataKey(key) && typeof value === 'string') clean[key] = value;
  dataStore = clean;
  dataDirty = true;
  writeDataNow();
  e.returnValue = !dataDirty;
});
// Note: a sync reply is sent the moment returnValue is first set, so it's set exactly once.
ipcMain.on('storage:latest-backup', (e) => {
  let result = null;
  try {
    const dir = path.join(app.getPath('userData'), 'backups');
    const files = fs.readdirSync(dir).filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
    for (const file of files) {
      const data = readDataFile(path.join(dir, file));
      if (data) {
        result = { file, data };
        break;
      }
    }
  } catch {}
  e.returnValue = result;
});

function isOnScreen(b) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 50 &&
    b.x + b.width > a.x + 50 &&
    b.y >= a.y - 10 &&
    b.y < a.y + a.height - 50
  );
}

// ---------- start with Windows ----------
const loginOpts = () => ({
  path: process.execPath,
  args: app.isPackaged ? [] : [app.getAppPath()],
});
const getOpenAtLogin = () => app.getLoginItemSettings(loginOpts()).openAtLogin;
const setOpenAtLogin = (on) => app.setLoginItemSettings({ openAtLogin: on, ...loginOpts() });

const settings = () => ({ pinned: !!state.pinned, openAtLogin: getOpenAtLogin(), hotkey: activeHotkey });

// ---------- app icon (drawn in code, no image file needed) ----------
function makeIcon(S) {
  const k = S / 32;
  const buf = Buffer.alloc(S * S * 4);
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const alpha = Math.max(0, Math.min(1, 15 * k - Math.hypot(cx - 16 * k, cy - 16 * k)));
      if (!alpha) continue;
      const d = Math.min(
        segDist(cx, cy, 9 * k, 16.5 * k, 14 * k, 21.5 * k),
        segDist(cx, cy, 14 * k, 21.5 * k, 23.5 * k, 11 * k),
      );
      const w = Math.max(0, Math.min(1, 2.6 * k - d));
      const r = 79 + (255 - 79) * w, g = 70 + (255 - 70) * w, b = 229 + (255 - 229) * w;
      const i = (y * S + x) * 4;
      buf[i] = Math.round(b * alpha);
      buf[i + 1] = Math.round(g * alpha);
      buf[i + 2] = Math.round(r * alpha);
      buf[i + 3] = Math.round(255 * alpha);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: S, height: S });
}

// A single-image .ico file that wraps a PNG (supported since Windows Vista).
function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

// Windows only shows toast notifications for apps that have a Start menu shortcut carrying their
// AppUserModelID. The installer creates that shortcut for installed copies; this covers running from source.
function ensureStartMenuShortcut() {
  if (process.platform !== 'win32' || app.isPackaged) return;
  try {
    const icoPath = path.join(app.getPath('userData'), 'icon.ico');
    fs.writeFileSync(icoPath, pngToIco(makeIcon(64).toPNG(), 64));
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'To-Do Widget.lnk');
    shell.writeShortcutLink(lnk, 'create', {
      target: process.execPath,
      args: `"${app.getAppPath()}"`,
      cwd: app.getAppPath(),
      description: 'To-Do Widget',
      icon: icoPath,
      iconIndex: 0,
      appUserModelId: APP_ID,
    });
  } catch (err) {
    console.warn('Could not create Start menu shortcut:', err.message);
  }
}

// ---------- automatic updates ----------
// Installed copies check GitHub Releases for a newer version, download it in the background and
// install it the next time the widget quits (or straight away with "Restart to update").
let updateStatus = { state: app.isPackaged ? 'idle' : 'dev', version: app.getVersion() };
let updater = null;

function setUpdateStatus(patch) {
  updateStatus = { ...updateStatus, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('update-status', updateStatus);
  buildTrayMenu();
}

function checkForUpdates() {
  if (!updater || ['checking', 'downloading', 'ready'].includes(updateStatus.state)) return;
  updater.checkForUpdates().catch((err) => setUpdateStatus({ state: 'error', error: String(err?.message || err).slice(0, 200) }));
}

function setupUpdates() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch {
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => setUpdateStatus({ state: 'checking', error: '' }));
  updater.on('update-available', (info) => setUpdateStatus({ state: 'downloading', available: info.version, percent: 0 }));
  updater.on('download-progress', (p) => setUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-not-available', () => setUpdateStatus({ state: 'current', checkedAt: Date.now() }));
  updater.on('update-downloaded', (info) => {
    setUpdateStatus({ state: 'ready', available: info.version });
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: 'Update ready',
      body: `To-Do Widget ${info.version} installs when the widget restarts. Click to restart now.`,
      icon: makeIcon(64),
    });
    liveNotifications.add(n);
    n.on('click', () => { liveNotifications.delete(n); installUpdate(); });
    n.on('close', () => liveNotifications.delete(n));
    n.show();
  });
  updater.on('error', (err) => {
    if (updateStatus.state !== 'ready') setUpdateStatus({ state: 'error', error: String(err?.message || err).slice(0, 200) });
  });
  setTimeout(checkForUpdates, 15 * 1000);
  setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
}

function installUpdate() {
  if (!updater || updateStatus.state !== 'ready') return;
  quitting = true;
  writeState();
  writeDataNow();
  updater.quitAndInstall(true, true); // install quietly, then open the widget again
}

ipcMain.handle('app:update-status', () => updateStatus);
ipcMain.handle('app:check-updates', () => {
  checkForUpdates();
  return updateStatus;
});
ipcMain.on('app:install-update', installUpdate);

// ---------- tray ----------
const prettyHotkey = (accelerator) => accelerator.replace('Control', 'Ctrl').replace('Super', 'Win');

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(updateStatus.state === 'ready' ? [{ label: `Restart to update to ${updateStatus.available}`, click: installUpdate }, { type: 'separator' }] : []),
    { label: activeHotkey ? `Show widget (${prettyHotkey(activeHotkey)})` : 'Show widget', click: showWindow },
    { type: 'separator' },
    { label: 'Pin to desktop', type: 'checkbox', checked: !!state.pinned, enabled: pin.available, click: (item) => setPinned(item.checked) },
    { label: 'Start with Windows', type: 'checkbox', checked: getOpenAtLogin(), click: (item) => { setOpenAtLogin(item.checked); notifySettings(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function notifySettings() {
  buildTrayMenu();
  if (win) win.webContents.send('settings-changed', settings());
}

function setPinned(pinned) {
  state.pinned = pinned && pin.available;
  if (state.pinned) pin.enable();
  else pin.disable();
  saveState();
  notifySettings();
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  pin.raise();
  win.focus();
}

// ---------- keyboard shortcut to open the widget from anywhere ----------
function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

// If another app already owns the key combination, Windows refuses it; keep the previous shortcut working then.
function registerHotkey(accelerator) {
  const previous = activeHotkey;
  globalShortcut.unregisterAll();
  activeHotkey = '';
  if (!accelerator) {
    state.hotkey = '';
    saveState();
    return { ok: true, hotkey: '' };
  }
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, toggleWindow);
  } catch {
    ok = false;
  }
  if (ok) {
    activeHotkey = accelerator;
    state.hotkey = accelerator;
    saveState();
    return { ok: true, hotkey: activeHotkey };
  }
  if (previous) {
    try {
      if (globalShortcut.register(previous, toggleWindow)) activeHotkey = previous;
    } catch {}
  }
  return { ok: false, hotkey: activeHotkey };
}

// ---------- window ----------
function createWindow() {
  state = loadState();

  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.max(state.width || 380, 330);
  const height = Math.min(Math.max(state.height || 700, 520), workArea.height - 40);
  let bounds = {
    x: state.x ?? workArea.x + workArea.width - width - 24,
    y: state.y ?? workArea.y + 24,
    width,
    height,
  };
  if (!isOnScreen(bounds) || bounds.y + bounds.height > workArea.y + workArea.height) {
    bounds = { ...bounds, x: Math.min(bounds.x, workArea.x + workArea.width - width - 24), y: workArea.y + 24 };
    if (!isOnScreen(bounds)) bounds.x = workArea.x + workArea.width - width - 24;
  }

  appIcon = makeIcon(32);

  win = new BrowserWindow({
    ...bounds,
    minWidth: 330,
    minHeight: 520,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    show: false,
    icon: appIcon,
    title: 'To-Do Widget',
    backgroundColor: THEME_BG[state.theme] || THEME_BG.light,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Reminders run on timers in the page; don't let Chromium slow them down while hidden.
      backgroundThrottling: false,
    },
  });

  pin = createDesktopPin(win);
  roundCorners(win);

  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    // --hidden starts the widget in the tray without showing it.
    if (app.commandLine.hasSwitch('hidden')) return;
    win.show();
    if (state.pinned) pin.enable();
  });
  // Windows is shutting down or signing out: save right now.
  win.on('session-end', writeDataNow);

  const rememberBounds = () => {
    if (win.isMinimized() || win.isMaximized()) return;
    Object.assign(state, win.getBounds());
    saveState();
  };
  win.on('moved', rememberBounds);
  win.on('resized', rememberBounds);

  // Closing just hides the widget so reminders keep running; quit from the tray.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  tray = new Tray(appIcon);
  tray.setToolTip('To-Do Widget');
  tray.on('click', showWindow);
  buildTrayMenu();
}

// ---------- notifications ----------
const liveNotifications = new Set(); // keep references so click handlers survive garbage collection

ipcMain.on('notify', (_e, payload = {}) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: String(payload.title || 'To-Do Widget'),
    body: String(payload.body || ''),
    silent: !!payload.silent,
    icon: makeIcon(64),
  });
  liveNotifications.add(n);
  const release = () => liveNotifications.delete(n);
  n.on('click', () => {
    showWindow();
    if (payload.view && win) win.webContents.send('navigate', payload.view);
    release();
  });
  n.on('close', release);
  n.on('failed', (_ev, error) => {
    console.warn('Notification failed:', error);
    release();
  });
  n.show();
});

// ---------- prayer times ----------
const PRAYER_KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

ipcMain.handle('prayer:times', (_e, { lat, lon, method, madhab, date } = {}) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new Error('Invalid prayer time request');
  }
  const coords = new adhan.Coordinates(lat, lon);
  const factory = method !== 'Other' && typeof adhan.CalculationMethod[method] === 'function'
    ? adhan.CalculationMethod[method]
    : adhan.CalculationMethod.MuslimWorldLeague;
  const params = factory();
  params.madhab = madhab === 'hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
  params.highLatitudeRule = adhan.HighLatitudeRule.recommended(coords);
  const [y, m, d] = date.split('-').map(Number);
  const times = new adhan.PrayerTimes(coords, new Date(y, m - 1, d), params);
  const out = { qibla: adhan.Qibla(coords) };
  for (const key of PRAYER_KEYS) out[key] = times[key].getTime();
  return out;
});

// City search for the prayer location (Open-Meteo's free geocoding service; only the search text is sent).
ipcMain.handle('geo:search', async (_e, query) => {
  const q = String(query || '').trim().slice(0, 100);
  if (q.length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    name: r.name,
    region: r.admin1 || '',
    country: r.country || '',
    countryCode: r.country_code || '',
    lat: r.latitude,
    lon: r.longitude,
    timezone: r.timezone || null,
  }));
});

// ---------- backup ----------
const backupsDir = () => path.join(app.getPath('userData'), 'backups');
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

ipcMain.handle('backup:save', async (_e, json, suggestedName) => {
  if (typeof json !== 'string') return { ok: false, error: 'Nothing to save' };
  const name = /^[\w.-]+\.json$/.test(String(suggestedName)) ? suggestedName : 'todo-widget-backup.json';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save a backup',
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [{ name: 'To-Do Widget backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  try {
    await fs.promises.writeFile(filePath, json, 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('backup:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Restore from a backup',
    defaultPath: app.getPath('documents'),
    filters: [{ name: 'To-Do Widget backup', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths?.[0]) return { canceled: true };
  try {
    const { size } = await fs.promises.stat(filePaths[0]);
    if (size > MAX_BACKUP_BYTES) return { ok: false, error: 'That file is too large to be a backup.' };
    return { ok: true, text: await fs.promises.readFile(filePaths[0], 'utf8'), path: filePaths[0] };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// One automatic backup per day; keep the newest seven.
ipcMain.handle('backup:auto', async (_e, json, day) => {
  if (typeof json !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return { ok: false };
  const dir = backupsDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `auto-${day}.json`);
  await fs.promises.writeFile(file, json, 'utf8');
  const autos = (await fs.promises.readdir(dir)).filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const old of autos.slice(0, Math.max(0, autos.length - 7))) {
    await fs.promises.unlink(path.join(dir, old)).catch(() => {});
  }
  return { ok: true, path: file };
});

ipcMain.handle('backup:open-folder', async () => {
  await fs.promises.mkdir(backupsDir(), { recursive: true });
  return shell.openPath(backupsDir());
});

// ---------- linked calendars (.ics links from Google, Outlook, iCloud, Canvas, …) ----------
const MAX_CALENDAR_CHARS = 20 * 1024 * 1024;

ipcMain.handle('calendar:fetch', async (_e, url) => {
  let parsed;
  try {
    parsed = new URL(String(url).trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw new Error('That link is not valid.');
  }
  if (parsed.protocol !== 'https:') throw new Error('Calendar links need to start with https:// or webcal://');
  let res;
  try {
    res = await fetch(parsed, { signal: AbortSignal.timeout(20000), headers: { Accept: 'text/calendar, */*' } });
  } catch {
    throw new Error("Couldn't connect. Check your internet connection and the link.");
  }
  if (!res.ok) throw new Error(`The calendar server returned an error (${res.status}). Check the link.`);
  if (Number(res.headers.get('content-length')) > MAX_CALENDAR_CHARS) throw new Error('That calendar is too large to import.');
  const text = await res.text();
  if (text.length > MAX_CALENDAR_CHARS) throw new Error('That calendar is too large to import.');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error("That link didn't return a calendar. Make sure you copied the iCal (.ics) link.");
  return text;
});

// Links from imported events and the Deen tab open in the normal browser; only web links are allowed.
ipcMain.on('open-external', (_e, url) => {
  try {
    if (new URL(String(url)).protocol === 'https:') shell.openExternal(String(url));
  } catch {}
});

// ---------- window IPC ----------
ipcMain.on('win:hide', () => win && win.hide());
ipcMain.on('win:show', showWindow);
ipcMain.handle('win:toggle-pin', () => {
  setPinned(!state.pinned);
  return !!state.pinned;
});
ipcMain.handle('app:get-settings', () => settings());
ipcMain.handle('app:set-login', (_e, on) => {
  setOpenAtLogin(!!on);
  notifySettings();
  return getOpenAtLogin();
});
ipcMain.handle('app:set-hotkey', (_e, accelerator) => {
  const result = registerHotkey(typeof accelerator === 'string' ? accelerator : '');
  notifySettings();
  return result;
});
// While Settings is recording a new shortcut, the current one mustn't fire and hide the window.
ipcMain.on('app:suspend-hotkey', (_e, suspended) => {
  if (suspended) {
    globalShortcut.unregisterAll();
  } else if (activeHotkey && !globalShortcut.isRegistered(activeHotkey)) {
    try {
      globalShortcut.register(activeHotkey, toggleWindow);
    } catch {}
  }
});
ipcMain.on('theme:set', (_e, theme) => {
  if (!THEME_BG[theme]) return;
  state.theme = theme;
  if (win) win.setBackgroundColor(THEME_BG[theme]);
  saveState();
});

// ---------- moving the widget ----------
// The page reports mouse down/up on the header and the window follows the cursor in between.
// This replaces the built-in drag region, whose move could be cancelled when pin-to-desktop
// pushed the window to the back as it got focus.
let drag = null;

function endDrag() {
  if (!drag) return;
  clearInterval(drag.timer);
  clearTimeout(drag.safety);
  drag = null;
  if (win && !win.isDestroyed()) {
    Object.assign(state, win.getBounds());
    saveState();
  }
}

ipcMain.on('drag:start', () => {
  if (!win) return;
  endDrag();
  const start = win.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const offset = { x: cursor.x - start.x, y: cursor.y - start.y };
  let last = { x: start.x, y: start.y };
  drag = {
    timer: setInterval(() => {
      const p = screen.getCursorScreenPoint();
      const next = { x: p.x - offset.x, y: p.y - offset.y };
      if (next.x === last.x && next.y === last.y) return;
      last = next;
      // Keep the original size: moving alone can change it when crossing monitors with different scaling.
      win.setBounds({ ...next, width: start.width, height: start.height });
    }, 1000 / 60),
    // If the page never reports the release (e.g. it reloaded mid-drag), don't leave the window stuck to the cursor.
    safety: setTimeout(endDrag, 60000),
  };
});
ipcMain.on('drag:end', endDrag);

// ---------- lifecycle ----------
app.on('second-instance', showWindow);
app.whenReady().then(() => {
  ensureStartMenuShortcut();
  createWindow();
  // A saved empty string means the user turned the shortcut off; only a missing value gets the default.
  registerHotkey(state.hotkey ?? DEFAULT_HOTKEY);
  buildTrayMenu();
  setupUpdates();
});
app.on('before-quit', () => {
  quitting = true;
  clearTimeout(saveTimer);
  writeState();
  writeDataNow();
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  writeDataNow();
});
app.on('window-all-closed', () => app.quit());
