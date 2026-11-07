'use strict';
(async () => {
  const $ = id => document.getElementById(id), api = window.petAPI;
  let state, selected, model, loading = 0, session, previewReady = false, controlsUI, verificationBusy = false;
  const pixi = new PIXI.Application({ view: $('model-canvas'), width: 450, height: 370, backgroundAlpha: 0, antialias: true, resolution: devicePixelRatio || 1, autoDensity: true });
  const notice = (message, error = false) => { $('notice').hidden = !message; $('notice').textContent = message; $('notice').classList.toggle('error', error); };
  async function call(op, request = {}) { const result = await api.workshop(op, request); if (!result.ok) throw Error(result.error); return result.value; }
  const guard = fn => async event => { try { await fn(event); } catch (error) { notice(error.message, true); } };
  function options(select, list, chosen) {
    select.replaceChildren(new Option('无', ''));
    for (const item of list) select.append(new Option(item.label || item.name, item.name));
    select.value = chosen || '';
  }
  function item() { return state.items.find(c => c.key === selected); }
  function unavailable(key) { return state.availability?.issues.find(issue => issue.kind === 'custom' && issue.key === key); }
  function renderVerification(progress = {}) {
    verificationBusy = !!progress.running;
    $('verify-resource-pack').disabled = verificationBusy || !state?.availability?.resources?.external;
    $('verify-resource-pack').textContent = verificationBusy ? '正在校验…' : '校验角色资料包';
    $('cancel-resource-verification').hidden = !verificationBusy;
    $('verification-progress').hidden = !verificationBusy && !progress.total;
    $('verification-meter').hidden = !verificationBusy;
    $('verification-meter').value = progress.percent || 0;
    $('verification-progress').textContent = verificationBusy ? progress.total ? `已检查 ${progress.done} / ${progress.total} 个文件（${progress.percent}%），可继续操作窗口或取消校验。` : '正在读取校验清单…' : progress.cancelled ? `已取消，检查了 ${progress.done} / ${progress.total} 个文件。` : progress.error ? '校验未完成：' + progress.error : progress.total ? `已检查 ${progress.done} / ${progress.total} 个文件。` : '';
  }
  function renderAvailability() {
    const a = state.availability;
    $('library-status-title').textContent = a.total ? `当前可用：${a.builtinCount} 个内置角色 · ${a.customCount} 个导入角色` : '还没有可用角色，先导入一位新朋友';
    $('library-status-detail').textContent = !a.total ? '可导入自己的模型；恢复原角色时，将完整 character-resources 文件夹放在程序旁，再点击“刷新角色库”。' : a.issues.length ? '部分资源暂不可用，已跳过；恢复文件后点击“刷新角色库”。现有可用角色仍可使用。' : a.resources?.external ? '已加载外置角色资料包，原有台词、语音与互动仍由程序模块处理。可点击“校验角色资料包”检查文件完整性。' : '内置角色在“角色设置”中切换；导入角色可在这里预览并放到桌面。';
    renderVerification(state.verification);
  }
  function fit() {
    if (!model) return;
    const b = model.getLocalBounds(), frame=item()?.outfits[0].framing||{zoom:1,offsetX:0,offsetY:0},factor=340/173;
    const scale=Math.min(155/Math.max(1,b.width),165/Math.max(1,b.height))*frame.zoom*factor;
    model.scale.set(scale);model.position.set((pixi.screen.width-167*factor)/2+(167*factor-b.width*scale)/2-b.x*scale+frame.offsetX*factor,15+(173*factor-b.height*scale)/2-b.y*scale+frame.offsetY*factor);
  }
  new ResizeObserver(() => { pixi.renderer.resize($('model-canvas').parentElement.clientWidth, 370); fit(); }).observe($('model-canvas').parentElement);
  function updateButtons() {
    $('show-controls').disabled=!previewReady;
    $('activate').disabled = !previewReady; $('stop-preview').disabled = !previewReady;
    $('play-motion').disabled = !previewReady || !item()?.outfits[0].motions.length;
    $('apply-expression').disabled = !previewReady || !$('expression').value;
  }
  async function select(key) {
    controlsUI?.detach();
    selected = key; previewReady = false; updateButtons(); renderList();
    const owner = item(), token = ++loading;
    if (model) { model.destroy({ children: true }); model = null; }
    $('details').hidden = !owner; $('no-selection').hidden = !!owner; $('empty').hidden = !!owner;
    $('preview-title').textContent = owner?.name || '等待一位新朋友';
    if (!owner) { $('preview-status').textContent = '透明模型预览'; return; }
    const outfit = owner.outfits[0];
    $('character-name').value = owner.name;
    options($('idle-motion'), outfit.motions, owner.bindings.idle); options($('click-motion'), outfit.motions, owner.bindings.click);
    options($('expression'), outfit.expressions, owner.bindings.expression);
    $('zoom').value = outfit.framing.zoom; $('offset-x').value = outfit.framing.offsetX; $('offset-y').value = outfit.framing.offsetY;
    $('zoom-value').textContent = Number($('zoom').value).toFixed(2) + '×';
    $('capabilities').textContent = outfit.motions.length + ' 个动作 · ' + outfit.expressions.length + ' 个表情。位置可拖拽或滑动调整，即时同步桌面。';
    $('preview-status').textContent = '正在加载模型…';
    const missing = unavailable(owner.key);
    if (missing) { $('preview-status').textContent = '资源暂不可用'; notice(missing.message + '。恢复素材后点击“刷新角色库”，也可重新导入。', true); return; }
    try {
      const next = await PIXI.live2d.Live2DModel.from(outfit.model, { autoInteract: false });
      if (token !== loading) { next.destroy(); return; }
      model = next; next.anchor.set(0, 0); pixi.stage.addChild(next); fit();
      controlsUI.attach(next,owner);
      previewReady = true;$('preview-status').textContent = '模型加载成功'; updateButtons();
    } catch (error) { if (token === loading) { previewReady=false;updateButtons();$('preview-status').textContent = '加载失败'; notice('当前播放器无法加载此模型：' + error.message + '。请检查模型版本与贴图，角色尚未放到桌面。', true); } }
  }
  function renderList() {
    $('count').textContent = state.items.length; $('characters').replaceChildren();
    if (!state.items.length) { const p = document.createElement('p'); p.className = 'subtle'; p.textContent = '这里还没有自定义角色。先导入一个完整模型试试。'; $('characters').append(p); }
    for (const c of state.items) {
      const button = document.createElement('button'); button.className = 'character' + (c.key === selected ? ' selected' : '');
      const name = document.createElement('strong'), info = document.createElement('small'); name.textContent = c.name; info.textContent = unavailable(c.key) ? '素材缺失 · 可恢复或重新导入' : c.outfits[0].motions.length + ' 个动作 · Live2D'; button.append(name, info);
      button.onclick = guard(() => select(c.key)); $('characters').append(button);
    }
  }
  function renderJobs() {
    const expanded = new Set([...$('jobs').querySelectorAll('details[open]')].map(el => el.dataset.job));
    $('jobs').replaceChildren(); $('cancel-job').disabled = !state.jobs.some(j => j.status === 'running');
    for (const job of state.jobs) {
      const div = document.createElement('div'); div.className = 'job';
      const title = document.createElement('div'); title.className = 'job-title';
      const name = document.createElement('strong'), status = document.createElement('span'); name.textContent = job.name; status.textContent = ({running:'制作中',complete:'待预览验收',failed:'生成失败',cancelled:'已取消',interrupted:'上次中断'})[job.status] || job.status; title.append(name, status);
      const msg = document.createElement('p'); msg.textContent = job.message;
      const buttons = document.createElement('div'); buttons.className = 'actions';
      const folder = document.createElement('button'); folder.textContent = '打开任务文件夹'; folder.onclick = guard(() => call('open-job', { id: job.id })); buttons.append(folder);
      if (job.status === 'complete') { const b = document.createElement('button'); b.textContent = '导入角色库并预览'; b.className = 'primary'; b.onclick = guard(async () => beginImport(await call('import-job', { id: job.id }))); buttons.append(b); }
      const logs = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre'); logs.dataset.job = job.id; logs.open = expanded.has(job.id); summary.textContent = '查看日志'; pre.textContent = job.log || '还没有日志'; logs.append(summary, pre); div.append(title, msg, buttons, logs); $('jobs').append(div);
    }
    if (!state.jobs.length) $('jobs').textContent = '还没有制作任务。';
  }
  async function refresh() {
    state = await call('state'); renderList(); renderJobs(); renderAvailability();
    $('engine-status').textContent = state.engine.message; $('engine-path').textContent = state.config.executable || state.config.source;
    $('generate').disabled = !state.engine.ready || state.jobs.some(j => j.status === 'running'); $('open-editor').disabled = !state.engine.ready;
    if (selected && !item()) await select(null);
  }
  function tab(name) {
    for (const button of document.querySelectorAll('[data-tab]')) button.classList.toggle('selected', button.dataset.tab === name);
    for (const n of ['library','production','image']) $(n + '-page').hidden = n !== name;
  }
  function beginImport(value) {
    if (!value) return; session = value; $('candidate').replaceChildren();
    for (const file of value.candidates) $('candidate').append(new Option(file, file));
    $('import-name').value = value.sourceName.replace(/\.(zip|psd)$/i, ''); $('import-error').textContent = '';
    $('import-warning').textContent = value.reconstructed ? '缺少模型入口，已根据唯一 MOC3 和图片生成基础入口；贴图顺序需预览确认，原有动作与表情无法恢复。' : '会复制素材到 beta 自己的角色库。导入后请先预览，确认模型与贴图正常。';
    $('import-dialog').showModal();
  }
  for (const name of ['folder','zip']) $('import-' + name).onclick = guard(async () => beginImport(await call('prepare', { kind: name })));
  $('open-settings').onclick = () => api.openSettings();
  $('refresh-library').onclick = guard(async () => { const key = selected; await call('refresh-library'); await refresh(); if (key) await select(key); notice('角色库已刷新。可在“角色设置”中选择已恢复的角色；导入角色预览后可放到桌面。'); });
  $('verify-resource-pack').onclick = guard(async () => {
    if (verificationBusy) return;
    renderVerification({ running: true, done: 0, total: 0 });
    notice('正在校验资料，进度会显示在上方。');
    try {
      const result = await call('verify-resource-pack');
      if (result.cancelled) notice('已取消校验，角色资料未改变。');
      else notice(result.valid ? `资料包校验通过：${result.files} 个文件与原始资料一致。` : `资料包不完整：${result.issues.length} 个文件缺失或改变，例如 ${result.issues[0]?.path}。请恢复完整资料包。`, !result.valid);
    } finally {
      const latest = await call('state'); state.verification = latest.verification; renderVerification(latest.verification);
    }
  });
  $('cancel-resource-verification').onclick = guard(() => call('cancel-resource-verification'));
  api.onResourceVerification?.(progress => { if (state) state.verification = progress; renderVerification(progress); });
  $('import-form').onsubmit = async event => {
    event.preventDefault(); $('confirm-import').disabled = true;
    try { const c = await call('commit', { token: session.token, candidate: $('candidate').value, name: $('import-name').value }); session = null; $('import-dialog').close(); await refresh(); tab('library'); await select(c.key); notice('素材已加入角色库。请检查动作，再点击“放到桌面”。'); }
    catch (error) { $('import-error').textContent = error.message; }
    finally { $('confirm-import').disabled = false; }
  };
  const cancelImport = guard(async () => { if (session) await call('discard', { token: session.token }); session = null; $('import-dialog').close(); });
  $('cancel-import').onclick = cancelImport; $('import-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelImport(); });
  $('details').onsubmit = guard(async event => { event.preventDefault(); const key = selected; await call('update', { key, changes: { name: $('character-name').value, bindings: { idle: $('idle-motion').value, click: $('click-motion').value, expression: $('expression').value }, framing: { zoom: +$('zoom').value, offsetX: +$('offset-x').value, offsetY: +$('offset-y').value } } }); await refresh(); await select(key); notice('角色设置已保存。'); });
  $('reset-framing').onclick = () => { $('zoom').value = 1; $('offset-x').value = 0; $('offset-y').value = 0; $('zoom-value').textContent = '1.00×'; };
  $('zoom').oninput = () => $('zoom-value').textContent = Number($('zoom').value).toFixed(2) + '×';
  $('remove').onclick = guard(async () => { if (await call('remove', { key: selected })) { await refresh(); await select(null); notice('已移出角色库，原文件保留。'); } });
  $('activate').onclick = guard(async () => { if (previewReady) { await call('activate', { key: selected,slot:$('target-slot').value }); notice('已放到桌面。工坊按钮会同步控制桌面上的同一角色。'); } });
  $('play-motion').onclick = guard(async () => { const name = $('click-motion').value || $('idle-motion').value; if (name && model) await controlsUI.act({type:'motion',name}); });
  $('apply-expression').onclick = guard(async () => { if ($('expression').value && model) await controlsUI.act({type:'expression',name:$('expression').value}); });
  $('expression').onchange = updateButtons;
  $('rescan-resources').onclick=guard(async()=>{const key=selected;await call('rescan',{key});await refresh();await select(key);notice('已重新扫描资源，角色位置和控制设置已保留。');});
  $('stop-preview').onclick = guard(async () => { if (model)await controlsUI.act({type:'stop'}); });
  for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => tab(button.dataset.tab);
  $('show-controls').onclick=()=>{tab('library');$('control-panel').scrollIntoView({behavior:'smooth',block:'start'});};
  for (const name of ['select-engine','select-java','open-editor','cancel-job']) $(name).onclick = guard(async () => { await call(name); await refresh(); });
  $('generate').onclick = guard(async () => { const job = await call('generate'); if (job) { notice('制作任务已开始，原素材已另存。'); await refresh(); } });
  $('open-image-lab').onclick = guard(() => call('open-image-lab'));
  controlsUI=new WorkshopControlsUI({call,notice,fit,getItem:item});
  await refresh();
  if(state.items.length)await select(state.items[0].key);
  setInterval(async () => { try { const next = await call('state'); state.jobs = next.jobs; state.verification = next.verification; renderVerification(next.verification); renderJobs(); $('generate').disabled = !state.engine.ready || state.jobs.some(j => j.status === 'running'); } catch {} }, 2500);
  window.workshopDebug = { refresh, select, state: () => state, previewReady: () => previewReady };
})().catch(error => { document.getElementById('notice').hidden = false; document.getElementById('notice').textContent = error.message; });
