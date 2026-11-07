'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

// The URL layout stays identical to the original application. Moving this whole
// directory therefore preserves character IDs, motion bindings and voice URLs.
const RESOURCE_PATHS = ['characters.json', 'characters', 'interaction-data.json', 'interaction-voice',
  'model', 'models', 'voice', 'lines.json', 'image-lab/builtin.js'];
let publicDir = path.join(__dirname, 'public'), packDir = path.join(__dirname, 'character-resources');
function configure(options) {
  publicDir = path.resolve(options.publicDir); packDir = path.resolve(options.packDir);
}
function activeRoot() { return fs.existsSync(packDir) ? packDir : publicDir; }
function isResource(relative) { return RESOURCE_PATHS.some(p => relative === p || relative.startsWith(p + '/')); }
function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw Error('资源路径无效');
  const file = path.resolve(root, relative);
  if (!file.startsWith(path.resolve(root) + path.sep)) throw Error('资源路径超出角色资料目录');
  return file;
}
function resolveAsset(pathname) {
  const relative = pathname.replace(/^\//, '');
  return isResource(relative) ? inside(activeRoot(), relative) : null;
}
function readInteractions() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(activeRoot(), 'interaction-data.json'), 'utf8'));
    if (!Array.isArray(data.paired) || !Array.isArray(data.daily) || !data.faces || typeof data.faces !== 'object') throw Error('互动资料格式无效');
    return { data, error: null };
  } catch (error) {
    return { data: { paired: [], daily: [], faces: {} }, error: error.code === 'ENOENT' ? null : error.message };
  }
}
function refreshInteractions(target) {
  const result = readInteractions();
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, result.data);
  return result;
}
function walk(root, relative = '') {
  const list = [];
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    const rel = relative ? relative + '/' + name : name;
    if (fs.statSync(inside(root, rel)).isDirectory()) list.push(...walk(root, rel)); else list.push(rel);
  }
  return list;
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function exportPack(source, destination) {
  if (fs.existsSync(destination)) throw Error('目标资料文件夹已存在，请选择新的导出路径。');
  fs.mkdirSync(destination, { recursive: true });
  for (const rel of RESOURCE_PATHS) {
    const input = inside(source, rel); if (!fs.existsSync(input)) continue;
    const output = inside(destination, rel); fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.cpSync(input, output, { recursive: true });
  }
  const files = Object.fromEntries(walk(destination).map(rel => [rel, { bytes: fs.statSync(inside(destination, rel)).size, sha256: hash(inside(destination, rel)) }]));
  const manifest = { format: 'deskpet-character-resources', version: 1, createdAt: new Date().toISOString(), files };
  fs.writeFileSync(path.join(destination, 'pack-manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
function verifyPack(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'pack-manifest.json'), 'utf8'));
  if (manifest.format !== 'deskpet-character-resources' || manifest.version !== 1 || !manifest.files) throw Error('角色资料包格式无效');
  const issues = [];
  for (const [rel, expected] of Object.entries(manifest.files)) {
    try {
      const file = inside(root, rel);
      if (fs.statSync(file).size !== expected.bytes || hash(file) !== expected.sha256) issues.push({ path: rel, message: '文件内容与原始资料不一致' });
    } catch (error) { issues.push({ path: rel, message: error.message }); }
  }
  return { valid: !issues.length, files: Object.keys(manifest.files).length, issues };
}
// The interactive verifier yields during every file read. Keep the synchronous
// version above only for offline export/build checks, never for Electron IPC.
async function verifyPackAsync(root, { onProgress = () => {}, signal } = {}) {
  const manifest = JSON.parse(await fs.promises.readFile(path.join(root, 'pack-manifest.json'), 'utf8'));
  if (manifest.format !== 'deskpet-character-resources' || manifest.version !== 1 || !manifest.files || Array.isArray(manifest.files)) throw Error('角色资料包格式无效');
  const entries = Object.entries(manifest.files), total = entries.length, issues = [];
  const totalBytes = entries.reduce((sum, [, file]) => sum + (Number.isFinite(file.bytes) && file.bytes >= 0 ? file.bytes : 0), 0);
  let done = 0, bytes = 0, currentFile = '', lastProgress = 0;
  const progress = (force = false) => {
    if (!force && Date.now() - lastProgress < 100) return;
    lastProgress = Date.now();
    onProgress({ running: true, done, total, bytes, totalBytes, currentFile, percent: total ? Math.floor(done * 100 / total) : 0 });
  };
  progress(true);
  for (const [rel, expected] of entries) {
    if (signal?.aborted) break;
    currentFile = rel;
    try {
      const file = inside(root, rel), stat = await fs.promises.stat(file);
      if (stat.size !== expected.bytes) issues.push({ path: rel, message: '文件长度与原始资料不一致' });
      else {
        const digest = crypto.createHash('sha256');
        const stream = fs.createReadStream(file, { highWaterMark: 256 * 1024, signal });
        for await (const chunk of stream) { digest.update(chunk); bytes += chunk.length; progress(); }
        if (digest.digest('hex') !== expected.sha256) issues.push({ path: rel, message: '文件内容与原始资料不一致' });
      }
    } catch (error) {
      if (signal?.aborted) break;
      issues.push({ path: rel, message: error.message });
    }
    done++; progress();
  }
  const cancelled = !!signal?.aborted;
  onProgress({ running: false, done, total, bytes, totalBytes, currentFile, percent: total ? Math.floor(done * 100 / total) : 100, cancelled });
  return { valid: !cancelled && !issues.length, cancelled, files: total, checked: done, issues };
}
function status() {
  const root = activeRoot(), external = root === packDir;
  return { external, root, packDir, hasCatalogue: fs.existsSync(path.join(root, 'characters.json')),
    hasInteractions: fs.existsSync(path.join(root, 'interaction-data.json')) };
}
module.exports = { RESOURCE_PATHS, configure, activeRoot, isResource, resolveAsset, readInteractions, refreshInteractions, exportPack, verifyPack, verifyPackAsync, status };
