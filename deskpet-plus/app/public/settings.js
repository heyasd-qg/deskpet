(async () => {
  const controls = [...document.querySelectorAll('[data-key]')];
  const sizeValue = document.getElementById('size-value');
  const previewStatus = document.getElementById('preview-status');
  let previewActive = false;
  let currentSettings;
  function selectPage(page) {
    if (!['character', 'system', 'chat'].includes(page)) return;
    for (const item of document.querySelectorAll('.nav-item')) {
      const active = item.dataset.page === page;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
      document.getElementById(`page-${item.dataset.page}`).hidden = !active;
    }
    if (page === 'chat') refreshMemories();
  }
  for (const button of document.querySelectorAll('.nav-item')) {
    button.addEventListener('click', () => selectPage(button.dataset.page));
  }
  window.petAPI.onSettingsPage(selectPage);
  const render = settings => {
    currentSettings = settings;
    for (const control of controls) {
      control[control.type === 'checkbox' ? 'checked' : 'value'] = settings[control.dataset.key];
    }
    sizeValue.textContent = `${settings.sizePercent}%`;
    const mask = document.querySelector('[data-key="maskOn"]');
    const stageOutfit = ['live', 'live_mask'].includes(settings.outfit);
    mask.disabled = !stageOutfit;
    for (const button of document.querySelectorAll('[data-preview]')) {
      button.disabled = button.dataset.preview === 'stop' ? !previewActive : previewActive || (button.dataset.preview === 'mask' && !stageOutfit);
    }
    document.getElementById('idle-preview').disabled = previewActive;
  };
  render(await window.petAPI.getSettings());
  window.petAPI.onSettings(render);
  for (const control of controls) {
    control.addEventListener(control.type === 'range' ? 'input' : 'change', () => {
      if (control.type === 'range') sizeValue.textContent = `${control.value}%`;
      window.petAPI.setSetting(control.dataset.key, control.type === 'checkbox' ? control.checked : control.value);
    });
  }
  window.petAPI.onPreviewStatus(state => {
    previewActive = !!state.active;
    previewStatus.textContent = state.message;
    render(currentSettings);
  });
  for (const button of document.querySelectorAll('[data-preview]')) {
    button.addEventListener('click', async () => {
      const kind = button.dataset.preview;
      const motion = kind === 'idle' ? document.getElementById('idle-preview').value : undefined;
      previewStatus.textContent = kind === 'stop' ? '正在停止预览…' : '正在准备预览…';
      const result = await window.petAPI.previewAction(kind, motion);
      if (!result.ok) previewStatus.textContent = result.message;
    });
  }
  const configStatus = document.getElementById('chat-config-status');
  const memoryStatus = document.getElementById('memory-status');
  async function refreshChatConfig() {
    const config = await window.petAPI.getChatConfig();
    document.getElementById('chat-endpoint').value = config.endpoint;
    document.getElementById('chat-model').value = config.model;
    configStatus.textContent = config.hasKey ? '密钥已保存，可以开始聊天。' : config.encryptionAvailable ? '尚未保存 API 密钥。' : '系统加密不可用，暂时无法保存密钥。';
    document.getElementById('chat-open-button').disabled = !config.hasKey;
    document.getElementById('chat-config-clear').disabled = !config.hasKey;
  }
  document.getElementById('deepseek-link').addEventListener('click', () => window.petAPI.openDeepSeekSite());
  document.getElementById('chat-config-save').addEventListener('click', async () => {
    configStatus.textContent = '正在保存…';
    try {
      await window.petAPI.saveChatConfig({
        apiKey: document.getElementById('chat-api-key').value,
        endpoint: document.getElementById('chat-endpoint').value,
        model: document.getElementById('chat-model').value
      });
      document.getElementById('chat-api-key').value = '';
      await refreshChatConfig();
    } catch (error) { configStatus.textContent = `保存失败：${error.message}`; }
  });
  document.getElementById('chat-config-clear').addEventListener('click', async () => {
    if (!confirm('确定删除本机保存的 API 密钥吗？')) return;
    try { await window.petAPI.saveChatConfig({ clearKey: true }); await refreshChatConfig(); }
    catch (error) { configStatus.textContent = `删除失败：${error.message}`; }
  });
  document.getElementById('chat-open-button').addEventListener('click', () => window.petAPI.openChat());

  async function refreshMemories() {
    const list = document.getElementById('memory-list');
    const memories = await window.petAPI.getMemories();
    list.replaceChildren();
    if (!memories.length) {
      const empty = document.createElement('p');
      empty.className = 'memory-empty'; empty.textContent = '祥子还没有保存关于你的记忆。'; list.append(empty);
      return;
    }
    for (const memory of memories) {
      const row = document.createElement('div'); row.className = 'memory-row';
      const content = document.createElement('span'); content.textContent = memory.text;
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '修改';
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除';
      let input = null;
      edit.addEventListener('click', async () => {
        if (!input) {
          input = document.createElement('input'); input.type = 'text'; input.maxLength = 180; input.value = memory.text;
          content.replaceWith(input); input.focus(); edit.textContent = '保存';
        } else {
          try { await window.petAPI.updateMemory(memory.id, input.value); memoryStatus.textContent = '记忆已更新。'; await refreshMemories(); }
          catch (error) { memoryStatus.textContent = error.message; }
        }
      });
      remove.addEventListener('click', async () => {
        await window.petAPI.deleteMemory(memory.id); memoryStatus.textContent = '记忆已删除。'; await refreshMemories();
      });
      row.append(content, edit, remove); list.append(row);
    }
  }
  document.getElementById('memory-add-button').addEventListener('click', async () => {
    const field = document.getElementById('memory-new');
    try { await window.petAPI.addMemory(field.value); field.value = ''; memoryStatus.textContent = '祥子记住了。'; await refreshMemories(); }
    catch (error) { memoryStatus.textContent = error.message; }
  });
  await refreshChatConfig();
  document.getElementById('done').addEventListener('click', () => window.petAPI.hideSettings());
})();
