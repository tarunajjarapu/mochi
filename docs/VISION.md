# The companion I want

Mochi is a personal assistant with a small physical presence on my desktop. It should feel like a capable companion: available when I want help, quiet when I am focused, and transparent when it is doing work.

The inspiration from Instinct is the assistant model: understand the person, connect context across tasks, and take useful actions. The desktop pet is Mochi's interface. Self-hosting is how I retain ownership of the runtime, memory, and tools, with a choice of local or hosted models.

## A day with Mochi

I open my laptop. Mochi sits in a corner. I ask what I wanted to work on, and it recalls plans I explicitly saved. I drop some notes into its workspace and ask it to turn them into next steps. It shows the file it wants to create. I approve it. Later, it nudges me to take a break.

Eventually, it should help gather information in a browser, organize a project, and complete errands through connected tools. It should show the planned action, ask when the consequence warrants it, and report what actually happened. Booking, buying, or sending anything needs a concrete review step.

## Design principles

1. **Personal first.** One person, one machine, useful defaults. No team SaaS or central account system.
2. **Own the brain.** Keep state inspectable and model choice configurable. OpenAI is the simplest default; local Ollama remains available for fully local inference.
3. **Presence without interruption.** Small animations express state. Proactivity needs quiet hours, limits, and a clear off switch.
4. **Useful actions.** The pet is attached to an agent runtime with tools, memory, and outcomes.
5. **Earn context.** Start with user-provided files and memories. Add opt-in screen or application context only with visible controls.
6. **Be honest.** Distinguish proposed, approved, attempted, failed, and completed work. Never imply it performed an action it cannot perform.

## Initial scope

The first slice proves the whole interaction: pet → request → model → tool proposal → approval → result → response. It also offers practical notebook and reminder controls without requiring AI.

Mochi is not initially an autonomous agent with access to my entire computer. Broader computer use will be added as separate capabilities, with the same explicit boundaries.
