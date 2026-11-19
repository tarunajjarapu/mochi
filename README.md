# Mochi

**A little company. A little help. Entirely yours.**

Mochi is a personal agent that lives on your desktop as a small animated pet. Click it to talk, ask it to remember something, set a reminder, or give it a task. The app, tools, and saved state run on your machine. Choose OpenAI, a LiteLLM proxy, another compatible endpoint, or local Ollama for the model.

This is my personal experiment in an assistant in the spirit of [Instinct](https://instinct.com/): something that understands what matters to you and helps you act on it. It is an independent project, not affiliated with Instinct.

**Status: early working prototype, developed on macOS.** The desktop shell, notebook, reminders, and tool-calling runtime are implemented. General browser control, screen awareness, voice, and real-world errands are future work.

## What it does today

- A floating, always-on-top pet with idle, thinking, approval, and happy states.
- A compact chat panel, menu-bar controls, and `Cmd/Ctrl + Shift + Space` shortcut.
- A bounded agent loop using OpenAI Responses, compatible Responses or Chat Completions APIs, or Ollama.
- Explicit personal memories, with a notebook to inspect and forget them.
- Persistent reminders, desktop notifications, and catch-up after restarting.
- Read and create text files in a dedicated Mochi workspace.
- Open a URL in your browser after showing you the exact URL.
- Per-action approval for every tool that changes state; Stop cancels pending work.
- A local activity log showing completed tools and their results.

The notebook and reminders work even when no model is connected.

## Run it

Install [Node.js 24 or newer](https://nodejs.org/), then:

```sh
git clone https://github.com/tarunajjarapu/mochi.git
cd mochi
npm ci
npm start
```

The first start downloads the pinned Electron desktop runtime if needed. Mochi does not require a separately deployed backend. Electron's main process handles the API requests and local tools.

## Connect a model

Open the pet's **Settings** and choose a provider:

| Provider | API base URL | Model | Key |
| --- | --- | --- | --- |
| **OpenAI (default)** | `https://api.openai.com/v1` | `gpt-6.2-sol` or another supported model ID | Your OpenAI API key |
| **LiteLLM / compatible** | e.g. `http://127.0.0.1:4000/v1` | Your configured proxy alias, e.g. `mochi` | Your proxy key, if required |
| **Ollama (local)** | `http://127.0.0.1:11434` | e.g. `qwen3:8b` | None |

Click **Save connection → Check saved connection**, then send a message. The check verifies the model list and credentials; an actual chat verifies inference and tool support. The model must support function calling. Responses is the default protocol for OpenAI and LiteLLM; Chat Completions is available for compatible endpoints that need it.

For **OpenAI**, create a key in your [API project](https://platform.openai.com/api-keys), enable API billing or credits as needed, and paste the key into Mochi's Settings. No Ollama install, proxy, or Mochi server is required. Provider availability and usage charges depend on your account.

For **LiteLLM**, a proxy must already be running on your computer or a server you control. Mochi sends the alias to that proxy; the proxy routes it to the provider you configured. Mochi does not start or install LiteLLM automatically.

For **Ollama**, install and start [Ollama](https://ollama.com/download), then run `ollama pull qwen3:8b`. To keep inference local, disable Ollama's cloud features as described in its [FAQ](https://docs.ollama.com/faq). Existing 0.1 Ollama profiles remain on Ollama until you explicitly switch providers.

See [connection setup and troubleshooting](docs/CONNECTIONS.md) for environment variables, routing examples, and common errors.

## Try it

> Remember that I prefer short, focused work sessions.
>
> Remind me to stretch in 20 minutes.
>
> Read notes.md in your workspace and create a new summary.md with three next steps.

Use **Settings → Open Mochi's workspace** to add files you want it to read. The current tools support top-level `.txt`, `.md`, `.json`, and `.csv` files, up to 32 KB for reads. Writes create new files and never overwrite existing files.

## Living on your desktop

Drag the grip above the pet to move it. Click the pet to open or close the panel. Closing the panel leaves the pet and reminders running. Use the menu-bar icon or **Settings → Quit Mochi** to exit.

This version does not install a background service or start at login. Reminders cannot wake a sleeping computer or fire while Mochi is closed; overdue reminders appear after it resumes or restarts. Notifications may require your OS notification permission. The chat also keeps a record of delivered reminders.

macOS is the development target. Windows and Linux desktop behavior has not been manually verified. Always-on-top and global shortcuts can vary by window manager. The source runs with `npm start`; signed installers are not included yet.

## Data and credentials

Local state is kept outside this repository in Electron's per-user application data directory:

| Platform | Default location |
| --- | --- |
| macOS | `~/Library/Application Support/Mochi/` |
| Windows | `%APPDATA%/Mochi/` |
| Linux | `~/.config/Mochi/` (or your XDG config location) |

`state.json` contains settings, the latest 100 chat messages, explicit memories, reminders, and the latest 200 completed tool records. The adjacent `workspace/` is the only folder the file tools access. This state is plain JSON, not encrypted. Back up the directory if you want to keep it; never commit it to the public repository.

API keys entered in Settings are encrypted with Electron's OS-backed `safeStorage` and stored separately in `credentials.json`. Keys are scoped to the exact provider and base URL. They are never returned to the renderer after saving, put into prompts, or written to the activity log. If secure storage is unavailable, saving a key fails instead of using plaintext. Environment keys are also supported.

**Hosted inference sends chat context and tool results to the selected provider.** That can include saved memories and file content read during a task. A local LiteLLM proxy can still route to a hosted model. OpenAI requests set `store: false`; this does not override the provider's other retention or account policies. For fully local inference, choose Ollama with a local model and disable its cloud features. Opening a URL intentionally contacts that site through your browser.

The renderer has no Node or network access. Main-process requests do not follow redirects. Remote provider endpoints require HTTPS; local HTTP is permitted for Ollama and proxies. All state-changing tools show their arguments and require approval. The initial tools have no shell, unrestricted filesystem access, screen recording, email sending, or purchasing capabilities.

## Development

```sh
npm run check
npm test
```

Tests use Node's built-in runner and mocked inference. They cover tool cycles through both hosted API formats, credentials and endpoint boundaries, persistence, reminders, approval denial, cancellation, and file restrictions. No key, model download, or Electron install is needed for the core checks. GitHub Actions runs them on each push and pull request.

For an isolated profile:

```sh
MOCHI_DATA_DIR="$PWD/.local/dev" npm start
```

See [product direction](docs/VISION.md), [architecture](docs/ARCHITECTURE.md), and [roadmap](docs/ROADMAP.md).
