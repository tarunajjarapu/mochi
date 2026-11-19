const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/core/store.cjs');
const { createTools } = require('../src/core/tools.cjs');
const { Ollama, validateSettings } = require('../src/core/provider.cjs');
const { runAgent } = require('../src/core/agent.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory), workspace = path.join(directory, 'workspace');
  const opened = [];
  const tools = createTools({ store, workspace, openExternal: async url => opened.push(url), now: () => Date.parse('2026-11-19T19:00:00Z') });
  return { directory, store, workspace, tools, opened };
}
const yes = { approve: async () => true };

test('memory and future reminders survive restart; overdue reminders deliver once', async t => {
  const { directory, store, tools } = fixture(t);
  await tools.execute('remember', { text: 'I prefer tea.' }, yes);
  await tools.execute('set_reminder', { text: 'Stretch', at: '2026-11-19T12:00:00-08:00' }, yes);
  const reloaded = new Store(directory);
  assert.equal(reloaded.state.memories[0].text, 'I prefer tea.');
  assert.equal(reloaded.due(Date.parse('2026-11-19T19:30:00Z')).length, 0);
  assert.equal(reloaded.due(Date.parse('2026-11-19T21:00:00Z'))[0].text, 'Stretch');
  assert.equal(new Store(directory).due(Date.parse('2026-11-19T21:00:00Z')).length, 0);
  assert.equal(store.state.activity.length, 2);
});

test('writes are denied by default and approval receives the exact normalized arguments', async t => {
  const { tools, store, opened } = fixture(t);
  assert.equal((await tools.execute('remember', { text: 'Do not save' })).denied, true);
  assert.equal(store.state.memories.length, 0);
  await tools.execute('open_url', { url: 'https://example.com' }, { approve: async action => {
    assert.deepEqual(action, { name: 'open_url', args: { url: 'https://example.com/' } }); return false;
  } });
  assert.equal(opened.length, 0);
});

test('cancellation while approval is open prevents the action', async t => {
  const { tools, store } = fixture(t);
  const controller = new AbortController();
  await assert.rejects(tools.execute('remember', { text: 'never save' }, {
    signal: controller.signal, approve: async () => { controller.abort(); return true; },
  }), { name: 'AbortError' });
  assert.equal(store.state.memories.length, 0);
});

test('file tools block traversal, symlinks, oversized files, and overwrites', async t => {
  const { directory, workspace, tools } = fixture(t);
  fs.writeFileSync(path.join(directory, 'outside.txt'), 'private');
  fs.symlinkSync(path.join(directory, 'outside.txt'), path.join(workspace, 'link.txt'));
  for (const filename of ['../outside.txt', '/tmp/private.txt', '.env', 'link.txt']) {
    await assert.rejects(tools.execute('read_file', { filename }));
  }
  fs.writeFileSync(path.join(workspace, 'large.txt'), 'x'.repeat(32_001));
  await assert.rejects(tools.execute('read_file', { filename: 'large.txt' }), /32 KB/);
  await tools.execute('write_file', { filename: 'note.md', content: 'Hello' }, yes);
  await assert.rejects(tools.execute('write_file', { filename: 'note.md', content: 'overwrite' }, yes), /EEXIST/);
  assert.equal((await tools.execute('read_file', { filename: 'note.md' })).content, 'Hello');
  assert.equal(fs.readFileSync(path.join(directory, 'outside.txt'), 'utf8'), 'private');
});

test('reminders require future timestamps with explicit offsets', async t => {
  const { tools } = fixture(t);
  for (const at of ['tomorrow', '2026-11-20T12:00:00', '2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z']) {
    await assert.rejects(tools.execute('set_reminder', { text: 'test', at }, yes));
  }
  const reminder = await tools.execute('set_reminder', { text: 'test', at: '2026-11-20T12:00:00-08:00' }, yes);
  await tools.execute('cancel_reminder', { id: reminder.id }, yes);
  assert.deepEqual(await tools.execute('list_reminders', {}), []);
});

test('URL actions reject local executable protocols and credentials', async t => {
  const { tools, opened } = fixture(t);
  for (const url of ['file:///tmp/file', 'javascript:alert(1)', 'https://user:pass@example.com']) {
    await assert.rejects(tools.execute('open_url', { url }, yes));
  }
  await tools.execute('open_url', { url: 'https://example.com' }, yes);
  assert.deepEqual(opened, ['https://example.com/']);
});

test('agent executes tools, sends tool results back, then returns the model answer', async t => {
  const { tools, store } = fixture(t);
  const calls = [];
  const provider = { chat: async messages => {
    calls.push(structuredClone(messages));
    return calls.length === 1
      ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'remember', arguments: { text: 'Tea, please.' } } }] }
      : { role: 'assistant', content: 'I’ll remember your preference.' };
  } };
  const result = await runAgent({ text: 'Remember I prefer tea', provider, tools, approve: yes.approve });
  assert.equal(result, 'I’ll remember your preference.');
  assert.equal(store.state.memories[0].text, 'Tea, please.');
  assert.equal(calls[1].at(-1).role, 'tool');
  assert.equal(JSON.parse(calls[1].at(-1).content).text, 'Tea, please.');
});

test('agent surfaces unknown tools as results and stops at its step budget', async t => {
  const { tools } = fixture(t);
  let steps = 0;
  const provider = { chat: async messages => {
    if (steps++) assert.match(messages.at(-1).content, /Unknown tool/);
    return { role: 'assistant', content: '', tool_calls: [{ function: { name: 'shell', arguments: { command: 'anything' } } }] };
  } };
  assert.match(await runAgent({ text: 'test', provider, tools, maxSteps: 2 }), /step limit/);
  assert.equal(steps, 2);
});

test('agent cancellation after inference prevents any tool execution', async t => {
  const { tools, store } = fixture(t);
  const controller = new AbortController();
  const provider = { chat: async () => {
    controller.abort();
    return { role: 'assistant', tool_calls: [{ function: { name: 'remember', arguments: { text: 'never' } } }] };
  } };
  await assert.rejects(runAgent({ text: 'test', provider, tools, signal: controller.signal, approve: yes.approve }), { name: 'AbortError' });
  assert.equal(store.state.memories.length, 0);
});

test('provider allows only loopback addresses and rejects cloud model names', () => {
  for (const endpoint of ['https://example.com', 'http://127.0.0.1.evil.test', 'file:///tmp', 'http://user:pass@localhost:11434', 'http://localhost:11434/api']) {
    assert.throws(() => validateSettings({ endpoint, model: 'qwen3:8b' }));
  }
  assert.throws(() => validateSettings({ endpoint: 'http://localhost:11434', model: 'model:cloud' }));
  assert.equal(validateSettings({ endpoint: 'http://localhost:11434/', model: 'qwen3:8b' }).endpoint, 'http://localhost:11434');
});

test('Ollama requests pass tools and abort signal and do not follow redirects', async () => {
  const controller = new AbortController();
  const provider = new Ollama({ endpoint: 'http://localhost:11434', model: 'qwen3:8b' }, async (url, options) => {
    assert.equal(url, 'http://localhost:11434/api/chat');
    assert.equal(options.redirect, 'error');
    assert.equal(JSON.parse(options.body).stream, false);
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ message: { role: 'assistant', content: 'Hi!' } }) };
  });
  assert.equal((await provider.chat([], [], controller.signal)).content, 'Hi!');
});

test('corrupt state is preserved instead of silently erased', t => {
  const { directory, store } = fixture(t);
  fs.writeFileSync(store.file, 'broken state');
  assert.throws(() => new Store(directory));
  assert.equal(fs.readFileSync(store.file, 'utf8'), 'broken state');
});
