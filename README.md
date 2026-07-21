# Futureproof Studio Assistant

A template for building your own AI studio assistant with Claude Code. From [Futureproof Music School](https://futureproofmusicschool.com).

This repo is the *structure* of an assistant, not the assistant itself. You make it yours by filling in the placeholders: give it a name, tell it about your studio, and let its memory grow as you work together.

## The idea

An AI assistant is only as useful as what it knows about you. Out of the box, Claude knows music production in general. It does not know your DAW template, your sample library, your taste, your half-finished projects, or what you figured out last Tuesday.

This repo fixes that with two pieces:

1. **A soul document** (`CLAUDE.md`): who the assistant is, what it's for, and how it should work with you. Claude Code reads this automatically every session.
2. **A memory system** (`memory/`): files the assistant reads and writes so knowledge survives between sessions. Sessions end. Files persist.

That's the whole trick. Everything else (MCP tools, automation, skills) gets added on top of this foundation later.

## Getting started

1. **Copy this repo** (or click "Use this template" on GitHub) and rename it if you like.
2. **Open it with Claude Code**: `cd` into the folder and run `claude`.
3. **Fill in the placeholders.** Search for `TODO` across the repo. The two files that matter most:
   - `CLAUDE.md`: name your assistant and personalize the identity sections
   - `.claude/rules/studio-context.md`: your DAW, gear, genres, and workflow
4. **Start working.** Ask it to help with a track. Tell it things worth remembering. Ask it to save learnings to memory.

A good first prompt: *"Read your CLAUDE.md and studio-context.md, then interview me for five minutes about my studio and my music. Save what you learn to memory."*

## Repo map

| Path | What it is |
|------|-----------|
| `CLAUDE.md` | The soul document. Identity, purpose, working style. Loaded every session. |
| `assistant.json` | The app config: your assistant's name, accent color, enabled tabs. |
| `.claude/rules/studio-context.md` | Facts about YOUR studio: DAW, gear, plugins, genres, aliases. |
| `.claude/rules/memory.md` | How the memory system works (schema and conventions). |
| `memory/working-self.md` | The assistant's current state: active projects, this week's focus. |
| `memory/episodic/` | Events: "what happened" (sessions, decisions, experiments). |
| `memory/semantic/` | Facts: "what's true" (your taste, your patterns, validated insights). |
| `memory/procedural/` | How-tos: "how we do things" (workflows, gear recipes, workarounds). |
| `board/board.json` | Your task board's data. The app renders it; the assistant edits it. |
| `app/` | The web interface: Board, Chat, and Interviews tabs (Next.js, port 3017). |
| `voice/` | The voice-interview server (Gemini Live, port 3015). |
| `interviews/templates/` | Briefings for voice sessions (onboarding, session debrief, brainstorm). |

## The app

The web interface is the daily way to work with your assistant:

```bash
cd app && npm install && npm run dev
```

Open http://localhost:3017. Three tabs:

- **Board**: a kanban task board. The data is a plain JSON file (`board/board.json`), so the assistant manages your tasks by editing the same file the app renders. One source of truth, no accounts.
- **Chat**: the assistant with everything: the repo, the memory, the board. Powered by the Claude Agent SDK using your existing Claude Code login (no API key needed). It can read and edit the repo, including the board.
- **Interviews**: spoken conversations, deliberately separate. **Voice gathers, text thinks**: the voice agent gets a one-page briefing and cannot see the repo; afterward the assistant reads the transcript and files what it learned into memory. Requires a `GEMINI_API_KEY` in a repo-root `.env` file and the voice server running (`cd voice && npm install && npm start`).

## What comes next

Once the foundation works, you extend it:

- **MCP tools**: connect Ableton Live, your file system, streaming APIs, whatever your workflow touches
- **Skills**: repeatable workflows the assistant can run on request
- **Automation**: scheduled tasks (session logs, library scans)
- **More tabs**: the app's tab registry makes new screens (a stats dashboard, a release tracker) one entry each

Add these only when you feel the need. A small assistant that knows you well beats a big one that doesn't.

## License and credits

Written by John von Seggern. A [Futureproof Music School](https://futureproofmusicschool.com) project, MIT licensed (see [LICENSE](LICENSE)).

Made for the Futureproof community: copy it, rename it, make it yours. Your assistant deserves its own name anyway.
