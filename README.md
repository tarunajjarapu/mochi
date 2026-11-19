# Mochi

**A little company. A little help. Entirely yours.**

Mochi is a personal agent that lives on your desktop as a small animated pet. Click it to talk, ask it to remember something, set a reminder, or give it a task. The app and model run on your own machine.

This is my personal experiment in building an assistant in the spirit of [Instinct](https://instinct.com/): something that understands what matters to you and helps you act on it. Mochi adds a persistent desktop companion and a self-hosted foundation. It is an independent project, not affiliated with Instinct.

**Status: early working prototype, developed on macOS.** The desktop shell, notebook, reminders, and tool-calling runtime are implemented. General browser control, screen awareness, voice, and real-world errands are future work.

## What it does today

- A floating, always-on-top pet with idle, thinking, approval, and happy states.
- A compact chat panel, menu-bar controls, and `Cmd/Ctrl + Shift + Space` shortcut.
- Local inference through Ollama, with a bounded multi-step agent loop.
- Explicit personal memories, with a notebook to inspect and forget them.
- Persistent reminders, desktop notifications, and catch-up after restarting.
- Read and create text files in a dedicated Mochi workspace.
- Open a link in your browser after showing you the exact URL.
- Per-action approval for every tool that changes state; Stop cancels pending work.
- A local activity log showing completed tools and their results.

The notebook and reminders work even when no model is running.

## Run it

You need [Node.js 24 or newer](https://nodejs.org/) and [Ollama](https://ollama.com/download). Model performance depends on your hardware; choose a local model with tool-calling support that fits your machine.

```sh
git clone https://github.com/tarunajjarapu/mochi.git
cd mochi
npm ci
npm start
```

The first start downloads the pinned Electron desktop runtime if it is not already installed. For local AI, download the default model:

```sh
ollama pull qwen3:8b
```

Start Ollama through its app, or run the server yourself. For local inference only, quit any existing Ollama server and start it with:

```sh
OLLAMA_NO_CLOUD=1 ollama serve
```

Ollama also supports disabling cloud features in its own settings; see its [FAQ](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features). Mochi connects to `http://127.0.0.1:11434` by default. Change the local address and model name in **Settings → Save connection**. There are no API keys, accounts, hosted database, telemetry, or paid service requirements in Mochi.

Try:

> Remember that I prefer short, focused work sessions.
>
> Remind me to stretch in 20 minutes.
>
> Read notes.md in your workspace and create a new summary.md with three next steps.

Use **Settings → Open Mochi’s workspace** to add the files you want it to read. The current tools support top-level `.txt`, `.md`, `.json`, and `.csv` files, up to 32 KB for reads. Writes create new files and never overwrite existing files.

## Living on your desktop

Drag the grip above the pet to move it. Click the pet to open or close the panel. Closing the panel leaves the pet and reminders running. Use the menu-bar icon or **Settings → Quit Mochi** to exit.

This version does not install a background service or start at login. Reminders cannot wake a sleeping computer or fire while Mochi is closed; overdue reminders appear after it resumes or restarts. Notifications may require your OS notification permission. The chat also keeps a record of delivered reminders.

macOS is the development target. Electron can also run on Windows and Linux, but those desktop environments have not been manually verified. Always-on-top and global shortcuts can vary by window manager. The source runs directly with `npm start`; signed installers are not yet included.

## Your data stays yours

State is kept outside this repository in Electron’s per-user application data directory:

| Platform | Default location |
| --- | --- |
| macOS | `~/Library/Application Support/Mochi/` |
| Windows | `%APPDATA%/Mochi/` |
| Linux | `~/.config/Mochi/` (or your XDG config location) |

`state.json` contains settings, the latest 100 chat messages, explicit memories, reminders, and the latest 200 completed tool records. The adjacent `workspace/` is the only folder the file tools access. State is plain JSON, not encrypted. Back up this directory if you want to keep it; never commit it to the public repository.

For an isolated development profile:

```sh
MOCHI_DATA_DIR="$PWD/.local/dev" npm start
```

The renderer has no Node access or network access. A narrow IPC bridge connects it to the main process. Model requests go only to a loopback address and do not follow redirects. Mochi rejects cloud-named models; disable cloud features in Ollama as well to prevent custom aliases from routing inference remotely. Opening a URL intentionally contacts that external site through your browser.

All state-changing tools show their exact arguments and wait for approval. Files, memories, and tool results are untrusted context. The initial tool set has no shell, unrestricted filesystem access, background screen recording, email sending, or purchasing capabilities. It is a small, inspectable foundation for adding those capabilities deliberately.

## Development

```sh
npm run check
npm test
```

The tests use Node’s built-in test runner and mocked inference. They cover persistence, overdue reminders, approval denial, cancellation, file boundaries, URL restrictions, provider settings, and a multi-step tool cycle. No downloaded model or Electron installation is needed for the core checks. GitHub Actions runs them on each push and pull request.

```text
src/
  main.cjs          Desktop windows, tray, notifications, approvals, IPC
  preload.cjs       Narrow renderer bridge
  core/
    agent.cjs       Bounded model → tool → result loop
    provider.cjs    Local Ollama client and connection validation
    tools.cjs       Tool schemas, argument validation, approval policy
    store.cjs       Atomic local JSON persistence
  ui/                Pet animation and companion panel
test/                Behavior and boundary tests
docs/                Product direction, architecture, next milestones
```

See [the product direction](docs/VISION.md), [architecture](docs/ARCHITECTURE.md), and [roadmap](docs/ROADMAP.md).
