const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ChatGPTAuth, listenForCallback, PLAN_SCOPE } = require('../src/core/chatgpt-auth.cjs');
const { DEFAULTS, createProvider, validateSettings } = require('../src/core/provider.cjs');
const { runAgent } = require('../src/core/agent.cjs');

const issuer = 'https://auth.openai.com', resource = 'https://api.openai.com/v1';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const keys = (async () => {
  const jose = await import('jose'); const pair = await jose.generateKeyPair('RS256');
  return { jose, ...pair, jwk: { ...await jose.exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' } };
})();
function fixtureStorage() {
  const values = new Map(); let count = 0;
  return { isAsyncEncryptionAvailable: async () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async value => { const id = `encrypted-${++count}`; values.set(id, value); return Buffer.from(id); },
    decryptStringAsync: async buffer => ({ result: values.get(buffer.toString()), shouldReEncrypt: false }) };
}
async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-chatgpt-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storage = fixtureStorage(), k = await keys;
  const flow = { scope: `openid email profile offline_access resource.invoke ${PLAN_SCOPE}`, subject: 'person-1', email: 'person@example.test',
    grants: [], opened: [], now: Date.now(), refreshes: 0, revocations: 0, ...options };
  let auth;
  const fetcher = async (url, init) => {
    url = String(url);
    assert.equal(init.redirect, 'error');
    if (url === `${issuer}/.well-known/openid-configuration`) return json({ issuer, jwks_uri: `${issuer}/.well-known/jwks.json`, revocation_endpoint: `${issuer}/test/revoke` });
    if (url === `${issuer}/.well-known/jwks.json`) return json({ keys: [k.jwk] });
    if (url === `${issuer}/test/revoke`) { flow.revocations++; return new Response(null, { status: flow.revokeStatus || 200 }); }
    assert.equal(url, `${issuer}/api/accounts/oauth/token`);
    const form = new URLSearchParams(init.body); flow.grants.push(form);
    assert.equal(form.get('resource'), resource); assert.ok(!form.has('client_secret'));
    if (form.get('grant_type') === 'refresh_token') {
      flow.refreshes++;
      if (flow.refreshError) return json({ error: flow.refreshError }, flow.refreshStatus || 400);
      return json({ access_token: 'renewed-access-secret', refresh_token: 'rotated-refresh-secret', token_type: 'Bearer', expires_in: 3600 });
    }
    const current = flow.opened.at(-1), expectedId = current.searchParams.get('client_id') === 'dynamic_agent_client' ? flow.issuedId || 'oaiapp_test_1' : current.searchParams.get('client_id');
    assert.equal(form.get('client_id'), expectedId);
    assert.equal(auth.data.profiles.at(-1).clientId, expectedId, 'registration must be retained before code exchange');
    assert.equal(form.get('redirect_uri'), current.searchParams.get('redirect_uri'));
    assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), current.searchParams.get('code_challenge'));
    if (flow.exchangeError) return json({ error: 'invalid_grant' }, 400);
    const claims = { sub: flow.subject, email: flow.email, name: 'Test person', nonce: current.searchParams.get('nonce'),
      iss: issuer, aud: expectedId, iat: Math.floor(flow.now / 1000), exp: Math.floor(flow.now / 1000) + 3600, ...flow.claims };
    let idToken = await new k.jose.SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(k.privateKey);
    if (flow.badSignature) { const pieces = idToken.split('.'); pieces[2] = (pieces[2][0] === 'a' ? 'b' : 'a') + pieces[2].slice(1); idToken = pieces.join('.'); }
    return json({ id_token: idToken, scope: flow.scope, ...(!flow.identityOnly ? { access_token: 'access-secret', refresh_token: 'refresh-secret', token_type: 'Bearer', expires_in: 3600 } : {}) });
  };
  const openExternal = async value => {
    const url = new URL(value); flow.opened.push(url);
    assert.equal(url.origin + url.pathname, `${issuer}/api/accounts/authorize`);
    if (flow.noCallback) return;
    const callback = new URL(url.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ code: 'synthetic-code', state: url.searchParams.get('state'),
      ...(url.searchParams.get('client_id') === 'dynamic_agent_client' ? { client_id: flow.issuedId || 'oaiapp_test_1' } : {}) });
    const response = await fetch(callback); assert.equal(response.status, 200);
  };
  auth = new ChatGPTAuth(directory, storage, { fetcher, openExternal, now: () => flow.now, platform: 'darwin' });
  await auth.initialize(); t.after(() => auth.cancel());
  return { auth, flow, directory, storage, fetcher, openExternal };
}

test('loopback callback rejects forged state, duplicate parameters and changed clients without accepting a code', async () => {
  const listener = await listenForCallback({ state: 'expected-state', clientId: 'oaiapp_existing' });
  const base = `${listener.redirectUri}?code=code&state=`;
  assert.equal((await fetch(`${base}forged`)).status, 400);
  assert.equal((await fetch(`${base}expected-state&state=expected-state`)).status, 400);
  const rejected = assert.rejects(listener.result, /invalid account registration/);
  assert.equal((await fetch(`${base}expected-state&client_id=oaiapp_other`)).status, 400);
  await rejected;
  await assert.rejects(fetch(`${base}expected-state`));
});

test('loopback cancellation and expiry close the listener', async () => {
  const controller = new AbortController();
  const cancelled = await listenForCallback({ state: 'test', signal: controller.signal });
  controller.abort(); await assert.rejects(cancelled.result, /cancelled/);
  await assert.rejects(fetch(cancelled.redirectUri));
  const expired = await listenForCallback({ state: 'test', timeoutMs: 20 });
  await assert.rejects(expired.result, /timed out/);
});

test('sign-in verifies JWT and PKCE, encrypts credentials, restores after restart and reuses the registration', async t => {
  const { auth, flow, directory, storage, fetcher, openExternal } = await fixture(t);
  await auth.signIn();
  const profile = auth.snapshot().profiles[0];
  assert.ok(profile.connected && profile.sharing); assert.ok(auth.snapshot().needsWelcome);
  assert.equal(await auth.getAccessToken(), 'access-secret');
  assert.equal(auth.data.profiles[0].subject, 'person-1');
  const disk = fs.readFileSync(auth.file, 'utf8'), publicState = JSON.stringify(auth.snapshot());
  for (const secret of ['access-secret', 'refresh-secret', 'person@example.test', auth.data.profiles[0].idToken]) assert.ok(!disk.includes(secret));
  assert.ok(!publicState.includes('access-secret')); assert.ok(!publicState.includes('refresh-secret'));
  assert.equal(fs.statSync(auth.file).mode & 0o777, 0o600);
  const reopened = new ChatGPTAuth(directory, storage, { fetcher, openExternal }); await reopened.initialize();
  assert.equal(await reopened.getAccessToken(), 'access-secret'); assert.equal(reopened.data.hostId, auth.data.hostId);
  await auth.acknowledgeWelcome(); assert.equal(auth.snapshot().needsWelcome, false);
  await auth.signIn({ profileId: profile.id });
  const first = flow.opened[0].searchParams, second = flow.opened[1].searchParams;
  assert.equal(first.get('client_id'), 'dynamic_agent_client'); assert.equal(first.get('agent_name_hint'), 'Mochi');
  assert.equal(second.get('client_id'), 'oaiapp_test_1'); assert.equal(second.has('agent_name_hint'), false);
  assert.equal(first.get('ext_agent_host_id'), second.get('ext_agent_host_id'));
  assert.notEqual(first.get('state'), second.get('state')); assert.notEqual(first.get('nonce'), second.get('nonce'));
  assert.ok(second.get('id_token_hint')); assert.equal(auth.data.profiles.length, 1);
});

test('issued registration survives a failed code exchange without becoming an authenticated account', async t => {
  const { auth, flow } = await fixture(t, { exchangeError: true });
  await assert.rejects(auth.signIn());
  assert.equal(auth.data.profiles.length, 1); assert.equal(auth.snapshot().activeId, null);
  const saved = auth.data.profiles[0]; assert.equal(saved.clientId, 'oaiapp_test_1'); assert.equal(saved.accessToken, undefined);
  flow.exchangeError = false; await auth.signIn({ profileId: saved.id });
  assert.equal(flow.opened[1].searchParams.get('client_id'), saved.clientId);
  assert.equal(auth.snapshot().activeId, saved.id);
});

test('untrusted JWT signatures, issuer, audience, expiry and nonce never authorize inference', async t => {
  for (const options of [{ badSignature: true }, { claims: { iss: 'https://attacker.example' } }, { claims: { aud: 'another-app' } },
    { claims: { exp: 1 } }, { claims: { nonce: 'wrong-nonce' } }, { claims: { aud: ['oaiapp_test_1', 'another-app'] } }]) {
    const { auth } = await fixture(t, options);
    await assert.rejects(auth.signIn(), /verify.*identity/);
    assert.equal(auth.snapshot().activeId, null); assert.equal(auth.data.profiles[0].accessToken, undefined);
  }
});

test('identity-only consent cannot run inference; explicitly enabling plan usage requests consent', async t => {
  const { auth, flow } = await fixture(t, { identityOnly: true, scope: 'openid profile email' });
  await auth.signIn(); const profile = auth.snapshot().profiles[0];
  assert.equal(profile.connected, true); assert.equal(profile.sharing, false); assert.equal(auth.snapshot().needsWelcome, false);
  await assert.rejects(auth.getAccessToken());
  flow.identityOnly = false; flow.scope += ` ${PLAN_SCOPE}`;
  await auth.signIn({ profileId: profile.id, enablePlan: true });
  assert.equal(flow.opened.at(-1).searchParams.get('prompt'), 'consent'); assert.ok(auth.snapshot().profiles[0].sharing);
});

test('account registrations remain distinct with the same email; returning identity mismatches preserve old credentials', async t => {
  const { auth, flow } = await fixture(t); await auth.signIn(); const first = auth.profile();
  flow.subject = 'another-person';
  await assert.rejects(auth.signIn({ profileId: first.id }), /does not match/);
  assert.equal(auth.profile().subject, first.subject); assert.equal(auth.profile().accessToken, 'access-secret');
  flow.issuedId = 'oaiapp_test_2'; await auth.signIn();
  assert.equal(auth.data.profiles.length, 2); assert.notEqual(auth.snapshot().profiles[0].label, auth.snapshot().profiles[1].label);
  await auth.select(first.id); assert.equal(auth.profile().subject, 'person-1');
});

test('refresh is serialized, rotates tokens atomically and retains scopes when omitted by the server', async t => {
  const { auth, flow } = await fixture(t); await auth.signIn(); flow.now += 3_550_000;
  const result = await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);
  assert.deepEqual(result, Array(3).fill('renewed-access-secret')); assert.equal(flow.refreshes, 1);
  assert.equal(auth.profile().refreshToken, 'rotated-refresh-secret'); assert.ok(auth.profile().scopes.includes(PLAN_SCOPE));
  const grant = flow.grants.at(-1); assert.equal(grant.get('client_id'), 'oaiapp_test_1'); assert.equal(grant.has('scope'), false);
});

test('temporary refresh failures preserve credentials; revoked sessions clear tokens and retain identity mapping', async t => {
  const { auth, flow } = await fixture(t); await auth.signIn(); flow.now += 3_550_000;
  flow.refreshError = 'server_error'; flow.refreshStatus = 503;
  await assert.rejects(auth.getAccessToken()); assert.equal(auth.profile().refreshToken, 'refresh-secret');
  flow.refreshError = 'invalid_grant'; flow.refreshStatus = 400;
  await assert.rejects(auth.getAccessToken(), /session ended/);
  assert.equal(auth.profile().refreshToken, undefined); assert.equal(auth.profile().idToken, undefined);
  assert.equal(auth.profile().clientId, 'oaiapp_test_1'); assert.equal(auth.profile().subject, 'person-1');
});

test('sign-out revokes renewable session and clears hints; failed remote revocation is reported honestly', async t => {
  const { auth, flow } = await fixture(t); await auth.signIn(); const id = auth.profile().id;
  assert.equal((await auth.signOut()).revoked, true); assert.equal(flow.revocations, 1);
  assert.equal(auth.profile().accessToken, undefined); assert.equal(auth.profile().idToken, undefined);
  await auth.signIn({ profileId: id }); assert.equal(flow.opened.at(-1).searchParams.has('id_token_hint'), false);
  flow.revokeStatus = 503;
  const result = await auth.signOut(); assert.equal(result.revoked, false); assert.match(result.message, /not confirmed/);
  assert.equal(flow.revocations, 3); assert.equal(auth.profile().refreshToken, undefined);
});

test('unavailable secure storage, corrupt encrypted files and cancelled sign-in do not save plaintext credentials', async t => {
  const { auth, storage, directory, flow } = await fixture(t);
  storage.isAsyncEncryptionAvailable = async () => false;
  await assert.rejects(auth.signIn(), /keychain/); assert.equal(flow.opened.length, 0);
  assert.equal(fs.existsSync(auth.file), false);
  storage.isAsyncEncryptionAvailable = async () => true;
  flow.noCallback = true;
  const signin = auth.signIn(); let earlyFailure;
  signin.catch(error => { earlyFailure = error; });
  for (let attempts = 0; !flow.opened.length && !earlyFailure && attempts < 100; attempts++) await new Promise(resolve => setTimeout(resolve, 2));
  if (earlyFailure) throw earlyFailure;
  auth.cancel(); await assert.rejects(signin, /cancelled/); assert.equal(auth.data.profiles.length, 0);
  fs.writeFileSync(auth.file, 'broken-data');
  const reopened = new ChatGPTAuth(directory, storage); await reopened.initialize();
  await assert.rejects(reopened.signIn(), /unlock/); assert.equal(fs.readFileSync(auth.file, 'utf8'), 'broken-data');
});

const schemas = [{ type: 'function', function: { name: 'current_time', description: 'Read the time.', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } }];
const account = { snapshot: () => ({ activeId: 'profile-1' }), getAccessToken: async id => { assert.equal(id, 'profile-1'); return 'synthetic-oauth-token'; } };
function stream(events) {
  const bytes = new TextEncoder().encode(events.map(event => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) return controller.close();
    const next = Math.min(offset + 13, bytes.length); controller.enqueue(bytes.slice(offset, next)); offset = next;
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const completed = output => ({ type: 'response.completed', response: { status: 'completed', output } });
const textItem = text => ({ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text }] });

test('ChatGPT agent parses fragmented SSE and preserves namespaced tool IDs, reasoning and assistant phase across steps', async () => {
  const reasoning = { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'opaque-state' };
  const calls = ['c1', 'c2'].map(call_id => ({ type: 'function_call', namespace: 'mochi', call_id, name: 'current_time', arguments: '{}' }));
  let requests = 0, executions = 0;
  const provider = createProvider(DEFAULTS.chatgpt, { auth: account, fetcher: async (url, init) => {
    assert.equal(url, `${resource}/responses`); assert.equal(init.headers.Authorization, 'Bearer synthetic-oauth-token'); assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body); assert.equal(body.stream, true); assert.equal(body.store, false);
    assert.ok(body.instructions.includes('Mochi')); assert.ok(!body.input.some(item => item.role === 'system'));
    for (const field of ['max_output_tokens', 'previous_response_id', 'temperature']) assert.ok(!Object.hasOwn(body, field));
    assert.equal(body.tools[0].type, 'namespace'); assert.equal(body.tools[0].name, 'mochi'); assert.equal(body.tools[0].tools[0].name, 'current_time');
    assert.ok(!init.body.includes('synthetic-oauth-token'));
    if (++requests === 1) return stream([completed([reasoning, ...calls])]);
    assert.deepEqual(body.input.slice(-5, -2), [reasoning, ...calls]);
    assert.deepEqual(body.input.slice(-2).map(item => item.call_id), ['c1', 'c2']);
    return stream([{ type: 'response.output_text.delta', delta: '☕' }, completed([textItem('Done ☕')])]);
  } });
  assert.equal(await runAgent({ text: 'Check twice', provider, tools: { schemas, execute: async () => ({ sequence: ++executions }) } }), 'Done ☕');
  assert.equal(requests, 2); assert.equal(executions, 2);
});

test('ChatGPT model picker uses account catalog, display labels, visibility and server order without inference', async () => {
  const provider = createProvider(DEFAULTS.chatgpt, { auth: account, fetcher: async (url, init) => {
    assert.equal(url, `${resource}/models`); assert.equal(init.method, 'GET');
    return json({ models: [{ slug: 'hidden', visibility: 'hidden' }, { slug: 'first', display_name: 'First model', visibility: 'list' },
      { slug: DEFAULTS.chatgpt.model, display_name: 'Selected model', visibility: 'list' }] });
  } });
  const status = await provider.status(); assert.equal(status.ready, true);
  assert.deepEqual(status.models, ['first', DEFAULTS.chatgpt.model]); assert.equal(status.modelChoices[0].label, 'First model');
  assert.throws(() => validateSettings({ ...DEFAULTS.chatgpt, endpoint: 'https://other.example/v1' }));
});

test('stream failures, missing completion, invalid arguments and unknown namespaces never execute proposed tools', async () => {
  const call = { type: 'function_call', namespace: 'mochi', call_id: 'c1', name: 'current_time', arguments: '{}' };
  const cases = [
    [{ type: 'response.output_item.done', item: call }],
    [{ type: 'response.output_item.done', item: call }, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }],
    [{ type: 'response.incomplete', response: { output: [call] } }],
    [completed([{ ...call, arguments: 'invalid-json' }])],
    [completed([{ ...call, namespace: 'another-app' }])],
    [completed([{ ...call, call_id: '' }])],
  ];
  for (const events of cases) {
    let executions = 0;
    const provider = createProvider(DEFAULTS.chatgpt, { auth: account, fetcher: async () => stream(events) });
    await assert.rejects(runAgent({ text: 'Time?', provider, tools: { schemas, execute: async () => executions++ } }));
    assert.equal(executions, 0);
  }
});

test('ChatGPT failures give account-specific recovery, keep diagnostics and never fall back to API billing', async () => {
  let requests = 0;
  const provider = createProvider(DEFAULTS.chatgpt, { auth: account, apiKey: 'must-not-use', fetcher: async (_url, init) => {
    requests++; assert.ok(!init.headers.Authorization.includes('must-not-use'));
    return json({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'sensitive-echo' } }, 429);
  } });
  await assert.rejects(provider.chat([], schemas), error => error.code === 'subscription_sharing_usage_limit_exceeded' && error.status === 429 && /Manage usage/.test(error.message) && !error.message.includes('sensitive-echo'));
  assert.equal(requests, 1);
});
