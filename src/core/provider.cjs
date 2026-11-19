const DEFAULTS = {
  openai: { provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'gpt-6.2-sol', api: 'responses' },
  compatible: { provider: 'compatible', endpoint: 'http://127.0.0.1:4000/v1', model: 'mochi', api: 'responses' },
  ollama: { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen3:8b', api: 'ollama' },
};
const isLoopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

function validateSettings(input = DEFAULTS.openai) {
  // Version 0.1 only supported Ollama. Never silently move existing chats to a cloud provider.
  const provider = input.provider ?? 'ollama';
  if (!Object.hasOwn(DEFAULTS, provider)) throw new Error('Choose OpenAI, LiteLLM / compatible, or Ollama.');
  const url = new URL(input.endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      (url.protocol === 'http:' && !isLoopback(url))) {
    throw new Error('Use HTTPS for remote providers, or HTTP on localhost. Do not put credentials in the URL.');
  }
  const endpoint = url.href.replace(/\/+$/, '');
  const api = provider === 'compatible' ? (input.api || 'responses') : DEFAULTS[provider].api;
  if (provider === 'openai' && endpoint !== DEFAULTS.openai.endpoint) throw new Error('OpenAI uses https://api.openai.com/v1. Choose LiteLLM / compatible for a custom endpoint.');
  if (provider === 'ollama' && (!isLoopback(url) || !['', '/'].includes(url.pathname))) throw new Error('Use a local Ollama origin, such as http://127.0.0.1:11434.');
  if (!['responses', 'chat', 'ollama'].includes(api) || (provider === 'compatible' && api === 'ollama')) throw new Error('Choose Responses or Chat Completions.');
  if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200 || /[\s\x00-\x1f]/.test(input.model)) throw new Error('Enter a model ID or proxy model alias without spaces.');
  if (provider === 'ollama' && /cloud/i.test(input.model)) throw new Error('Choose a local Ollama model.');
  return { provider, endpoint, model: input.model, api };
}

function httpError(status) {
  if (status === 401 || status === 403) return 'Authentication failed. Check the API key and its permissions in Settings.';
  if (status === 429) return 'Provider limit reached. Check your API quota, billing, or rate limits.';
  if (status === 404) return 'Endpoint or model not found. Check the base URL, API format, and model ID.';
  if (status === 400 || status === 422) return 'Provider rejected the request. Check that this model supports the chosen API and function tools.';
  return `Provider returned HTTP ${status}. Try again or check the provider service.`;
}

class HttpProvider {
  constructor(settings, { apiKey = '', fetcher = fetch } = {}) {
    this.settings = validateSettings(settings); this.apiKey = apiKey; this.fetch = fetcher;
  }
  async request(route, body, signal) {
    if (this.settings.provider === 'openai' && !this.apiKey) throw new Error('Add your OpenAI API key in Settings or set OPENAI_API_KEY before starting Mochi.');
    const timeout = AbortSignal.timeout(body ? 180_000 : 8_000);
    let response;
    try {
      response = await this.fetch(`${this.settings.endpoint}${route}`, {
        method: body ? 'POST' : 'GET', redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      signal?.throwIfAborted();
      if (timeout.aborted) throw new Error('Provider request timed out. Try a smaller model or try again.');
      throw new Error('Cannot reach the provider. Check its address, connection, and whether the service is running.');
    }
    if (!response.ok) throw new Error(httpError(response.status));
    try { return await response.json(); }
    catch { signal?.throwIfAborted(); throw new Error('Provider returned an invalid or interrupted JSON response.'); }
  }
  async status() {
    const data = await this.request('/models');
    if (!Array.isArray(data.data)) throw new Error('The endpoint did not return a model list. Check the base URL.');
    const models = data.data.map(m => m.id).filter(id => typeof id === 'string');
    return { connected: true, ready: models.includes(this.settings.model), models,
      message: models.includes(this.settings.model)
        ? 'Connected; model listed. Send a message to verify inference and tool support.'
        : 'Connected, but this model is not listed. Check the model ID or proxy alias.' };
  }
}

class Ollama extends HttpProvider {
  constructor(settings, fetcher = fetch) { super({ ...settings, provider: 'ollama' }, { fetcher }); }
  async status() {
    const data = await this.request('/api/tags');
    const models = (data.models || []).map(m => m.name), ready = models.includes(this.settings.model);
    return { connected: true, models, ready, message: ready ? 'Local model installed. Send a message to try it.' : 'Ollama is running. Install the model or choose one from the list.' };
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

function parseArguments(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { throw new Error('The model returned invalid tool arguments. No action was taken for this response.'); }
}

class ResponsesProvider extends HttpProvider {
  async chat(messages, tools, signal) {
    const input = messages.flatMap(message => {
      if (message.responseItems) return message.responseItems;
      if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
      return [{ role: message.role, content: message.content }];
    });
    const result = await this.request('/responses', {
      model: this.settings.model, input, store: false, max_output_tokens: 8192,
      tools: tools.map(t => ({ type: 'function', ...t.function, strict: true })),
    }, signal);
    if (result.status && result.status !== 'completed') throw new Error('The model response was incomplete. No tools from this response were executed; try a shorter request.');
    if (!Array.isArray(result.output)) throw new Error('Provider returned an invalid Responses API result.');
    const calls = result.output.filter(item => item.type === 'function_call');
    if (calls.some(call => !call.call_id || !call.name)) throw new Error('Provider returned a tool call without an ID or name.');
    return {
      role: 'assistant',
      content: result.output.filter(item => item.type === 'message').flatMap(item => item.content || [])
        .map(part => part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : '').join('\n'),
      tool_calls: calls.map(call => ({ id: call.call_id, function: { name: call.name, arguments: parseArguments(call.arguments) } })),
      // Preserve encrypted reasoning and assistant phase for subsequent requests within this turn.
      responseItems: result.output,
    };
  }
}

class ChatProvider extends HttpProvider {
  async chat(messages, tools, signal) {
    const result = await this.request('/chat/completions', {
      model: this.settings.model, tools, stream: false,
      messages: messages.map(message => {
        if (message.role === 'tool') return { role: 'tool', tool_call_id: message.tool_call_id, content: message.content };
        if (message.chatMessage) return message.chatMessage;
        return { role: message.role, content: message.content };
      }),
    }, signal);
    const choice = result.choices?.[0], message = choice?.message;
    if (!message || message.role !== 'assistant') throw new Error('Provider returned an invalid Chat Completions result.');
    if (!['stop', 'tool_calls'].includes(choice.finish_reason)) throw new Error('The model response was incomplete. No tools from this response were executed.');
    const calls = message.tool_calls || [];
    if (!Array.isArray(calls) || calls.some(call => !call.id || !call.function?.name)) throw new Error('Provider returned invalid tool calls.');
    return { role: 'assistant', content: message.content || message.refusal || '', chatMessage: message,
      tool_calls: calls.map(call => ({ id: call.id, function: { name: call.function.name, arguments: parseArguments(call.function.arguments) } })),
    };
  }
}

function createProvider(settings, options = {}) {
  const config = validateSettings(settings);
  if (config.provider === 'ollama') return new Ollama(config, options.fetcher);
  return config.api === 'responses' ? new ResponsesProvider(config, options) : new ChatProvider(config, options);
}
module.exports = { DEFAULTS, validateSettings, createProvider, Ollama, ResponsesProvider, ChatProvider };
