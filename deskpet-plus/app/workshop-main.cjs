'use strict';
const fs = require('node:fs'), path = require('node:path');
const { dialog, shell } = require('electron');
const { CharacterLibrary, inside } = require('./character-library.cjs');
const { ProductionEngine } = require('./production-engine.cjs');
const { setCustomCharacters, reloadBuiltinCharacters, getBuiltinState, catalogue } = require('./character-core.cjs');
const { scanCustom } = require('./character-availability.cjs');
const characterResources = require('./character-resources.cjs');
function installWorkshop({ app, BrowserWindow, ipcMain, DATA_DIR, PUBLIC_DIR, PORTABLE_ROOT, openURL, refresh, activate, dispatch }) {
  const library = new CharacterLibrary(DATA_DIR), engine = new ProductionEngine(DATA_DIR, path.resolve(PORTABLE_ROOT, '../../tools'));
  let customState, window, verificationTask, verificationAbort;
  let verificationState = { running: false, done: 0, total: 0, percent: 0 };
  const verificationProgress = state => {
    verificationState = state;
    if (window && !window.isDestroyed()) window.webContents.send('resource-verification', state);
  };
  function verifyResources() {
    if (verificationTask) return verificationTask;
    verificationAbort = new AbortController();
    verificationProgress({ running: true, done: 0, total: 0, percent: 0 });
    verificationTask = characterResources.verifyPackAsync(characterResources.activeRoot(), { signal: verificationAbort.signal, onProgress: verificationProgress })
      .catch(error => { verificationProgress({ ...verificationState, running: false, error: error.message }); throw error; })
      .finally(() => { verificationTask = null; verificationAbort = null; });
    return verificationTask;
  }
  const updateCatalogue = () => { customState = scanCustom(library.items, library.root); setCustomCharacters(customState.characters); };
  updateCatalogue();
  const availability = () => ({ builtinCount: getBuiltinState().characters.length, customCount: customState.characters.length,
    total: catalogue.length, resources: characterResources.status(), issues: [...getBuiltinState().issues, ...customState.issues] });
  const sync = () => { updateCatalogue(); refresh(); };
  function open() {
    if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
    window = new BrowserWindow({ width: 1180, height: 820, minWidth: 960, minHeight: 660, show: !process.argv.includes('--self-test'), title: 'Deskpet Plus · 角色工坊 Beta', autoHideMenuBar: true, backgroundColor: '#171326',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.loadURL(openURL() + '/workshop.html'); window.on('closed', () => { window = null; verificationAbort?.abort(); });
  }
  const choose = async (options) => {
    const selection = await dialog.showOpenDialog(window, options); return selection.canceled ? null : selection.filePaths[0];
  };
  async function call(op, args = {}) {
    switch (op) {
      case 'state': return { items: library.items, config: engine.config, jobs: engine.jobs, engine: engine.status(), migrationErrors:library.migrationErrors, availability: availability(), verification: verificationState };
      case 'refresh-library': reloadBuiltinCharacters(); sync(); return availability();
      case 'verify-resource-pack': return verifyResources();
      case 'cancel-resource-verification': verificationAbort?.abort(); return true;
      case 'control': {
        const state=library.control(args.key,args.command);updateCatalogue();dispatch?.(args.key,{command:args.command,state});return state;
      }
      case 'rescan': {const item=library.rescan(args.key);sync();return item;}
      case 'framing': {
        const item=library.update(args.key,{framing:args.framing});updateCatalogue();dispatch?.(args.key,{framing:item.outfits[0].framing});return item.outfits[0].framing;
      }
      case 'prepare': {
        const source = await choose(args.kind === 'folder' ? { title: '选择包含模型入口、MOC3 和贴图的文件夹', properties: ['openDirectory'] } : { title: '选择 Live2D 模型 ZIP', properties: ['openFile'], filters: [{ name: '角色资源', extensions: ['zip'] }] });
        return source ? library.prepare(source) : null;
      }
      case 'discard': library.discard(args.token); return true;
      case 'commit': { const result = library.commit(args.token, args.candidate, args.name); sync(); return result; }
      case 'update': { const result = library.update(args.key, args.changes); sync(); return result; }
      case 'activate': if (!customState.characters.some(c => c.key === args.key)) throw Error('角色资源不可用，请恢复素材后刷新角色库。'); if(args.slot&&!['single','left','right'].includes(args.slot))throw Error('桌面位置无效。');activate(args.key,args.slot); return true;
      case 'remove': {
        const item = library.items.find(c => c.key === args.key); if (!item) throw Error('角色不存在。');
        const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['保留', '移出角色库'], defaultId: 0, cancelId: 0, message: '移出“' + item.name + '”？', detail: '原始导入文件不受影响，副本素材保留在本机 _trash 文件夹。' });
        if (result.response !== 1) return false; library.remove(args.key); sync(); return true;
      }
      case 'select-engine': {
        const file = await choose({ title: '选择 PSD2Live 便携版程序', properties: ['openFile'], filters: [{ name: 'PSD2Live', extensions: ['exe'] }] });
        if (file) engine.saveConfig({ executable: file }); return engine.config;
      }
      case 'select-java': {
        const file = await choose({ title: '选择 Java 21 或更高版本的 java.exe', properties: ['openFile'], filters: [{ name: 'Java', extensions: ['exe'] }] });
        if (file) engine.saveConfig({ java: file, executable: '' }); return engine.config;
      }
      case 'generate': {
        const file = await choose({ title: '选择分层 PSD 或 PSD2Live 工程', properties: ['openFile'], filters: [{ name: '角色制作素材', extensions: ['psd', 'psd2live'] }] });
        return file ? engine.start(file) : null;
      }
      case 'cancel-job': engine.cancel(); return true;
      case 'import-job': { const job = engine.jobs.find(j => j.id === args.id); if (!job || job.status !== 'complete') throw Error('任务尚未生成模型。'); return library.prepare(job.output); }
      case 'open-job': { const job = engine.jobs.find(j => j.id === args.id); if (!job) throw Error('任务不存在。'); await shell.openPath(path.dirname(job.source)); return true; }
      case 'open-editor': engine.openEditor(); return true;
      case 'open-image-lab': {
        const w = new BrowserWindow({ width: 1180, height: 820, title: '单图动作试验', autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
        w.loadURL(openURL() + '/image-lab/index.html'); return true;
      }
      default: throw Error('未知操作。');
    }
  }
  ipcMain.handle('workshop-call', async (event, op, args) => {
    if (event.sender !== window?.webContents) return { ok: false, error: '请从角色工坊操作。' };
    try { return { ok: true, value: await call(op, args) }; } catch (error) { return { ok: false, error: error.message }; }
  });
  function serveAsset(url, response) {
    try {
      const relative = url.slice('/user-assets/'.length), key = relative.split('/')[0];
      if (!library.items.some(c => c.key === key)) throw Error('Unknown character');
      const file = inside(inside(library.root, key), relative.slice(key.length + 1)), ext = path.extname(file).toLowerCase();
      const types = { '.json': 'application/json', '.moc3': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg' };
      if (!types[ext] || !fs.statSync(file).isFile()) throw Error('Unsupported asset');
      response.setHeader('Content-Type', types[ext]); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
      fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch { response.writeHead(404).end(); }
  }
  app.on('before-quit', () => { verificationAbort?.abort(); engine.cancel(); });
  return { open, serveAsset, library, engine, call, getWindow: () => window };
}
module.exports = { installWorkshop };
