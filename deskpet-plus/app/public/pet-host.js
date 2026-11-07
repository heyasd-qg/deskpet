(async () => {
  const native = window.petAPI, records = new Map(), characters = document.getElementById('characters');
  const catalogue = native.getCharacters();
  let layout, pointer, hovered;
  const active = record => records.get(record.slot) === record;
  const emit = (record, name, value) => { for (const callback of record?.listeners.get(name) || []) callback(value); };
  const events = ['Settings','Cursor','BubbleSide','MediaState','ActivityState','PreviewAction','DailyNotice','Interaction','InteractionEnd','CharacterCommand'];
  for (const name of events) native['on' + name](packet => emit(records.get(packet.slot), name, packet.value));

  // Each embedded scene gets its own callbacks and explicit character slot.
  // Only this host has an Electron preload and owns the native window.
  window.createPetSlotAPI = slot => {
    const record = records.get(slot);
    if (!record) throw Error('Inactive character slot');
    const api = {
      getCharacters: () => catalogue,
      getSettings: () => Promise.resolve(record.profile),
      setSetting: (key, value) => active(record) && native.setSetting(key, value),
      beginDrag: () => active(record) && native.beginDrag(), endDrag: () => active(record) && native.endDrag(),
      openSettings: () => native.openSettings(), quit: () => native.quit()
    };
    for (const name of events) api['on' + name] = callback => {
      if (!record.listeners.has(name)) record.listeners.set(name, new Set());
      record.listeners.get(name).add(callback);
    };
    for (const name of ['ready','profileStatus','sceneStatus','previewStatus','dailyNoticeResult','interactionDone'])
      api[name] = value => { if (active(record)) native[name]({ ...value, slot }); };
    return api;
  };

  function render(next) {
    if (!next) return;
    layout = next;
    const s = next.settings, factor = s.sizePercent / 100, width = Math.round(167 * factor), height = Math.round(173 * factor);
    const step = Math.round(86 * factor), group = width + (s.dualEnabled ? step : 0);
    document.body.style.setProperty('--pet-width', width + 'px');
    document.body.style.setProperty('--pet-height', height + 'px');
    document.body.classList.toggle('position-locked', s.displayLocked);
    const toolbar = document.getElementById('toolbar'); toolbar.style.left = (205 + group - 52) + 'px';
    const lock = document.getElementById('lock-button'); lock.classList.toggle('locked', s.displayLocked);
    lock.setAttribute('aria-pressed', String(s.displayLocked));
    lock.title = s.displayLocked ? '解锁：允许移动，全屏时让出显示' : '锁定显示与位置，持续随机互动';
    lock.setAttribute('aria-label', lock.title);
    for (const [slot, record] of records) if (!next.profiles[slot]) { records.delete(slot); record.listeners.clear(); record.frame.remove(); }
    for (const [slot, profile] of Object.entries(next.profiles)) {
      let record = records.get(slot);
      if (!record) {
        const frame = document.createElement('iframe'); frame.className = 'pet-scene'; frame.dataset.slot = slot;
        frame.title = slot === 'right' ? '右侧人物' : '左侧人物';
        record = { slot, frame, profile, listeners: new Map() }; records.set(slot, record);
        frame.src = '/pet.html?slot=' + slot; characters.append(frame);
      }
      record.profile = profile; record.frame.style.left = (slot === 'right' ? step : 0) + 'px';
      record.frame.style.width = (410 + width) + 'px';
    }
    catalogue.then(items => { if (layout !== next) return; document.title = Object.values(next.profiles).map(p => items.find(c => c.key === p.character)?.name).join(' · ') + ' · 邦多利桌宠'; });
    if (s.displayLocked && pointer) finishPointer();
  }
  native.onPetLayout(render);
  render(await native.getPetLayout());

  function sceneAt(event) {
    const s = layout.settings, factor = s.sizePercent / 100, width = Math.round(167 * factor), step = Math.round(86 * factor);
    const divider = 205 + width / 2 + step / 2;
    return records.get(s.dualEnabled && event.clientX >= divider ? 'right' : 'left');
  }
  function hover(record) {
    if (record === hovered) return;
    hovered?.frame.contentWindow?.petInput?.hover(false); hovered = record;
    hovered?.frame.contentWindow?.petInput?.hover(true);
  }
  document.addEventListener('pointermove', event => {
    if (event.target.closest('#toolbar')) hover(null); else hover(sceneAt(event));
    if (pointer && Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y) > 5) pointer.moved = true;
  });
  document.addEventListener('pointerleave', () => hover(null));
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('#toolbar')) return;
    const record = sceneAt(event); if (!record) return;
    record.frame.contentWindow?.petInput?.hover(false);
    pointer = { id: event.pointerId, x: event.screenX, y: event.screenY, moved: false, record };
    document.body.setPointerCapture(event.pointerId);
    if (!layout.settings.displayLocked) native.beginDrag();
  });
  function finishPointer(event) {
    if (!pointer || event && event.pointerId !== pointer.id) return;
    const p = pointer; pointer = null; native.endDrag();
    if (document.body.hasPointerCapture(p.id)) document.body.releasePointerCapture(p.id);
    const moved = p.moved || event && Math.hypot(event.screenX - p.x, event.screenY - p.y) > 5;
    if (event?.type === 'pointerup' && !moved && active(p.record)) p.record.frame.contentWindow?.petInput?.click();
  }
  document.addEventListener('pointerup', finishPointer); document.addEventListener('pointercancel', finishPointer);
  document.addEventListener('lostpointercapture', () => finishPointer());
  window.addEventListener('blur', () => finishPointer());
  document.getElementById('settings-button').addEventListener('click', () => native.openSettings());
  document.getElementById('lock-button').addEventListener('click', () => native.setSetting('displayLocked', !layout.settings.displayLocked));
  window.petDebug = (slot = 'left') => records.get(slot)?.frame.contentWindow?.petDebug?.();
  window.petDebugAll = () => Object.fromEntries([...records].map(([slot]) => [slot, window.petDebug(slot)]));
})().catch(error => console.error('Pet host failed', error));
