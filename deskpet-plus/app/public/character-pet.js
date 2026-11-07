(async () => {
  if (window.parent !== window) {
    window.petAPI = window.parent.createPetSlotAPI(new URLSearchParams(location.search).get('slot'));
    document.body.classList.add('embedded-pet');
  }
  const [catalogue, initialSettings, interactionAssets] = await Promise.all([window.petAPI.getCharacters(), window.petAPI.getSettings(), fetch('/interaction-data.json').then(r => r.json())]);
  let settings = initialSettings;
  const canvas = document.getElementById('stage'), bubble = document.getElementById('bubble');
  const hint = document.getElementById('drag-hint'), status = document.getElementById('status'), voice = document.getElementById('voice-player');
  const updateHint = () => {
    hint.textContent = settings.dualEnabled ? '拖动人物可一起移动 · 点击播放台词' : '拖动人物可移动 · 点击播放台词';
    document.getElementById('toolbar').hidden = !!(settings.dualEnabled && settings.slot === 'left');
    document.body.classList.toggle('position-locked', settings.displayLocked);
    const lock = document.getElementById('lock-button'); lock.classList.toggle('locked', settings.displayLocked);
    lock.setAttribute('aria-pressed', String(settings.displayLocked));
    const label = settings.displayLocked ? '解锁：允许移动，全屏时让出显示' : '锁定显示与位置，持续随机互动';
    lock.title = label; lock.setAttribute('aria-label', label);
    if (settings.displayLocked) hint.textContent = '已锁定位置 · 点击人物播放台词';
  };
  updateHint();
  const factor = () => settings.sizePercent / 100;
  const app = new PIXI.Application({ view: canvas, width: 167, height: 173, backgroundAlpha: 0, antialias: true,
    resolution: window.devicePixelRatio || 1, autoDensity: true });
  voice.volume = settings.voiceVolume / 100;
  let character, outfit, model, performer, lines = [], loadedKey = '', profileLoading = false, profileRequest = 0;
  let performing = false, modeTask, modeController, performanceFailure = '';
  let media = { playing: false, haruhikage: false }, inactive = false, foregroundApp = false;
  let actionController, idleTimer, temporaryMask, preview, previewTimer, songController, songTimer;
  let hintDelay, hintTimer, bubbleTimer, pointerStart, actionIndex = 0, performanceIndex = 0, lastIdle = '';
  let interaction = null, interactionController, interactionMotionController, lastSceneStatus = '';
  const heldFaces = new Map(), interactionHistory = [];
  const toneExpressions = { N:'idle01', S:'smile01', H:'smile01', C:'kime01', F:'serious01', Q:'surprised02', U:'surprised01', Y:'shy01', B:'bsmile01', A:'angry01', E:'smile01', T:'idle02', R:'smile01', D:'cry03', L:'sad01' };
  const toneMotions = { N:'nod01', S:'smile01', H:'smile01', C:'kime01', F:'serious01', Q:'question01', U:'surprised01', Y:'nod01', B:'nod01', A:'angry01', E:'nod01', T:'thinking01', R:'nod01', D:'cry01', L:'sad01' };
  const textureReferences = new Map(), baseReferences = new Map();
  function trackModel(target) {
    for (const texture of new Set(target.textures)) {
      textureReferences.set(texture, (textureReferences.get(texture) || 0) + 1);
      baseReferences.set(texture.baseTexture, (baseReferences.get(texture.baseTexture) || 0) + 1);
    }
    return target;
  }
  function releaseModel(target) {
    target.petController?.dispose();
    const textures = [...new Set(target.textures)];
    target.destroy();
    for (const texture of textures) {
      const base = texture.baseTexture, count = textureReferences.get(texture) - 1, baseCount = baseReferences.get(base) - 1;
      if (count) textureReferences.set(texture, count);
      else { textureReferences.delete(texture); texture.destroy(false); }
      if (baseCount) baseReferences.set(base, baseCount);
      else { baseReferences.delete(base); base.destroy(); }
    }
  }
  const requestedKey = () => `${settings.character}/${settings.outfit}`;
  const requestedCharacter = () => catalogue.find(c => c.key === settings.character);
  const haruhikageCharacters = new Set(['sakiko', 'tomori', 'taki', 'soyo', 'mutsumi']);
  const songActive = () => !!(!settings.dualEnabled && media.playing && media.haruhikage && haruhikageCharacters.has(character?.key));
  const wantsPerformance = () => !character?.custom && character?.performance?.available !== false && performanceFailure !== character?.key && (!!preview && preview.kind === 'performance' || media.playing && !songActive());
  const stageOutfit = () => !!outfit?.stageCostume;
  const maskWanted = () => {
    if (!outfit?.maskAvailable) return 0;
    if (!temporaryMask) return settings.maskOn ? 1 : 0;
    const t = Math.min(1, (Date.now() - temporaryMask.start) / 850);
    return temporaryMask.from + (temporaryMask.to - temporaryMask.from) * t;
  };
  function report(loading, error = '') {
    window.petAPI.profileStatus({ loading, character: settings.character, outfit: settings.outfit, error });
    status.classList.toggle('hidden', !loading && !error);
    if (loading) status.textContent = `正在准备${requestedCharacter().name}…`;
    else if (error) status.textContent = '加载失败，请重新选择人物或服装';
  }
  function place(target) {
    if (!target) return;
    const frame = target.petFraming;
    if (frame.auto) {
      const bounds = target.petLocalBounds || (target.petLocalBounds = target.getLocalBounds());
      const scale = Math.min(155 / Math.max(1, bounds.width), 165 / Math.max(1, bounds.height)) * frame.zoom;
      target.scale.set(scale * factor());
      target.position.set(((167 - bounds.width * scale) / 2 - bounds.x * scale + frame.offsetX) * factor(), ((173 - bounds.height * scale) / 2 - bounds.y * scale + frame.offsetY) * factor());
      return;
    }
    target.scale.set(frame.scale * factor());
    target.position.set(frame.x * factor(), (target.petY ?? frame.y) * factor());
  }
  function resize() {
    const width = Math.round(167 * factor()), height = Math.round(173 * factor());
    document.body.style.setProperty('--pet-width', width + 'px');
    document.body.style.setProperty('--pet-height', height + 'px');
    app.renderer.resize(width, height);
    place(model); place(performer);
  }
  function resetGaze() {
    model?.internalModel.focusController.focus(0, 0, true);
    performer?.internalModel.focusController.focus(0, 0, true);
  }
  function setExpression(target, name) {
    if (!target) return;
    const manager = target.internalModel.motionManager.expressionManager;
    if (name && name === target.petExpression && manager && !manager.isFinished()) return;
    target.petExpression = name;
    const revision = target.petExpressionRevision = (target.petExpressionRevision || 0) + 1;
    manager?.stopAllExpressions();
    if (manager) manager.reserveExpressionIndex = -1;
    if (!name || !manager) return;
    const index = manager.getExpressionIndex(name);
    if (index >= 0 && manager.currentExpression === manager.expressions[index]) { manager.restoreExpression(); return; }
    target.expression(name).then(() => {
      if (!target.destroyed && revision !== target.petExpressionRevision) setExpression(target, target.petExpression);
    }).catch(error => console.warn('Expression unavailable', name, error));
  }
  function frameControls(target, isPerformance) {
    const core = target.internalModel.coreModel;
    if (target.petCharacter.custom) {
      if (!settings.eyesOpen) { core.setParameterValueById('ParamEyeLOpen', 0); core.setParameterValueById('ParamEyeROpen', 0); }
      return;
    }
    const masked = isPerformance ? target.petCharacter.performance.maskAvailable && settings.performanceMask :
      target.petOutfit.maskAvailable && maskWanted() > 0.5;
    if ((isPerformance && target.petCharacter.performance.maskAvailable) || (!isPerformance && target.petOutfit.maskAvailable)) {
      core.setParameterValueById('ParamMask', isPerformance ? (masked ? 1 : 0) : maskWanted());
    }
    if (masked && !isPerformance) {
      for (const p of target.petOutfit.neutralParameters) {
        if (!/^Param(Eye(?!Ball)|Brow|Mouth|Tear)/.test(p.Id)) continue;
        const value = target.petOutfit.parameterDefaults[p.Id] ?? 0;
        core.setParameterValueById(p.Id, p.Blend === 'Overwrite' ? p.Value : p.Blend === 'Multiply' ? value * p.Value : value + p.Value);
      }
    }
    if (interaction) applyInteractionFace(target, isPerformance, masked);
    if (!isPerformance && (masked || (!songActive() && !target.petExpression?.startsWith('exp_cry') && !interaction?.codes.includes('D')))) {
      core.setParameterValueById('ParamTear', 0); core.setParameterValueById('ParamTear2', 0);
    } else if (!isPerformance && songActive() && !masked) core.setParameterValueById('ParamTear', 1);
    if (isPerformance && target.petCharacter.performance.instrumentVisibility && target.petInstrument !== undefined) {
      core.setParameterValueById(target.petCharacter.performance.instrumentVisibility.parameter, target.petInstrument);
    }
    if (!settings.eyesOpen) { core.setParameterValueById('ParamEyeLOpen', 0); core.setParameterValueById('ParamEyeROpen', 0); }
    target.petRendered = { mask: core.getParameterValueById('ParamMask'), tear: core.getParameterValueById('ParamTear'), browLeft: core.getParameterValueById('ParamBrowLY'), cheek: core.getParameterValueById('ParamCheek'),
      leftEye: core.getParameterValueById('ParamEyeLOpen'), rightEye: core.getParameterValueById('ParamEyeROpen') };
  }
  function applyInteractionFace(target, isPerformance, masked) {
    const faces = interactionAssets.faces[character.key];
    if (!faces?.outfits?.[outfit.key]) return;
    const available = faces.outfits[outfit.key];
    const codes = interaction.codes || ['N'], age = Date.now() - interaction.started;
    const code = codes[Math.min(codes.length - 1, Math.floor(age / Math.max(800, interaction.duration * 350)))];
    let name = 'exp_' + toneExpressions[code] + '.exp3';
    if (!available[name]) name = code === 'Q' ? 'exp_surprised01.exp3' : code === 'D' ? outfit.moods.哭泣.expression : 'exp_idle01.exp3';
    if (masked) name = 'exp_idle01.exp3';
    const params = available[name] || [], defaults = isPerformance ? faces.performanceDefaults : outfit.parameterDefaults;
    const core = target.internalModel.coreModel;
    if (!heldFaces.has(target)) heldFaces.set(target, new Map());
    if (target.petReaction !== name) { target.petReaction = name; target.petReactionStart = Date.now(); target.petReactionFrom = new Map(); }
    const weight = Math.min(1, (Date.now() - target.petReactionStart) / 350);
    for (const p of params) {
      if (!(p.Id in defaults) || !/Eye|Brow|Mouth|Cheek|Tear|Emo|smile|angry|sad|fun|serious|surprised|Pale|Sweat|Faceshadow|FaceEye|FaceBrow/i.test(p.Id) || /Mask|Instrument/i.test(p.Id)) continue;
      const original = core.getParameterValueById(p.Id), baseline = defaults[p.Id];
      if (!heldFaces.get(target).has(p.Id)) heldFaces.get(target).set(p.Id, original);
      if (!target.petReactionFrom.has(p.Id)) target.petReactionFrom.set(p.Id, original);
      const value = p.Blend === 'Overwrite' ? p.Value : p.Blend === 'Multiply' ? baseline * p.Value : baseline + p.Value;
      const from = target.petReactionFrom.get(p.Id);
      core.setParameterValueById(p.Id, from + (value - from) * weight);
    }
  }
  function releaseInteraction(group, immediate = true) {
    if (!interaction || group && interaction.group !== group) return;
    const current = interaction;
    const finish = () => {
      if (interaction !== current) return;
      interactionController?.abort(); interactionMotionController?.abort(); voice.pause(); bubble.classList.remove('visible');
      for (const [target, params] of heldFaces) if (!target.destroyed) { for (const [id, value] of params) target.internalModel.coreModel.setParameterValueById(id, value); target.petReaction = null; }
      heldFaces.clear(); temporaryMask = null; interaction = null;
      if (!performing) returnToIdle(); reconcile();
    };
    if (immediate) finish(); else setTimeout(finish, 800);
  }
  async function interactionLine(segment, speaking, signal) {
    if (speaking && settings.showLines) { bubble.textContent = segment[settings.language] || segment.zh; bubble.classList.add('visible'); }
    if (speaking && segment.audio && settings.voiceEnabled) { voice.src = segment.audio; voice.play().catch(() => {}); }
    if (!await delayFor((segment.duration || 3) * 1000 + 150, signal)) return;
    if (speaking && !voice.paused && !voice.ended) {
      const until = Date.now() + 3000;
      while (!signal.aborted && !voice.paused && !voice.ended && Date.now() < until) await delayFor(60, signal);
    }
  }
  async function runInteraction(command) {
    let ok = false, error = '';
    try {
      if (!settings.dualEnabled || profileLoading || !model || preview || modeTask || command.reaction && command.reaction.character !== character.key) throw new Error('Character is switching');
      if (interaction && interaction.group !== command.group) releaseInteraction(null);
      interactionController?.abort(); interactionMotionController?.abort(); stopAction(); stopSong(); resetGaze();
      setExpression(model, null); voice.pause(); clearTimeout(bubbleTimer); bubble.classList.remove('visible');
      const controller = interactionController = new AbortController(), motionController = interactionMotionController = new AbortController();
      let motion, codes = command.reaction?.codes || ['N'];
      if (command.kind === 'gesture') {
        const choices = character.interactions.idle.filter(m => m !== lastIdle);
        if (outfit.maskAvailable && !performing && lastIdle !== 'mask') choices.push('mask');
        motion = choices[Math.floor(Math.random() * choices.length)]; lastIdle = motion;
        const found = Object.entries(toneMotions).find(([, suffix]) => motion === 'mtn_' + suffix + '_C'); codes = [found?.[0] || 'N'];
      } else motion = 'mtn_' + (command.speaking ? toneMotions[codes[0]] : ['Q','U','A','Y'].includes(codes[0]) ? toneMotions[codes[0]] : 'nod01') + '_C';
      const current = interaction = { group: command.group, phase: command.phase, kind: command.kind, speaking: !!command.speaking, codes,
        segment: command.segment, started: Date.now(), duration: command.segment?.duration || outfit.motionDurations[motion] || 3 };
      interactionHistory.push({ group: command.group, phase: command.phase, speaking: !!command.speaking, codes, audio: command.speaking ? command.segment?.audio || null : null });
      if (interactionHistory.length > 30) interactionHistory.shift();
      const movement = performing || wantsPerformance() ? Promise.resolve() : motion === 'mask' ? maskAction(model, motionController.signal) : playOnce(model, motion, motionController.signal);
      await Promise.all([movement, interactionLine(command.segment || { duration: current.duration }, !!command.speaking, controller.signal)]);
      ok = !controller.signal.aborted && interaction === current;
      if (interaction === current) { voice.pause(); bubble.classList.remove('visible'); }
    } catch (e) { error = String(e.message || e); }
    window.petAPI.interactionDone({ requestId: command.requestId, ok, error });
  }
  async function safeMotion(target, name, priority = 3) {
    if (target?.petCharacter.custom && /^mtn_/.test(name || '')) name = target.petCharacter.bindings.idle;
    if (!target || target.destroyed || !target.internalModel.motionManager.definitions[name]) return false;
    try { return await target.motion(name, 0, priority); } catch (error) { console.warn('Motion unavailable', name, error); return false; }
  }
  function stopAction() { actionController?.abort(); actionController = null; clearTimeout(idleTimer); temporaryMask = null; }
  function stopSong() { songController?.abort(); songController = null; clearTimeout(songTimer); songTimer = null; }
  function clearPreview(announce = true) {
    const previous = preview;
    preview = null; clearTimeout(previewTimer); stopAction();
    if (announce && previous) window.petAPI.previewStatus({ active: false, message: '预览已结束，已恢复原先状态。' });
  }
  async function playOnce(target, motion, signal) {
    if (!target || signal.aborted) return false;
    const started = await safeMotion(target, motion);
    if (!started || signal.aborted || target !== model) return false;
    const manager = target.internalModel.motionManager;
    return new Promise(resolve => {
      let timeout;
      const finish = value => { clearTimeout(timeout); manager.off('motionFinish', onFinish); signal.removeEventListener('abort', onAbort); resolve(value); };
      const onFinish = () => finish(true), onAbort = () => finish(false);
      manager.on('motionFinish', onFinish); signal.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => finish(false), ((target.petOutfit.motionDurations[motion] || 8) + 3) * 1000);
      if (signal.aborted) onAbort();
    });
  }
  function expressionFor(motion) {
    return Object.values(outfit.moods).find(m => m.motion === motion)?.expression || null;
  }
  function idleMotion(force = false) {
    if(character?.custom){model?.petController?.playIdle();return;}
    if (!model || profileLoading || performing || wantsPerformance() || preview || actionController || songActive() || interaction) return;
    if (!force && model.internalModel.motionManager.playing) return;
    setExpression(model, character.custom ? character.bindings.expression : null); safeMotion(model, 'mtn_idle01_C', force ? 3 : 1);
  }
  function returnToIdle() {
    if(character?.custom){model?.petController?.playIdle();return;}
    if (!model || performing || interaction) return;
    setExpression(model, character.custom ? character.bindings.expression : songActive() ? outfit.moods.哭泣.expression : null);
    safeMotion(model, 'mtn_idle01_C');
  }
  function delayFor(ms, signal) {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      const done = value => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(value); };
      const abort = () => done(false), timer = setTimeout(() => done(true), ms);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  async function maskAction(target, signal) {
    const original = settings.maskOn ? 1 : 0, start = Date.now();
    setExpression(target, null);
    temporaryMask = { from: original, to: 1 - original, start };
    if (!await playOnce(target, 'mtn_maskoff01_C', signal) || signal.aborted) return;
    if (!await delayFor(Math.max(0, 5000 - (Date.now() - start)), signal)) return;
    temporaryMask = { from: 1 - original, to: original, start: Date.now() };
    await playOnce(target, 'mtn_maskoff01_C', signal);
    if (!signal.aborted) temporaryMask = null;
  }
  async function runAction(motion, purpose) {
    if(character?.custom){if(motion)await model.petController.command({type:'motion',name:motion}).catch(error=>console.warn(error.message));return;}
    stopAction(); resetGaze();
    const controller = actionController = new AbortController(), target = model;
    if (motion === 'mask') await maskAction(target, controller.signal);
    else { setExpression(target, expressionFor(motion)); await playOnce(target, motion, controller.signal); }
    if (controller.signal.aborted || target !== model) return;
    actionController = null; temporaryMask = null;
    returnToIdle();
    if (purpose === 'preview') { clearPreview(); reconcile(); }
    else if (purpose === 'idle' && inactive) idleTimer = setTimeout(() => { idleTimer = null; beginIdle(); }, 10000);
  }
  function beginIdle() {
    if (!model || !inactive || settings.dualEnabled || profileLoading || performing || wantsPerformance() || preview || songActive() || interaction) return;
    const choices = character.interactions.idle.filter(m => m !== lastIdle);
    if (character.custom && !choices.length) { idleMotion(); return; }
    if (outfit.maskAvailable && lastIdle !== 'mask') choices.push('mask');
    const motion = foregroundApp && !settings.displayLocked ? 'mtn_thinking01_C' : choices[Math.floor(Math.random() * choices.length)];
    lastIdle = motion; runAction(motion, 'idle');
  }
  async function sob() {
    if (!model || !songActive() || profileLoading || performing || wantsPerformance() || preview || songController || songTimer) return;
    stopAction(); resetGaze();
    const target = model, controller = songController = new AbortController();
    setExpression(target, outfit.moods.哭泣.expression);
    await playOnce(target, outfit.moods.哭泣.motion, controller.signal);
    if (controller.signal.aborted || target !== model || !songActive()) return;
    songController = null; returnToIdle();
    songTimer = setTimeout(() => { songTimer = null; sob(); }, 18000);
  }
  function reconcile() {
    if (profileLoading || !model) return;
    if(character.custom){model.petController?.playIdle();return;}
    if (performing !== wantsPerformance()) { syncMode(); return; }
    if (performing || preview || actionController || interaction) return;
    if (songActive()) sob();
    else if (inactive && !idleTimer) beginIdle();
    else idleMotion();
  }
  function animate(target, from, to, duration, signal, property = 'y') {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      const frame = now => {
        if (signal.aborted || target.destroyed) { reject(new DOMException('Cancelled', 'AbortError')); return; }
        const t = Math.min(1, (now - start) / duration), ease = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const value = from + (to - from) * ease;
        if (property === 'instrument') target.petInstrument = value;
        else { target.petY = value; place(target); }
        if (t < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
  }
  async function ensurePerformer() {
    if (performer) return performer;
    const owner = character;
    const next = trackModel(await PIXI.live2d.Live2DModel.from(owner.performance.model, { autoInteract: false, autoUpdate: true }));
    if (owner !== character || profileLoading) { releaseModel(next); throw new DOMException('Cancelled', 'AbortError'); }
    next.anchor.set(0, 0); next.petFraming = owner.performance.framing; next.petCharacter = owner;
    next.internalModel.on('beforeModelUpdate', () => frameControls(next, true));
    next.internalModel.motionManager.on('motionFinish', () => {
      if (next === performer && performing && wantsPerformance() && !modeTask) playPerformance();
    });
    performer = next; next.visible = false; app.stage.addChild(next); place(next);
    return next;
  }
  function playPerformance() {
    const sequence = character.performance.sequences[0];
    safeMotion(performer, sequence[performanceIndex++ % sequence.length]);
  }
  function restoreDaily() {
    performing = false;
    document.body.classList.remove('performing');
    if (performer) { performer.visible = false; performer.petY = performer.petFraming.y; performer.internalModel.motionManager.stopAllMotions(); }
    if (model) { model.visible = true; model.alpha = 1; model.petY = model.petFraming.y; place(model); }
  }
  function syncMode() {
    if (modeTask || profileLoading || !model || performing === wantsPerformance()) return;
    const controller = modeController = new AbortController();
    modeTask = (async () => {
      interactionMotionController?.abort();
      stopAction(); stopSong(); resetGaze(); bubble.classList.remove('visible');
      while (!profileLoading && performing !== wantsPerformance()) {
        if (wantsPerformance()) {
          await ensurePerformer();
          if (controller.signal.aborted || !wantsPerformance()) return;
          const sameCostume = stageOutfit();
          document.body.style.setProperty('--performance-bottom-cut', character.performance.bottomCut + '%');
          document.body.classList.add('performing');
          setExpression(model, null);
          await safeMotion(performer, 'mtn_idle_01');
          if (sameCostume && character.performance.instrumentVisibility) {
            performer.petInstrument = 0; performer.petY = performer.petFraming.y; performer.visible = true; place(performer); model.visible = false;
            await animate(performer, 0, 1, 1450, controller.signal, 'instrument');
          } else {
            if (!sameCostume) await animate(model, model.petFraming.y, 190, 1150, controller.signal);
            model.visible = false; performer.visible = true;
            await animate(performer, 190, performer.petFraming.y, 1300, controller.signal);
          }
          performing = true; performanceIndex = 0; performer.petInstrument = undefined; playPerformance();
        } else {
          if (performer) await animate(performer, performer.petFraming.y, 190, 1150, controller.signal);
          if (performer) { performer.visible = false; performer.internalModel.motionManager.stopAllMotions(); }
          document.body.classList.remove('performing');
          model.visible = true;
          await animate(model, 190, model.petFraming.y, 1150, controller.signal);
          performing = false; returnToIdle();
        }
      }
    })().catch(error => {
      restoreDaily();
      if (error.name !== 'AbortError') { console.error('Performance failed', error); performanceFailure = character.key; report(false, error.message); clearPreview(); }
    }).finally(() => {
      modeTask = null; modeController = null;
      if (!profileLoading) reconcile();
    });
  }
  async function loadProfile() {
    profileRequest++;
    if (profileLoading) return;
    profileLoading = true;
    releaseInteraction(null);
    clearPreview(); stopAction(); stopSong(); resetGaze();
    voice.pause(); bubble.classList.remove('visible');
    modeController?.abort();
    if (modeTask) await modeTask;
    try {
      while (requestedKey() !== loadedKey) {
        report(true);
        const version = profileRequest, owner = requestedCharacter(), clothing = owner.outfits.find(o => o.key === settings.outfit);
        const next = trackModel(await PIXI.live2d.Live2DModel.from(clothing.model, { autoInteract: false, autoUpdate: true }));
        let nextLines;
        try { nextLines = owner.custom ? [] : owner === character ? lines : await fetch(owner.lines).then(r => { if (!r.ok) throw new Error('台词加载失败'); return r.json(); }); }
        catch (error) { console.warn('角色台词暂不可用', error); nextLines = []; }
        if (version !== profileRequest || `${owner.key}/${clothing.key}` !== requestedKey()) { releaseModel(next); continue; }
        const keepPerformance = owner === character && performing && !!performer;
        if (model) { app.stage.removeChild(model); releaseModel(model); }
        if (performer && owner !== character) { app.stage.removeChild(performer); releaseModel(performer); performer = null; }
        character = owner; outfit = clothing; model = next; lines = nextLines;
        loadedKey = `${owner.key}/${clothing.key}`; performanceFailure = ''; lastIdle = '';
        next.anchor.set(0, 0); next.petFraming = clothing.framing; next.petCharacter = owner; next.petOutfit = clothing;
        if(owner.custom)next.petController=new CharacterControls.Controller(next,owner);
        next.internalModel.on('beforeModelUpdate', () => frameControls(next, false));
        next.internalModel.motionManager.on('motionFinish', () => {if(!owner.custom)setTimeout(() => { if (next === model) idleMotion(); }, 80);});
        app.stage.addChildAt(next, 0); place(next); if(owner.custom)next.petController.playIdle();else safeMotion(next, 'mtn_idle01_C', 1);
        if (keepPerformance) next.visible = false;
        else restoreDaily();
        document.title = `${owner.name} · 邦多利桌宠`;
        canvas.setAttribute('aria-label', owner.name + '桌宠');
      }
      report(false);
    } catch (error) { console.error('Profile failed', error); report(false, error.message); }
    finally { profileLoading = false; if (requestedKey() === loadedKey) reconcile(); }
  }
  function startPreview({ kind, motion }) {
    if(character?.custom&&model?.petController){if(kind==='stop')model.petController.stop();else if(kind==='idle')model.petController.command({type:'motion',name:motion}).catch(error=>console.warn(error.message));window.petAPI.previewStatus({active:false,message:'已触发角色动作，更多控制请打开角色工坊。'});return;}
    if (kind === 'stop') { clearPreview(); returnToIdle(); reconcile(); return; }
    if (!model || profileLoading || modeTask || (kind !== 'performance' && (performing || media.playing))) {
      window.petAPI.previewStatus({ active: false, message: '正在切换或演奏，请稍后预览这个动作。' }); return;
    }
    if (kind === 'mask' && !outfit.maskAvailable) { window.petAPI.previewStatus({ active: false, message: '当前服装没有可佩戴的面具。' }); return; }
    releaseInteraction(null); clearPreview(false); stopSong(); stopAction(); preview = { kind, motion }; resetGaze();
    window.petAPI.previewStatus({ active: true, message: kind === 'performance' ? `正在预览${character.role}表演，约 15 秒后结束。` : '正在预览动作，播放一次后自动结束。' });
    if (kind === 'performance') { syncMode(); previewTimer = setTimeout(() => { clearPreview(); reconcile(); }, 15000); }
    else if (kind === 'mask') runAction('mask', 'preview');
    else if (outfit.motions.some(m => m.name === motion)) runAction(motion, 'preview');
    else clearPreview();
  }
  function playLine() {
    if (!lines.length) return;
    const line = lines[Math.floor(Math.random() * lines.length)];
    if (settings.showLines) { bubble.textContent = line[settings.language] || line.zh || line.ja; bubble.classList.add('visible'); clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => bubble.classList.remove('visible'), 6000); }
    voice.pause();
    if (settings.voiceEnabled && line.audio) { voice.src = line.audio; voice.play().catch(error => console.warn('Voice failed', error)); }
  }
  function clickCharacter() {
    if (!profileLoading && !performing && !modeTask && !preview && !songActive() && !interaction) {
      playLine();
      const motion = character.custom ? character.bindings.click : character.interactions.click[actionIndex++ % character.interactions.click.length];
      if (motion) runAction(motion, 'click');
    }
  }
  function hideHint() { clearTimeout(hintDelay); clearTimeout(hintTimer); hint.classList.remove('visible'); }
  resize(); document.body.classList.add('bubble-side-left');
  window.petAPI.onSettings(next => {
    const previousKey = requestedKey(), previousMask = settings.maskOn, previousSong = songActive();
    settings = next; resize(); updateHint();
    voice.volume = settings.voiceVolume / 100;
    if (!settings.dualEnabled) releaseInteraction(null);
    if (requestedKey() !== previousKey) { loadProfile(); return; }
    if (previousSong && !songActive()) { stopSong(); setExpression(model, null); }
    if (previousMask !== settings.maskOn && preview?.kind === 'mask') { clearPreview(); returnToIdle(); reconcile(); }
    if (!settings.followMouse || media.playing || performing || inactive || preview || actionController) resetGaze();
    if (!settings.showLines) bubble.classList.remove('visible');
    if (!settings.voiceEnabled) voice.pause();
    reconcile();
  });
  window.petAPI.onMediaState(next => {
    const previousSong = songActive(); media = next;
    if (media.playing) { resetGaze(); stopAction(); if (preview && preview.kind !== 'performance') clearPreview(); }
    if (previousSong && !songActive()) { stopSong(); setExpression(model, null); performanceFailure = ''; }
    if (!media.playing) performanceFailure = '';
    reconcile();
  });
  window.petAPI.onActivityState(state => {
    const changed = inactive !== state.inactive || foregroundApp !== state.appOpen;
    inactive = state.inactive; foregroundApp = state.appOpen;
    if (!changed || interaction || preview || songActive() || performing || modeTask || profileLoading) return;
    stopAction(); returnToIdle(); reconcile();
  });
  window.petAPI.onPreviewAction(startPreview);
  window.petAPI.onBubbleSide(side => { if (side && typeof side === 'object') { bubble.style.left = side.left + 'px'; bubble.style.width = side.width + 'px'; } });
  window.petAPI.onInteraction(runInteraction);
  window.petAPI.onInteractionEnd(value => releaseInteraction(value.group, value.immediate));
  window.petAPI.onCharacterCommand(value=>{
    const owner=catalogue.find(c=>c.key===value.key);
    if(owner){if(value.framing)owner.outfits[0].framing=value.framing;if(value.state)owner.runtimeState=value.state;}
    if(character?.key!==value.key||!model?.petController)return;
    if(value.framing){model.petFraming=value.framing;place(model);}
    if(value.command)model.petController.command(value.command,value.state).catch(error=>console.warn(error.message));
  });
  window.petAPI.onCursor(cursor => {
    if(character?.custom){model?.petController?.setCursor(cursor,settings.followMouse&&!settings.dualEnabled);return;}
    if (model && settings.followMouse && !media.playing && !performing && !inactive && !preview && !actionController && !profileLoading && !modeTask) model.internalModel.focusController.focus(cursor.x, cursor.y);
  });
  window.petAPI.onDailyNotice(value => {
    const accepted = !!model && !profileLoading && !preview && !modeTask && !interaction && (value.manual || !media.playing && !performing);
    window.petAPI.dailyNoticeResult({ id: value.id, accepted, manual: value.manual });
    if (!accepted) return;
    bubble.textContent = value.text; bubble.classList.add('visible'); clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('visible'), 6000);
    if (!value.manual) runAction('mtn_nod01_C', 'notice');
  });
  canvas.addEventListener('pointerenter', () => { hideHint(); hintDelay = setTimeout(() => { hint.classList.add('visible'); hintTimer = setTimeout(hideHint, 1100); }, 250); });
  canvas.addEventListener('pointerleave', hideHint);
  window.petInput = { click: clickCharacter, hover: active => { hideHint(); if (active) hintDelay = setTimeout(() => { hint.classList.add('visible'); hintTimer = setTimeout(hideHint, 1100); }, 250); } };
  document.getElementById('settings-button').addEventListener('click', event => { event.stopPropagation(); window.petAPI.openSettings(); });
  document.getElementById('lock-button').addEventListener('click', event => { event.stopPropagation(); window.petAPI.setSetting('displayLocked', !settings.displayLocked); });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    hideHint(); pointerStart = { id: event.pointerId, x: event.screenX, y: event.screenY, moved: false };
    canvas.setPointerCapture(event.pointerId); if (!settings.displayLocked) window.petAPI.beginDrag();
  });
  canvas.addEventListener('pointermove', event => { if (pointerStart && event.pointerId === pointerStart.id && Math.hypot(event.screenX - pointerStart.x, event.screenY - pointerStart.y) > 5) pointerStart.moved = true; });
  function finishPointer(event) {
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    const moved = pointerStart.moved || Math.hypot(event.screenX - pointerStart.x, event.screenY - pointerStart.y) > 5;
    pointerStart = null; window.petAPI.endDrag();
    if (!moved && event.type === 'pointerup' && !profileLoading && !performing && !modeTask && !preview && !songActive() && !interaction) {
      clickCharacter();
    }
  }
  canvas.addEventListener('pointerup', finishPointer); canvas.addEventListener('pointercancel', finishPointer);
  window.addEventListener('blur', () => { if (pointerStart) { pointerStart = null; window.petAPI.endDrag(); } });
  window.petDebug = () => ({ character: character?.key, outfit: outfit?.key, loadedKey, profileLoading, performing, slot: settings.slot, dualEnabled: settings.dualEnabled, followMouse: settings.followMouse,
    desiredPerformance: wantsPerformance(), transitionBusy: !!modeTask, preview: preview?.kind || null,
    mediaPlaying: media.playing, haruhikagePlaying: songActive(), songAction: !!songController, songWaiting: !!songTimer, inactive, foregroundApp, lastIdle,
    lines: lines.length, expression: model?.petExpression || null, activeAction: !!actionController,
    locked: settings.displayLocked, volume: voice.volume, interaction: interaction && { group: interaction.group, phase: interaction.phase, speaking: interaction.speaking, codes: interaction.codes, expression: (performing ? performer : model)?.petReaction }, interactionHistory,
    sceneModels: app.stage.children.length, maskAvailable: outfit?.maskAvailable,
    mask: model?.petRendered?.mask, tear: model?.petRendered?.tear, eyes: model?.petRendered,
    performanceMask: performer?.petRendered?.mask, performanceFace: performer?.petRendered,
    gaze: model && { x: model.internalModel.focusController.targetX, y: model.internalModel.focusController.targetY },
    model: model && { x: model.x, y: model.y, scale: model.scale.x, visible: model.visible },
    performer: performer && { x: performer.x, y: performer.y, scale: performer.scale.x, visible: performer.visible }
  });
  await loadProfile();
  window.petAPI.ready({ character: character?.key, outfit: outfit?.key, lines: lines.length });
  setInterval(() => {
    const value = { character: character?.key, outfit: outfit?.key, ready: !!model && !profileLoading && !modeTask && !preview, performing };
    const json = JSON.stringify(value); if (json !== lastSceneStatus) { lastSceneStatus = json; window.petAPI.sceneStatus(value); }
  }, 200);
})();
