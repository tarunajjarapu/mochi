const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, screen, shell, Notification, dialog, safeStorage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Store } = require('./core/store.cjs');
const { DEFAULTS, createProvider, validateSettings } = require('./core/provider.cjs');
const { Credentials } = require('./core/credentials.cjs');
const { ChatGPTAuth } = require('./core/chatgpt-auth.cjs');
const { createTools } = require('./core/tools.cjs');
const { runAgent } = require('./core/agent.cjs');

app.setName('Mochi');
app.setPath('userData', process.env.MOCHI_DATA_DIR
  ? path.resolve(process.env.MOCHI_DATA_DIR)
  : path.join(app.getPath('appData'), 'Mochi'));
const locked = app.requestSingleInstanceLock();
if (!locked) { app.quit(); } else {
  let pet, panel, tray, store, credentials, chatgpt, tools, active, reminderTimer, configuring = false;
  let quitting = false, petDrag, positionTimer;
  const approvals = new Map();
  const uiFile = name => path.join(__dirname, 'ui', name);
  const emit = event => {
    for (const win of [pet, panel]) if (win && !win.isDestroyed()) win.webContents.send('mochi:event', event);
  };
  const snapshot = () => ({ ...store.state, workspace: path.join(app.getPath('userData'), 'workspace'), busy: !!active || configuring,
    providerDefaults: DEFAULTS, keySource: credentials.source(store.state.settings), chatgpt: chatgpt.snapshot() });
  const provider = async (settings = store.state.settings) => createProvider(settings, { auth: chatgpt, apiKey: await credentials.get(settings) });
  const refresh = () => emit({ type: 'state', state: snapshot() });
  const setMood = mood => emit({ type: 'mood', mood });
  function positionPanel() {
    if (!pet || !panel) return;
    const anchor = pet.getBounds();
    const area = screen.getDisplayMatching(anchor).workArea;
    const width = Math.min(420, area.width), height = Math.min(650, area.height);
    panel.setBounds({ width, height,
      x: Math.max(area.x, Math.min(anchor.x - width + anchor.width, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(anchor.y - height - 8, area.y + area.height - height)),
    });
  }
  function showPanel() { positionPanel(); panel.show(); panel.focus(); refresh(); }
  function visiblePetPosition(point, size = { width: 166, height: 180 }) {
    const area = screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) }).workArea;
    return { x: Math.round(Math.max(area.x, Math.min(point.x, area.x + Math.max(0, area.width - size.width)))),
      y: Math.round(Math.max(area.y, Math.min(point.y, area.y + Math.max(0, area.height - size.height)))) };
  }
  function savePetPosition() {
    clearTimeout(positionTimer);
    if (!pet || pet.isDestroyed()) return;
    const [x, y] = pet.getPosition(), previous = store.state.petPosition;
    if (previous?.x === x && previous?.y === y) return;
    store.state.petPosition = { x, y };
    try { store.save(); }
    catch { store.state.petPosition = previous; emit({ type: 'error', message: 'Could not save Mochi’s position.' }); }
  }
  function movePetWithCursor() {
    if (!petDrag || pet.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - petDrag.cursor.x, dy = cursor.y - petDrag.cursor.y;
    if (!petDrag.moved && Math.hypot(dx, dy) < 5) return;
    petDrag.moved = true;
    const area = screen.getDisplayNearestPoint(cursor).workArea, bounds = petDrag.bounds;
    const x = Math.round(Math.max(area.x, Math.min(bounds.x + dx, area.x + Math.max(0, area.width - bounds.width))));
    const y = Math.round(Math.max(area.y, Math.min(bounds.y + dy, area.y + Math.max(0, area.height - bounds.height))));
    pet.setPosition(x, y);
  }
  function endPetDrag() {
    if (!petDrag) return false;
    movePetWithCursor();
    const moved = petDrag.moved;
    clearInterval(petDrag.timer); clearTimeout(petDrag.timeout); petDrag = null;
    if (moved) savePetPosition();
    return moved;
  }
  function beginPetDrag() {
    endPetDrag();
    petDrag = { cursor: screen.getCursorScreenPoint(), bounds: pet.getBounds(), moved: false,
      timer: setInterval(movePetWithCursor, 16), timeout: setTimeout(endPetDrag, 300_000) };
  }
  function makeWindow(options, file) {
    const win = new BrowserWindow({ ...options, webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
    } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.loadFile(uiFile(file));
    return win;
  }
  function register(name, handler, petAllowed = false) {
    ipcMain.handle(`mochi:${name}`, (event, ...args) => {
      const validPanel = event.sender === panel.webContents && event.senderFrame?.url === pathToFileURL(uiFile('panel.html')).href;
      const validPet = petAllowed && event.sender === pet.webContents && event.senderFrame?.url === pathToFileURL(uiFile('pet.html')).href;
      if (!validPanel && !validPet) throw new Error('Untrusted sender.');
      return handler(...args);
    });
  }
  function askApproval(action, signal) {
    signal.throwIfAborted();
    showPanel(); setMood('waiting');
    return new Promise(resolve => {
      const id = randomUUID();
      let timer;
      const finish = allowed => {
        clearTimeout(timer); signal.removeEventListener('abort', onAbort); approvals.delete(id);
        emit({ type: 'approval-resolved', id });
        resolve(allowed);
      };
      const onAbort = () => finish(false);
      approvals.set(id, finish);
      signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => finish(false), 120_000);
      emit({ type: 'approval', id, ...action });
    });
  }
  async function run(work) {
    if (active || configuring) throw new Error('Mochi is already working. Wait for the current operation to finish.');
    const controller = new AbortController(); active = controller;
    refresh(); setMood('thinking');
    try { return await work(controller.signal); }
    finally { active = null; refresh(); setMood('idle'); }
  }
  async function configure(work) {
    if (active || configuring) throw new Error('Wait for the current operation to finish.');
    configuring = true; refresh();
    try { return await work(); }
    finally { configuring = false; refresh(); }
  }
  async function useChatGPT() {
    const next = { ...DEFAULTS.chatgpt };
    if (store.state.settings.provider === 'chatgpt') next.model = store.state.settings.model;
    try {
      const status = await (await provider(next)).status();
      if (!status.ready && status.models.length) next.model = status.models[0];
    } catch { /* Keep the account connected; the connection check will explain recovery. */ }
    store.state.settings = next; store.save();
  }
  function deliverReminders() {
    try {
      for (const reminder of store.due()) {
        store.add('messages', { role: 'assistant', content: `Reminder: ${reminder.text}` }, 100);
        emit({ type: 'reminder', text: reminder.text });
        if (Notification.isSupported()) {
          const notification = new Notification({ title: 'Mochi reminder', body: reminder.text });
          notification.on('click', showPanel); notification.show();
        }
        setMood('happy'); refresh();
      }
    } catch (error) { emit({ type: 'error', message: `Reminder storage error: ${error.message}` }); }
  }
  app.whenReady().then(async () => {
    store = new Store(app.getPath('userData'));
    credentials = new Credentials(app.getPath('userData'), safeStorage);
    chatgpt = new ChatGPTAuth(app.getPath('userData'), safeStorage, { openExternal: url => shell.openExternal(url), onChange: refresh });
    await chatgpt.initialize();
    tools = createTools({ store, workspace: path.join(app.getPath('userData'), 'workspace'), openExternal: url => shell.openExternal(url) });
    const area = screen.getPrimaryDisplay().workArea;
    const saved = store.state.petPosition;
    const position = visiblePetPosition(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? saved : { x: area.x + area.width - 192, y: area.y + area.height - 200 });
    pet = makeWindow({ width: 166, height: 180, ...position,
      frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false }, 'pet.html');
    pet.setAlwaysOnTop(true, 'floating');
    pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    panel = makeWindow({ width: 420, height: 650, minWidth: 320, minHeight: 400, frame: false,
      resizable: false, backgroundColor: '#f8f6ef', alwaysOnTop: true, show: false }, 'panel.html');
    panel.on('close', event => { if (!quitting) { event.preventDefault(); panel.hide(); } });
    pet.once('ready-to-show', () => pet.showInactive());
    panel.once('ready-to-show', showPanel);
    pet.on('move', () => {
      positionPanel(); clearTimeout(positionTimer);
      positionTimer = setTimeout(savePetPosition, 250);
    });
    pet.on('hide', endPetDrag);
    pet.webContents.on('render-process-gone', endPetDrag);
    const keepPetVisible = () => {
      endPetDrag();
      const position = visiblePetPosition(pet.getBounds());
      pet.setPosition(position.x, position.y); positionPanel(); savePetPosition();
    };
    screen.on('display-removed', keepPetVisible);
    screen.on('display-metrics-changed', keepPetVisible);
    const pixels = Buffer.alloc(22 * 22 * 4);
    for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) {
      const body = ((x - 10.5) / 9) ** 2 + ((y - 12) / 7) ** 2 < 1;
      const ears = y >= 3 && y <= 10 && ((x >= 4 && x <= 7) || (x >= 14 && x <= 17));
      const eyes = y >= 10 && y <= 12 && ((x >= 7 && x <= 8) || (x >= 13 && x <= 14));
      if ((body || ears) && !eyes) pixels[(y * 22 + x) * 4 + 3] = 255;
    }
    const trayIcon = nativeImage.createFromBitmap(pixels, { width: 22, height: 22, scaleFactor: 1 });
    trayIcon.setTemplateImage(true);
    tray = new Tray(trayIcon); tray.setToolTip('Mochi');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Talk to Mochi', click: showPanel },
      { label: 'Show / hide pet', click: () => pet.isVisible() ? pet.hide() : pet.showInactive() },
      { label: 'Open workspace', click: () => shell.openPath(path.join(app.getPath('userData'), 'workspace')) },
      { type: 'separator' }, { label: 'Quit Mochi', click: () => app.quit() },
    ]));
    tray.on('click', showPanel);
    globalShortcut.register('CommandOrControl+Shift+Space', showPanel);
    register('state', snapshot, true);
    register('toggle', () => panel.isVisible() ? panel.hide() : showPanel(), true);
    register('pet-drag-start', beginPetDrag, true);
    register('pet-drag-end', endPetDrag, true);
    register('hide', () => panel.hide());
    register('quit', () => app.quit());
    register('workspace', () => shell.openPath(path.join(app.getPath('userData'), 'workspace')));
    register('stop', () => { active?.abort(); chatgpt.cancel(); });
    register('chatgpt-sign-in', options => configure(async () => {
      if (!options || typeof options !== 'object' || (options.profileId !== undefined && typeof options.profileId !== 'string') ||
          (options.enablePlan !== undefined && typeof options.enablePlan !== 'boolean')) throw new Error('Invalid sign-in options.');
      await chatgpt.signIn({ profileId: options.profileId, enablePlan: options.enablePlan });
      await useChatGPT(); showPanel();
      return snapshot();
    }));
    register('chatgpt-cancel', () => chatgpt.cancel());
    register('chatgpt-select', id => configure(async () => {
      if (typeof id !== 'string') throw new Error('Choose a saved ChatGPT account.');
      await chatgpt.select(id); await useChatGPT(); return snapshot();
    }));
    register('chatgpt-sign-out', () => configure(() => chatgpt.signOut()));
    register('chatgpt-welcome', () => configure(() => chatgpt.acknowledgeWelcome()));
    register('chatgpt-usage', () => shell.openExternal('https://chatgpt.com/settings/usage'));
    register('approve', (id, allowed) => {
      if (typeof id !== 'string' || typeof allowed !== 'boolean') throw new Error('Invalid decision.');
      approvals.get(id)?.(allowed);
    });
    register('settings', async input => {
      if (active || configuring) throw new Error('Wait for the current operation to finish.');
      const next = validateSettings(input), previous = store.state.settings;
      configuring = true; refresh();
      try {
        if (input.apiKey) await credentials.set(next, input.apiKey);
        store.state.settings = next; store.save(); return next;
      } catch (error) { store.state.settings = previous; throw error; }
      finally { configuring = false; refresh(); }
    });
    register('remove-key', () => {
      if (active || configuring) throw new Error('Wait for the current operation to finish.');
      credentials.remove(store.state.settings); refresh();
    });
    register('status', async () => {
      try { return await configure(async () => (await provider()).status()); }
      catch (error) { return { connected: false, ready: false, models: [], message: error.message }; }
    });
    register('tool', (name, args) => run(signal => tools.execute(name, args, { signal, approve: action => askApproval(action, signal) })));
    register('chat', text => run(async signal => {
      if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw new Error('Enter a message up to 8000 characters.');
      const history = [...store.state.messages];
      store.add('messages', { role: 'user', content: text }, 100); refresh();
      let answer;
      try {
        answer = await runAgent({ text, history, provider: await provider(), tools, signal,
          approve: action => askApproval(action, signal), onEvent: event => {
            emit(event); if (event.type === 'thinking' || event.type === 'tool') setMood('thinking');
          } });
      } catch (error) {
        answer = signal.aborted ? 'Stopped. Completed actions remain in Activity.' : `I couldn’t finish: ${error.message}\nOpen Settings to check your model connection.`;
      }
      store.add('messages', { role: 'assistant', content: answer }, 100);
      return answer;
    }));
    reminderTimer = setInterval(deliverReminders, 1000);
    panel.webContents.once('did-finish-load', deliverReminders);
  }).catch(error => { dialog.showErrorBox('Mochi could not start', error.message); app.quit(); });
  app.on('second-instance', () => { if (panel) showPanel(); });
  app.on('activate', () => { if (panel) showPanel(); });
  app.on('before-quit', () => {
    quitting = true; active?.abort(); chatgpt?.cancel(); clearInterval(reminderTimer);
    endPetDrag(); savePetPosition();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
