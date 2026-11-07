(() => {
  const messages = document.getElementById('chat-messages');
  const input = document.getElementById('chat-input');
  const form = document.getElementById('chat-form');
  const sendButton = document.getElementById('chat-send');
  const stopButton = document.getElementById('chat-stop');
  const errorBox = document.getElementById('chat-error');
  let busy = false;
  let currentReply = null;
  function scrollDown() { messages.scrollTop = messages.scrollHeight; }
  function addMessage(text, role) {
    const node = document.createElement('div');
    node.className = `chat-message ${role}`;
    node.textContent = text;
    messages.append(node); scrollDown();
    return node;
  }
  function setBusy(value) {
    busy = value;
    sendButton.disabled = value;
    stopButton.hidden = !value;
    input.disabled = value;
    if (!value) input.focus();
  }
  function showCandidate(text) {
    const card = document.createElement('div'); card.className = 'chat-suggestion';
    const copy = document.createElement('p'); copy.textContent = `祥子要记住这件事吗？\n${text}`;
    const save = document.createElement('button'); save.textContent = '记住';
    const skip = document.createElement('button'); skip.textContent = '忽略';
    save.addEventListener('click', async () => {
      try { await window.petAPI.addMemory(text); card.textContent = '祥子记住了。'; }
      catch (error) { card.textContent = `保存失败：${error.message}`; }
    });
    skip.addEventListener('click', () => card.remove());
    card.append(copy, save, skip); messages.append(card); scrollDown();
  }
  window.petAPI.onChatStream(state => {
    if (!currentReply) return;
    if (state.error) { errorBox.textContent = state.error; currentReply.textContent = '……'; return; }
    currentReply.textContent = state.text || '……';
    if (state.done) for (const candidate of state.candidates || []) showCandidate(candidate);
    scrollDown();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || busy) return;
    errorBox.textContent = '';
    addMessage(question, 'user');
    currentReply = addMessage('祥子正在思考……', 'sakiko');
    input.value = '';
    setBusy(true);
    try { await window.petAPI.sendChat(question); }
    catch (error) { errorBox.textContent = error.message; currentReply.textContent = '……'; }
    finally { currentReply = null; setBusy(false); }
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });
  stopButton.addEventListener('click', () => window.petAPI.cancelChat());
  document.getElementById('chat-settings').addEventListener('click', () => window.petAPI.openSettings());
  input.focus();
})();
