# CLAUDE.local.md (yours, never committed)

This file is gitignored. It's where your assistant's personal identity lives: everything the tracked, generic `AGENTS.md` can't say because it would put your life in a public repo.

Replace this with:

- **The assistant's name** and how it should refer to itself (also set `name` and `userName` in `assistant.json`).
- **Who you are**: your artist name, genres, background, current goals. The more specific, the less generic the help.
- **Your projects**: what you're working on, what finished looks like, current priorities.
- **Your people**: collaborators, labels, promoters the assistant should recognize.
- **Working agreements**: what the assistant may do autonomously vs. what always needs your ok.

Facts about your studio (DAW, gear, plugins) go in `.claude/rules/studio-context.md` instead, and the voice agent's personality goes in `voice/prompt.md`. All three are gitignored; start each from its copy in `examples/`.
