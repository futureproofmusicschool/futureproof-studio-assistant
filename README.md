# Futureproof Studio Assistant

A template for building your own AI studio assistant with Claude Code or Codex. From [Futureproof Music School](https://futureproofmusicschool.com).

This repo is the *structure* of an assistant, not the assistant itself. You make it yours by filling in the placeholders: give it a name, describe your studio, and let its memory grow as you work together.

## The idea

An assistant is only as useful as what it knows about you. A general model knows music production, but it does not know your DAW template, sample library, taste, half-finished projects, or what you figured out last Tuesday.

This repo fixes that with two pieces:

1. **One soul document** (`AGENTS.md`): who the assistant is, what it is for, and how it should work with you. Codex reads it directly. `CLAUDE.md` imports the same file for Claude Code, so the two clients cannot drift into different personalities.
2. **A memory system** (`memory/`): files the assistant reads and writes so knowledge survives between sessions. Sessions end. Files persist.

That is the foundation. MCP tools, skills, automation, and the local app sit on top of it.

## Getting started

1. **Copy this repo** or click **Use this template** on GitHub.
2. **Install Node.js 18 or newer and sign in to at least one supported client:**
   - Claude Code: run `claude`
   - Codex: run `codex`
3. **Fill in the placeholders.** Search for `TODO` across the repo. Start with:
   - `AGENTS.md`: name the assistant and personalize its identity and purpose
   - `assistant.json`: use the same name and set the accent color
   - `voice/prompt.md`: describe the artist so the voice assistant is not generic
   - `.claude/rules/studio-context.md`: add your DAW, gear, genres, and workflow
4. **Start working.** Open the repo in either client and ask for help with a track. Tell the assistant what is worth remembering and ask it to save durable learnings.

A good first prompt:

> Read your studio context, then interview me for five minutes about my studio and my music. Save what you learn to memory.

## Claude Code and Codex compatibility

The repository keeps shared behavior and data independent of the client:

| Concern | Claude Code | Codex |
|---|---|---|
| Assistant identity | `CLAUDE.md` imports `AGENTS.md` | `AGENTS.md` loads automatically |
| Memory and studio context | `.claude/rules/` loads automatically | `AGENTS.md` directs Codex to the same files |
| Ableton MCP | `.mcp.json` | `.codex/config.toml` |

The MCP files use different formats, so keep their server definitions aligned when you add or remove tools. Codex only loads project `.codex/config.toml` settings after you trust the repository.

Both clients currently launch `AbletonMCP` with `uvx ableton-mcp`. Install [`uv`](https://docs.astral.sh/uv/) if `uvx` is not already on your path, and follow Ableton MCP's setup instructions before expecting the assistant to inspect Live.

## Repo map

| Path | What it is |
|---|---|
| `AGENTS.md` | Canonical soul document shared by Claude Code and Codex. Edit this file. |
| `CLAUDE.md` | Thin Claude Code entry point that imports `AGENTS.md`. |
| `assistant.json` | App name, accent color, and enabled tabs. |
| `.claude/rules/studio-context.md` | Facts about your studio: DAW, gear, plugins, genres, and aliases. |
| `.claude/rules/memory.md` | Memory schema and conventions shared by both clients. |
| `.mcp.json` | Claude Code project MCP configuration. |
| `.codex/config.toml` | Codex project configuration, including Ableton MCP. |
| `memory/working-self.md` | Current state: active projects and this week's focus. |
| `memory/episodic/` | Events: sessions, decisions, and experiments. |
| `memory/semantic/` | Facts: taste, patterns, and validated insights. |
| `memory/procedural/` | Repeatable workflows, gear recipes, and workarounds. |
| `board/board.json` | Task board data shared by the app and assistant. |
| `app/` | Next.js interface with Talk, Board, and Contacts tabs (port 3017). Also relays the voice socket. |
| `voice/` | Base voice prompt and saved session transcripts. |
| `interviews/templates/` | Session modes for the Talk tab: onboarding, session debrief, brainstorm. |
| `outbox/` | Email drafts written during a voice session. Nothing here is ever sent. |

## The app

Install and launch the local interface:

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3017](http://localhost:3017). The app has three tabs:

- **Talk**: one voice-first conversation surface, backed by Gemini Live. Pick a session mode, hit Start talking, and speak; the assistant answers out loud and both sides stream as text. Typing works mid-session. Put `GEMINI_API_KEY` in a repo-root `.env`; the key stays on the server, which relays the socket at `/api/talk/ws`.
- **Board**: a kanban board backed by `board/board.json`. The UI and assistant edit the same source of truth.
- **Contacts**: an outreach tracker backed by `contacts/contacts.json`, with a correspondence log per contact.

During a Talk session the voice assistant can search the web, search and read your studio files (memory, plans, transcripts, templates, board, contacts, project rules, and nothing else), and write an email draft to `outbox/`. It never sends anything and never edits the board. Ending a session saves the transcript to `voice/transcripts/`; the CLI assistant files it into memory afterward.

## Extending it

Add capabilities when the need is real:

- **MCP tools** connect Ableton Live, file systems, streaming APIs, and other services.
- **Skills** capture repeatable workflows.
- **Automation** handles stable scheduled work such as session logs or library scans.
- **More tabs** can be added through the app's tab registry.

A small assistant that knows you well beats a large one that does not.

## License and credits

Written by John von Seggern. A [Futureproof Music School](https://futureproofmusicschool.com) project, MIT licensed (see [LICENSE](LICENSE)).

Made for the Futureproof community: copy it, rename it, make it yours. Your assistant deserves its own name anyway.
