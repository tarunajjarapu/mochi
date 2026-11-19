const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULTS, validateSettings, createProvider } = require('../src/core/provider.cjs');
const { Credentials } = require('../src/core/credentials.cjs');
const { Store } = require('../src/core/store.cjs');
const { runAgent } = require('../src/core/agent.cjs');

const ok = data => ({ ok: true, json: async () => data });
const schemas = [{ type: 'function', function: { name: 'current_time', description: 'Read the time.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } }];
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-provider-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}

test('new profiles default to OpenAI; old Ollama profiles migrate without changing destination', t => {
  const dir = directory(t), store = new Store(dir);
  assert.deepEqual(store.state.settings, DEFAULTS.openai);
  store.state.settings = { endpoint: 'http://localhost:11434', model: 'qwen3:8b' };
  store.save();
  assert.deepEqual(new Store(dir).state.settings, { provider: 'ollama', api: 'ollama', endpoint: 'http://localhost:11434', model: 'qwen3:8b' });
});

test('remote endpoints require HTTPS; direct OpenAI cannot be redirected to a different host', () => {
  for (const endpoint of ['http://proxy.example/v1', 'https://user:key@proxy.example/v1', 'https://proxy.example/v1?api_key=x', 'https://proxy.example/v1#key', 'file:///tmp']) {
    assert.throws(() => validateSettings({ ...DEFAULTS.compatible, endpoint }));
  }
  assert.throws(() => validateSettings({ ...DEFAULTS.openai, endpoint: 'https://proxy.example/v1' }));
  assert.equal(validateSettings({ ...DEFAULTS.compatible, endpoint: 'https://proxy.example/gateway/v1/' }).endpoint, 'https://proxy.example/gateway/v1');
  assert.equal(validateSettings({ ...DEFAULTS.openai, apiKey: 'must-not-persist' }).apiKey, undefined);
});

test('Responses loop preserves reasoning, assistant phase and IDs for multiple calls to the same tool', async () => {
  const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque-model-state' };
  const commentary = { type: 'message', id: 'msg_1', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Checking.', annotations: [] }] };
  const toolCalls = ['call_1', 'call_2'].map(call_id => ({ type: 'function_call', call_id, name: 'current_time', arguments: '{}' }));
  let requests = 0, executions = 0;
  const provider = createProvider(DEFAULTS.openai, { apiKey: 'synthetic-test-key', fetcher: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-key');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.model, 'gpt-6.2-sol');
    assert.equal(body.tools[0].name, 'current_time'); assert.equal(body.tools[0].strict, true);
    assert.ok(!JSON.stringify(body).includes('synthetic-test-key'));
    if (++requests === 1) return ok({ status: 'completed', output: [reasoning, commentary, ...toolCalls] });
    assert.deepEqual(body.input.slice(-6, -2), [reasoning, commentary, ...toolCalls]);
    assert.deepEqual(body.input.slice(-2).map(item => [item.type, item.call_id]), [['function_call_output', 'call_1'], ['function_call_output', 'call_2']]);
    assert.equal(JSON.parse(body.input.at(-1).output).sequence, 2);
    return ok({ status: 'completed', output: [{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Done.' }] }] });
  } });
  const answer = await runAgent({ text: 'Check twice.', provider, tools: { schemas, execute: async () => ({ sequence: ++executions }) } });
  assert.equal(answer, 'Done.'); assert.equal(executions, 2); assert.equal(requests, 2);
});

test('LiteLLM Responses uses the configured alias, proxy URL and proxy key', async () => {
  const provider = createProvider({ ...DEFAULTS.compatible, model: 'my-alias' }, { apiKey: 'proxy-test-key', fetcher: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:4000/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer proxy-test-key');
    assert.equal(JSON.parse(options.body).model, 'my-alias');
    return ok({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Routed.' }] }] });
  } });
  assert.equal((await provider.chat([{ role: 'user', content: 'Hello' }], schemas)).content, 'Routed.');
});

test('Chat Completions loop serializes calls and matches result IDs without losing provider fields', async () => {
  const first = { role: 'assistant', content: null, reasoning_content: 'provider-specific-state', tool_calls: [{ id: 'chat_call', type: 'function', function: { name: 'current_time', arguments: '{}' } }] };
  let requests = 0;
  const provider = createProvider({ ...DEFAULTS.compatible, api: 'chat' }, { fetcher: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:4000/v1/chat/completions');
    const body = JSON.parse(options.body);
    if (++requests === 1) return ok({ choices: [{ finish_reason: 'tool_calls', message: first }] });
    assert.deepEqual(body.messages.at(-2), first);
    assert.deepEqual(body.messages.at(-1), { role: 'tool', tool_call_id: 'chat_call', content: '{"time":"now"}' });
    return ok({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'It is now.' } }] });
  } });
  assert.equal(await runAgent({ text: 'Time?', provider, tools: { schemas, execute: async () => ({ time: 'now' }) } }), 'It is now.');
});

test('incomplete responses and malformed argument JSON never execute proposed tools', async () => {
  for (const response of [
    { status: 'incomplete', output: [{ type: 'function_call', call_id: 'x', name: 'current_time', arguments: '{}' }] },
    { status: 'completed', output: [{ type: 'function_call', call_id: 'x', name: 'current_time', arguments: 'not-json' }] },
  ]) {
    let executions = 0;
    const provider = createProvider(DEFAULTS.openai, { apiKey: 'test-key', fetcher: async () => ok(response) });
    await assert.rejects(runAgent({ text: 'Time?', provider, tools: { schemas, execute: async () => executions++ } }));
    assert.equal(executions, 0);
  }
});

test('missing keys fail before network access; provider error bodies never enter user-facing errors', async () => {
  const missing = createProvider(DEFAULTS.openai, { fetcher: async () => { assert.fail('Network must not be called'); } });
  await assert.rejects(missing.status(), /API key/);
  const denied = createProvider(DEFAULTS.openai, { apiKey: 'test-key', fetcher: async () => ({ ok: false, status: 401, json: async () => ({ error: 'echoed-sensitive-value' }) }) });
  await assert.rejects(denied.status(), error => /Authentication/.test(error.message) && !error.message.includes('echoed-sensitive-value'));
});

test('status checks the model list without generating a billable response', async () => {
  const provider = createProvider(DEFAULTS.openai, { apiKey: 'test-key', fetcher: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/models'); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    return ok({ data: [{ id: DEFAULTS.openai.model }] });
  } });
  assert.equal((await provider.status()).ready, true);
});

test('cancellation propagates to the hosted fetch and aborts the turn', async () => {
  const controller = new AbortController();
  const provider = createProvider(DEFAULTS.openai, { apiKey: 'test-key', fetcher: async (_url, options) => {
    controller.abort(); options.signal.throwIfAborted();
  } });
  await assert.rejects(provider.chat([], schemas, controller.signal), { name: 'AbortError' });
});

function fakeStorage() {
  const encrypted = new Map(); let sequence = 0;
  return {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async value => { const id = `ciphertext-${++sequence}`; encrypted.set(id, value); return Buffer.from(id); },
    decryptStringAsync: async buffer => ({ result: encrypted.get(buffer.toString()), shouldReEncrypt: false }),
    getSelectedStorageBackend: () => 'gnome_libsecret',
  };
}

test('keys are encrypted on disk, survive restart and are scoped to provider and endpoint', async t => {
  const dir = directory(t), storage = fakeStorage(), vault = new Credentials(dir, storage, {});
  await vault.set(DEFAULTS.openai, 'synthetic-private-key');
  assert.equal(fs.readFileSync(vault.file, 'utf8').includes('synthetic-private-key'), false);
  const reopened = new Credentials(dir, storage, {});
  assert.equal(await reopened.get(DEFAULTS.openai), 'synthetic-private-key');
  assert.equal(await reopened.get(DEFAULTS.compatible), '');
  assert.equal(await reopened.get({ ...DEFAULTS.compatible, endpoint: 'https://proxy.example/v1' }), '');
  reopened.remove(DEFAULTS.openai); assert.equal(await reopened.get(DEFAULTS.openai), '');
});

test('environment keys never follow a provider switch or a proxy host change', async t => {
  const vault = new Credentials(directory(t), fakeStorage(), { OPENAI_API_KEY: 'openai-only', LITELLM_API_KEY: 'proxy-only' });
  assert.equal(await vault.get(DEFAULTS.openai), 'openai-only');
  assert.equal(await vault.get(DEFAULTS.compatible), 'proxy-only');
  assert.equal(await vault.get(DEFAULTS.ollama), '');
  assert.equal(await vault.get({ ...DEFAULTS.compatible, endpoint: 'https://other.example/v1' }), '');
});

test('key storage fails closed when OS encryption is unavailable or Linux uses plaintext fallback', async t => {
  const dir = directory(t), storage = fakeStorage(); storage.isAsyncEncryptionAvailable = async () => false;
  await assert.rejects(new Credentials(dir, storage, {}).set(DEFAULTS.openai, 'secret'), /Secure storage/);
  storage.isAsyncEncryptionAvailable = async () => true; storage.getSelectedStorageBackend = () => 'basic_text';
  await assert.rejects(new Credentials(dir, storage, {}, 'linux').set(DEFAULTS.openai, 'secret'), /Secure storage/);
  assert.equal(fs.existsSync(path.join(dir, 'credentials.json')), false);
});
