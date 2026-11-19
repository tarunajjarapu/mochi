function validateSettings(input) {
  const url = new URL(input.endpoint);
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Use a local Ollama address, such as http://127.0.0.1:11434.');
  }
  if (typeof input.model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,120}$/.test(input.model) || /cloud/i.test(input.model)) {
    throw new Error('Choose a local model name (for example qwen3:8b).');
  }
  return { endpoint: url.origin, model: input.model };
}

class Ollama {
  constructor(settings, fetcher = fetch) {
    this.settings = validateSettings(settings);
    this.fetch = fetcher;
  }
  async request(route, body, signal) {
    const timeout = AbortSignal.timeout(body ? 180_000 : 5_000);
    const response = await this.fetch(`${this.settings.endpoint}${route}`, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}. Check that ${this.settings.model} is installed.`);
    return response.json();
  }
  async status() {
    const data = await this.request('/api/tags');
    const models = (data.models || []).map(m => m.name);
    return { connected: true, models, ready: models.includes(this.settings.model) };
  }
  async chat(messages, tools, signal) {
    const result = await this.request('/api/chat', {
      model: this.settings.model, messages, tools, stream: false,
      options: { num_ctx: 16384, num_predict: 4096 },
    }, signal);
    if (!result.message || result.message.role !== 'assistant') throw new Error('Ollama returned an invalid message.');
    return result.message;
  }
}
module.exports = { Ollama, validateSettings };
