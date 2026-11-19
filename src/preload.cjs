const { contextBridge, ipcRenderer } = require('electron');
const invoke = name => (...args) => ipcRenderer.invoke(`mochi:${name}`, ...args);
contextBridge.exposeInMainWorld('mochi', {
  state: invoke('state'), chat: invoke('chat'), stop: invoke('stop'),
  toggle: invoke('toggle'), hide: invoke('hide'), quit: invoke('quit'),
  settings: invoke('settings'), status: invoke('status'), workspace: invoke('workspace'),
  tool: invoke('tool'), approve: invoke('approve'),
  onEvent: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mochi:event', listener);
    return () => ipcRenderer.removeListener('mochi:event', listener);
  },
});
