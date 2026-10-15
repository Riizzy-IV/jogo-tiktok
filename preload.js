const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('live', {
  info: () => ipcRenderer.invoke('app:info'),
  games: () => ipcRenderer.invoke('games:list'),
  play: (id) => ipcRenderer.invoke('games:play', id),
  openInBrowser: (id) => ipcRenderer.invoke('games:openBrowser', id),
  reveal: (id) => ipcRenderer.invoke('games:reveal', id),
  gifts: () => ipcRenderer.invoke('gifts:list'),
  status: () => ipcRenderer.invoke('status:get'),
  startSim: (rate) => ipcRenderer.invoke('source:sim', rate),
  setRate: (rate) => ipcRenderer.invoke('sim:rate', rate),
  connect: (username) => ipcRenderer.invoke('source:tiktok', username),
  stop: () => ipcRenderer.invoke('source:stop'),
  inject: (evt) => ipcRenderer.invoke('event:inject', evt),
  onEvent: (cb) => ipcRenderer.on('live:event', (_, e) => cb(e)),
  onStatus: (cb) => ipcRenderer.on('live:status', (_, s) => cb(s)),
  onClients: (cb) => ipcRenderer.on('games:clients', (_, n) => cb(n)),
});
