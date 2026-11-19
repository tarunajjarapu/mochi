const $ = selector => document.querySelector(selector);
let state, approvalId, toastTimer, checkGeneration = 0, chatgptModels = [];
const api = window.mochi;
const make = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 6000); }
const safe = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(error => toast(error.message));
function tab(name) {
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.id === name));
  document.querySelectorAll('[data-tab]').forEach(el => el.setAttribute('aria-pressed', el.dataset.tab === name));
}
document.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => tab(el.dataset.tab));
$('#hide').onclick = safe(() => api.hide());
$('#quit').onclick = safe(() => api.quit());
$('#workspace').onclick = safe(async () => { const error = await api.workspace(); if (error) toast(error); });
$('#stop').onclick = safe(() => api.stop());
function renderMessages() {
  const box = $('#messages');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.replaceChildren();
  if (!state.messages.length) {
    const welcome = make('div', undefined, 'welcome');
    welcome.append(make('div', 'YOUR DESKTOP, A LITTLE WARMER', 'eyebrow'), make('h1', 'Small companion.\nA little more possible.'), make('p', 'I’m Mochi. I can help you think things through, remember the little things, and get a few things done.'));
    const choices = make('div', undefined, 'suggestions');
    for (const text of ['What can you help me with?', 'Remember that I like quiet mornings.', 'Remind me to stretch in 20 minutes.']) {
      const button = make('button', text); button.onclick = () => { $('#message').value = text; $('#message').focus(); }; choices.append(button);
    }
    welcome.append(choices); box.append(welcome);
  }
  for (const message of state.messages) {
    const bubble = make('div', undefined, `bubble ${message.role}`);
    if (message.role === 'assistant') bubble.append(make('span', 'MOCHI', 'speaker'));
    bubble.append(make('span', message.content)); box.append(bubble);
  }
  if (atBottom) box.scrollTop = box.scrollHeight;
}
function renderNotebook() {
  $('#memories').replaceChildren(); $('#reminders').replaceChildren();
  if (!state.memories.length) $('#memories').append(make('p', 'A fresh page. Nothing saved yet.', 'empty'));
  for (const memory of state.memories) {
    const item = make('div', undefined, 'item'), remove = make('button', 'Forget this');
    remove.onclick = safe(() => api.tool('forget', { id: memory.id }));
    item.append(make('p', memory.text), remove); $('#memories').append(item);
  }
  const pending = state.reminders.filter(r => !r.deliveredAt).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!pending.length) $('#reminders').append(make('p', 'Nothing coming up. A little breathing room.', 'empty'));
  for (const reminder of pending) {
    const item = make('div', undefined, 'item'), cancel = make('button', 'Cancel reminder');
    cancel.onclick = safe(() => api.tool('cancel_reminder', { id: reminder.id }));
    item.append(make('p', reminder.text), make('time', new Date(reminder.at).toLocaleString()), cancel); $('#reminders').append(item);
  }
}
function renderActivity() {
  $('#events').replaceChildren();
  if (!state.activity.length) $('#events').append(make('p', 'Quiet for now. Completed actions will appear here.', 'empty'));
  for (const event of [...state.activity].reverse()) {
    const details = make('details', undefined, 'event');
    details.append(make('summary', event.tool.replaceAll('_', ' ')), make('small', new Date(event.createdAt).toLocaleString()), make('pre', JSON.stringify({ arguments: event.args, result: event.result }, null, 2)));
    $('#events').append(details);
  }
}
function render(next) {
  state = next;
  renderMessages(); renderNotebook(); renderActivity();
  $('#working').hidden = !state.busy; $('#send').disabled = state.busy;
  $('#provider-tag').textContent = { chatgpt: 'CHATGPT PLAN', openai: 'OPENAI API', compatible: 'CUSTOM PROVIDER', ollama: 'LOCAL MODEL' }[state.settings.provider];
  document.querySelectorAll('#settings-form input, #settings-form select, #settings-form button').forEach(el => el.disabled = state.busy);
  $('#check').disabled = state.busy;
  updateProviderForm();
  const account = state.chatgpt.profiles.find(profile => profile.id === state.chatgpt.activeId);
  $('#plan-usage').hidden = state.settings.provider !== 'chatgpt';
  $('#plan-label').textContent = account?.sharing ? 'Using ChatGPT plan' : 'ChatGPT plan not connected';
  if (state.chatgpt.pending) $('#working-label').textContent = 'Finish ChatGPT sign-in in your browser…';
  if (state.settings.provider === 'chatgpt' && state.chatgpt.needsWelcome && !state.busy && !$('#chatgpt-welcome').open) $('#chatgpt-welcome').showModal();
}
function draftSettings() {
  return { provider: $('#provider').value, endpoint: $('#endpoint').value.replace(/\/+$/, ''),
    model: $('#provider').value === 'chatgpt' ? ($('#chatgpt-model').value || (state.settings.provider === 'chatgpt' ? state.settings.model : state.providerDefaults.chatgpt.model)) : $('#model').value.trim(),
    api: $('#provider').value === 'compatible' ? $('#api-format').value : state.providerDefaults[$('#provider').value].api };
}
function savedDraft() {
  const draft = draftSettings();
  return ['provider', 'endpoint', 'model', 'api'].every(key => draft[key] === state.settings[key]);
}
function updateProviderForm() {
  const selected = $('#provider').value, local = selected === 'ollama', custom = selected === 'compatible', accountMode = selected === 'chatgpt';
  $('#endpoint').readOnly = selected === 'openai' || accountMode;
  $('#api-fields').hidden = accountMode; $('#chatgpt-fields').hidden = !accountMode;
  document.querySelectorAll('#api-fields input, #api-fields select').forEach(el => el.disabled = state.busy || accountMode);
  $('#format-fields').hidden = !custom; $('#key-fields').hidden = local;
  $('#setup-title').textContent = { chatgpt: 'Your account. A little more possible.', openai: 'OpenAI, straight from your desktop.', compatible: 'Bring your own model router.', ollama: 'Keep inference on your machine.' }[selected];
  $('#setup-description').textContent = { chatgpt: 'Continue with ChatGPT to use an eligible plan. No API key or separate Mochi server is needed.', openai: 'Add your own OpenAI API key and choose a model. API usage is billed separately from your ChatGPT plan.', compatible: 'Point Mochi at your running LiteLLM proxy or another compatible API. Enter its base URL, model alias, and key if required.', ollama: 'Start Ollama and install a model, for example: ollama pull qwen3:8b.' }[selected];
  $('#data-notice').textContent = local ? 'Chat and tool results go to your local Ollama server.' : 'Chat context and tool results (including files or memories read during a task) are sent to this provider. Tools still run on your computer with the same approvals.';
  const sameEndpoint = selected === state.settings.provider && $('#endpoint').value.replace(/\/+$/, '') === state.settings.endpoint;
  $('#key-status').textContent = sameEndpoint && state.keySource === 'saved' ? 'An encrypted key is saved for this address. Leave blank to keep it.' : sameEndpoint && state.keySource === 'environment' ? 'Using the key from Mochi’s environment. A pasted key overrides it.' : 'Keys are encrypted using your OS keychain and saved for this provider and address only. A local proxy may not require a key.';
  $('#remove-key').hidden = local || accountMode;
  $('#remove-key').disabled = state.busy || !savedDraft() || state.keySource !== 'saved';
  const auth = state.chatgpt, profile = auth.profiles.find(item => item.id === auth.activeId);
  $('#account-picker-fields').hidden = !auth.profiles.length;
  $('#chatgpt-account').replaceChildren(...auth.profiles.map(item => { const option = make('option', item.label); option.value = item.id; return option; }));
  $('#chatgpt-account').value = auth.activeId || '';
  $('#account-status').textContent = auth.error || (auth.pending ? 'Waiting for your browser. You can cancel and try again.' :
    profile?.sharing ? 'Connected · Using ChatGPT plan' : profile?.connected ? 'Signed in, but plan usage is disabled. Continue with ChatGPT to enable it.' : 'Continue with ChatGPT to connect.');
  $('#chatgpt-sign-in').hidden = auth.pending;
  $('#chatgpt-cancel').hidden = !auth.pending; $('#chatgpt-cancel').disabled = false;
  $('#chatgpt-add').hidden = !auth.profiles.length;
  $('#chatgpt-sign-out').disabled = state.busy || !profile?.connected;
  $('#chatgpt-model').disabled = state.busy || !chatgptModels.length;
  $('#save-connection').textContent = accountMode ? 'Save model' : 'Save connection';
  $('#save-connection').disabled = state.busy || (accountMode && !chatgptModels.length);
}
function fillSettings(settings) {
  $('#provider').value = settings.provider; $('#endpoint').value = settings.endpoint;
  $('#model').value = settings.model; $('#api-format').value = settings.api === 'chat' ? 'chat' : 'responses';
  $('#api-key').value = ''; $('#models').replaceChildren();
  if (settings.provider === 'chatgpt') $('#chatgpt-model').value = settings.model;
  updateProviderForm();
}
$('#provider').onchange = () => { fillSettings(state.providerDefaults[$('#provider').value]); $('#status-detail').textContent = 'Save this connection to use it.'; };
$('#endpoint').oninput = () => { $('#api-key').value = ''; updateProviderForm(); };
$('#model').oninput = updateProviderForm; $('#api-format').onchange = updateProviderForm;
$('#chatgpt-model').onchange = updateProviderForm;
async function check() {
  if (!savedDraft()) { toast('Save the connection first, then check it.'); return; }
  const generation = ++checkGeneration;
  $('#connection').textContent = 'Checking connection…';
  const status = await api.status();
  if (generation !== checkGeneration) return;
  $('#dot').classList.toggle('online', status.ready);
  $('#connection').textContent = status.ready ? state.settings.model : status.connected ? 'Check model name' : 'Connection needs setup';
  $('#status-detail').textContent = status.message;
  $('#models').replaceChildren(...status.models.filter(name => state.settings.provider !== 'ollama' || !/cloud/i.test(name)).map(name => { const option = make('option'); option.value = name; return option; }));
  if (state.settings.provider === 'chatgpt') {
    chatgptModels = status.modelChoices || [];
    $('#chatgpt-model').replaceChildren(...chatgptModels.map(model => { const option = make('option', model.label); option.value = model.id; return option; }));
    if (chatgptModels.some(model => model.id === state.settings.model)) $('#chatgpt-model').value = state.settings.model;
    if (!chatgptModels.length) { const option = make('option', 'Connect to load models'); option.value = ''; $('#chatgpt-model').append(option); }
    updateProviderForm();
  }
}
$('#check').onclick = safe(check);
$('#settings-form').onsubmit = event => { event.preventDefault(); safe(async () => {
  ++checkGeneration;
  try { await api.settings({ ...draftSettings(), apiKey: ['ollama', 'chatgpt'].includes($('#provider').value) ? '' : $('#api-key').value.trim() }); }
  finally { $('#api-key').value = ''; }
  fillSettings(state.settings); await check(); toast('Connection saved.');
})(); };
$('#remove-key').onclick = safe(async () => { await api.removeKey(); await check(); toast('Saved key removed. Environment keys, if set, still apply.'); });
async function connectChatGPT(newAccount = false) {
  ++checkGeneration;
  const profile = state.chatgpt.profiles.find(item => item.id === state.chatgpt.activeId);
  await api.chatgptSignIn(newAccount || !profile ? {} : { profileId: profile.id, enablePlan: profile.connected && !profile.sharing });
  const next = await api.state();
  render(next); fillSettings(next.settings); await check();
}
$('#chatgpt-sign-in').onclick = safe(() => connectChatGPT());
$('#chatgpt-add').onclick = safe(() => connectChatGPT(true));
$('#chatgpt-cancel').onclick = safe(() => api.chatgptCancel());
$('#chatgpt-account').onchange = safe(async () => {
  ++checkGeneration; chatgptModels = [];
  await api.chatgptSelect($('#chatgpt-account').value); const next = await api.state();
  render(next); fillSettings(next.settings); await check();
});
$('#chatgpt-sign-out').onclick = safe(async () => {
  ++checkGeneration; const result = await api.chatgptSignOut(); chatgptModels = [];
  fillSettings(state.settings); await check(); $('#status-detail').textContent = result.message; toast(result.message);
});
document.querySelectorAll('[data-manage-usage]').forEach(button => button.onclick = safe(() => api.chatgptUsage()));
$('#chatgpt-got-it').onclick = safe(async () => { await api.chatgptWelcome(); $('#chatgpt-welcome').close(); });
$('#chatgpt-welcome').addEventListener('cancel', event => { event.preventDefault(); $('#chatgpt-got-it').click(); });
$('#chat-form').onsubmit = event => { event.preventDefault(); safe(async () => {
  const message = $('#message').value.trim(); if (!message || state.busy) return;
  $('#message').value = ''; await api.chat(message);
})(); };
$('#message').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#chat-form').requestSubmit(); } };
$('#memory-form').onsubmit = event => { event.preventDefault(); safe(async () => {
  const result = await api.tool('remember', { text: $('#memory-text').value }); if (!result.denied) $('#memory-text').value = '';
})(); };
$('#reminder-form').onsubmit = event => { event.preventDefault(); safe(async () => {
  const at = new Date($('#reminder-at').value); if (!Number.isFinite(at.getTime())) throw new Error('Choose a valid reminder time.');
  const result = await api.tool('set_reminder', { text: $('#reminder-text').value, at: at.toISOString() });
  if (!result.denied) { $('#reminder-text').value = ''; $('#reminder-at').value = ''; }
})(); };
const approvalTitles = { remember: 'Keep this in mind?', forget: 'Forget this memory?', set_reminder: 'Give you a nudge?', cancel_reminder: 'Cancel this nudge?', write_file: 'Create this file?', open_url: 'Open this in your browser?' };
function decide(allowed) { if (approvalId) return api.approve(approvalId, allowed); }
$('#allow').onclick = safe(() => decide(true)); $('#deny').onclick = safe(() => decide(false));
$('#approval').addEventListener('cancel', event => { event.preventDefault(); safe(() => decide(false))(); });
api.onEvent(event => {
  if (event.type === 'state') render(event.state);
  if (event.type === 'thinking') $('#working-label').textContent = `Thinking · step ${event.step}`;
  if (event.type === 'tool') $('#working-label').textContent = `Using ${(event.name || 'tool').replaceAll('_', ' ')}…`;
  if (event.type === 'error') toast(event.message);
  if (event.type === 'reminder') toast(`A little nudge: ${event.text}`);
  if (event.type === 'approval') {
    approvalId = event.id;
    $('#approval-title').textContent = approvalTitles[event.name] || 'Allow this action?';
    $('#approval-detail').textContent = event.name === 'set_reminder' ? new Date(event.args.at).toLocaleString() : event.name === 'open_url' ? 'This will open an external website in your default browser.' : 'Review the exact details below.';
    $('#approval-args').textContent = JSON.stringify(event.args, null, 2);
    $('#approval').showModal();
  }
  if (event.type === 'approval-resolved' && event.id === approvalId) { $('#approval').close(); approvalId = null; }
});
safe(async () => { render(await api.state()); fillSettings(state.settings); await check(); })();
