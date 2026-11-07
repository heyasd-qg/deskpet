'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');

function localFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw Error('资源路径无效');
  const file = path.resolve(root, relative), boundary = path.resolve(root) + path.sep;
  if (!file.startsWith(boundary)) throw Error('资源路径超出角色目录');
  return file;
}
function existingFile(file) {
  for (const candidate of [file, ...(/\.(json|moc3)$/i.test(file) ? [file + '.gz'] : [])]) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
  }
  throw Error('缺少资源：' + path.basename(file));
}
function inspectModel(root, entry) {
  try {
    const file = localFile(root, entry), input = existingFile(file);
    const bytes = fs.readFileSync(input), model = JSON.parse(input.endsWith('.gz') ? zlib.gunzipSync(bytes) : bytes);
    const refs = model.FileReferences;
    if (!refs?.Moc || !Array.isArray(refs.Textures) || !refs.Textures.length) throw Error('模型入口缺少 MOC3 或贴图');
    const dependencies = [refs.Moc, ...refs.Textures, refs.Physics, refs.Pose, refs.UserData, refs.DisplayInfo,
      ...(refs.Expressions || []).map(e => e.File), ...Object.values(refs.Motions || {}).flat().flatMap(m => [m.File, m.Sound])].filter(Boolean);
    for (const name of dependencies) existingFile(localFile(root, path.relative(root, path.resolve(path.dirname(file), name))));
    return { available: true };
  } catch (error) { return { available: false, message: error.message }; }
}
function scanBuiltins(publicDir) {
  const characters = [], issues = [];
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(path.join(publicDir, 'characters.json'), 'utf8'));
    if (!Array.isArray(entries)) throw Error('角色目录配置格式无效');
  } catch (error) {
    if (error.code !== 'ENOENT') issues.push({ kind: 'catalogue', message: '无法读取内置角色目录：' + error.message });
    return { characters, issues };
  }
  for (const entry of entries) {
    try {
      const inspect = model => inspectModel(publicDir, typeof model === 'string' && model.startsWith('/characters/') ? model.slice(1) : '');
      const outfits = (entry.outfits || []).filter(outfit => {
        const result = inspect(outfit.model);
        if (!result.available) issues.push({ kind: 'outfit', key: entry.key, name: entry.name, outfit: outfit.key, message: result.message });
        return result.available;
      });
      if (!outfits.length) continue;
      const performance = inspect(entry.performance?.model);
      if (!performance.available) issues.push({ kind: 'performance', key: entry.key, name: entry.name, message: performance.message });
      characters.push({ ...entry, outfits, defaultOutfit: outfits.some(o => o.key === entry.defaultOutfit) ? entry.defaultOutfit : outfits[0].key,
        performance: performance.available ? entry.performance : { ...entry.performance, available: false, maskAvailable: false } });
    } catch (error) { issues.push({ kind: 'character', key: entry?.key, message: error.message }); }
  }
  return { characters, issues };
}
function scanCustom(items, libraryRoot) {
  const characters = [], issues = [];
  for (const item of items) {
    let result;
    try { result = inspectModel(localFile(libraryRoot, item.key), item.sourceEntry); }
    catch (error) { result = { available: false, message: error.message }; }
    if (result.available) characters.push(item);
    else issues.push({ kind: 'custom', key: item.key, name: item.name, message: result.message });
  }
  return { characters, issues };
}
module.exports = { scanBuiltins, scanCustom, inspectModel };
