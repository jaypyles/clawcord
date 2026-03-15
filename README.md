<p align="center">
  <strong>Clawcord</strong> — A Discord bot wired to <strong>OpenRouter</strong>. Use stealth or free models, GPT, or any provider. One process, one stack, tuned to <strong>your</strong> workflow.
</p>

<p align="center">
  Mention the bot in Discord. It remembers, follows your behavior rules, runs on your schedule. Small codebase, no dashboard, no config matrix.
</p>

## What This Is

Clawcord is a single-purpose Discord bot: **Discord for I/O, OpenRouter for the brain.** No “pick your LLM backend” or “add Discord via plugin” — it’s Discord + OpenRouter by default. You get a small, auditable codebase that does one thing clearly.

- **OpenRouter** — One API key. Point `OPENROUTER_MODEL` at a stealth/free model for zero-cost usage, or at GPT-4o / Claude / others when you want quality. No vendor lock-in.
- **Discord only** — Mentions and DMs; reply chains and threads; slash commands. No Telegram or Slack wiring.
- **Your workflow** — Behavior rules (tone, style, constraints), persistent memory, scheduled tasks, and a command registry live in markdown in `agent-core/`. The bot reads and applies them every run. Customization = edit those files or tell the bot to edit them.

No install wizard, no dashboard, no debug UI. You configure with `.env` and (optionally) by talking to the bot: “Remember I prefer CST” or “From now on talk like a pirate.”

## Quick Start

```bash
git clone https://github.com/YOUR_USER/clawcord.git
cd clawcord
cp .env.example .env
```

Edit `.env`: set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, and `OPENROUTER_API_KEY`. Optionally set `OPENROUTER_MODEL` (default is `openai/gpt-4o-mini`; use a [stealth or free model](https://openrouter.ai/models) for no-cost usage).

```bash
bun install
bun run register
bun run dev
```

Mention the bot in a channel (with **Message Content Intent** enabled in the Discord Developer Portal) or DM it. It will use your `agent-core/BEHAVIOR.md` and `agent-core/MEMORY.md` automatically.

## Philosophy

**One stack.** Discord for I/O, OpenRouter for the model. No optional runtimes or channel providers to wire up.

**Model flexibility.** Use free/stealth models for everyday use, swap to GPT or Claude when you need more. One env var.

**Small enough to understand.** One process, a handful of files. No microservices, no message queues.

**Workflow in markdown.** Behavior rules, memory, schedule, and command docs live in `agent-core/` as editable markdown. The bot can read and update them via tools. Your preferences are in the repo, not in a database.

**AI-native.** No install wizard; set env and run. No dashboard; ask the bot what it remembers or what’s scheduled. No debug UI; describe the problem, the bot (or you) fixes the code or the rules.

**Built for one user.** Fork it and shape behavior, memory, and commands to match how you work.

## What It Supports

- **Discord I/O** — Mention the bot or DM it. Reply chains and threads keep context; long replies are split into multiple messages. Slash commands (e.g. `/ping`) for utilities.
- **OpenRouter models** — Any model on OpenRouter: stealth/free models for cost-free use, or GPT-4o, Claude, etc. Set `OPENROUTER_MODEL` in `.env`.
- **Behavior rules** — `agent-core/BEHAVIOR.md` holds structured rules (tone, timezone, style). The bot applies all enabled rules to every response and can add/disable/delete rules via the `behavior_editor` tool.
- **Persistent memory** — `agent-core/MEMORY.md` stores structured entries (category, importance, tags). The bot reads and updates memory via the `memory_editor` tool.
- **Scheduled tasks** — Recurring or one-time jobs in `agent-core/SCHEDULE.md`. The bot runs them and can post results to a Discord channel.
- **Command registry** — `agent-core/COMMANDS.md` documents your custom commands/workflows. The bot can list and update them via the `commands_registry` tool.
- **Skills** — Optional skills from `~/.config/clawcord/skills/` (Claude Code SKILL.md format). The bot can list and read them via `skills_reader`.
- **Optional tools** — `http_fetch`, `get_time`; optional `bash_exec` (off by default, gated by `ENABLE_BASH_TOOL`).

## Usage

Mention the bot or DM it with a prompt:

```
@bot summarize the last few messages
@bot remember I work in CST and prefer short answers
@bot add a behavior rule: always talk like a pirate
@bot what's in my memory?
@bot list my scheduled tasks
```

Reply to the bot’s message to continue the thread; it carries reply-chain context and tool summaries. Use slash commands (e.g. `/ping`) where registered.

Set `OPENROUTER_MODEL` to match your goal:

- **Free / stealth:** e.g. a free or stealth model on [OpenRouter](https://openrouter.ai/models) for no API cost.
- **Paid / quality:** e.g. `openai/gpt-4o`, `anthropic/claude-3.5-sonnet`, etc.

## Customizing

Edit the repo or tell the bot:

- **Behavior** — Edit `agent-core/BEHAVIOR.md` or ask the bot to add/change rules (e.g. “always use CST”, “talk like a pirate”).
- **Memory** — Ask the bot to remember or forget things; it uses `memory_editor` and `agent-core/MEMORY.md`.
- **Schedule** — Edit `agent-core/SCHEDULE.md` or use the bot’s schedule tools.
- **Commands** — Document workflows in `agent-core/COMMANDS.md`; the bot can read and update via `commands_registry`.
- **Model** — Change `OPENROUTER_MODEL` in `.env` and restart.

## Requirements

- **macOS or Linux** (or WSL2)
- **Bun** (or Node 20+ if you adapt the scripts)
- **Discord** application with a bot token and Message Content Intent enabled
- **OpenRouter** API key ([openrouter.ai](https://openrouter.ai))

## Docker

Build and run with Docker:

```bash
docker build -t clawcord .
docker run --rm -e DISCORD_TOKEN=… -e DISCORD_CLIENT_ID=… -e DISCORD_GUILD_ID=… -e OPENROUTER_API_KEY=… -e OPENROUTER_MODEL=… clawcord
```

Mount env or use secrets for tokens. The image includes Bun, bash, Python, and pipx for tools that need them.

## Architecture

```
Discord (discord.js) → MessageCreate / DM → generateBotReply (AI SDK + OpenRouter) → tools (behavior, memory, schedule, …) → Response
```

Single process: Discord connection, message routing, reply-chain and tool-context handling, schedule runner. No daemons, no queues. Key files:

| File                        | Purpose                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `src/index.ts`              | Discord client, message routing, reply chains                                           |
| `src/ai/generate-reply.ts`  | OpenRouter + tools, behavior/memory loading                                             |
| `src/ai/schedule-runner.ts` | Scheduled tasks from SCHEDULE.md                                                        |
| `src/ai/tools/*.ts`         | behavior_editor, memory_editor, schedule_editor, skills_reader, commands_registry, etc. |
| `agent-core/BEHAVIOR.md`    | Structured behavior rules (JSONL)                                                       |
| `agent-core/MEMORY.md`      | Structured memory entries (JSONL)                                                       |
| `agent-core/SCHEDULE.md`    | Scheduled jobs                                                                          |
| `agent-core/COMMANDS.md`    | Command/workflow registry                                                               |

## FAQ

**Why OpenRouter?**  
One API key, many models. Use free/stealth models for daily use and switch to GPT or Claude when you need them. No per-provider setup.

**Why Discord only?**  
This stack is Discord + OpenRouter. To add another channel, fork and add it.

**How do I get free usage?**  
Set `OPENROUTER_MODEL` to a free or stealth model on OpenRouter. Check [OpenRouter models](https://openrouter.ai/models) for current options.

**Where is my data?**  
Behavior, memory, schedule, and command docs live in `agent-core/*.md` in the repo. No external database unless you add one.

**How do I change how the bot talks?**  
Edit `agent-core/BEHAVIOR.md` or ask the bot to add/update rules (e.g. tone, timezone, style). It applies all enabled rules on every reply.

**Is bash_exec safe?**  
It’s off by default (`ENABLE_BASH_TOOL=false`). When enabled, it has timeouts, output truncation, and blocks obvious destructive commands. Use at your own risk.

## Contributing

Prefer small, clear changes. If you add a new tool or intent, keep the single-process, Discord + OpenRouter design.

## License

MIT
