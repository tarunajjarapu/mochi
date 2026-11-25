# Mochi

**A little company. A little help. Entirely yours.**

Mochi is a personal agent that lives on your desktop as a small animated pet. Click it to talk, ask it to remember something, set a reminder, or give it a task. The app, tools, and saved state run on your machine. Connect your ChatGPT account, use an OpenAI API key, route through LiteLLM, or run a local Ollama model.

This is my personal experiment in an assistant in the spirit of [Instinct](https://instinct.com/): something that understands what matters to you and helps you act on it. It is an independent project, not affiliated with Instinct.

**Status: early working prototype, developed on macOS.** The desktop shell, notebook, reminders, and tool-calling runtime are implemented. General browser control, screen awareness, voice, and real-world errands are future work.

## What it does today

- A floating 3D pet with soft lighting, breathing, curious glances, blinking, and expressive ears. Thinking, approval, reminders, and being picked up each have their own movements.
- A dark GitHub PR inbox: your open PRs, requested reviews, CI and review status, repository filters, and local pins.
- PR details with checks, recent conversation, and one-click summaries or code reviews from your selected model.
- Dark, light, or system appearance, plus readable code blocks with copy buttons in chat.
- A compact chat panel, menu-bar controls, and `Cmd/Ctrl + Shift + Space` shortcut.
- **Continue with ChatGPT**: browser sign-in, account switching, available-model picker, encrypted sessions, and automatic renewal.
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

## Your GitHub inbox

Install the official [GitHub CLI](https://cli.github.com/) (`brew install gh` on macOS). Open **Pull requests → Connect GitHub**, click **Open GitHub**, and enter the displayed one-time code. If GitHub CLI is already signed in, the inbox connects automatically. You can also sign in with `gh auth login --hostname github.com` and refresh Mochi. Credentials stay managed by GitHub CLI; Mochi never copies a token into its own files or renderer. GitHub CLI normally uses the OS credential store, but can fall back to its configuration file if the credential store is unavailable; check `gh auth status` if needed.

- **My open PRs** and **Needs my review** show counts across repositories. **Involved** includes other open PRs you participate in.
- Filter by title, repository, PR number, draft status, or problems such as failing CI, requested changes, and conflicts. Enter `owner/repo` in the repository field to narrow the GitHub query.
- Star a PR to pin it locally. Pins rise to the top of the current view; use the Pinned filter to focus on them. Nothing is posted to GitHub.
- Open a PR for its description, individual CI checks, latest reviews, and recent comments. **Open on GitHub** takes you to the full review and merge controls.
- **Review with Mochi** reads the latest PR and available patches, then gives findings and suggested tests in chat. **Summarize** explains the change and current blockers. These actions use your selected model and its normal usage allowance.

The inbox refreshes every two minutes while visible and supports loading further pages. It works without connecting a model. Looking at the inbox does not send GitHub data to a model; requesting an AI summary or review sends the PR details it reads. PR tools are read-only and never comment, approve, close, or merge. Reviews inspect at most 30 file patches, with per-file and total size limits; missing or partial diffs are identified. This is not a full repository checkout or a test run.

GitHub.com is supported. Repository access and organization SSO must already be allowed for your GitHub CLI account. To switch accounts, run `gh auth switch --hostname github.com`, then refresh. **Settings → Appearance** selects Dark, Light, or Follow system.

## Connect a model

Open the pet's **Settings → ChatGPT account → Continue with ChatGPT**. Sign in in your browser, select your account/workspace, and allow **Use your ChatGPT plan**. Return to Mochi, choose a model from your account's catalog, and click **Save model**. A first connection selects an available model automatically. Send a message to verify inference.

No API key, proxy, or hosted Mochi backend is required. This uses OpenAI's official [Sign in with ChatGPT](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) integration for eligible local/personal projects. Model inference runs at OpenAI. Usage counts toward your plan allowance or available credits; **Manage usage** opens ChatGPT's app limits. Signing in does not import your ChatGPT conversations or memories. You can cancel sign-in, reconnect a saved registration, add another account/workspace, or sign out in Settings.

Other provider options remain available:

| Provider | API base URL | Model | Key |
| --- | --- | --- | --- |
| **OpenAI API key** | `https://api.openai.com/v1` | `gpt-6.2-sol` or another supported model ID | Your OpenAI API key |
| **LiteLLM / compatible** | e.g. `http://127.0.0.1:4000/v1` | Your configured proxy alias, e.g. `mochi` | Your proxy key, if required |
| **Ollama (local)** | `http://127.0.0.1:11434` | e.g. `qwen3:8b` | None |

Click **Save connection → Check saved connection**, then send a message. The check verifies the model list and credentials; an actual chat verifies inference and tool support. The model must support function calling. Responses is the default protocol for OpenAI and LiteLLM; Chat Completions is available for compatible endpoints that need it.

For **OpenAI API key**, create a key in your [API project](https://platform.openai.com/api-keys), enable API billing or credits as needed, and paste the key into Mochi's Settings. API billing is separate from ChatGPT plan usage. Mochi never switches to API billing when your ChatGPT allowance is unavailable.

For **LiteLLM**, a proxy must already be running on your computer or a server you control. Mochi sends the alias to that proxy; the proxy routes it to the provider you configured. Mochi does not start or install LiteLLM automatically.

For **Ollama**, install and start [Ollama](https://ollama.com/download), then run `ollama pull qwen3:8b`. To keep inference local, disable Ollama's cloud features as described in its [FAQ](https://docs.ollama.com/faq). Existing profiles keep their provider and billing path until you explicitly switch; ChatGPT is the default for new profiles only.

See [connection setup and troubleshooting](docs/CONNECTIONS.md) for environment variables, routing examples, and common errors.

## Try it

> Remember that I prefer short, focused work sessions.
>
> Remind me to stretch in 20 minutes.
>
> Read notes.md in your workspace and create a new summary.md with three next steps.

Use **Settings → Open Mochi's workspace** to add files you want it to read. The current tools support top-level `.txt`, `.md`, `.json`, and `.csv` files, up to 32 KB for reads. Writes create new files and never overwrite existing files.

## Living on your desktop

Drag the pet itself to move it. Mochi remembers its position after a restart. Click the pet to open or close the panel. There is no permanent caption: brief speech bubbles appear for permission requests and reminders. Closing the panel leaves the pet and reminders running. Use the menu-bar icon or **Settings → Quit Mochi** to exit.

The 3D character is built and rendered locally with Three.js; it downloads no models or artwork. Animation respects your system’s reduced-motion preference, pauses while hidden, and is capped at 30 frames per second. If WebGL is unavailable, a lightweight CSS character keeps the same interactions.

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

ChatGPT registration IDs, verified identities, and OAuth tokens are encrypted separately in `chatgpt-auth.json` using the same OS-backed storage. The renderer receives account labels and connection status, never tokens. Each sign-in uses PKCE, state and nonce validation, and signed identity-token verification. The callback listens only on `127.0.0.1` during sign-in and closes on completion, cancellation, or timeout. Sign-out attempts remote session revocation and removes local tokens; if revocation cannot be confirmed, Mochi tells you how to disconnect it in ChatGPT settings. Your registration and host ID remain for reconnecting.

**Hosted inference sends chat context and tool results to the selected provider.** That can include saved memories and file content read during a task. A local LiteLLM proxy can still route to a hosted model. OpenAI requests set `store: false`; this does not override the provider's other retention or account policies. For fully local inference, choose Ollama with a local model and disable its cloud features. Opening a URL intentionally contacts that site through your browser.

The renderer has no Node or network access. Model requests do not follow redirects. Remote provider endpoints require HTTPS; local HTTP is permitted for Ollama and proxies. All agent tools that change state show their arguments and require approval. GitHub uses fixed read-only queries through GitHub CLI in the main process, without shell interpolation. Local appearance and pin changes are direct UI actions. The model has no shell, unrestricted filesystem access, screen recording, email sending, or purchasing capabilities.

## Development

```sh
npm run check
npm test
```

Tests use Node's built-in runner, simulated OpenAI responses, locally signed JWT fixtures, and a real loopback callback listener. They cover sign-in, token validation/refresh/revocation, account isolation, interrupted streams, tool cycles, credentials and endpoint boundaries, persistence, approvals, and file restrictions. No real account, key, model download, or Electron runtime is needed for the core checks; dependencies must be installed, and the tests need loopback networking. GitHub Actions runs them on each push and pull request. Live account eligibility and inference must be verified after you sign in.

For an isolated profile:

```sh
MOCHI_DATA_DIR="$PWD/.local/dev" npm start
```

See [product direction](docs/VISION.md), [architecture](docs/ARCHITECTURE.md), and [roadmap](docs/ROADMAP.md).
