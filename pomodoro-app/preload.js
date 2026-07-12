const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  showNotification: (options) => ipcRenderer.invoke('show-notification', options),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  setTrayTooltip: (text) => ipcRenderer.invoke('set-tray-tooltip', text),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  closeApp: () => ipcRenderer.invoke('close-app'),
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
});
