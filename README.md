# Studio Assistant

A template for building your own AI studio assistant with Claude Code.

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
| `.claude/rules/studio-context.md` | Facts about YOUR studio: DAW, gear, plugins, genres, aliases. |
| `.claude/rules/memory.md` | How the memory system works (schema and conventions). |
| `memory/working-self.md` | The assistant's current state: active projects, this week's focus. |
| `memory/episodic/` | Events: "what happened" (sessions, decisions, experiments). |
| `memory/semantic/` | Facts: "what's true" (your taste, your patterns, validated insights). |
| `memory/procedural/` | How-tos: "how we do things" (workflows, gear recipes, workarounds). |

## What comes next

Once the foundation works, you extend it:

- **MCP tools**: connect Ableton Live, your file system, streaming APIs, whatever your workflow touches
- **Skills**: repeatable workflows the assistant can run on request
- **Automation**: scheduled tasks (session logs, library scans)

Add these only when you feel the need. A small assistant that knows you well beats a big one that doesn't.
