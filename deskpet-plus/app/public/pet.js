(async () => {
  const OUTFITS = {
    school_winter_hs: '/model/adv_live2d_sakiko_010_school_winter_hs_1st.model3.json',
    school_summer_hs: '/models/adv_live2d_sakiko_010_school_summer_hs_1st/adv_live2d_sakiko_010_school_summer_hs_1st.model3.json',
    school_winter_jhs: '/models/adv_live2d_sakiko_010_school_winter_jhs/adv_live2d_sakiko_010_school_winter_jhs.model3.json',
    casual_spring: '/models/adv_live2d_sakiko_010_casual_spring_01/adv_live2d_sakiko_010_casual_spring_01.model3.json',
    live: '/models/adv_live2d_sakiko_010_live_01/adv_live2d_sakiko_010_live_01.model3.json',
    live_mask: '/models/adv_live2d_sakiko_010_live_01_mask/adv_live2d_sakiko_010_live_01_mask.model3.json'
  };
  const PIANO_FILE = '/models/live2d_sakiko_010_live_01/live2d_sakiko_010_live_01.model3.json';
  const canvas = document.getElementById('stage');
  const bubble = document.getElementById('bubble');
  const dragHint = document.getElementById('drag-hint');
  const voicePlayer = document.getElementById('voice-player');
  const status = document.getElementById('status');
  voicePlayer.volume = 0.45;
  let settings = await window.petAPI.getSettings();
  const factor = () => (settings.sizePercent || 100) / 100;
  const app = new PIXI.Application({ view: canvas, width: Math.round(167 * factor()), height: Math.round(173 * factor()), backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
  let lines = [];
  let model;
  let piano;
  let currentOutfit;
  let modelVersion = 0;
  let performing = false;
  let desiredPerformance = false;
  let mediaPlaying = false;
  let haruhikagePlaying = false;
  let haruhikagePlayed = false;
  let haruhikageController = null;
  let haruhikageTimer = null;
  const HARUHIKAGE_SOB_GAP_MS = 18000;
  let previewKind = null;
  let previewTimer;
  let previewMaskTimer;
  let previewActionController;
  let transitionBusy = false;
  let pianoIndex = 0;
  let mouseInactive = false;
  let foregroundApp = false;
  let activityTimer;
  let maskTimer;
  let idleActionController;
  let temporaryMask = null;
  let bubbleTimer;
  let hintDelay;
  let hintTimer;
  let actionIndex = 0;
  let pointerStart = null;
  let chatActive = false;
  let currentChatMood = '平静';
  let pendingChatMood = null;
  let chatActionController;
  let chatExpression = 'exp_idle01.exp3';
  let noticeTimer;
  const chatMoods = {
    平静: ['mtn_nod01_C', 'exp_idle01.exp3'],
    开心: ['mtn_smile01_C', 'exp_smile01.exp3'],
    生气: ['mtn_angry01_C', 'exp_angry01.exp3'],
    难过: ['mtn_sad01_C', 'exp_sad01.exp3'],
    哭泣: ['mtn_cry01_C', 'exp_cry03.exp3'],
    惊讶: ['mtn_surprised01_C', 'exp_surprised01.exp3'],
    严肃: ['mtn_serious01_C', 'exp_serious01.exp3'],
    自信: ['mtn_kime01_C', 'exp_kime01.exp3'],
    疑惑: ['mtn_question01_C', 'exp_surprised02.exp3'],
    思考: ['mtn_thinking01_C', 'exp_idle02.exp3']
  };
  const clickActions = ['mtn_smile01_C', 'mtn_nod01_C', 'mtn_look01_C', 'mtn_question01_C', 'mtn_thinking01_C'];
  const idleActions = ['mtn_angry01_C', 'mtn_cry01_C', 'mtn_check01_C', 'mtn_kime01_C', 'mask', 'mtn_question01_C', 'mtn_sad01_C', 'mtn_thinking01_C'];
  let lastIdleAction = '';
  window.petDebug = () => ({
    performing, desiredPerformance, mediaPlaying, haruhikagePlaying, haruhikagePlayed,
    haruhikageTimerPending: haruhikageTimer !== null,
    expression: (() => {
      const manager = model?.internalModel.motionManager.expressionManager;
      return manager?.definitions[manager.expressions.indexOf(manager.currentExpression)]?.Name;
    })(),
    tear: model?.lastTear,
    gaze: model && {
      x: model.internalModel.focusController.targetX,
      y: model.internalModel.focusController.targetY
    },
    previewKind, mouseInactive, foregroundApp, lastIdleAction, chatActive, chatExpression,
    model: model && { width: model.width, height: model.height, x: model.x, y: model.y, scale: model.scale.x, visible: model.visible },
    piano: piano && { width: piano.width, height: piano.height, x: piano.x, y: piano.y, scale: piano.scale.x, visible: piano.visible }
  });
  document.body.classList.add('bubble-side-left');

  function baseY() { return -130 / 3 * factor(); }
  function pianoY() { return -15 * factor(); }
  function applySize() {
    const width = Math.round(167 * factor());
    const height = Math.round(173 * factor());
    document.body.style.setProperty('--pet-width', `${width}px`);
    document.body.style.setProperty('--pet-height', `${height}px`);
    app.renderer.resize(width, height);
    if (model) placeModel(model);
    if (piano) placePiano(piano);
  }
  function placeModel(target) {
    target.scale.set(target.petBaseScale * factor());
    target.position.set(83.5 * factor(), baseY());
  }
  function placePiano(target) {
    target.scale.set(target.petBaseScale * factor());
    target.position.set(83.5 * factor(), pianoY());
  }
  function hideHint() {
    clearTimeout(hintDelay); clearTimeout(hintTimer);
    dragHint.classList.remove('visible');
  }
  function resetGaze() {
    model?.internalModel.focusController.focus(0, 0, true);
  }
  function maskWanted() {
    if (temporaryMask !== null) {
      const progress = Math.min(1, (Date.now() - temporaryMask.start) / 850);
      return temporaryMask.from + (temporaryMask.to - temporaryMask.from) * progress;
    }
    return settings.maskOn ? 1 : 0;
  }
  function applyEyesAndMask(target, isPiano) {
    const core = target.internalModel.coreModel;
    target.lastTear = core.getParameterValueById('ParamTear');
    if (!settings.eyesOpen) {
      core.setParameterValueById('ParamEyeLOpen', 0);
      core.setParameterValueById('ParamEyeROpen', 0);
    }
    core.setParameterValueById('ParamMask', isPiano ? (settings.performanceMask ? 1 : 0) : maskWanted());
  }
  function safeMotion(target, name, priority = 2) {
    if (!target) return Promise.resolve(false);
    try { return Promise.resolve(target.motion(name, 0, priority)).catch(error => { console.warn('Motion unavailable:', name, error); return false; }); }
    catch (error) { console.warn('Motion unavailable:', name, error); return Promise.resolve(false); }
  }
  function setHaruhikageExpression(target, active) {
    if (!target) return;
    target.expression(active ? 'exp_cry03.exp3' : 'exp_idle01.exp3')
      .then(applied => {
        if (!applied || target !== model) return;
        if (chatActive) applyChatExpression(chatExpression);
        else if (active !== haruhikagePlaying) setHaruhikageExpression(target, haruhikagePlaying);
      })
      .catch(error => console.warn('Expression unavailable:', error));
  }
  function applyChatExpression(name) {
    chatExpression = name;
    const target = model;
    if (!target) return;
    target.expression(name).then(applied => {
      if (!applied || target !== model) return;
      if (chatActive && chatExpression !== name) applyChatExpression(chatExpression);
      else if (!chatActive && haruhikagePlaying) setHaruhikageExpression(target, true);
    }).catch(error => console.warn('Chat expression unavailable:', error));
  }
  function stopChatAction() {
    chatActionController?.abort();
    chatActionController = null;
  }
  function waitForChat() {
    currentChatMood = '平静';
    pendingChatMood = null;
    stopChatAction();
    clearIdleTimers();
    stopHaruhikageSob();
    resetGaze();
    clearTimeout(bubbleTimer);
    bubble.classList.remove('visible');
    voicePlayer.pause();
    applyChatExpression('exp_idle01.exp3');
    if (model && !performing && !transitionBusy) safeMotion(model, 'mtn_idle01_C', 3);
  }
  function setChatActive(open) {
    if (chatActive === open) return;
    chatActive = open;
    if (open) {
      if (previewKind) stopPreview(false, false);
      waitForChat();
      piano?.internalModel.motionManager.stopAllMotions?.();
      desiredPerformance = false;
      if (performing || transitionBusy) syncPerformance();
    } else {
      stopChatAction();
      pendingChatMood = null;
      desiredPerformance = mediaPlaying && !haruhikagePlaying;
      if (haruhikagePlaying) setHaruhikageExpression(model, true);
      else applyChatExpression('exp_idle01.exp3');
      if (performing !== desiredPerformance || transitionBusy) syncPerformance();
      else if (haruhikagePlaying) playHaruhikageSob();
      else if (mouseInactive) beginIdleCycle();
      else defaultMotion();
    }
  }
  function playChatMood(mood) {
    if (!chatActive || !model) return;
    currentChatMood = chatMoods[mood] ? mood : '平静';
    const [motion, expression] = chatMoods[mood] || chatMoods.平静;
    if (performing || transitionBusy) { pendingChatMood = currentChatMood; return; }
    stopChatAction();
    resetGaze();
    const masked = (currentOutfit === 'live' || currentOutfit === 'live_mask') && maskWanted() > 0.5;
    applyChatExpression(masked ? 'exp_idle01.exp3' : expression);
    const controller = new AbortController();
    chatActionController = controller;
    const target = model;
    playMotionOnce(target, motion, controller.signal).then(() => {
      if (!controller.signal.aborted && chatActive && target === model) safeMotion(target, 'mtn_idle01_C', 3);
    });
  }
  function showDailyNotice(value) {
    const busy = chatActive || previewKind || transitionBusy || (!value.manual && (mediaPlaying || performing || desiredPerformance || haruhikagePlaying));
    if (busy || !model) { window.petAPI.dailyNoticeResult({ id: value.id, accepted: false, manual: value.manual }); return; }
    if (!value.manual) clearIdleTimers();
    bubble.textContent = value.text;
    bubble.classList.add('visible');
    clearTimeout(bubbleTimer); clearTimeout(noticeTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('visible'), 6000);
    if (!value.manual && !performing) safeMotion(model, 'mtn_nod01_C', 3);
    noticeTimer = setTimeout(() => { if (!chatActive && !performing) { if (mouseInactive) beginIdleCycle(); else defaultMotion(); } }, 6200);
    window.petAPI.dailyNoticeResult({ id: value.id, accepted: true, manual: value.manual });
  }
  function stopHaruhikageSob() {
    clearTimeout(haruhikageTimer);
    haruhikageTimer = null;
    haruhikageController?.abort();
    haruhikageController = null;
  }
  async function playMotionOnce(target, name, signal) {
    if (!target || signal.aborted) return false;
    const manager = target.internalModel.motionManager;
    const started = await safeMotion(target, name, 3);
    if (!started || signal.aborted || target !== model) return false;
    return new Promise(resolve => {
      const finish = completed => {
        manager.off('motionFinish', onFinish);
        signal.removeEventListener('abort', onAbort);
        resolve(completed);
      };
      const onFinish = () => finish(true);
      const onAbort = () => finish(false);
      manager.on('motionFinish', onFinish);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }
  function defaultMotion() {
    if (!chatActive && !performing && !previewKind && !haruhikagePlaying && model && !mouseInactive) safeMotion(model, 'mtn_idle01_C', 1);
  }
  function clearIdleTimers() {
    clearTimeout(activityTimer); clearTimeout(maskTimer);
    idleActionController?.abort();
    idleActionController = null;
    temporaryMask = null;
  }
  function endIdle() {
    clearIdleTimers();
    resetGaze();
    if (!chatActive && !performing && !desiredPerformance && !previewKind && model) safeMotion(model, 'mtn_idle01_C', 3);
  }
  function finishIdleAction(controller, target) {
    if (controller.signal.aborted || target !== model || !mouseInactive || performing || desiredPerformance || previewKind || chatActive) return;
    temporaryMask = null;
    safeMotion(target, 'mtn_idle01_C', 3);
    activityTimer = setTimeout(beginIdleCycle, 10000);
  }
  function beginIdleCycle() {
    clearIdleTimers();
    if (!mouseInactive || performing || desiredPerformance || haruhikagePlaying || previewKind || chatActive || !model) return;
    let action;
    if (foregroundApp) action = 'mtn_thinking01_C';
    else {
      const stageOutfit = currentOutfit === 'live' || currentOutfit === 'live_mask';
      const choices = idleActions.filter(name => name !== lastIdleAction && (name !== 'mask' || stageOutfit));
      action = choices[Math.floor(Math.random() * choices.length)];
    }
    lastIdleAction = action;
    resetGaze();
    const controller = new AbortController();
    idleActionController = controller;
    const target = model;
    if (action === 'mask') {
      const original = settings.maskOn ? 1 : 0;
      const changed = original ? 0 : 1;
      const startedAt = Date.now();
      temporaryMask = { from: original, to: changed, start: startedAt };
      playMotionOnce(target, 'mtn_maskoff01_C', controller.signal).then(completed => {
        if (controller.signal.aborted) return;
        if (!completed) { finishIdleAction(controller, target); return; }
        maskTimer = setTimeout(() => {
          if (controller.signal.aborted) return;
          temporaryMask = { from: changed, to: original, start: Date.now() };
          playMotionOnce(target, 'mtn_maskoff01_C', controller.signal).then(() => finishIdleAction(controller, target));
        }, Math.max(0, 5000 - (Date.now() - startedAt)));
      });
    } else {
      playMotionOnce(target, action, controller.signal).then(() => finishIdleAction(controller, target));
    }
  }
  async function loadOutfit(outfit) {
    const version = ++modelVersion;
    const next = await PIXI.live2d.Live2DModel.from(OUTFITS[outfit], { autoInteract: false, autoUpdate: true });
    if (version !== modelVersion) { next.destroy(); return; }
    next.anchor.set(0.5, 0);
    next.petBaseScale = Math.min(300 / next.width, (1340 / 3) / next.height);
    next.internalModel.on('beforeModelUpdate', () => applyEyesAndMask(next, false));
    next.internalModel.motionManager.on('motionFinish', () => {
      if (next === model && !chatActive && !performing && !mouseInactive) setTimeout(() => {
        if (next === model && !chatActive && !next.internalModel.motionManager.playing && !mouseInactive) defaultMotion();
      }, 80);
    });
    if (model) {
      stopHaruhikageSob();
      haruhikagePlayed = false;
      app.stage.removeChild(model);
      model.destroy();
    }
    model = next;
    currentOutfit = outfit;
    app.stage.addChildAt(next, 0);
    placeModel(next);
    safeMotion(next, 'mtn_idle01_C', 1);
    if (performing) next.visible = false;
    if (mouseInactive && !chatActive && !performing && !previewKind) beginIdleCycle();
    if (chatActive) {
      const masked = (currentOutfit === 'live' || currentOutfit === 'live_mask') && maskWanted() > 0.5;
      applyChatExpression(masked ? 'exp_idle01.exp3' : chatMoods[currentChatMood][1]);
    }
    else if (haruhikagePlaying) setHaruhikageExpression(next, true);
    playHaruhikageSob();
  }
  function playHaruhikageSob() {
    if (!haruhikagePlaying || chatActive || haruhikageController || haruhikageTimer !== null || performing || desiredPerformance || transitionBusy || previewKind || !model) return;
    haruhikagePlayed = true;
    clearIdleTimers();
    resetGaze();
    bubble.classList.remove('visible');
    const target = model;
    const controller = new AbortController();
    haruhikageController = controller;
    playMotionOnce(target, 'mtn_cry01_C', controller.signal).then(completed => {
      if (haruhikageController !== controller) return;
      haruhikageController = null;
      if (!haruhikagePlaying || target !== model || performing || desiredPerformance) return;
      if (completed) safeMotion(target, 'mtn_idle01_C', 3);
      haruhikageTimer = setTimeout(() => {
        haruhikageTimer = null;
        playHaruhikageSob();
      }, HARUHIKAGE_SOB_GAP_MS);
    });
  }
  async function loadPiano() {
    if (piano) return piano;
    const next = await PIXI.live2d.Live2DModel.from(PIANO_FILE, { autoInteract: false, autoUpdate: true });
    next.anchor.set(0.5, 0);
    next.petBaseScale = Math.min(280 / next.width, 290 / next.height);
    next.internalModel.on('beforeModelUpdate', () => applyEyesAndMask(next, true));
    next.internalModel.motionManager.on('motionFinish', () => {
      if (performing && !chatActive && next === piano) playNextPianoMotion();
    });
    piano = next;
    app.stage.addChild(next);
    placePiano(next);
    next.visible = false;
    return next;
  }
  function playNextPianoMotion() {
    const sequence = ['mtn_play01_01', 'mtn_play01_02', 'mtn_play01_03'];
    safeMotion(piano, sequence[pianoIndex++ % sequence.length], 3);
  }
  function slide(target, from, to, duration) {
    return new Promise(resolve => {
      const start = performance.now();
      target.position.y = from;
      const tick = now => {
        const t = Math.min(1, (now - start) / duration);
        const eased = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        target.position.y = from + (to - from) * eased;
        if (t < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
  }
  async function syncPerformance() {
    if (transitionBusy || performing === desiredPerformance) return;
    transitionBusy = true;
    clearIdleTimers();
    try {
      if (desiredPerformance) {
        await loadPiano();
        if (!desiredPerformance) return;
        performing = true;
        resetGaze();
        bubble.classList.remove('visible');
        const stageOutfit = currentOutfit === 'live' || currentOutfit === 'live_mask';
        if (!stageOutfit) {
          await slide(model, baseY(), 190 * factor(), 1150);
          model.visible = false;
          document.body.classList.add('performing');
          piano.visible = true;
          await slide(piano, 190 * factor(), pianoY(), 1300);
        } else {
          document.body.classList.add('performing');
          piano.visible = true;
          const rising = slide(piano, 190 * factor(), pianoY(), 1450);
          await new Promise(resolve => setTimeout(resolve, 720));
          model.visible = false;
          await rising;
        }
        pianoIndex = 0;
        playNextPianoMotion();
      } else {
        if (piano) await slide(piano, pianoY(), 190 * factor(), 1150);
        if (piano) piano.visible = false;
        document.body.classList.remove('performing');
        model.visible = true;
        await slide(model, 190 * factor(), baseY(), 1150);
        performing = false;
        if (chatActive) safeMotion(model, 'mtn_idle01_C', 3);
        else if (mouseInactive) beginIdleCycle(); else defaultMotion();
      }
    } catch (error) { console.error('Performance transition failed:', error); performing = false; document.body.classList.remove('performing'); if (model) model.visible = true; }
    finally {
      transitionBusy = false;
      if (performing !== desiredPerformance) syncPerformance();
      else if (chatActive && pendingChatMood && !performing) {
        const mood = pendingChatMood; pendingChatMood = null; playChatMood(mood);
      }
      else if (!chatActive) playHaruhikageSob();
    }
  }
  function sendPreviewStatus(active, message) {
    window.petAPI.previewStatus({ active, message });
  }
  function stopPreview(announce = true, resume = true) {
    const previous = previewKind;
    clearTimeout(previewTimer);
    clearTimeout(previewMaskTimer);
    previewActionController?.abort();
    previewActionController = null;
    previewKind = null;
    temporaryMask = null;
    desiredPerformance = !chatActive && mediaPlaying && !haruhikagePlaying;
    if (previous === 'piano') syncPerformance();
    else if (resume && !performing && !desiredPerformance && !haruhikagePlaying) {
      if (mouseInactive) beginIdleCycle();
      else { resetGaze(); if (model) safeMotion(model, 'mtn_idle01_C', 3); }
    }
    if (announce) sendPreviewStatus(false, '预览已结束，已恢复原先状态。');
  }
  function startPreview({ kind, motion }) {
    if (chatActive) { sendPreviewStatus(false, '聊天时无法预览动作，请先结束聊天。'); return; }
    if (kind === 'stop') { stopPreview(); return; }
    if (!model || (kind !== 'piano' && (performing || desiredPerformance || transitionBusy || mediaPlaying))) {
      sendPreviewStatus(false, '祥子正在演奏，请在演奏结束后预览这个动作。');
      return;
    }
    if (kind === 'mask' && currentOutfit !== 'live' && currentOutfit !== 'live_mask') {
      sendPreviewStatus(false, '戴面具动作仅能在演出服上预览。');
      return;
    }
    stopPreview(false, false);
    clearIdleTimers();
    previewKind = kind;
    resetGaze();
    if (kind === 'piano') {
      desiredPerformance = true;
      syncPerformance();
      previewTimer = setTimeout(() => stopPreview(), 15000);
      sendPreviewStatus(true, '正在预览钢琴演奏，约 15 秒后自动结束。');
    } else if (kind === 'mask') {
      const controller = new AbortController();
      previewActionController = controller;
      const target = model;
      const original = settings.maskOn ? 1 : 0;
      const changed = original ? 0 : 1;
      const startedAt = Date.now();
      temporaryMask = { from: original, to: changed, start: startedAt };
      playMotionOnce(target, 'mtn_maskoff01_C', controller.signal).then(completed => {
        if (controller.signal.aborted) return;
        if (!completed) { stopPreview(); return; }
        previewMaskTimer = setTimeout(() => {
          if (controller.signal.aborted) return;
          temporaryMask = { from: changed, to: original, start: Date.now() };
          playMotionOnce(target, 'mtn_maskoff01_C', controller.signal).then(() => {
            if (!controller.signal.aborted) stopPreview();
          });
        }, Math.max(0, 5000 - (Date.now() - startedAt)));
      });
      sendPreviewStatus(true, '正在预览面具动作：切换两次，各播放一次。');
    } else if (kind === 'idle' && idleActions.includes(motion) && motion !== 'mask') {
      const controller = new AbortController();
      previewActionController = controller;
      playMotionOnce(model, motion, controller.signal).then(() => {
        if (!controller.signal.aborted) stopPreview();
      });
      sendPreviewStatus(true, '正在预览待机动作，播放一次后自动结束。');
    } else stopPreview();
  }
  function playLine() {
    if (!lines.length) return;
    const choice = lines[Math.floor(Math.random() * lines.length)];
    if (settings.showLines) {
      bubble.textContent = choice[settings.language] || choice.zh || choice.ja;
      bubble.classList.add('visible');
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => bubble.classList.remove('visible'), 6000);
    }
    voicePlayer.pause();
    if (voicePlayer.readyState > 0) voicePlayer.currentTime = 0;
    if (settings.voiceEnabled && choice.audio) {
      voicePlayer.src = choice.audio;
      voicePlayer.play().catch(error => console.warn('Voice playback failed:', error));
    }
  }
  applySize();
  window.petAPI.onBubbleSide(side => {
    document.body.classList.toggle('bubble-side-left', side === 'left');
    document.body.classList.toggle('bubble-side-right', side === 'right');
  });
  window.petAPI.onMediaState(state => {
    const wasMediaPlaying = mediaPlaying;
    const wasHaruhikage = haruhikagePlaying;
    mediaPlaying = !!state.playing;
    haruhikagePlaying = mediaPlaying && !!state.haruhikage;
    if (chatActive) return;
    if (mediaPlaying && !wasMediaPlaying) resetGaze();
    if (mediaPlaying && previewKind && previewKind !== 'piano') stopPreview();
    if (haruhikagePlaying && !wasHaruhikage) {
      haruhikagePlayed = false;
      clearIdleTimers();
      setHaruhikageExpression(model, true);
    } else if (!haruhikagePlaying && wasHaruhikage) {
      stopHaruhikageSob();
      haruhikagePlayed = false;
      setHaruhikageExpression(model, false);
    }
    const next = (mediaPlaying && !haruhikagePlaying) || previewKind === 'piano';
    if (desiredPerformance !== next || performing !== next) { desiredPerformance = next; syncPerformance(); }
    if (haruhikagePlaying) playHaruhikageSob();
    else if (wasHaruhikage && !next && !performing) {
      if (mouseInactive) beginIdleCycle();
      else if (model) safeMotion(model, 'mtn_idle01_C', 3);
    }
  });
  window.petAPI.onPreviewAction(startPreview);
  window.petAPI.onActivityState(state => {
    const changed = mouseInactive !== state.inactive || foregroundApp !== state.appOpen;
    mouseInactive = state.inactive; foregroundApp = state.appOpen;
    if (!changed) return;
    if (chatActive || previewKind || haruhikagePlaying) return;
    if (mouseInactive) beginIdleCycle(); else endIdle();
  });
  window.petAPI.onSettings(next => {
    const oldOutfit = settings.outfit;
    settings = next;
    applySize();
    if (oldOutfit !== next.outfit) {
      if (previewKind) stopPreview();
      loadOutfit(next.outfit).catch(console.error);
    }
    if (model && (!settings.followMouse || mediaPlaying || performing || mouseInactive || chatActive)) resetGaze();
    if (chatActive && model && oldOutfit === next.outfit) {
      const masked = (currentOutfit === 'live' || currentOutfit === 'live_mask') && maskWanted() > 0.5;
      applyChatExpression(masked ? 'exp_idle01.exp3' : chatMoods[currentChatMood][1]);
    }
    if (!settings.showLines) bubble.classList.remove('visible');
    if (!settings.voiceEnabled) { voicePlayer.pause(); if (voicePlayer.readyState > 0) voicePlayer.currentTime = 0; }
  });
  window.petAPI.onCursor(cursor => {
    if (model && settings.followMouse && !chatActive && !mediaPlaying && !performing && !mouseInactive && !previewKind) model.internalModel.focusController.focus(cursor.x, cursor.y);
  });
  window.petAPI.onChatState(state => setChatActive(!!state.open));
  window.petAPI.onChatWaiting(() => { if (chatActive) waitForChat(); });
  window.petAPI.onChatMood(state => playChatMood(state.mood));
  window.petAPI.onDailyNotice(showDailyNotice);
  canvas.addEventListener('pointerenter', () => {
    hideHint();
    hintDelay = setTimeout(() => {
      dragHint.classList.add('visible');
      hintTimer = setTimeout(hideHint, 1100);
    }, 250);
  });
  canvas.addEventListener('pointerleave', hideHint);
  document.getElementById('settings-button').addEventListener('click', event => {
    event.stopPropagation(); window.petAPI.openSettings();
  });
  document.getElementById('chat-button').addEventListener('click', event => {
    event.stopPropagation(); window.petAPI.openChat();
  });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    hideHint();
    pointerStart = { id: event.pointerId, x: event.screenX, y: event.screenY, moved: false };
    canvas.setPointerCapture(event.pointerId);
    window.petAPI.beginDrag();
  });
  canvas.addEventListener('pointermove', event => {
    if (pointerStart && event.pointerId === pointerStart.id && Math.hypot(event.screenX - pointerStart.x, event.screenY - pointerStart.y) > 5) pointerStart.moved = true;
  });
  function finishPointer(event) {
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    const moved = pointerStart.moved || Math.hypot(event.screenX - pointerStart.x, event.screenY - pointerStart.y) > 5;
    pointerStart = null;
    window.petAPI.endDrag();
    if (!moved && event.type === 'pointerup' && !chatActive && !performing && !previewKind) {
      playLine();
      safeMotion(model, clickActions[actionIndex++ % clickActions.length], 3);
    }
  }
  canvas.addEventListener('pointerup', finishPointer);
  canvas.addEventListener('pointercancel', finishPointer);
  window.addEventListener('blur', () => { if (pointerStart) { pointerStart = null; window.petAPI.endDrag(); } });
  try {
    lines = await fetch('/lines.json').then(response => response.json());
    await loadOutfit(settings.outfit);
    status.classList.add('hidden');
    window.petAPI.ready({ modelWidth: model.width, modelHeight: model.height, scale: model.petBaseScale * factor(), motions: Object.keys(model.internalModel.motionManager.definitions).length, lines: lines.length, outfit: settings.outfit });
  } catch (error) {
    console.error(error);
    status.textContent = '模型加载失败：' + error.message;
    window.petAPI.ready({ error: error.stack || error.message });
  }
})();
