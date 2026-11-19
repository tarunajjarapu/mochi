const { contextBridge, ipcRenderer } = require('electron');
const invoke = name => (...args) => ipcRenderer.invoke(`mochi:${name}`, ...args);
contextBridge.exposeInMainWorld('mochi', {
  state: invoke('state'), chat: invoke('chat'), stop: invoke('stop'),
  toggle: invoke('toggle'), hide: invoke('hide'), quit: invoke('quit'),
  beginPetDrag: invoke('pet-drag-start'), endPetDrag: invoke('pet-drag-end'),
  settings: invoke('settings'), status: invoke('status'), removeKey: invoke('remove-key'), workspace: invoke('workspace'),
  chatgptSignIn: invoke('chatgpt-sign-in'), chatgptCancel: invoke('chatgpt-cancel'), chatgptSelect: invoke('chatgpt-select'),
  chatgptSignOut: invoke('chatgpt-sign-out'), chatgptWelcome: invoke('chatgpt-welcome'), chatgptUsage: invoke('chatgpt-usage'),
  tool: invoke('tool'), approve: invoke('approve'),
  onEvent: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mochi:event', listener);
    return () => ipcRenderer.removeListener('mochi:event', listener);
  },
});
