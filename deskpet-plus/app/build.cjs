'use strict';
const path = require('node:path');
const { isResource } = require('./character-resources.cjs');
const pkg = require('./package.json');
function ignored(file) {
  let relative = file.replaceAll('\\', '/');
  const root = __dirname.replaceAll('\\', '/');
  if (relative.startsWith(root + '/')) relative = relative.slice(root.length + 1);
  relative = relative.replace(/^\/+/, '');
  return /^(node_modules|data|character-resources|dist)(\/|$)/.test(relative) || relative === 'build.cjs' ||
    relative.startsWith('public/') && isResource(relative.slice('public/'.length));
}
async function build() {
  const { packager } = await import('@electron/packager');
  return packager({ dir: __dirname, name: 'DeskpetPlus', executableName: 'DeskpetPlus',
    electronVersion: pkg.devDependencies.electron, appVersion: pkg.version,
    platform: process.platform, arch: process.arch, out: path.resolve(__dirname, '../dist'),
    asar: true, overwrite: false, ignore: ignored });
}
module.exports = { ignored, build };
if (require.main === module) build().then(outputs => console.log(outputs.join('\n'))).catch(error => { console.error(error); process.exitCode = 1; });
