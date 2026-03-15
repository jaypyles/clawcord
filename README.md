# Bun + TypeScript Discord LLM Bot

Starter Discord bot using:

- Bun runtime
- TypeScript
- `discord.js` (slash + mention handling)
- Vercel AI SDK (`ai` + `@openrouter/ai-sdk-provider`)

## 1) Install Bun

If Bun is not installed:

```bash
curl -fsSL https://bun.sh/install | bash
```

Open a new shell after install, then confirm:

```bash
bun --version
```

## 2) Install dependencies

```bash
bun install
```

## 3) Configure environment

Copy and fill the env file:

```bash
cp .env.example .env
```

Required variables:

- `DISCORD_TOKEN`: Bot token from Discord Developer Portal
- `DISCORD_CLIENT_ID`: Application (client) ID
- `DISCORD_GUILD_ID`: Server ID for fast guild-scoped command registration
- `OPENROUTER_API_KEY`: API key for OpenRouter model calls
- `OPENROUTER_MODEL` (optional): default is `openai/gpt-4o-mini`
- `PLAYGROUND_DIR` (optional): absolute/relative path for sandbox work directory used in the system prompt (defaults to `cwd/playground`)
- `ENABLE_BASH_TOOL` (optional): default is `false`

## 4) Register slash commands

```bash
bun run register
```

## 5) Run the bot

```bash
bun run dev
```

Available commands:

- `/ping`

Mention flow:

- Mention the bot in a message and include your prompt.
- Example: `@your-bot summarize the latest messages`
- DM flow is enabled: direct messages to the bot are handled without mentioning.
- Reply context is supported: if your mention is a reply to another message, the bot includes the referenced message content as context.
- You can also reply directly to the bot's message without mentioning it.
- Reply chain memory is supported: when replying in a thread/chain, it walks prior replied messages to preserve conversation continuity.
- Tool-call memory is included for bot turns: compact summaries of prior tool usage are carried into subsequent reply-chain context.
- Long bot outputs are automatically split into multiple Discord messages when they exceed Discord's message length limit.
- The bot will reply directly to that message.

Important: enable **Message Content Intent** for your bot in the Discord Developer Portal, otherwise mention prompts will not include message text.

### Built-in AI tools

The mention LLM flow can use these tools:

- `http_fetch`: verbose native-like fetch (method, headers, query, body, redirect, cache, mode, credentials, etc.)
- `get_time`: returns current UTC timestamp
- `bash_exec`: runs a bash command (disabled by default)
- `memory_editor`: read/add/delete structured memory entries in `agent-core/MEMORY.md`
- `behavior_editor`: read/add/enable-disable/delete structured behavior rules in `agent-core/BEHAVIOR.md`
- `skills_reader`: lists/reads skills from `~/.config/justdothething/skills` (supports Claude Code skill format)
- `commands_registry`: list/read/upsert command entries in `agent-core/COMMANDS.md`

`skills_reader` Claude Code format:

- Preferred layout: `~/.config/justdothething/skills/<skill-name>/SKILL.md`
- Supports YAML frontmatter metadata (e.g. `name`, `description`, `version`)
- Detects scripts in `~/.config/justdothething/skills/<skill-name>/scripts/`
- Returns explicit `name` and `description` fields in tool output
- Also supports plain markdown files in the root skills directory

`bash_exec` safety behavior:

- Off unless `ENABLE_BASH_TOOL=true`
- 10 second timeout
- Truncated stdout/stderr previews
- Blocks obvious destructive patterns (`rm -rf /`, `mkfs`, `shutdown`, `reboot`, fork bombs)
- Can execute inline commands OR run a script file by `filePath` (restricted to `~/.config/justdothething/skills`)
- If `filePath` ends in `.py`, it runs with `python3`; otherwise it runs with `bash`

## Notes

- This project uses guild command registration for quick updates while developing.
- If you want global commands later, change the route in `src/register-commands.ts` to `Routes.applicationCommands(...)`.
