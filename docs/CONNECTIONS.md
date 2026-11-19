# Model connections

The desktop app already contains the agent runtime. It calls a model, receives tool proposals, asks for approvals, executes tools locally, and sends results back. You do not need a separate Mochi backend.

```text
Default:    Desktop pet → Electron main process → OpenAI Responses (your ChatGPT plan)
API key:    Desktop pet → Electron main process → OpenAI API (separate API billing)
Optional:   Desktop pet → Electron main process → LiteLLM proxy → chosen provider
Local:      Desktop pet → Electron main process → Ollama
```

## ChatGPT account: the default

1. Open Mochi → Settings → select **ChatGPT account**.
2. Click **Continue with ChatGPT**. Your system browser opens OpenAI's sign-in page.
3. Choose the account and workspace you want, then allow **Use your ChatGPT plan**.
4. Return to Mochi. It fetches the models available to that account and selects an available model. You can choose another and click **Save model**.
5. Send a message, such as “What time is it?”, to verify an actual model → local tool → response cycle.

No API key or client secret is needed. The model still runs on OpenAI's servers; your agent tools and state stay on your machine. Account eligibility, model access, and plan limits are controlled by OpenAI. This integration does not read another application's tokens, browser cookies, ChatGPT conversations, or ChatGPT memories.

**Manage usage** opens [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage). Requests consume the existing plan allowance or available credits, including any app-specific limits. Mochi never silently falls back to paid API-key inference. For a different billing path, select that provider yourself.

Saved accounts are listed separately, even when they share an email address. Their numbered labels identify separate account/workspace registrations. Use **Add account** to connect another registration; select an existing one to reuse it. **Continue with ChatGPT** reconnects the selected registration. If sign-in succeeds without plan permission, the connection is retained and you can explicitly request plan consent again.

**Sign out** stops using the selected session, attempts to revoke its refresh token, and clears its local access, refresh, and ID tokens. The registration is retained for later sign-in. If remote revocation cannot be confirmed, disconnect Mochi from **ChatGPT Settings → Security and login → Sign in with ChatGPT**. Other saved accounts remain available.

Credentials are encrypted in the OS keychain-backed `chatgpt-auth.json` file in Mochi's application data directory. Secure storage must be available; there is no plaintext or environment-token fallback for ChatGPT sign-in. Tokens refresh automatically near expiry. A revoked or expired renewable session requires signing in again.

The temporary sign-in listener uses an available port on `127.0.0.1` and closes after completion, cancellation, or three minutes. No public callback URL, port forwarding, or separate backend is required. Leave Mochi running while you finish the browser flow.

Implementation follows the official [registration guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [account/session guide](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), and [model/inference requirements](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

## OpenAI API key: separate API billing

1. Create your own key in the [OpenAI API dashboard](https://platform.openai.com/api-keys). Your API project needs access to the chosen model and available billing or credits.
2. Open Mochi → Settings → select OpenAI API key.
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

Only the main process makes model requests. It sends the current prompt, up to 20 recent user/assistant messages, tool definitions, and tool results from the current task. Saved memory is retrieved on demand. File content read by a tool becomes a tool result and therefore goes to the configured model provider. Stored API keys are sent only as authentication headers to their matching endpoint. ChatGPT access tokens are sent only to the fixed public OpenAI API; refresh and ID tokens are used only in OpenAI's authentication flow.

Switching to a hosted provider applies to subsequent chats, including their recent context. The data notice in Settings makes this destination explicit. OpenAI uses the Responses API with `store: false`, while retaining response items only in memory during the tool loop.

## Troubleshooting

- **ChatGPT sign-in cancelled/timed out:** click Continue with ChatGPT again and finish the browser flow while Mochi remains open.
- **Signed in, plan usage disabled:** Continue with ChatGPT again to explicitly request plan permission, or choose another provider.
- **ChatGPT account not eligible / access restricted:** the selected account, workspace, region, or policy may not permit plan usage. Select another account or provider; repeated sign-in is not a workaround.
- **ChatGPT usage limit reached:** click Manage usage. This can be a plan or app limit; Mochi cannot infer the reset time.
- **ChatGPT routing/usage temporarily unavailable:** the connection is retained. Try again later; no billing fallback occurs.
- **ChatGPT stream incomplete/interrupted:** no tools from that incomplete response execute. Earlier completed steps remain in Activity.
- **ChatGPT session ended:** Continue with ChatGPT to reconnect the saved registration.
- **Cannot unlock saved ChatGPT accounts:** unlock your OS keychain and restart Mochi. Existing encrypted data is preserved.
- **Authentication failed:** check the key, provider selection, and API project or proxy permissions.
- **Model not listed:** check the exact model ID or proxy alias. Model listing verifies availability, not tool quality.
- **Endpoint or model not found:** use the base URL ending in `/v1` (or your gateway's API prefix), not a full completion route.
- **Provider rejected request:** the chosen model may not support function calling or that API format. Try Responses for newer OpenAI models, or the format documented by your gateway.
- **Provider limit reached:** check usage quota, billing, or rate limits on the provider account.
- **Secure storage unavailable:** unlock the OS keychain, or use environment credentials. Mochi refuses the Linux plaintext fallback.
- **Saved key cannot be unlocked:** replacing an unsigned development build can change macOS Keychain access. Re-enter the key in Settings or use environment credentials.
- **Changes do not appear:** quit the old Mochi process and restart `npm start`; reloading the renderer does not reload main-process provider code.

The bundled test suite uses simulated providers and does not require or spend real API credits. Verify your own connection with a simple chat after signing in or entering your key.
