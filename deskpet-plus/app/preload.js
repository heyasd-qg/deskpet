const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petAPI', {
  openWorkshop: () => ipcRenderer.send('open-workshop'),
  onCharacterCommand: callback => ipcRenderer.on('character-command',(_event,value)=>callback(value)),
  workshop: (op, request = {}) => ipcRenderer.invoke('workshop-call', op, request),
  onResourceVerification: callback => ipcRenderer.on('resource-verification', (_event, value) => callback(value)),
  getCharacters: () => ipcRenderer.invoke('get-characters'),
  onProfileStatus: callback => ipcRenderer.on('profile-status', (_event, value) => callback(value)),
  profileStatus: value => ipcRenderer.send('profile-status', value),
  getSettings: slot => ipcRenderer.invoke('get-settings', slot),
  getPetLayout: () => ipcRenderer.invoke('get-pet-layout'),
  onPetLayout: callback => ipcRenderer.on('pet-layout', (_event, value) => callback(value)),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  onSettings: callback => ipcRenderer.on('settings-changed', (_event, value) => callback(value)),
  onCursor: callback => ipcRenderer.on('cursor', (_event, value) => callback(value)),
  onBubbleSide: callback => ipcRenderer.on('bubble-side', (_event, value) => callback(value)),
  onMediaState: callback => ipcRenderer.on('media-state', (_event, value) => callback(value)),
  onActivityState: callback => ipcRenderer.on('activity-state', (_event, value) => callback(value)),
  previewAction: (kind, motion, slot) => ipcRenderer.invoke('preview-action', kind, motion, slot),
  onPreviewAction: callback => ipcRenderer.on('preview-action', (_event, value) => callback(value)),
  onPreviewStatus: callback => ipcRenderer.on('preview-status', (_event, value) => callback(value)),
  onSettingsPage: callback => ipcRenderer.on('settings-page', (_event, value) => callback(value)),
  onDailyNotice: callback => ipcRenderer.on('daily-notice', (_event, value) => callback(value)),
  dailyNoticeResult: value => ipcRenderer.send('daily-notice-result', value),
  previewStatus: state => ipcRenderer.send('preview-status', state),
  beginDrag: () => ipcRenderer.send('begin-drag'),
  endDrag: () => ipcRenderer.send('end-drag'),
  openSettings: () => ipcRenderer.send('open-settings'),
  hideSettings: () => ipcRenderer.send('hide-settings'),
  quit: () => ipcRenderer.send('quit'),
  ready: details => ipcRenderer.send('pet-ready', details)
  ,onInteraction: callback => ipcRenderer.on('interaction-command', (_event, value) => callback(value))
  ,onInteractionEnd: callback => ipcRenderer.on('interaction-end', (_event, value) => callback(value))
  ,interactionDone: value => ipcRenderer.send('interaction-done', value)
  ,sceneStatus: value => ipcRenderer.send('scene-status', value)
});
