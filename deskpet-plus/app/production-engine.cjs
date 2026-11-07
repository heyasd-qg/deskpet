'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { walk, writeJSON } = require('./character-library.cjs');
function quoteArg(value) { return '"' + String(value).replaceAll('\\', '/').replaceAll('"', '\\"') + '"'; }
class ProductionEngine {
  constructor(dataDir, toolsRoot) {
    this.root = path.join(dataDir, 'production'); fs.mkdirSync(this.root, { recursive: true });
    this.configFile = path.join(dataDir, 'production-settings.json');
    this.config = fs.existsSync(this.configFile) ? JSON.parse(fs.readFileSync(this.configFile, 'utf8')) : {};
    this.config.source ||= path.join(toolsRoot, 'psd2live');
    this.config.java ||= fs.existsSync(path.join(toolsRoot, 'jdk-21', 'bin', 'java.exe')) ? path.join(toolsRoot, 'jdk-21', 'bin', 'java.exe') : 'D:\\DevEco Studio\\jbr\\bin\\java.exe';
    this.jobs = fs.readdirSync(this.root).flatMap(id => {
      try { const j = JSON.parse(fs.readFileSync(path.join(this.root, id, 'job.json'), 'utf8')); if (j.status === 'running') { j.status = 'interrupted'; j.message = '上次退出时任务未完成，可以重新生成。'; } return [j]; } catch { return []; }
    });
    this.process = null; this.active = null;
  }
  saveConfig(config) { this.config = { ...this.config, ...config }; writeJSON(this.configFile, this.config); }
  status() {
    const signature = JSON.stringify(this.config);
    if (this.cachedStatus?.signature === signature && Date.now() - this.cachedStatus.time < 30000) return this.cachedStatus.value;
    const value = this.checkStatus(); this.cachedStatus = { signature, value, time: Date.now() }; return value;
  }
  checkStatus() {
    if (this.config.executable && fs.existsSync(this.config.executable)) return { ready: true, mode: 'portable', message: '已选择 PSD2Live 程序，生成时会调用它。' };
    const wrapper = path.join(this.config.source, 'gradle', 'wrapper', 'gradle-wrapper.jar');
    if (!fs.existsSync(wrapper)) return { ready: false, message: '未找到 PSD2Live 源码，请选择便携版程序。' };
    if (!fs.existsSync(this.config.java)) return { ready: false, message: '已有 PSD2Live 源码；需要 Java 21 或选择 PSD2Live 便携版程序。' };
    const r = spawnSync(this.config.java, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (r.error || r.status !== 0) return { ready: false, message: 'Java 无法启动：' + (r.error?.message || r.stderr || r.stdout) };
    const version = (r.stderr || '') + (r.stdout || ''), major = Number(version.match(/version "(\d+)/)?.[1]);
    return { ready: major >= 21, mode: 'source', message: major >= 21 ? '源码模式可启动；首次构建需要下载 Gradle 和依赖。' : '当前 Java 版本不足 21。' };
  }
  command(args) {
    if (this.config.executable) return { file: this.config.executable, args, cwd: path.dirname(this.config.executable), env: process.env };
    const home = path.dirname(path.dirname(this.config.java)), cache = path.join(this.root, 'gradle-cache');
    return { file: this.config.java, args: ['-Dorg.gradle.java.home=' + home, '-Dgradle.user.home=' + cache, '-classpath', path.join(this.config.source, 'gradle', 'wrapper', 'gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', '--no-daemon', '-Ppsd2live.prebuiltRuntime=false', 'run', '--args=' + args.map(quoteArg).join(' ')], cwd: this.config.source, env: { ...process.env, JAVA_HOME: home, GRADLE_USER_HOME: cache } };
  }
  start(input) {
    if (this.active) throw Error('已有制作任务在运行，请等待或取消。');
    const status = this.status(); if (!status.ready) throw Error(status.message);
    if (!/\.(psd|psd2live)$/i.test(input)) throw Error('请选择分层 PSD 或 PSD2Live 工程。');
    const id = randomUUID(), dir = path.join(this.root, id); fs.mkdirSync(dir);
    const original = path.join(dir, 'source' + path.extname(input)); fs.copyFileSync(input, original);
    const output = path.join(dir, 'output'); fs.mkdirSync(output);
    const job = { id, name: path.basename(input), status: 'running', startedAt: new Date().toISOString(), source: original, output, message: '正在启动制作工具…', log: '' };
    this.jobs.unshift(job); this.active = job;
    const args = /\.psd2live$/i.test(input) ? ['export', original, '--target', 'moc3', '--output', output] : ['--input', original, '--output', output, '--atlas', '2048', '--lang', 'zh'];
    writeJSON(path.join(dir, 'job.json'), job);
    const command = this.command(args);
    const child = this.process = spawn(command.file, command.args, { cwd: command.cwd, env: command.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = data => { const text = data.toString(); job.log = (job.log + text).slice(-24000); job.message = text.trim().split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 300) || job.message; fs.appendFileSync(path.join(dir, 'build.log'), text); };
    child.stdout.on('data', log); child.stderr.on('data', log);
    child.on('error', error => { job.status = 'failed'; job.message = error.message; log(Buffer.from(error.message)); });
    child.on('close', code => {
      if (job.status !== 'cancelled') {
        let models = []; try { models = walk(output).filter(f => /\.model3\.json$/i.test(f)); } catch {}
        job.status = code === 0 && models.length ? 'complete' : 'failed';
        job.message = job.status === 'complete' ? '模型文件已生成，请导入角色库并预览验收。' : '生成未完成，请查看日志；原素材已保留，可重试。';
        job.models = models;
      }
      job.finishedAt = new Date().toISOString(); writeJSON(path.join(dir, 'job.json'), job);
      this.active = null; this.process = null;
    });
    return job;
  }
  cancel() {
    if (!this.process || !this.active) return;
    this.active.status = 'cancelled'; this.active.message = '用户已取消，素材与日志保留。';
    const child = this.process, pid = child.pid;
    if (process.platform === 'win32' && pid) {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      const fallback = () => { if (child.exitCode === null && child.signalCode === null) child.kill(); };
      killer.on('error', fallback); killer.on('close', code => { if (code) fallback(); });
      const timer = setTimeout(fallback, 1500); timer.unref(); child.once('close', () => clearTimeout(timer));
    } else child.kill();
  }
  openEditor() {
    const status = this.status(); if (!status.ready) throw Error(status.message);
    const c = this.command([]), child = spawn(c.file, c.args, { cwd: c.cwd, env: c.env, windowsHide: true, stdio: 'ignore' });
    child.on('error', () => {}); child.unref();
  }
}
module.exports = { ProductionEngine, quoteArg };
