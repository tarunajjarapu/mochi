const { validateSettings, responseMessage } = require('./provider.cjs');

function planError(status, body = {}, requestId) {
  const code = body.error?.code || body.code;
  const messages = {
    subscription_sharing_user_not_eligible: 'ChatGPT plan usage is not available for this account or workspace. Choose another account or provider.',
    subscription_sharing_usage_limit_exceeded: 'ChatGPT usage limit reached. Open Manage usage to review your plan and Mochi’s app limit.',
    subscription_sharing_usage_unavailable: 'ChatGPT usage could not be checked. Your account is still saved; try again later.',
    subscription_sharing_user_unavailable: 'ChatGPT account information is temporarily unavailable. Try again later.',
    subscription_sharing_unsupported_capability: 'This request uses a capability your ChatGPT connection does not support. Try another listed model.',
    subscription_sharing_route_not_supported: 'ChatGPT plan usage does not support this API route.',
    subscription_sharing_invalid_user: 'ChatGPT could not validate your session. Continue with ChatGPT again in Settings.',
    chatpass_v2_scope_not_authorized: 'ChatGPT plan permission was not accepted. Review this connection in Settings.',
    chatpass_v2_invalid_authorization_context: 'ChatGPT plan permission was not accepted. Review this connection in Settings.',
  };
  const error = new Error(messages[code] || ({
    401: 'ChatGPT authentication was not accepted. Continue with ChatGPT again in Settings.',
    403: 'Your ChatGPT account, workspace, region, or policy does not allow this request.',
    429: 'ChatGPT usage limit reached. Open Manage usage to review your plan and Mochi’s app limit.',
    503: 'ChatGPT plan routing is temporarily unavailable. Your account is still saved; try again later.',
  }[status]) || `ChatGPT could not complete the request${status ? ` (HTTP ${status})` : ''}. Try again or choose another listed model.`);
  // Keep structured diagnostics, but never echo arbitrary service text or tokens into chat/logs.
  error.status = status; error.code = code; error.param = body.error?.param;
  error.requestId = requestId; error.bodyShape = body && typeof body === 'object' ? Object.keys(body) : typeof body;
  return error;
}

async function readCompletedResponse(body, signal) {
  if (!body) throw new Error('ChatGPT did not return a response stream.');
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', data = [], bytes = 0, eventBytes = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength; eventBytes += value.byteLength;
      if (bytes > 32 * 1024 * 1024 || eventBytes > 4 * 1024 * 1024) throw new Error('ChatGPT returned a response larger than Mochi can process.');
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        if (line !== '') continue;
        eventBytes = Buffer.byteLength(buffer);
        if (!data.length) continue;
        const raw = data.join('\n'); data = [];
        if (raw === '[DONE]') throw new Error('ChatGPT’s stream ended before completion. No tools from this response were executed.');
        let event;
        try { event = JSON.parse(raw); } catch { throw new Error('ChatGPT returned an invalid response stream.'); }
        if (event.type === 'response.failed' || event.type === 'error') throw planError(undefined, event.response || event);
        if (event.type === 'response.incomplete') throw new Error('ChatGPT’s response was incomplete. No tools from this response were executed.');
        if (event.type === 'response.completed') {
          if (event.response?.status !== 'completed' || !Array.isArray(event.response.output)) throw new Error('ChatGPT returned an invalid completed response.');
          signal?.throwIfAborted(); return event.response;
        }
      }
    }
    throw new Error('ChatGPT’s stream ended before completion. No tools from this response were executed.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

class ChatGPTProvider {
  constructor(settings, { auth, fetcher = fetch } = {}) {
    this.settings = validateSettings(settings);
    if (this.settings.provider !== 'chatgpt' || !auth) throw new Error('ChatGPT requires its own account connection.');
    this.auth = auth; this.fetch = fetcher; this.profileId = auth.snapshot().activeId;
  }
  async request(route, body, signal) {
    const token = await this.auth.getAccessToken(this.profileId);
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(body ? 180_000 : 15_000);
    const combined = AbortSignal.any([timeout, ...(signal ? [signal] : [])]);
    try {
      const response = await this.fetch(`${this.settings.endpoint}${route}`, { method: body ? 'POST' : 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: body ? 'text/event-stream' : 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: combined });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw planError(response.status, data, response.headers.get('x-request-id'));
      }
      return body ? await readCompletedResponse(response.body, combined) : await response.json();
    } catch (error) {
      signal?.throwIfAborted();
      if (timeout.aborted) throw new Error('ChatGPT request timed out. Try again.');
      if (/^(ChatGPT|Your ChatGPT|This request)/.test(error.message)) throw error;
      throw new Error('Cannot reach ChatGPT or its response was interrupted. Check your connection and try again.');
    }
  }
  async status() {
    const data = await this.request('/models');
    if (!Array.isArray(data.models)) throw new Error('ChatGPT did not return your account’s model catalog.');
    const modelChoices = data.models.filter(model => model.visibility === 'list' && typeof model.slug === 'string')
      .map(model => ({ id: model.slug, label: typeof model.display_name === 'string' ? model.display_name : model.slug }));
    const models = modelChoices.map(model => model.id), ready = models.includes(this.settings.model);
    return { connected: true, ready, models, modelChoices, message: ready ? 'Using ChatGPT plan. Send a message to verify inference.' : 'Connected to ChatGPT. Choose an available model below and save.' };
  }
  async chat(messages, tools, signal) {
    const input = messages.filter(message => message.role !== 'system').flatMap(message => {
      if (message.responseItems) return message.responseItems;
      if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
      return [{ role: message.role, content: message.content }];
    });
    const result = await this.request('/responses', {
      model: this.settings.model, instructions: messages.filter(message => message.role === 'system').map(message => message.content).join('\n'),
      input, store: false, stream: true, include: ['reasoning.encrypted_content'],
      tools: tools.length ? [{ type: 'namespace', name: 'mochi', description: 'Mochi’s local personal assistant tools.',
        tools: tools.map(tool => ({ type: 'function', ...tool.function, strict: true })) }] : [],
    }, signal);
    const names = new Set(tools.map(tool => tool.function.name));
    if (result.output.some(item => item.type === 'function_call' && ((item.namespace && item.namespace !== 'mochi') || !names.has(item.name)))) {
      throw new Error('ChatGPT requested an unknown tool or namespace. No tools from this response were executed.');
    }
    return responseMessage(result);
  }
}
module.exports = { ChatGPTProvider, readCompletedResponse, planError };
