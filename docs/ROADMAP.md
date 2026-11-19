# Roadmap

## 0.1 — A companion with useful hands

- [x] Transparent pet, animations, draggable position, always-on-top window
- [x] Chat panel, notebook, settings, tray, shortcut
- [x] Local Ollama chat and bounded tool loop
- [x] Persistent memories, reminders, workspace files, approved URL opening
- [x] Approval, cancellation, activity log, behavior tests, CI
- [ ] Test with a live local model on the target machine
- [ ] Verify Windows and Linux desktop behavior

## 0.2 — Model choice

- [x] OpenAI Responses as the default for new profiles
- [x] LiteLLM / compatible Responses and Chat Completions endpoints
- [x] Endpoint-scoped encrypted API keys and environment credentials
- [x] Connection settings, model listing, migration, and provider contract tests
- [ ] Verify live inference with a user-configured API key

## Next — Daily-driver quality

- [ ] Signed macOS app, installer, versioned releases
- [ ] Opt-in launch at login and remembered pet position
- [ ] Model discovery, hardware-aware setup, token streaming
- [ ] Durable task ledger for requested, approved, completed, and failed actions
- [ ] Reliable reminder delivery reconciliation, recurring reminders, quiet hours
- [ ] Export, reset, and retention controls for local data
- [ ] Automated Electron integration tests and accessibility checks

## 0.3 — A more capable personal agent

- [ ] Dedicated browser profile and observable browser tasks
- [ ] MCP client with per-tool allowlists and permissions
- [ ] Explicit file/folder grants with previews and reversible edits
- [ ] Read-only calendar/email integrations before write capabilities
- [ ] User-defined routines with budgets and stop conditions
- [ ] Better memory retrieval, source attribution, editing, and forgetting

## 0.4 — Context and presence

- [ ] Opt-in screen/application context with a visible capture indicator
- [ ] Local voice input and speech output
- [ ] Custom pet themes and richer expressions
- [ ] Proactive suggestions with quiet hours and attention limits
- [ ] A private self-hosted mobile messaging gateway

The goal is a personal assistant capable of useful errands, with review before sending messages, making bookings, spending money, or modifying important files. Every milestone should remain runnable without a central Mochi service.
