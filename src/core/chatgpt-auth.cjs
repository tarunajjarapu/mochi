const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomBytes, randomUUID, createHash, timingSafeEqual } = require('node:crypto');

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const TERMINAL_REFRESH = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const clearTokens = profile => { const { accessToken, refreshToken, idToken, expiresAt, ...rest } = profile; return { ...rest, scopes: [] }; };

// A short-lived loopback listener. Invalid/unsolicited requests never consume the pending attempt.
async function listenForCallback({ state, clientId, signal, timeoutMs = 180_000 }) {
  signal?.throwIfAborted();
  let settle, timer, finished = false, consumed = false, redirectUri;
  const result = new Promise((resolve, reject) => { settle = (error, value) => error ? reject(error) : resolve(value); });
  // The browser can fail to open before the caller starts awaiting result.
  result.catch(() => {});
  const finish = (error, value) => {
    if (finished) return;
    finished = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    server.close(); server.closeAllConnections(); settle(error, value);
  };
  const cancel = () => finish(new Error('ChatGPT sign-in cancelled.'));
  const server = http.createServer((req, res) => {
    const reply = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      res.end(message);
    };
    let url;
    try { url = new URL(req.url, redirectUri); } catch { reply(400, 'Invalid request.'); return; }
    if (req.method !== 'GET' || req.headers.host !== new URL(redirectUri).host || req.headers.origin || url.origin !== new URL(redirectUri).origin || url.pathname !== '/auth/callback') {
      reply(404, 'Not found.'); return;
    }
    if (finished || consumed || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1) || !equal(url.searchParams.get('state'), state)) {
      reply(400, 'Invalid sign-in callback. Return to Mochi and try again.'); return;
    }
    consumed = true;
    let error, value;
    if (url.searchParams.has('error')) error = new Error('ChatGPT sign-in was declined or could not be completed.');
    else {
      const returnedId = url.searchParams.get('client_id');
      const issuedId = returnedId || clientId;
      const code = url.searchParams.get('code');
      if (!code || code.length > 8192 || !issuedId || issuedId === 'dynamic_agent_client' || !/^[a-zA-Z0-9_-]{1,200}$/.test(issuedId) || (clientId && returnedId && returnedId !== clientId)) {
        error = new Error('ChatGPT returned an invalid account registration. Try signing in again.');
      } else value = { code, clientId: issuedId };
    }
    reply(error ? 400 : 200, error ? error.message : 'Sign-in response received. Return to Mochi to finish connecting. You can close this tab.');
    // Let the response finish before closing this socket.
    res.once('finish', () => finish(error, value));
  });
  server.headersTimeout = 10_000; server.requestTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
  server.on('error', () => finish(new Error('The local sign-in listener failed. Try again.')));
  signal?.addEventListener('abort', cancel, { once: true });
  timer = setTimeout(() => finish(new Error('ChatGPT sign-in timed out. Try again from Settings.')), timeoutMs);
  if (signal?.aborted) cancel();
  return { redirectUri, result, close: cancel };
}

class ChatGPTAuth {
  constructor(directory, storage, { openExternal, fetcher = fetch, platform = process.platform, now = Date.now, onChange = () => {} } = {}) {
    this.file = path.join(directory, 'chatgpt-auth.json'); this.storage = storage; this.openExternal = openExternal;
    this.fetch = fetcher; this.platform = platform; this.now = now; this.onChange = onChange;
    this.data = { version: 1, hostId: `urn:uuid:${randomUUID()}`, activeId: null, welcomeSeen: false, profiles: [] };
    this.refreshes = new Map(); this.pending = null; this.loadError = '';
  }
  async available() {
    return await this.storage.isAsyncEncryptionAvailable() && !(this.platform === 'linux' && this.storage.getSelectedStorageBackend() === 'basic_text');
  }
  async initialize() {
    if (!fs.existsSync(this.file)) return;
    try {
      if (!await this.available()) throw new Error();
      const envelope = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const decrypted = await this.storage.decryptStringAsync(Buffer.from(envelope.encrypted, 'base64'));
      const data = JSON.parse(decrypted.result);
      if (data.version !== 1 || !Array.isArray(data.profiles) || typeof data.hostId !== 'string' || !data.hostId.startsWith('urn:uuid:') ||
          data.profiles.some(profile => !profile || typeof profile.id !== 'string' || typeof profile.clientId !== 'string' ||
            !Array.isArray(profile.scopes) || profile.scopes.some(scope => typeof scope !== 'string') ||
            ['accessToken', 'refreshToken', 'idToken', 'subject', 'email', 'name'].some(key => profile[key] !== undefined && typeof profile[key] !== 'string')) ||
          new Set(data.profiles.map(profile => profile.id)).size !== data.profiles.length ||
          (data.activeId !== null && !data.profiles.some(profile => profile.id === data.activeId))) throw new Error();
      this.data = data;
      if (decrypted.shouldReEncrypt) await this.save(data);
    } catch { this.loadError = 'Cannot unlock saved ChatGPT accounts. Unlock your OS keychain and restart Mochi.'; }
  }
  async save(next) {
    if (this.loadError) throw new Error(this.loadError);
    if (!await this.available()) throw new Error('Unlock your OS keychain to securely save ChatGPT sign-in. Plaintext storage is not supported.');
    const encrypted = await this.storage.encryptStringAsync(JSON.stringify(next));
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') }), { mode: 0o600 });
    fs.chmodSync(`${this.file}.tmp`, 0o600);
    fs.renameSync(`${this.file}.tmp`, this.file); this.data = next; this.onChange();
  }
  profile(id = this.data.activeId) { return this.data.profiles.find(profile => profile.id === id); }
  snapshot() {
    return { activeId: this.data.activeId, pending: !!this.pending, error: this.loadError,
      needsWelcome: !this.data.welcomeSeen && !!this.profile()?.scopes.includes(PLAN_SCOPE),
      profiles: this.data.profiles.map((profile, index) => ({ id: profile.id,
        label: `${profile.email || profile.name || 'ChatGPT account'} · ${index + 1}`,
        connected: !!(profile.accessToken || profile.idToken), sharing: !!profile.accessToken && profile.scopes.includes(PLAN_SCOPE) })) };
  }
  async replace(profile, extra = {}) {
    const profiles = this.data.profiles.filter(item => item.id !== profile.id);
    const index = this.data.profiles.findIndex(item => item.id === profile.id);
    profiles.splice(index < 0 ? profiles.length : index, 0, profile);
    await this.save({ ...this.data, ...extra, profiles });
  }
  async discovery() {
    if (this.configuration) return this.configuration;
    const response = await this.fetch(`${ISSUER}/.well-known/openid-configuration`, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Cannot load ChatGPT sign-in configuration. Try again later.');
    const config = await response.json();
    const trusted = value => { try { const url = new URL(value); return url.origin === ISSUER && !url.username && !url.password && !url.search && !url.hash; } catch { return false; } };
    if (config.issuer !== ISSUER || !trusted(config.jwks_uri) || (config.revocation_endpoint && !trusted(config.revocation_endpoint))) throw new Error('Invalid ChatGPT sign-in configuration.');
    this.configuration = config; return config;
  }
  async verifyIdentity(token, clientId, nonce) {
    const jose = await import('jose');
    const config = await this.discovery();
    this.jwks ||= jose.createRemoteJWKSet(new URL(config.jwks_uri), {
      [jose.customFetch]: (url, init) => this.fetch(url, { ...init, redirect: 'error' }), timeoutDuration: 10_000,
    });
    try {
      const { payload } = await jose.jwtVerify(token, this.jwks, { issuer: ISSUER, audience: clientId,
        algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
        currentDate: new Date(this.now()) });
      if (!payload.sub || typeof payload.sub !== 'string' || (nonce && !equal(payload.nonce, nonce)) ||
          (payload.azp && payload.azp !== clientId) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) throw new Error();
      return payload;
    } catch { throw new Error('Could not verify the ChatGPT account identity. No new credentials were accepted.'); }
  }
  async tokenRequest(parameters, signal) {
    let response;
    try {
      response = await this.fetch(TOKEN, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...parameters, resource: RESOURCE }), signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]) });
    } catch { signal?.throwIfAborted(); throw new Error('Cannot reach ChatGPT sign-in. Check your connection and try again.'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('ChatGPT sign-in returned an invalid response.'); }
    if (!response.ok || data.error) {
      const error = new Error('ChatGPT could not renew or complete sign-in. Try again from Settings.');
      error.code = typeof data.error === 'string' ? data.error : data.error?.code; throw error;
    }
    return data;
  }
  tokenFields(tokens, previous = {}) {
    if (['access_token', 'refresh_token', 'id_token', 'scope', 'token_type'].some(key => tokens[key] !== undefined && typeof tokens[key] !== 'string')) throw new Error('ChatGPT returned invalid session credentials.');
    const scopes = typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/).filter(Boolean) : (previous.scopes || []);
    if (tokens.access_token && (typeof tokens.access_token !== 'string' || tokens.token_type?.toLowerCase() !== 'bearer' ||
        !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0)) throw new Error('ChatGPT returned invalid session credentials.');
    if (scopes.includes(PLAN_SCOPE) && !tokens.access_token) throw new Error('ChatGPT did not return credentials for plan usage.');
    return { scopes, ...(tokens.access_token ? { accessToken: tokens.access_token, expiresAt: this.now() + tokens.expires_in * 1000 } : {}),
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}), ...(tokens.id_token ? { idToken: tokens.id_token } : {}) };
  }
  async signIn({ profileId, enablePlan = false } = {}) {
    if (this.pending) throw new Error('A ChatGPT sign-in is already in progress.');
    const previous = profileId ? this.profile(profileId) : undefined;
    if (profileId && !previous) throw new Error('Choose a saved ChatGPT account.');
    const controller = new AbortController(); this.pending = controller; this.onChange();
    let listener;
    try {
      await this.save(this.data); // Persist host ID before any registration can occur.
      const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
      const verifier = randomBytes(64).toString('base64url');
      listener = await listenForCallback({ state, clientId: previous?.clientId, signal: controller.signal });
      const url = new URL(AUTHORIZE);
      url.search = new URLSearchParams({ client_id: previous?.clientId || 'dynamic_agent_client',
        ...(!previous ? { agent_name_hint: 'Mochi' } : {}), ext_agent_host_id: this.data.hostId,
        response_type: 'code', redirect_uri: listener.redirectUri, scope: SCOPES, resource: RESOURCE,
        state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        ...(previous?.idToken ? { id_token_hint: previous.idToken } : {}), ...(previous?.email ? { login_hint: previous.email } : {}),
        ...(enablePlan ? { prompt: 'consent' } : {}),
      }).toString();
      try { await this.openExternal(url.href); }
      catch { throw new Error('Could not open your browser for ChatGPT sign-in. Try again from Settings.'); }
      const callback = await listener.result;
      const registration = previous || { id: randomUUID(), clientId: callback.clientId, scopes: [] };
      await this.replace(registration); // Retain issued ID even when the one-time code exchange fails.
      const tokens = await this.tokenRequest({ grant_type: 'authorization_code', client_id: registration.clientId,
        code: callback.code, code_verifier: verifier, redirect_uri: listener.redirectUri }, controller.signal);
      if (typeof tokens.id_token !== 'string') throw new Error('ChatGPT did not return a verifiable account identity.');
      const identity = await this.verifyIdentity(tokens.id_token, registration.clientId, nonce);
      if (previous?.subject && identity.sub !== previous.subject) throw new Error('The ChatGPT account does not match this saved registration. Add it as another account.');
      controller.signal.throwIfAborted();
      await this.replace({ ...clearTokens(registration), subject: identity.sub,
        email: typeof identity.email === 'string' ? identity.email : '', name: typeof identity.name === 'string' ? identity.name : '',
        ...this.tokenFields(tokens) }, { activeId: registration.id });
      return this.snapshot();
    } catch (error) {
      if (controller.signal.aborted) throw new Error('ChatGPT sign-in cancelled.');
      // Never propagate browser errors, which can contain the authorization URL and ID-token hint.
      if (/^(ChatGPT|Cannot|Could not|The ChatGPT|Unlock|Invalid|Choose)/.test(error.message)) throw error;
      throw new Error('Could not complete ChatGPT sign-in. Return to Settings and try again.');
    } finally { listener?.close(); this.pending = null; this.onChange(); }
  }
  cancel() { this.pending?.abort(); }
  async select(id) {
    if (!this.profile(id)) throw new Error('Choose a saved ChatGPT account.');
    await this.save({ ...this.data, activeId: id });
  }
  async acknowledgeWelcome() { await this.save({ ...this.data, welcomeSeen: true }); }
  async getAccessToken(id = this.data.activeId) {
    if (this.loadError) throw new Error(this.loadError);
    const profile = this.profile(id);
    if (!profile?.accessToken) throw new Error('Continue with ChatGPT in Settings to connect your account.');
    if (!profile.scopes.includes(PLAN_SCOPE)) throw new Error('Enable ChatGPT plan usage in Settings, or choose another provider.');
    if (profile.expiresAt > this.now() + 60_000) return profile.accessToken;
    if (!profile.refreshToken) throw new Error('Your ChatGPT session expired. Continue with ChatGPT in Settings.');
    if (!this.refreshes.has(id)) this.refreshes.set(id, this.refresh(profile).finally(() => this.refreshes.delete(id)));
    return this.refreshes.get(id);
  }
  async refresh(profile) {
    let tokens;
    try { tokens = await this.tokenRequest({ grant_type: 'refresh_token', client_id: profile.clientId, refresh_token: profile.refreshToken }); }
    catch (error) {
      if (TERMINAL_REFRESH.has(error.code)) { await this.replace(clearTokens(profile)); throw new Error('Your ChatGPT session ended. Continue with ChatGPT in Settings.'); }
      throw error;
    }
    if (tokens.id_token) {
      const identity = await this.verifyIdentity(tokens.id_token, profile.clientId);
      if (identity.sub !== profile.subject) throw new Error('ChatGPT renewed a different identity. Sign in again.');
    }
    const next = { ...profile, ...this.tokenFields(tokens, profile) };
    if (!tokens.access_token) throw new Error('ChatGPT did not renew the access token. Sign in again.');
    await this.replace(next);
    if (!next.scopes.includes(PLAN_SCOPE)) throw new Error('ChatGPT plan usage is no longer enabled. Review it in Settings.');
    return next.accessToken;
  }
  async signOut(id = this.data.activeId) {
    await this.refreshes.get(id)?.catch(() => {});
    const profile = this.profile(id);
    if (!profile) throw new Error('Choose a saved ChatGPT account.');
    let revoked = !profile.accessToken && !profile.refreshToken;
    if (profile.refreshToken) {
      try {
        const { revocation_endpoint: endpoint } = await this.discovery();
        if (endpoint) for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await this.fetch(endpoint, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ token: profile.refreshToken, token_type_hint: 'refresh_token', client_id: profile.clientId }), signal: AbortSignal.timeout(8_000) });
            if (response.status === 200) { revoked = true; break; }
            if (response.status < 500) break;
          } catch { /* One bounded retry, then clear locally and report uncertainty. */ }
          if (!attempt) await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch { /* The account can still be signed out locally if discovery is unavailable. */ }
    }
    await this.replace(clearTokens(profile));
    return { revoked, message: revoked ? 'Signed out of ChatGPT.' : 'Signed out locally. Remote revocation was not confirmed; disconnect Mochi in ChatGPT Settings → Security and login → Sign in with ChatGPT.' };
  }
}
module.exports = { ChatGPTAuth, listenForCallback, PLAN_SCOPE };
