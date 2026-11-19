const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateSettings } = require('./provider.cjs');

class Credentials {
  constructor(directory, storage, env = process.env, platform = process.platform) {
    this.file = path.join(directory, 'credentials.json'); this.storage = storage; this.env = env; this.platform = platform;
    this.keys = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
  }
  id(settings) {
    const config = validateSettings(settings);
    return createHash('sha256').update(`${config.provider}:${config.endpoint}`).digest('hex');
  }
  source(settings) {
    if (settings.provider === 'ollama') return 'none';
    if (Object.hasOwn(this.keys, this.id(settings))) return 'saved';
    if (settings.provider === 'openai' && this.env.OPENAI_API_KEY) return 'environment';
    // A proxy environment key is tied to one exact endpoint; changing hosts must not forward it.
    if (settings.provider === 'compatible' && this.env.LITELLM_API_KEY && settings.endpoint === (this.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000/v1').replace(/\/+$/, '')) return 'environment';
    return 'none';
  }
  async available() {
    return await this.storage.isAsyncEncryptionAvailable() &&
      !(this.platform === 'linux' && this.storage.getSelectedStorageBackend() === 'basic_text');
  }
  persist(next) {
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(`${this.file}.tmp`, this.file); this.keys = next;
  }
  async set(settings, value) {
    if (settings.provider === 'ollama') throw new Error('Ollama does not need an API key.');
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\r\n\x00]/.test(value)) throw new Error('Enter a valid API key.');
    if (!await this.available()) throw new Error('Secure storage is unavailable. Set OPENAI_API_KEY or LITELLM_API_KEY in the environment instead.');
    const encrypted = await this.storage.encryptStringAsync(value.trim());
    this.persist({ ...this.keys, [this.id(settings)]: encrypted.toString('base64') });
  }
  remove(settings) {
    const next = { ...this.keys }; delete next[this.id(settings)]; this.persist(next);
  }
  async get(settings) {
    const source = this.source(settings);
    if (source === 'none') return '';
    if (source === 'environment') return settings.provider === 'openai' ? this.env.OPENAI_API_KEY : this.env.LITELLM_API_KEY;
    try {
      if (!await this.available()) throw new Error();
      const decrypted = await this.storage.decryptStringAsync(Buffer.from(this.keys[this.id(settings)], 'base64'));
      if (decrypted.shouldReEncrypt) await this.set(settings, decrypted.result);
      return decrypted.result;
    } catch { throw new Error('Cannot unlock the saved API key. Unlock your OS keychain or replace the key in Settings.'); }
  }
}
module.exports = { Credentials };
