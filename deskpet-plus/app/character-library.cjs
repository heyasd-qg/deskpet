'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { randomUUID } = require('node:crypto');
const { enrichModel } = require('./resource-catalog.cjs');
const { defaultState, reduceState } = require('./public/character-controls.js');
const LIMIT = 768 * 1024 * 1024, FILE_LIMIT = 128 * 1024 * 1024;
const allowed = new Set(['.json', '.moc3', '.png', '.jpg', '.jpeg', '.webp', '.wav', '.mp3', '.ogg', '.opus', '.gz']);
function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\x00-\x1f:]/.test(relative) || /^[\\/]/.test(relative)) throw Error('资源路径无效：' + relative);
  const full = path.resolve(root, relative.replaceAll('/', path.sep).replaceAll('\\', path.sep));
  if (!full.startsWith(path.resolve(root) + path.sep)) throw Error('资源路径超出所选目录，请选择包含共用贴图和 assets 的上级角色文件夹：' + relative);
  return full;
}
function walk(root, relative = '', result = []) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const rel = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw Error('资源中包含链接，请先改为普通文件。');
    if (entry.isDirectory()) walk(root, rel, result);
    else if (entry.isFile()) result.push(rel);
    if (result.length > 10000) throw Error('文件数超过 10000，请只选择角色资源目录。');
  }
  return result;
}
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(value, null, 2)); fs.renameSync(tmp, file);
}
function crc32(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) { n ^= b; for (let k = 0; k < 8; k++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); }
  return (n ^ 0xffffffff) >>> 0;
}
function extractZip(file, target) {
  if (fs.statSync(file).size > LIMIT) throw Error('ZIP 超过 768MB，请只保留角色资源。');
  const b = fs.readFileSync(file); let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { end = i; break; }
  if (end < 0 || b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6)) throw Error('不是支持的单卷 ZIP 文件。');
  const count = b.readUInt16LE(end + 10); let cursor = b.readUInt32LE(end + 16), total = 0;
  if (count === 65535 || count > 10000 || b.readUInt32LE(end + 12) === 0xffffffff) throw Error('暂不支持 ZIP64 或超过 10000 项的压缩包。');
  const names = new Set();
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > end || b.readUInt32LE(cursor) !== 0x02014b50) throw Error('ZIP 目录损坏。');
    const flags = b.readUInt16LE(cursor + 8), method = b.readUInt16LE(cursor + 10), crc = b.readUInt32LE(cursor + 16);
    const packed = b.readUInt32LE(cursor + 20), size = b.readUInt32LE(cursor + 24), nl = b.readUInt16LE(cursor + 28);
    const offset = b.readUInt32LE(cursor + 42), attrs = b.readUInt32LE(cursor + 38);
    if (cursor + 46 + nl > end) throw Error('ZIP 文件名损坏。');
    const name = b.subarray(cursor + 46, cursor + 46 + nl).toString('utf8').replaceAll('\\', '/');
    cursor += 46 + nl + b.readUInt16LE(cursor + 30) + b.readUInt16LE(cursor + 32);
    const out = inside(target, name);
    if (names.has(out.toLowerCase())) throw Error('ZIP 中存在重名文件。'); names.add(out.toLowerCase());
    if (((attrs >>> 16) & 0xf000) === 0xa000) throw Error('ZIP 中不允许链接文件。');
    if (name.endsWith('/')) continue;
    if (flags & 1 || ![0, 8].includes(method)) throw Error('暂不支持加密 ZIP 或这种压缩方式。');
    total += size; if (size > FILE_LIMIT || total > LIMIT) throw Error('解压资源超过大小限制。');
    if (!allowed.has(path.extname(name).toLowerCase())) continue;
    if (offset + 30 > b.length || b.readUInt32LE(offset) !== 0x04034b50) throw Error('ZIP 数据头损坏。');
    const start = offset + 30 + b.readUInt16LE(offset + 26) + b.readUInt16LE(offset + 28);
    if (start + packed > b.length) throw Error('ZIP 数据被截断。');
    const data = method === 0 ? b.subarray(start, start + packed) : zlib.inflateRawSync(b.subarray(start, start + packed), { maxOutputLength: FILE_LIMIT });
    if (data.length !== size || crc32(data) !== crc) throw Error('ZIP 文件校验失败：' + name);
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, data);
  }
}
class CharacterLibrary {
  constructor(dataDir) {
    this.root = path.join(dataDir, 'user-characters'); this.staging = path.join(dataDir, 'import-staging');
    this.index = path.join(this.root, 'index.json'); this.pending = new Map();
    fs.mkdirSync(this.root, { recursive: true }); fs.mkdirSync(this.staging, { recursive: true });
    this.items = fs.existsSync(this.index) ? json(this.index) : [];
    if (!Array.isArray(this.items)) throw Error('角色库索引损坏，请保留 index.json 并检查。');
    this.migrationErrors = [];
    const outdated = this.items.filter(c => c.resourceRevision !== 2);
    if (outdated.length) {
      if (fs.existsSync(this.index) && !fs.existsSync(this.index + '.before-resource-upgrade')) fs.copyFileSync(this.index, this.index + '.before-resource-upgrade');
      for (const item of outdated) {
        try {
          const root = inside(this.root, item.key), entry = inside(root, item.sourceEntry);
          const model = json(entry), resources = enrichModel(root, item.sourceEntry, model, relative => {
            const file=inside(root,relative);if(!fs.existsSync(file)&&fs.existsSync(file+'.gz'))fs.writeFileSync(file,zlib.gunzipSync(fs.readFileSync(file+'.gz'),{maxOutputLength:FILE_LIMIT}));return json(file);
          });
          if (!fs.existsSync(entry + '.before-resource-upgrade')) fs.copyFileSync(entry, entry + '.before-resource-upgrade');
          writeJSON(entry, model); this.applyResources(item, resources);
        } catch(error) { this.migrationErrors.push({key:item.key,message:error.message}); }
      }
      this.save();
    }
  }
  applyResources(item, resources) {
    item.resourceRevision = 2; item.resources = resources;
    const outfit=item.outfits[0];outfit.motions=resources.motions;outfit.expressions=resources.expressions;
    outfit.expressionParameters=Object.fromEntries(resources.expressions.map(e=>[e.name,e.parameters]));
    if(!resources.motions.some(m=>m.name===item.bindings.idle))item.bindings.idle=resources.idle;
    if(!resources.motions.some(m=>m.name===item.bindings.click))item.bindings.click=null;
    if(!resources.expressions.some(e=>e.name===item.bindings.expression))item.bindings.expression=null;
    item.interactions={idle:item.bindings.idle?[item.bindings.idle]:[],click:item.bindings.click?[item.bindings.click]:[]};
    item.runtimeState ||= defaultState(item);
  }
  save() { writeJSON(this.index, this.items); }
  discard(token) {
    const dir = this.pending.get(token); if (!dir) return;
    this.pending.delete(token); fs.rmSync(inside(this.staging, token), { recursive: true, force: true });
  }
  prepare(source) {
    const token = randomUUID(), dir = inside(this.staging, token); fs.mkdirSync(dir);
    this.pending.set(token, dir);
    try {
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) throw Error('请选择普通文件夹或 ZIP。');
      if (stat.isDirectory()) {
        const files = walk(source); let total = 0;
        for (const rel of files) {
          if (!allowed.has(path.extname(rel).toLowerCase())) continue;
          const src = inside(source, rel), size = fs.statSync(src).size; total += size;
          if (size > FILE_LIMIT || total > LIMIT) throw Error('角色资源超过 768MB 或单个文件超过 128MB。');
          const dst = inside(dir, rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst);
        }
      } else if (path.extname(source).toLowerCase() === '.zip') extractZip(source, dir);
      else throw Error('请选择模型文件夹或 ZIP；CMO3 工程需先在编辑器导出运行模型。');
      let files = walk(dir), candidates = files.filter(f => /\.model3\.json(?:\.gz)?$/i.test(f));
      const reconstructed = !candidates.length;
      if (reconstructed) {
        const mocs = files.filter(f => /\.moc3$/i.test(f)), textures = files.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
        if (mocs.length !== 1 || !textures.length) throw Error('未找到 .model3.json 与完整模型。请选择导出的运行模型，不是 PSD／CMO3 工程或打包后的 EXE。');
        writeJSON(path.join(dir, 'reconstructed.model3.json'), { Version: 3, FileReferences: { Moc: mocs[0].replaceAll('\\', '/'), Textures: textures.map(f => f.replaceAll('\\', '/')) } });
        candidates = ['reconstructed.model3.json'];
      }
      return { token, candidates, reconstructed, sourceName: path.basename(source) };
    } catch (error) { this.discard(token); throw error; }
  }
  commit(token, candidate, name) {
    const dir = this.pending.get(token); if (!dir) throw Error('导入会话已失效，请重新选择。');
    const ensure = (relative, extension) => {
      const file = inside(dir, relative);
      if (!extension.test(relative)) throw Error('资源类型不符：' + relative);
      if (!fs.existsSync(file) && fs.existsSync(file + '.gz')) fs.writeFileSync(file, zlib.gunzipSync(fs.readFileSync(file + '.gz'), { maxOutputLength: FILE_LIMIT }));
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw Error('缺少资源：' + relative);
      return file;
    };
    if (candidate.endsWith('.gz')) candidate = candidate.slice(0, -3);
    const entry = ensure(candidate, /\.model3\.json$/i), model = json(entry), refs = model.FileReferences;
    if (model.Version !== 3 || !refs || !Array.isArray(refs.Textures) || !refs.Textures.length) throw Error('模型入口缺少 Version 3 或贴图列表。');
    const base = path.dirname(candidate), ref = (name, ext) => ensure(path.join(base, name), ext);
    const moc = fs.readFileSync(ref(refs.Moc, /\.moc3$/i));
    if (moc.length < 64 || moc.subarray(0, 4).toString() !== 'MOC3') throw Error('MOC3 文件损坏或格式不符。');
    for (const t of refs.Textures) ref(t, /\.(png|jpg|jpeg|webp)$/i);
    for (const field of ['Physics', 'Pose', 'UserData', 'DisplayInfo']) if (refs[field]) json(ref(refs[field], /\.json$/i));
    const resources = enrichModel(dir, candidate, model, relative => json(ensure(relative,/\.json$/i)));
    const {motions,expressions}=resources;
    for(const definitions of Object.values(refs.Motions))for(const definition of definitions)if(definition.Sound)ref(definition.Sound,/\.(wav|mp3|ogg|opus)$/i);
    writeJSON(entry, model);
    const key = 'user_' + randomUUID().replaceAll('-', ''), dest = inside(this.root, key);
    const url = '/user-assets/' + key + '/' + candidate.replaceAll('\\', '/');
    const idle = resources.idle || null;
    const descriptor = { key, name: String(name || path.basename(candidate, '.model3.json')).trim().slice(0, 60) || '新角色', custom: true, band: '我的角色', role: '自定义角色', defaultOutfit: 'default',
      createdAt: new Date().toISOString(), sourceEntry: candidate.replaceAll('\\', '/'),
      performance: { enabled: false, maskAvailable: false }, interactions: { idle: motions.map(m => m.name), click: motions.map(m => m.name) },
      bindings: { idle, click: null, expression: null },
      outfits: [{ key: 'default', label: '默认', model: url, maskAvailable: false, stageCostume: false, framing: { auto: true, zoom: 1, offsetX: 0, offsetY: 0 }, motions,
        expressions, moods: {}, neutralParameters: [], parameterDefaults: {}, expressionParameters: Object.fromEntries(expressions.map(e => [e.name, e.parameters])) }] };
    this.applyResources(descriptor,resources);
    fs.renameSync(dir, dest); this.pending.delete(token); this.items.push(descriptor);
    try { this.save(); } catch (error) { this.items.pop(); fs.rmSync(dest, { recursive: true, force: true }); throw error; }
    return descriptor;
  }
  update(key, changes) {
    const item = this.items.find(c => c.key === key); if (!item) throw Error('角色不存在。');
    const next = structuredClone(item), outfit = next.outfits[0];
    if (changes.name !== undefined) { const name = String(changes.name).trim().slice(0, 60); if (!name) throw Error('请输入角色名字。'); next.name = name; }
    if (changes.bindings) for (const kind of ['idle', 'click', 'expression']) {
      if (!(kind in changes.bindings)) continue;
      const value = changes.bindings[kind] || null;
      if (value && !(kind === 'expression' ? outfit.expressions : outfit.motions).some(x => x.name === value)) throw Error('选择的动作或表情不存在。');
      next.bindings[kind] = value;
      if(kind==='expression'&&value!==item.bindings.expression)next.runtimeState={...next.runtimeState,expressions:value?[value]:[]};
    }
    if (changes.framing) for (const [field, min, max] of [['zoom', .2, 3], ['offsetX', -160, 160], ['offsetY', -170, 170]]) {
      if (!(field in changes.framing)) continue; const value = Number(changes.framing[field]); if (!Number.isFinite(value)) throw Error('位置参数无效。');
      outfit.framing[field] = Math.max(min, Math.min(max, value));
    }
    next.interactions={idle:next.bindings.idle?[next.bindings.idle]:[],click:next.bindings.click?[next.bindings.click]:[]};
    const index = this.items.indexOf(item); this.items[index] = next;
    try { this.save(); } catch (error) { this.items[index] = item; throw error; } return next;
  }
  control(key, command) {
    const item=this.items.find(c=>c.key===key);if(!item)throw Error('角色不存在。');
    const next=reduceState(item,item.runtimeState,command),previous=item.runtimeState;item.runtimeState=next;
    try{this.save()}catch(error){item.runtimeState=previous;throw error}return next;
  }
  rescan(key) {
    const item=this.items.find(c=>c.key===key);if(!item)throw Error('角色不存在。');
    const root=inside(this.root,key),entry=inside(root,item.sourceEntry),model=json(entry);
    const resources=enrichModel(root,item.sourceEntry,model,relative=>{
      const file=inside(root,relative);if(!fs.existsSync(file)&&fs.existsSync(file+'.gz'))fs.writeFileSync(file,zlib.gunzipSync(fs.readFileSync(file+'.gz'),{maxOutputLength:FILE_LIMIT}));return json(file);
    });
    writeJSON(entry,model);this.applyResources(item,resources);this.save();return item;
  }
  remove(key) {
    
    const item = this.items.find(c => c.key === key); if (!item) throw Error('角色不存在。');
    const previous = this.items; this.items = this.items.filter(c => c !== item);
    try { this.save(); } catch (error) { this.items = previous; throw error; }
    // Keep the assets in a recoverable trash folder; never touch the supplied originals.
    const source = inside(this.root, key), trash = path.join(this.root, '_trash'); fs.mkdirSync(trash, { recursive: true });
    if (fs.existsSync(source)) fs.renameSync(source, inside(trash, key + '-' + Date.now()));
  }
}
module.exports = { CharacterLibrary, inside, walk, extractZip, crc32, writeJSON };
