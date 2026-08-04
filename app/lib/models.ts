/**
 * Every model id the server calls, in one place, so upgrading a model is a
 * one-line edit instead of a grep. The voice model lives in lib/talk.ts because
 * it is part of the Live socket handshake, not a plain generateContent call.
 */

/** Gemini Flash: internal bookkeeping (filing transcripts into memory). Cheap, fast, the student's own key. */
export const BOOKKEEPING_MODEL = "gemini-3.6-flash";

/** Gemini Pro: the default composer backend, so a student needs no second account. */
export const COMPOSER_GEMINI_MODEL = "gemini-3.1-pro-preview";

/** Gemini Pro (thinking) as the Chat tab's brain: text sessions for precise, complex instructions. */
export const CHAT_MODEL = "gemini-3.1-pro-preview";

/** The Deep Research agent the Chat tab can start through the Interactions API. */
export const DEEP_RESEARCH_AGENT = "deep-research-preview-04-2026";

/**
 * Claude Fable 5 for the anthropic-api and claude-code composer backends.
 * Thinking is always on for this model; depth is set with effort, not a token
 * budget (budget_tokens is rejected with a 400).
 */
export const COMPOSER_CLAUDE_MODEL = "claude-fable-5";

/** Effort level for the Claude composer. Valid: low | medium | high | xhigh | max. */
export const CLAUDE_EFFORT = "medium";

/** Re-served by this model when Fable's safety classifiers decline a request. */
export const CLAUDE_FALLBACK_MODEL = "claude-opus-4-8";

/** Beta flag that enables the server-side `fallbacks` parameter. */
export const CLAUDE_FALLBACK_BETA = "server-side-fallback-2026-06-01";
