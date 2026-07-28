# Futureproof Studio Assistant

A template for building your own AI studio assistant. It runs as a local app on a Google Gemini API key, and works with Claude Code or Codex as optional power tools. From [Futureproof Music School](https://futureproofmusicschool.com).

This repo is the *structure* of an assistant, not the assistant itself. You make it yours by filling in the placeholders: give it a name, describe your studio, and let its memory grow as you work together.

## The idea

An assistant is only as useful as what it knows about you. A general model knows music production, but it does not know your DAW template, sample library, taste, half-finished projects, or what you figured out last Tuesday.

This repo fixes that with two pieces:

1. **One soul document** (`AGENTS.md`): who the assistant is, what it is for, and how it should work with you. Codex reads it directly. `CLAUDE.md` imports the same file for Claude Code, so the two clients cannot drift into different personalities.
2. **A memory system** (`memory/`): files the assistant reads and writes so knowledge survives between sessions. Sessions end. Files persist.

That is the foundation. MCP tools, skills, automation, and the local app sit on top of it.

## Getting started

1. **Copy this repo** or click **Use this template** on GitHub.
2. **Run `scripts/init.sh`.** It copies starter files from `examples/` into their real locations and installs a pre-commit guard. Everything personal (your identity, memory, board, contacts, prompts, transcripts, keys) lives in **gitignored files**, so your data never leaves your machine even though the code repo is public.
3. **Install Node.js 18 or newer**, then start the app (`npm install --prefix app && npm run dev --prefix app`) and paste a Google Gemini API key into the setup screen. That is the only account you need: talking, writing MIDI, and filing sessions into memory all run on it.
4. **Optional: a coding client for deeper work.** Claude Code (`claude`) or Codex (`codex`) opens the repo as a working session, which is better for auditing memory, editing prompts, and changing the assistant itself. Neither is required for the assistant to remember things.
5. **Personalize the gitignored files:**
   - `CLAUDE.local.md`: name the assistant and describe who you are
   - `assistant.json`: the same name, your name, and the accent color (the names are also editable in the app's Settings tab)
   - `voice/prompt.md`: describe the artist so the voice assistant is not generic
   - `.claude/rules/studio-context.md`: add your DAW, gear, genres, and workflow
6. **Start working.** Talk to it in the app, or open the repo in a coding client and ask for help with a track. Tell the assistant what is worth remembering; every voice session is filed into memory automatically when it ends.

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
| `app/` | Next.js interface with Talk, Board, Contacts, and Settings tabs (port 3017). Also relays the voice socket. |
| `ableton/AbletonOSC/` | Vendored Ableton Live Remote Script (OSC control surface); install with `scripts/install-abletonosc.sh`. |
| `desktop/` | Electron shell that wraps the app in its own window. |
| `examples/` | Starter copies of every gitignored personal file; `scripts/init.sh` puts them in place. |
| `voice/` | Base voice prompt and saved session transcripts. |
| `interviews/templates/` | Session modes for the Talk tab: onboarding, session debrief, brainstorm. |
| `outbox/` | Email drafts written during a voice session. Nothing here is ever sent. |
| `instruments/` | Articulation and keyswitch docs for the composer. Yours stay local; only the README and example ship. |
| `reference/` | The reference shelf: full manuals (PDF, docx, text, markdown) the assistant searches on demand. Gitignored except its README. |
| `settings.json` | Machine-local settings: which Mac runs Ableton, and which model writes MIDI. |

## The app

**Easiest:** double-click **`Start Studio Assistant.command`** in the repo root (macOS). It installs dependencies on first run, starts the server, and opens the app in your browser; keep the Terminal window open while you work.

Or from a terminal:

```bash
cd app
npm install
npm run dev
```

Open [http://localhost:3017](http://localhost:3017). The app has four tabs:

- **Talk**: one voice-first conversation surface, backed by Gemini Live. Pick a session mode, hit Start talking, and speak; the assistant answers out loud and both sides stream as text. Typing works mid-session. Add or replace your Gemini API key from Settings; first run also prompts for it on the Talk screen. The key is saved to the gitignored repo-root `.env` and stays on the server, which relays the socket at `/api/talk/ws`. Sessions hang up on their own after five quiet minutes.
- **Board**: a kanban board backed by `board/board.json`. The UI and assistant edit the same source of truth.
- **Contacts**: an outreach tracker backed by `contacts/contacts.json`, with a correspondence log per contact.
- **Settings**: name the assistant (and yourself), pick which Mac runs Ableton Live, choose which model writes MIDI, and see what is on the reference shelf. Always present, even if you trim the other tabs in `assistant.json`.

During a Talk session the voice assistant can search the web, search and read your studio files (memory, plans, transcripts, templates, board, contacts, project rules, and nothing else), search any manuals you drop into `reference/` (PDF, docx, text, or markdown — see [`reference/README.md`](reference/README.md)), save a memory on the spot, and write an email draft to `outbox/`. Technical questions check the shelf first, then fall back to a web search preferring official documentation, and the assistant says where the answer came from. It never sends anything and never edits the board. Ending a session saves the transcript to `voice/transcripts/` and files it into memory automatically, on Gemini Flash through the same key; machine-written memory files are stamped `filed-by: gemini-flash` so you can audit what it kept.

## Ableton Live control

The voice assistant sees and controls Ableton Live: session and arrangement contents, transport and tempo, mixer moves, and above all creating MIDI clips, writing notes into them, and placing them on the arrangement timeline. It edits only when asked and confirms before anything destructive.

Setup: run `scripts/install-abletonosc.sh` (add `user@host` to install on another Mac on your network), select **AbletonOSC** as a Control Surface in Live's preferences (Link, Tempo & MIDI), and pick the machine in the Settings tab. The transport is OSC over UDP to the vendored Remote Script in `ableton/AbletonOSC/`; it is unauthenticated, so keep it on your local network and never port-forward 11000/11001.

### Asking for a part

Ask out loud for material ("give me a sparse ride-led groove under that, eight bars") and the assistant hands the brief to a **composer model** that writes the performance, then puts it in the clip. It takes 20 to 60 seconds. By default the composer is Gemini Pro on the key you already gave it; the Settings tab's Composer panel can switch it to Claude Fable 5, either on an Anthropic API key or through a local `claude` CLI login.

Drop your sample library's articulation documentation into `instruments/` as markdown, name it when you ask ("on the taiko kit"), and the whole doc goes into the composer's prompt, so keyswitches get placed the way the manual says. See [`instruments/README.md`](instruments/README.md). Continuous CC lanes cannot be written yet.

## Desktop app

`npm install --prefix desktop`, then `npm start --prefix desktop` opens the assistant in its own window, starting the app server if it isn't already running. `npm run pack --prefix desktop` builds a double-clickable Mac app; the packaged app finds your checkout via `~/.studio-assistant-desktop.json` (`{"repo": "/path/to/this/checkout"}`).

## Extending it

Add capabilities when the need is real:

- **MCP tools** connect file systems, streaming APIs, and other services (Ableton Live control is built in).
- **Gmail** integration (sending the drafts in `outbox/` from the app after you review them) is the next planned milestone; today you send drafts yourself.
- **Skills** capture repeatable workflows.
- **Automation** handles stable scheduled work such as session logs or library scans.
- **More tabs** can be added through the app's tab registry.

A small assistant that knows you well beats a large one that does not.

## License and credits

Written by John von Seggern. A [Futureproof Music School](https://futureproofmusicschool.com) project, MIT licensed (see [LICENSE](LICENSE)).

Made for the Futureproof community: copy it, rename it, make it yours. Your assistant deserves its own name anyway.
