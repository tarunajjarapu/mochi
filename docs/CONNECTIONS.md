# Model connections

The desktop app already contains the agent runtime. It calls a model, receives tool proposals, asks for approvals, executes tools locally, and sends results back. You do not need a separate Mochi backend.

```text
Default:    Desktop pet → Electron main process → OpenAI API
Optional:   Desktop pet → Electron main process → LiteLLM proxy → chosen provider
Local:      Desktop pet → Electron main process → Ollama
```

## OpenAI: the simplest setup

1. Create your own key in the [OpenAI API dashboard](https://platform.openai.com/api-keys). Your API project needs access to the chosen model and available billing or credits.
2. Open Mochi → Settings → select OpenAI.
3. Keep `https://api.openai.com/v1` and the default `gpt-6.2-sol`, or enter another model ID that supports Responses and function calling.
4. Paste the key into the password field. Click Save connection, then Check saved connection.
5. Ask Mochi to remember a harmless fact and approve the proposed tool. This tests the entire model → tool → result loop.

The key is encrypted locally. Leaving the field blank keeps an existing key for that endpoint. Remove saved key deletes the saved encrypted credential; an environment key, if set, will still apply.

You can instead set `OPENAI_API_KEY` in the environment of the terminal that launches `npm start`. Mochi does not load `.env` files automatically. Avoid putting keys in source files, launch commands saved to shared history, or screenshots.

No OpenAI key is bundled with the public app, and no connection from another application is inherited. API usage is charged according to the selected provider account.

## LiteLLM: route to the model you want

LiteLLM's proxy is an optional, separate service. Run it locally or use an existing private deployment. See the [official gateway setup](https://docs.litellm.ai/docs/simple_proxy).

A minimal model-routing configuration looks like:

```yaml
model_list:
  - model_name: mochi
    litellm_params:
      model: openai/gpt-6.2-sol
      api_key: os.environ/OPENAI_API_KEY
```

The provider key belongs to the proxy's environment. Mochi only needs the proxy key if the proxy requires authentication. To route somewhere else, change the deployment behind the `mochi` alias using LiteLLM's provider configuration.

In Mochi Settings select:

| Field | Value |
| --- | --- |
| Provider | LiteLLM / compatible endpoint |
| API base URL | `http://127.0.0.1:4000/v1` for a local proxy, or your HTTPS gateway URL |
| API format | Responses by default; Chat Completions if your endpoint/model requires it |
| Model ID or proxy alias | `mochi` (must match the proxy configuration) |
| API key | Your proxy virtual key; blank if your local proxy requires no authentication |

The base URL is the API prefix, not the final `/responses` or `/chat/completions` route. Mochi appends that route itself. The endpoint should expose `/models` for the connection check. A server that omits model listing can still support chat; a failed check is not a full inference test.

Current LiteLLM supports [Responses](https://docs.litellm.ai/docs/response_api) and [Chat Completions](https://docs.litellm.ai/docs/completion). Some models only support tool calling through Responses. The selected model must support function tools; matching the API format alone does not guarantee that.

For environment credentials, set `LITELLM_API_KEY` before launching Mochi. It only applies to `http://127.0.0.1:4000/v1` unless `LITELLM_BASE_URL` is set to the exact custom base URL. Set that same URL in Settings. Changing the endpoint never forwards a saved key or an unrelated environment key automatically.

## Ollama: fully local inference

Install [Ollama](https://ollama.com/download), start it, then download a model:

```sh
ollama pull qwen3:8b
```

Select Ollama, use `http://127.0.0.1:11434`, and set model `qwen3:8b`. No API key is needed. Disable cloud features in Ollama as well; see its [FAQ](https://docs.ollama.com/faq). If running the server yourself, quit any existing Ollama server before running:

```sh
OLLAMA_NO_CLOUD=1 ollama serve
```

## What gets sent

Only the main process makes model requests. It sends the current prompt, up to 20 recent user/assistant messages, tool definitions, and tool results from the current task. Saved memory is retrieved on demand. File content read by a tool becomes a tool result and therefore goes to the configured model provider. Stored API keys are sent only as authentication headers to their matching endpoint.

Switching to a hosted provider applies to subsequent chats, including their recent context. The data notice in Settings makes this destination explicit. OpenAI uses the Responses API with `store: false`, while retaining response items only in memory during the tool loop.

## Troubleshooting

- **Authentication failed:** check the key, provider selection, and API project or proxy permissions.
- **Model not listed:** check the exact model ID or proxy alias. Model listing verifies availability, not tool quality.
- **Endpoint or model not found:** use the base URL ending in `/v1` (or your gateway's API prefix), not a full completion route.
- **Provider rejected request:** the chosen model may not support function calling or that API format. Try Responses for newer OpenAI models, or the format documented by your gateway.
- **Provider limit reached:** check usage quota, billing, or rate limits on the provider account.
- **Secure storage unavailable:** unlock the OS keychain, or use environment credentials. Mochi refuses the Linux plaintext fallback.
- **Saved key cannot be unlocked:** replacing an unsigned development build can change macOS Keychain access. Re-enter the key in Settings or use environment credentials.
- **Changes do not appear:** quit the old Mochi process and restart `npm start`; reloading the renderer does not reload main-process provider code.

The bundled test suite uses simulated providers and does not require or spend real API credits. Verify your own endpoint with a simple chat after entering your key.
