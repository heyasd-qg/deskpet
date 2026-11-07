const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const characterResources = require('./character-resources.cjs');
characterResources.configure({ publicDir: path.join(__dirname, 'public'), packDir: path.join(app.isPackaged ? path.dirname(process.execPath) : __dirname, 'character-resources') });
const { catalogue, DEFAULTS, normalize, update, character, forSlot } = require('./character-core.cjs');
const zlib = require('node:zlib');
const { InteractionDirector } = require('./interaction-director.cjs');
const interactionData = {}; characterResources.refreshInteractions(interactionData);
const TEST_MODE = process.argv.includes('--self-test');
const debugFile = path.join(__dirname, '..', 'debug.log');
function debug(message) { if (process.argv.includes('--capture')) fs.appendFileSync(debugFile, message + '\n'); }
debug('main-loaded');
process.on('uncaughtException', error => debug(`uncaught: ${error.stack || error}`));
process.on('unhandledRejection', error => debug(`rejection: ${error?.stack || error}`));

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORTABLE_ROOT = app.isPackaged ? path.dirname(process.execPath) : __dirname;
const DATA_DIR = TEST_MODE && process.env.PET_TEST_DATA ? path.resolve(process.env.PET_TEST_DATA) : path.join(PORTABLE_ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
app.setPath('userData', DATA_DIR);
app.setPath('sessionData', DATA_DIR);
const TEMP_DIR = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(TEMP_DIR, { recursive: true });
app.setPath('temp', TEMP_DIR);
const POSITION_FILE = path.join(DATA_DIR, 'pet-position.json');
const { installWorkshop } = require('./workshop-main.cjs');
let workshop;
const SIDE_SPACE = 205;
const BASE_PET_WIDTH = 167;
const BASE_PET_HEIGHT = 173;
const DUAL_CENTER_STEP = 86;
const HEAD_ROOM = 140;
const DEFAULT_SETTINGS = DEFAULTS;
let settings = { ...DEFAULT_SETTINGS };
let petWindow;
let needsActivation = false;
let appBaseUrl;
let settingsWindow;
let dailyTimer;
let dailyState = {};
let tray;
let server;
let cursorTimer;
let dragTimer;
let dragOrigin = null;
const lastIgnore = new WeakMap();
let mediaMonitor;
let mediaBuffer = '';
let mediaState = { playing: false, haruhikage: false, appOpen: false };
let lastCursorPoint;
let lastCursorMovement = Date.now();
let inactive = false;
let desktopMonitor, desktopBuffer = '', interactionTimer, director, quitting = false;
let desktopState = { idleMs: 0, fullscreen: false, rect: null }, lastDesktopReport = 0, fullscreenHidden = false, lastTopRefresh = 0;
const scenes = {}, interactionWaiters = new Map();

function endInteraction(group, immediate = false) {
  sendAllPets('interaction-end', { group, immediate });
  for (const [id, item] of interactionWaiters) if (item.group === group) { clearTimeout(item.timer); interactionWaiters.delete(id); item.reject(new Error('Interaction cancelled')); }
}
function transportInteraction(slot, command) {
  const entry = petEntries().find(item => item.slot === slot);
  if (!entry || entry.win.webContents.isLoading()) return Promise.reject(new Error('Character not ready'));
  return new Promise((resolve, reject) => {
    const id = `${command.group}/${command.phase}/${slot}`;
    const timer = setTimeout(() => { interactionWaiters.delete(id); reject(new Error('Interaction timed out')); }, 45000);
    interactionWaiters.set(id, { group: command.group, slot, resolve, reject, timer });
    sendSlot(slot, 'interaction-command', { ...command, requestId: id });
  });
}
function interactionContext() { return { dualEnabled: settings.dualEnabled && catalogue.length > 0, locked: settings.displayLocked,
  idle: (lastDesktopReport ? desktopState.idleMs : Date.now() - lastCursorMovement) >= 15000,
  left: settings.dualLeft, right: settings.dualRight, scenes }; }
function sendActivity() { sendAllPets('activity-state', { inactive: settings.displayLocked || (settings.dualEnabled ? interactionContext().idle : inactive), appOpen: mediaState.appOpen }); }
function applyDisplayState() {
  const all = petWindows(); if (!all.length) return;
  const size = petSize(), b = petWindow.getBounds(), r = desktopState.rect;
  const covered = desktopState.fullscreen && r && b.x + SIDE_SPACE + size.groupWidth > r.x && b.x + SIDE_SPACE < r.x + r.width && b.y + b.height > r.y && b.y + b.height - size.petHeight < r.y + r.height;
  const hide = !settings.displayLocked && !!covered;
  if (hide !== fullscreenHidden) { fullscreenHidden = hide; for (const win of all) { if (hide) win.hide(); else if (!TEST_MODE) win.showInactive(); } }
  const refresh = settings.displayLocked && Date.now() - lastTopRefresh > 1250;
  for (const win of all) {
    if (win.petLocked !== settings.displayLocked) win.setMovable(!settings.displayLocked);
    if (win.petLocked !== settings.displayLocked || refresh) { win.setAlwaysOnTop(true, settings.displayLocked ? 'screen-saver' : 'floating'); win.petLocked = settings.displayLocked; if (settings.displayLocked && !TEST_MODE) win.moveTop(); }
    if (hide && win.isVisible()) win.hide();
  }
  if (refresh) lastTopRefresh = Date.now();
}
function acceptDesktopState(next, physical = false) {
  if (!Number.isFinite(next.idleMs) || typeof next.fullscreen !== 'boolean') return;
  const rect = next.rect;
  desktopState = { idleMs: Math.max(0, next.idleMs), fullscreen: next.fullscreen,
    rect: rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 ? physical ? screen.screenToDipRect(null, rect) : rect : null };
  lastDesktopReport = Date.now(); sendActivity(); applyDisplayState(); director?.poll();
}
function startDesktopMonitor() {
  desktopBuffer = '';
  const script = fs.readFileSync(path.join(__dirname, 'desktop-monitor.ps1'), 'utf8');
  desktopMonitor = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, env: { ...process.env, PET_OWNER_PID: String(process.pid), TEMP: TEMP_DIR, TMP: TEMP_DIR }, stdio: ['ignore', 'pipe', 'pipe'] });
  desktopMonitor.stdout.on('data', bytes => { desktopBuffer += bytes.toString(); const lines = desktopBuffer.split(/\r?\n/); desktopBuffer = lines.pop(); for (const line of lines) { try { acceptDesktopState(JSON.parse(line), true); } catch(error) { debug('desktop-state: ' + error.message); } } });
  desktopMonitor.stderr.on('data', bytes => debug('desktop-monitor: ' + bytes.toString()));
  desktopMonitor.on('error', error => debug('desktop-monitor: ' + error.message));
  desktopMonitor.on('close', () => { if (!quitting) { lastDesktopReport = 0; setTimeout(() => { if (!quitting) startDesktopMonitor(); }, 1500); } });
}

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch {}
  settings = normalize(input);
}
function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}
function broadcastSettings() {
  if (petWindows().length) petWindow.webContents.send('pet-layout', petLayout());
  for (const { slot } of petEntries()) sendSlot(slot, 'settings-changed', forSlot(settings, slot));
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('settings-changed', settings);
}
function petWindows() { return petWindow && !petWindow.isDestroyed() ? [petWindow] : []; }
function petEntries() { return petWindows().length ? (settings.dualEnabled ? ['left', 'right'] : ['left']).map(slot => ({ win: petWindow, slot })) : []; }
function petEntry(sender, slot = 'left') { return petEntries().find(item => item.win.webContents === sender && item.slot === slot); }
function petLayout() { return { settings, profiles: Object.fromEntries(petEntries().map(({ slot }) => [slot, forSlot(settings, slot)])) }; }
function sendSlot(slot, channel, value) { if (petEntries().some(item => item.slot === slot) && !petWindow.webContents.isLoading()) petWindow.webContents.send(channel, { slot, value }); }
function sendAllPets(channel, value) { for (const { slot } of petEntries()) sendSlot(slot, channel, value); }

function startServer() {
  const types = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.webp': 'image/webp', '.png': 'image/png', '.moc3': 'application/octet-stream', '.opus': 'audio/ogg'
  };
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
      catch { res.writeHead(400).end(); return; }
      if (pathname.startsWith('/user-assets/')) { workshop.serveAsset(pathname, res); return; }
      if (pathname === '/interaction-data.json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(interactionData)); return;
      }
      const roleFile = characterResources.resolveAsset(pathname);
      const file = roleFile || path.resolve(PUBLIC_DIR, '.' + pathname);
      if (pathname.startsWith('/chat.') || !roleFile && !file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403).end(); return; }
      if (pathname === '/image-lab/builtin.js' && !fs.existsSync(file)) {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end('window.BUILTIN_IMAGE = null;'); return;
      }
      fs.stat(file, (err, stat) => {
        const compressed = err && roleFile && /\.(moc3|json)$/.test(file) && fs.existsSync(file + '.gz');
        if (!compressed && (err || !stat.isFile())) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        const stream = fs.createReadStream(compressed ? file + '.gz' : file);
        stream.on('error', () => res.destroy());
        if (compressed) { const decoder = zlib.createGunzip(); decoder.on('error', () => res.destroy()); stream.pipe(decoder).pipe(res); }
        else stream.pipe(res);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function openSettings(baseUrl, page = settings.dualEnabled ? 'dual' : 'character') {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (!TEST_MODE) { settingsWindow.show(); settingsWindow.focus(); }
    if (settingsWindow.webContents.isLoading()) settingsWindow.webContents.once('did-finish-load', () => settingsWindow?.webContents.send('settings-page', page));
    else settingsWindow.webContents.send('settings-page', page);
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 900, height: 700, minWidth: 780, minHeight: 560,
    show: !TEST_MODE, title: '邦多利桌宠 · 设置', autoHideMenuBar: true,
    backgroundColor: '#171326',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !TEST_MODE }
  });
  settingsWindow.loadURL(`${baseUrl}/settings.html`);
  settingsWindow.webContents.once('did-finish-load', () => settingsWindow?.webContents.send('settings-page', page));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function reconcilePetWindow(activate = false) {
  if (!catalogue.length) {
    needsActivation = true;
    workshop.open();
    endDrag();
    const previous = petWindow; petWindow = null;
    previous?.destroy();
    for (const slot of Object.keys(scenes)) delete scenes[slot];
    return;
  }
  if (activate) needsActivation = false;
  if (needsActivation) return;
  if (!petWindows().length) { fullscreenHidden = false; createPet(appBaseUrl); }
  else { resizePet(); petWindow.webContents.reload(); }
}

function sendPet(channel, value) {
  sendSlot('left', channel, value);
}

function isQuietTime(now) {
  const minute = now.getHours() * 60 + now.getMinutes();
  const toMinute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const start = toMinute(settings.quietStart), end = toMinute(settings.quietEnd);
  return start === end ? false : start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function checkDailyNotice() {
  if (!petWindow || petWindow.isDestroyed() || mediaState.playing || director?.busy || isQuietTime(new Date())) return;
  const now = new Date();
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const hour = now.getHours();
  const greeting = hour >= 5 && hour < 11 ? '早安' : hour >= 11 && hour < 18 ? '午安' : hour >= 18 && hour < 24 ? '晚安' : null;
  const period = hour < 11 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  if (settings.greetingsEnabled && greeting && dailyState[period] !== day) {
    sendPet('daily-notice', { id: `${day}:${period}`, kind: 'greeting', text: `${greeting}。今天也请照顾好自己。` });
    return;
  }
  const hourKey = `${day}:${hour}`;
  if (settings.hourlyChime && now.getMinutes() <= 5 && dailyState.hour !== hourKey) {
    sendPet('daily-notice', { id: hourKey, kind: 'hour', text: `现在是${hour}点。` });
  }
}

function petSize() {
  const factor = settings.sizePercent / 100;
  const petWidth = Math.round(BASE_PET_WIDTH * factor);
  const petHeight = Math.round(BASE_PET_HEIGHT * factor);
  const gap = Math.round(DUAL_CENTER_STEP * factor) - petWidth;
  const groupWidth = settings.dualEnabled ? petWidth * 2 + gap : petWidth;
  return { petWidth, petHeight, gap, groupWidth, width: SIDE_SPACE * 2 + groupWidth, height: petHeight + HEAD_ROOM };
}

function readPetPosition() {
  try {
    const position = JSON.parse(fs.readFileSync(POSITION_FILE, 'utf8'));
    if (Number.isInteger(position.x) && Number.isInteger(position.y)) return position;
  } catch {}
  return null;
}

function savePetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const { x, y, height } = petWindow.getBounds();
  fs.writeFileSync(POSITION_FILE, JSON.stringify({ x, y, height, bodyBottom: y + height }));
}

function fitPetOnScreen(bounds) {
  const { groupWidth: petWidth, petHeight } = petSize();
  const body = { x: bounds.x + SIDE_SPACE, y: bounds.y + bounds.height - petHeight, width: petWidth, height: petHeight };
  let chosen = screen.getPrimaryDisplay();
  let overlap = 0;
  for (const display of screen.getAllDisplays()) {
    const area = display.workArea;
    const width = Math.max(0, Math.min(body.x + body.width, area.x + area.width) - Math.max(body.x, area.x));
    const height = Math.max(0, Math.min(body.y + body.height, area.y + area.height) - Math.max(body.y, area.y));
    if (width * height > overlap) { overlap = width * height; chosen = display; }
  }
  const work = chosen.workArea;
  const proposedX = overlap ? body.x : work.x + work.width - petWidth - 28;
  const proposedY = overlap ? body.y : work.y + work.height - petHeight - 18;
  const bodyX = Math.max(work.x, Math.min(proposedX, work.x + Math.max(0, work.width - petWidth)));
  const headRoom = Math.min(HEAD_ROOM, Math.max(0, work.height - petHeight));
  const bodyY = Math.max(work.y + headRoom, Math.min(proposedY, work.y + Math.max(0, work.height - petHeight)));
  return { ...bounds, x: Math.round(bodyX - SIDE_SPACE), y: Math.round(bodyY - bounds.height + petHeight) };
}

function keepPetOnScreen() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const before = petWindow.getBounds();
  const after = fitPetOnScreen(before);
  if (before.x !== after.x || before.y !== after.y) {
    petWindow.setBounds(after);
    savePetPosition();
  }
}

function updateBubbleSide() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const { petWidth, petHeight } = petSize();
  for (const { win, slot } of petEntries()) {
    const offset = slot === 'right' ? petSize().petWidth + petSize().gap : 0;
    const b = win.getBounds(), body = { x: b.x + offset + SIDE_SPACE, y: b.y + b.height - petHeight, width: petWidth, height: petHeight };
    const work = screen.getDisplayMatching(body).workArea, width = Math.min(220, work.width - 16);
    const center = Math.max(work.x + width / 2 + 8, Math.min(body.x + petWidth / 2, work.x + work.width - width / 2 - 8));
    sendSlot(slot, 'bubble-side', { left: center - b.x - offset - width / 2, width });
  }
}
function resizePet(wasDual = settings.dualEnabled) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const old = petWindow.getBounds();
  const oldGroupWidth = old.width - SIDE_SPACE * 2;
  const centerX = old.x + SIDE_SPACE + oldGroupWidth / 2;
  const bottomY = old.y + old.height;
  const next = petSize();
  petWindow.setBounds(fitPetOnScreen({
    x: Math.round(centerX - SIDE_SPACE - next.groupWidth / 2),
    y: Math.round(bottomY - next.height),
    width: next.width, height: next.height
  }));
  savePetPosition();
  updateBubbleSide();
}

function createPet(baseUrl) {
  const work = screen.getPrimaryDisplay().workArea;
  const { width, height, petWidth } = petSize();
  const saved = readPetPosition();
  let bounds = fitPetOnScreen({
    x: saved?.x ?? work.x + work.width - SIDE_SPACE - petWidth - 28,
    y: saved ? (saved.bodyBottom ?? saved.y + (saved.height ?? Math.max(210, petSize().petHeight))) - height : work.y + work.height - height - 18,
    width, height
  });
  const win = new BrowserWindow({
    ...bounds, transparent: true, frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: false, hasShadow: false,
    backgroundColor: '#00000000', title: '邦多利桌宠', show: !TEST_MODE,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !TEST_MODE, offscreen: TEST_MODE }
  });
  petWindow = win;
  if (TEST_MODE) { win.webContents.setFrameRate(30); win.webContents.startPainting(); }
  win.setAlwaysOnTop(true, settings.displayLocked ? 'screen-saver' : 'floating');
  win.setMovable(!settings.displayLocked);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadURL(`${baseUrl}/pet-host.html`);
  win.webContents.on('did-fail-load', (_event, code, description) => debug(`load failed ${code}: ${description}`));
  win.on('move', updateBubbleSide);
  win.webContents.on('did-finish-load', updateBubbleSide);
  win.on('closed', () => { if (petWindow === win) { petWindow = null; app.quit(); } });
}

function startCursorTracking() {
  cursorTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    if (!lastCursorPoint || p.x !== lastCursorPoint.x || p.y !== lastCursorPoint.y) {
      lastCursorMovement = Date.now();
      lastCursorPoint = p;
      if (inactive) { inactive = false; sendActivity(); }
    } else if (!inactive && Date.now() - lastCursorMovement >= 30000) {
      inactive = true;
      sendActivity();
    }
    const win = petWindow, b = win.getBounds();
    const x = p.x - b.x, y = p.y - b.y;
    const { petWidth, petHeight, groupWidth, gap } = petSize();
    const petTop = b.height - petHeight;
    const bodyY = y - petTop - petHeight * .54;
    const inside = x >= 0 && y >= 0 && x < b.width && y < b.height;
    const inBody = inside && petEntries().some(({slot}) => {
      const offset = slot === 'right' ? petWidth + gap : 0, bodyX = x - SIDE_SPACE - offset - petWidth / 2;
      return Math.pow(bodyX / (petWidth * .45), 2) + Math.pow(bodyY / (petHeight * .56), 2) < 1.15;
    });
    const inToolbar = inside && x >= SIDE_SPACE + groupWidth - 52 && x <= SIDE_SPACE + groupWidth && y >= petTop && y < petTop + 29;
    const ignore = !(inBody || inToolbar || dragOrigin);
    if (ignore !== lastIgnore.get(win)) {
      win.setIgnoreMouseEvents(ignore, { forward: true });
      lastIgnore.set(win, ignore);
    }
    for (const { slot } of petEntries()) {
    const bodyX = x - SIDE_SPACE - (slot === 'right' ? petWidth + gap : 0) - petWidth / 2;
    sendSlot(slot, 'cursor', process.argv.includes('--look-left') ? { x: -1, y: 0 } : {
      x: Math.max(-1, Math.min(1, bodyX / (petWidth * .86))),
      y: Math.max(-1, Math.min(1, ((b.y + petTop + petHeight * .36) - p.y) / (petHeight * .6)))
    });
    }
  }, 50);
}

function startMediaMonitor() {
  const script = fs.readFileSync(path.join(__dirname, 'media-monitor.ps1'), 'utf8');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const temp = path.join(DATA_DIR, 'tmp');
  fs.mkdirSync(temp, { recursive: true });
  mediaMonitor = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true, env: { ...process.env, TEMP: temp, TMP: temp }, stdio: ['ignore', 'pipe', 'ignore']
  });
  mediaMonitor.stdout.on('data', data => {
    mediaBuffer += data.toString();
    const lines = mediaBuffer.split(/\r?\n/);
    mediaBuffer = lines.pop();
    for (const line of lines) {
      try {
        const next = JSON.parse(line);
        if (typeof next.playing !== 'boolean' || typeof next.haruhikage !== 'boolean' || typeof next.appOpen !== 'boolean') continue;
        mediaState = next;
        if (petWindow && !petWindow.isDestroyed()) {
          sendAllPets('media-state', { playing: next.playing, haruhikage: next.haruhikage });
          sendActivity();
        }
      } catch {}
    }
  });
  mediaMonitor.on('error', error => debug(`media-monitor: ${error.message}`));
}

function beginDrag() {
  if (settings.displayLocked || dragOrigin || !petWindow || petWindow.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  dragOrigin = { cursor: { ...cursor }, lastCursor: { ...cursor }, bounds: petWindow.getBounds(), windows: petWindows().map(win => ({ win, bounds: win.getBounds() })) };
  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!dragOrigin || !petWindow || petWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    if (cursor.x === dragOrigin.lastCursor.x && cursor.y === dragOrigin.lastCursor.y) return;
    dragOrigin.lastCursor = { ...cursor };
    for (const item of dragOrigin.windows) {
      if (item.win.isDestroyed()) continue;
      const x = item.bounds.x + cursor.x - dragOrigin.cursor.x, y = item.bounds.y + cursor.y - dragOrigin.cursor.y;
      const current = item.win.getBounds();
      if (current.x !== x || current.y !== y) item.win.setPosition(x, y);
    }
  }, 16);
}

function endDrag() {
  const origin = dragOrigin;
  dragOrigin = null;
  clearInterval(dragTimer);
  dragTimer = null;
  if (origin && petWindow && !petWindow.isDestroyed()) {
    const current = petWindow.getBounds();
    if (current.x !== origin.bounds.x || current.y !== origin.bounds.y) {
      petWindow.setBounds(fitPetOnScreen(current));
      savePetPosition();
    }
  }
}

app.whenReady().then(async () => {
  debug('ready');
  workshop = installWorkshop({ app, BrowserWindow, ipcMain, DATA_DIR, PUBLIC_DIR, PORTABLE_ROOT,
    openURL: () => appBaseUrl,
    dispatch: (key, message) => sendAllPets('character-command',{key,...message}),
    refresh: () => {
      director?.cancel('character library changed');
      characterResources.refreshInteractions(interactionData);
      settings = normalize(settings); saveSettings(); director?.configure();
      reconcilePetWindow(); settingsWindow?.webContents.reload();
    },
    activate: (key,slot='single') => {
      director?.cancel('activate imported character');
      const wasDual = settings.dualEnabled; settings.dualEnabled = slot!=='single';
      settings = update(settings,slot==='single'?'character':slot==='left'?'dualLeft.character':'dualRight.character', key); saveSettings();
      if (!petWindows().length) reconcilePetWindow(true);
      if (wasDual!==settings.dualEnabled) resizePet(wasDual); director?.configure(); broadcastSettings();
    }
  });
  loadSettings();
  try { dailyState = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'daily-state.json'), 'utf8')); } catch { dailyState = {}; }
  if (process.argv.includes('--eyes-closed')) settings.eyesOpen = false;
  if (process.argv.includes('--no-follow')) settings.followMouse = false;
  if (process.argv.includes('--capture-no-mask')) settings.performanceMask = false;
  if (process.argv.includes('--capture-mask-on')) settings.maskOn = true;
  debug('settings-loaded');
  const baseUrl = await startServer();
  appBaseUrl = baseUrl;
  debug('server-started');
  needsActivation = !catalogue.length;
  if (!needsActivation) createPet(baseUrl);
  director = new InteractionDirector({ data: interactionData, catalogue, context: interactionContext, transport: transportInteraction, end: endInteraction });
  director.configure();
  debug('pet-created');
  if (!TEST_MODE) {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'public', 'tray.png'));
  tray = new Tray(icon);
  debug('tray-created');
  tray.setToolTip('Deskpet Plus · Beta');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '设置', click: () => openSettings(baseUrl) },
    { label: '角色工坊 · Beta', click: () => workshop.open() },
    { label: '现在几点', click: () => sendPet('daily-notice', { id: `manual:${Date.now()}`, kind: 'hour', text: `现在是${new Date().getHours()}点${new Date().getMinutes()}分。`, manual: true }) },
    { label: '显示桌宠', click: () => { if (!catalogue.length) { workshop.open(); return; } if (!petWindows().length) reconcilePetWindow(true); petWindow.show(); petWindow.focus(); } },
    { type: 'separator' }, { label: '退出', click: () => app.quit() }
  ]));
  tray.on('double-click', () => openSettings(baseUrl));
  }
  if (!TEST_MODE) startCursorTracking();
  if (!TEST_MODE) startMediaMonitor();
  if (!TEST_MODE) startDesktopMonitor();
  if (!TEST_MODE) interactionTimer = setInterval(() => { director.poll(); applyDisplayState(); }, 250);
  if (!TEST_MODE) { dailyTimer = setInterval(checkDailyNotice, 60000); setTimeout(checkDailyNotice, 12000); }
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, keepPetOnScreen);
  }

  ipcMain.handle('get-settings', (event, slot) => { const entry = petEntry(event.sender, slot); return slot && entry ? forSlot(settings, entry.slot) : settings; });
  ipcMain.handle('get-pet-layout', event => petEntry(event.sender) ? petLayout() : null);
  ipcMain.handle('get-characters', () => catalogue);
  ipcMain.handle('set-setting', (_event, key, value) => {
    const wasDual = settings.dualEnabled, wasLocked = settings.displayLocked;
    if (key === 'dualEnabled' || key === 'sizePercent' || key === 'displayLocked') endDrag();
    settings = update(settings, key, value);
    if (!petWindows().length && catalogue.length && (key === 'character' || /^(dualLeft|dualRight)\.character$/.test(key) || key === 'dualEnabled' && value)) reconcilePetWindow(true);
    if (key === 'sizePercent' || wasDual !== settings.dualEnabled) resizePet(wasDual);
    if (wasDual !== settings.dualEnabled) { delete scenes.left; delete scenes.right; }
    director.configure(); if (!wasLocked && settings.displayLocked) director.nextAt = Date.now();
    saveSettings(); broadcastSettings(); sendActivity(); applyDisplayState(); return settings;
  });
  ipcMain.on('open-settings', () => openSettings(baseUrl));
  ipcMain.on('open-workshop', event => { if (event.sender === settingsWindow?.webContents || event.sender === petWindow?.webContents) workshop.open(); });
  ipcMain.on('hide-settings', () => settingsWindow?.hide());
  ipcMain.on('daily-notice-result', (event, value) => {
    if (event.sender !== petWindow?.webContents || !value?.accepted || value.manual) return;
    const [day, period] = String(value.id || '').split(':');
    if (period === 'morning' || period === 'afternoon' || period === 'evening') dailyState[period] = day;
    else dailyState.hour = value.id;
    fs.writeFileSync(path.join(DATA_DIR, 'daily-state.json'), JSON.stringify(dailyState));
  });
  ipcMain.on('begin-drag', event => { if (petEntry(event.sender)) beginDrag(); });
  ipcMain.on('end-drag', event => { if (petEntry(event.sender)) endDrag(); });
  ipcMain.on('quit', () => app.quit());
  ipcMain.handle('preview-action', (event, kind, motion, slot) => {
    const entry = petEntries().find(item => item.slot === (settings.dualEnabled && slot === 'right' ? 'right' : 'left'));
    const target = entry?.win, profile = forSlot(settings, entry?.slot);
    const selected = character(profile.character)?.outfits.find(o => o.key === profile.outfit);
    const allowed = selected?.motions.map(m => m.name) || [];
    if (event.sender !== settingsWindow?.webContents || !['performance', 'mask', 'idle', 'stop'].includes(kind) ||
        (kind === 'idle' && !allowed.includes(motion)) || !target || target.isDestroyed() || target.webContents.isLoading()) {
      return { ok: false, message: '桌宠尚未准备好，请稍后重试。' };
    }
    director.cancel('manual preview'); director.pending = false;
    sendSlot(entry.slot, 'preview-action', { kind, motion });
    return { ok: true };
  });
  ipcMain.on('preview-status', (event, state) => {
    const entry = petEntry(event.sender, state?.slot);
    if (entry && settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('preview-status', { ...state, slot: entry.slot });
    }
  });
  ipcMain.on('pet-ready', (event, details) => {
    const entry = petEntry(event.sender, details?.slot); if (!entry) return;
    updateBubbleSide();
    sendSlot(entry.slot, 'media-state', { playing: mediaState.playing, haruhikage: mediaState.haruhikage });
    sendActivity(); applyDisplayState();
    debug(JSON.stringify(details));
  });
  ipcMain.on('profile-status', (event, value) => {
    const entry = petEntry(event.sender, value?.slot); if (!entry) return;
    settingsWindow?.webContents.send('profile-status', { ...value, slot: entry.slot });
  });
  ipcMain.on('scene-status', (event, value) => {
    const entry = petEntry(event.sender, value?.slot); if (!entry || !value || typeof value.ready !== 'boolean') return;
    scenes[entry.slot] = { ready: value.ready, character: value.character, outfit: value.outfit, performing: !!value.performing };
    director.poll();
  });
  ipcMain.on('interaction-done', (event, value) => {
    const entry = petEntry(event.sender, value?.slot), item = interactionWaiters.get(value?.requestId);
    if (!entry || !item || item.slot !== entry.slot) return;
    clearTimeout(item.timer); interactionWaiters.delete(value.requestId);
    if (value.ok) item.resolve(); else item.reject(new Error(value.error || 'Character interaction interrupted'));
  });
  if (TEST_MODE) module.exports.test = {
    windows: () => ({ pet: petWindow, right: null, settings: settingsWindow }),
    openSettings: () => openSettings(baseUrl), settings: () => settings,
    forceBounds: bounds => petWindow.setBounds(bounds), beginDrag, endDrag, trackCursor: startCursorTracking,
    desktop: acceptDesktopState, director: () => director, display: () => ({ hidden: fullscreenHidden, desktop: desktopState }),
    media: value => { mediaState = { ...mediaState, ...value }; sendAllPets('media-state', value); }
    ,workshop: () => workshop
    ,resources: () => characterResources.status(), interactionData: () => interactionData
  };
  if (!TEST_MODE && (needsActivation || process.argv.includes('--workshop'))) workshop.open();
});

app.on('before-quit', () => { quitting = true; if (cursorTimer) clearInterval(cursorTimer); if (dailyTimer) clearInterval(dailyTimer); if (interactionTimer) clearInterval(interactionTimer); director?.cancel('exit'); endDrag(); mediaMonitor?.kill(); desktopMonitor?.kill(); server?.close(); });
app.on('window-all-closed', () => { if (!tray) app.quit(); });
