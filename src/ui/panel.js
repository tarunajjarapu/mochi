const $ = selector => document.querySelector(selector);
let state, approvalId, toastTimer;
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
  $('#settings-form button').disabled = state.busy;
}
async function check() {
  $('#connection').textContent = 'Checking local model…';
  const status = await api.status();
  $('#dot').classList.toggle('online', status.ready);
  $('#connection').textContent = status.ready ? `${state.settings.model} · local` : status.connected ? 'Model not installed' : 'Local model is offline';
  $('#status-detail').textContent = status.ready ? 'Connected. Your local model is ready.' : status.connected ? `Ollama is running. Install ${state.settings.model} or choose an installed model.` : 'Start Ollama, then check again. You can still use the notebook and reminders.';
  $('#models').replaceChildren(...status.models.filter(name => !/cloud/i.test(name)).map(name => { const option = make('option'); option.value = name; return option; }));
}
$('#check').onclick = safe(check);
$('#settings-form').onsubmit = event => { event.preventDefault(); safe(async () => {
  await api.settings({ endpoint: $('#endpoint').value, model: $('#model').value.trim() }); await check(); toast('Connection saved.');
})(); };
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
safe(async () => { render(await api.state()); $('#endpoint').value = state.settings.endpoint; $('#model').value = state.settings.model; await check(); })();
