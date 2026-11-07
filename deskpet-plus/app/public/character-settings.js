(async () => {
  const [characters, initial] = await Promise.all([window.petAPI.getCharacters(), window.petAPI.getSettings()]);
  const controls = [...document.querySelectorAll('[data-key]')], roleSelect = document.getElementById('character-select');
  const outfitSelect = document.getElementById('outfit-select'), motionSelect = document.getElementById('idle-preview');
  const targetSelect = document.getElementById('preview-target'), sizeValue = document.getElementById('size-value'), previewStatus = document.getElementById('preview-status');
  const cards = [...document.querySelectorAll('[data-dual-slot]')], statuses = {}, previews = {};
  const profileKeys = new Set(['character', 'outfit', 'maskOn', 'performanceMask']);
  let currentSettings, roleKey = '', clothingKey = '', changeRevision = 0, previewOwner;
  function populateRoles(select) {
    select.replaceChildren();
    for (const band of [...new Set(characters.map(c => c.band))]) {
      const group = document.createElement('optgroup'); group.label = band;
      for (const c of characters.filter(c => c.band === band)) { const option = document.createElement('option'); option.value = c.key; option.textContent = c.name; group.append(option); }
      select.append(group);
    }
    select.disabled = !characters.length;
    if (!characters.length) select.append(new Option('请先导入角色', ''));
  }
  for (const select of [roleSelect, ...cards.map(card => card.querySelector('[data-profile-key="character"]'))]) populateRoles(select);
  function selectPage(page) {
    if (!['character', 'dual', 'system'].includes(page)) return;
    for (const item of document.querySelectorAll('.nav-item')) {
      const active = item.dataset.page === page;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
      document.getElementById(`page-${item.dataset.page}`).hidden = !active;
    }
  }
  function populateOutfits(select, c) {
    if (select.dataset.character === c.key) return;
    select.replaceChildren();
    for (const o of c.outfits) { const option = document.createElement('option'); option.value = o.key; option.textContent = o.label; select.append(option); }
    select.dataset.character = c.key;
  }
  function render(settings) {
    currentSettings = settings;
    const target = settings.dualEnabled ? targetSelect.value : 'left';
    const profile = settings.dualEnabled ? settings[target === 'right' ? 'dualRight' : 'dualLeft'] : settings;
    const c = characters.find(c => c.key === profile.character);
    document.getElementById('empty-library').hidden = !!c;
    if (!c) {
      for (const control of controls) {
        control[control.type === 'checkbox' ? 'checked' : 'value'] = profileKeys.has(control.dataset.key) ? profile[control.dataset.key] : settings[control.dataset.key];
        control.disabled = profileKeys.has(control.dataset.key) || control.dataset.key === 'dualEnabled';
      }
      document.getElementById('preview-target-field').hidden = true;
      outfitSelect.replaceChildren(new Option('请先导入角色', '')); outfitSelect.disabled = true;
      motionSelect.replaceChildren(new Option('暂无动作', '')); motionSelect.disabled = true;
      for (const button of document.querySelectorAll('[data-preview]')) button.disabled = true;
      for (const card of cards) {
        for (const control of card.querySelectorAll('[data-profile-key]')) control.disabled = true;
        card.querySelector('.dual-profile-status').textContent = '导入角色后可配置双人模式。';
      }
      sizeValue.textContent = settings.sizePercent + '%';
      document.getElementById('voice-volume-value').textContent = settings.voiceVolume + '%';
      document.getElementById('profile-status').textContent = '暂无可用角色，系统设置仍可保存。';
      previewStatus.textContent = '导入并启用角色后可以预览动作。';
      return;
    }
    const outfit = c.outfits.find(o => o.key === profile.outfit);
    const loading = !!statuses[target]?.loading, previewActive = Object.values(previews).some(p => p.active);
    document.getElementById('preview-target-field').hidden = !settings.dualEnabled;
    document.querySelector('#page-character .intro').textContent = settings.dualEnabled ? '选择要查看的一侧，再调整人物、服装或预览动作。' : '先选择人物，再选择她的服装。';
    if (roleKey !== c.key) { populateOutfits(outfitSelect, c); roleKey = c.key; clothingKey = ''; }
    if (clothingKey !== outfit.key) {
      motionSelect.replaceChildren();
      for (const m of outfit.motions) { const option = document.createElement('option'); option.value = m.name; option.textContent = m.label; motionSelect.append(option); }
      motionSelect.value = outfit.motions.some(m => m.name === 'mtn_thinking01_C') ? 'mtn_thinking01_C' : outfit.motions[0]?.name || '';
      clothingKey = outfit.key;
    }
    for (const control of controls) control[control.type === 'checkbox' ? 'checked' : 'value'] = profileKeys.has(control.dataset.key) ? profile[control.dataset.key] : settings[control.dataset.key];
    outfitSelect.disabled = false;
    sizeValue.textContent = settings.sizePercent + '%';
    document.getElementById('voice-volume-value').textContent = settings.voiceVolume + '%';
    document.querySelector('[data-key="maskOn"]').disabled = !outfit.maskAvailable;
    document.querySelector('[data-key="performanceMask"]').disabled = !c.performance.maskAvailable;
    const follow = document.querySelector('[data-key="followMouse"]'); follow.disabled = settings.dualEnabled;
    if (settings.dualEnabled) follow.checked = false;
    document.getElementById('follow-mouse-hint').textContent = settings.dualEnabled ? '双人模式已停用，返回单人时恢复原设置' : '演奏和待机动作时暂时停用';
    document.getElementById('performance-hint').textContent = c.custom ? '自定义角色：动作、表情与位置可在角色工坊调整。' : `电脑播放音乐或视频时，${c.name}会切换为${c.role}表演。演奏使用固定的演出服。`;
    document.getElementById('profile-status').textContent = loading ? '正在切换人物或服装…' : statuses[target]?.error ? '加载失败，请重新选择人物或服装。' : '';
    previewStatus.textContent = previews[previewOwner]?.message || '选择动作即可预览。';
    for (const button of document.querySelectorAll('[data-preview]')) button.disabled = button.dataset.preview === 'stop' ? !previewActive : previewActive || loading || button.dataset.preview === 'mask' && !outfit.maskAvailable;
    motionSelect.disabled = previewActive || loading;
    if (c.custom || c.performance?.available === false) document.querySelector('[data-preview="performance"]').disabled = true;
    if (c.custom) document.querySelector('[data-preview="idle"]').disabled ||= !outfit.motions.length;
    for (const card of cards) {
      const slot = card.dataset.dualSlot, selected = settings[slot === 'left' ? 'dualLeft' : 'dualRight'];
      const actor = characters.find(c => c.key === selected.character), clothes = actor.outfits.find(o => o.key === selected.outfit);
      populateOutfits(card.querySelector('[data-profile-key="outfit"]'), actor);
      for (const control of card.querySelectorAll('[data-profile-key]')) control[control.type === 'checkbox' ? 'checked' : 'value'] = selected[control.dataset.profileKey];
      card.querySelector('[data-profile-key="maskOn"]').disabled = !clothes.maskAvailable;
      card.querySelector('[data-profile-key="performanceMask"]').disabled = !actor.performance.maskAvailable;
      card.querySelector('.dual-performance-hint').textContent = actor.custom ? '自定义角色：保持普通显示，暂不参与双人对白。' : `播放音乐时：${actor.role}表演。`;
      card.querySelector('.dual-profile-status').textContent = !settings.dualEnabled ? '' : statuses[slot]?.loading ? '正在切换…' : statuses[slot]?.error ? '加载失败，请重新选择。' : '';
    }
  }
  render(initial);
  window.petAPI.onSettings(render);
  window.petAPI.onSettingsPage(selectPage);
  window.petAPI.onProfileStatus(state => { statuses[state.slot || 'left'] = state; if (currentSettings) render(currentSettings); });
  window.petAPI.onPreviewStatus(state => { previews[state.slot || 'left'] = state; if (state.active) previewOwner = state.slot || 'left'; render(currentSettings); });
  async function commit(key, value) { const revision = ++changeRevision; const settings = await window.petAPI.setSetting(key, value); if (revision === changeRevision) render(settings); }
  for (const control of controls) control.addEventListener(control.type === 'range' ? 'input' : 'change', () => {
    let key = control.dataset.key;
    const value = control.type === 'checkbox' ? control.checked : control.value;
    if (control.type === 'range') (control.dataset.key === 'voiceVolume' ? document.getElementById('voice-volume-value') : sizeValue).textContent = value + '%';
    if (currentSettings.dualEnabled && profileKeys.has(key)) key = (targetSelect.value === 'right' ? 'dualRight.' : 'dualLeft.') + key;
    commit(key, value);
  });
  for (const card of cards) for (const control of card.querySelectorAll('[data-profile-key]')) control.addEventListener('change', () => commit((card.dataset.dualSlot === 'right' ? 'dualRight.' : 'dualLeft.') + control.dataset.profileKey, control.type === 'checkbox' ? control.checked : control.value));
  targetSelect.addEventListener('change', () => { roleKey = ''; clothingKey = ''; render(currentSettings); });
  for (const button of document.querySelectorAll('[data-preview]')) button.addEventListener('click', async () => {
    const kind = button.dataset.preview, slot = kind === 'stop' ? previewOwner : targetSelect.value;
    previewStatus.textContent = kind === 'stop' ? '正在停止预览…' : '正在准备预览…';
    const result = await window.petAPI.previewAction(kind, kind === 'idle' ? motionSelect.value : undefined, currentSettings.dualEnabled ? slot : 'left');
    if (!result.ok) previewStatus.textContent = result.message;
  });
  for (const button of document.querySelectorAll('.nav-item')) button.addEventListener('click', () => selectPage(button.dataset.page));
  document.getElementById('done').addEventListener('click', () => window.petAPI.hideSettings());
})();
