# Memory System

The memory system stores studio knowledge in three types plus a dynamic working self. This is how the assistant keeps continuity between sessions: sessions end, files persist.

## Location

All memories live in `/memory/` with a subdirectory for each type.

## Working Self

**Location:** `memory/working-self.md`

A snapshot of current state: active tracks, this week's focus, what's working and what isn't. Unlike the three memory types (which store knowledge), the working self captures *now*.

- **Read it** at the start of any session about ongoing work
- **Update it** whenever the state of a project changes meaningfully
- **Keep it under 100 lines.** Compress, don't truncate. Old state moves to episodic memory.

## Memory Types

### Episodic (what happened)

Records of sessions, decisions, experiments, and their outcomes.

**Location:** `memory/episodic/`
**Naming:** `YYYY-MM-DD-descriptive-name.md`

```yaml
---
type: episodic
date: 2026-07-17
tags: [track-name, mixdown]
outcome: pending | success | failure | mixed
---
# Title

What happened, why, what we expected, what to follow up on.
```

Examples: "Rebuilt the drop in Track X with a new bass patch", "Tried sidechaining the pads to the kick, sounded worse, reverted".

### Semantic (what's true)

Validated facts and patterns: taste, tendencies, insights about the music.

**Location:** `memory/semantic/`
**Naming:** `category-topic.md` (e.g., `taste-basslines.md`)

```yaml
---
type: semantic
category: taste | workflow | sound-design | mixing | arrangement
last_validated: 2026-07-17
confidence: high | medium | low
---
# Topic

## Fact
Statement, evidence, what it means for future sessions.
```

Examples: "I always prefer darker pad sounds; bright pads get replaced within a session", "My arrangements stall at the 2-minute mark; the fix has been writing the outro first".

### Procedural (how we do things)

Workflows, recipes, and workarounds, written as steps.

**Location:** `memory/procedural/`
**Naming:** `action-description.md` (e.g., `bounce-stems-for-mastering.md`)

```yaml
---
type: procedural
category: workflow | gear | troubleshooting
last_used: 2026-07-17
---
# Procedure Name

## When to Use
## Steps
1. ...
## Gotchas
- ...
```

Examples: "How I set up a new project from template", "The exact export settings for club-ready masters", "Fix for the audio interface dropping out after sleep".

## Rules of the System

1. **Save at the moment of learning.** A insight not written down within the session is gone.
2. **One fact per file stays findable.** Prefer small focused files over one giant notes file.
3. **Memory is context, not authority.** Files record what was believed at the time. If current evidence contradicts a memory, trust the evidence and update the file.
4. **Confidence decays.** A taste note from a year ago may not be true anymore. When acting on an old memory, ask whether it still holds.
5. **Read with a target.** Grep for a topic before reading whole directories. Load only what the session needs.
