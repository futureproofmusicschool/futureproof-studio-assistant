export type TurnRole = "user" | "assistant" | "tool";
export type TurnMode = "text" | "voice";
export type AttachmentKind = "image" | "pdf" | "text" | "midi";

export type Attachment = {
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  /** Data-root-relative, e.g. "conversation/uploads/2026-08-03-141201-riff.mid". */
  path: string;
  size: number;
  /** Extracted text (pdf/text) or analysis (midi). Replayed with the turn forever. */
  summary?: string;
};

export type ConversationTurn = {
  id: string;
  role: TurnRole;
  mode: TurnMode;
  text: string;
  createdAt: number;
  attachment?: Attachment;
};

export type ConversationState = {
  liveHandle?: string | null;
  liveHandleUpdatedAt?: number;
  lastFiledTurnId?: string | null;
  lastFiledDay?: string | null;
};

export type SeedTurn = { role: "user" | "model"; parts: { text: string }[] };

export declare const DATA_ROOT: string;
export declare const CONVERSATION_DIR: string;
export declare const THREAD_PATH: string;
export declare const STATE_PATH: string;
export declare const UPLOADS_DIR: string;
export declare const TRANSCRIPTS_DIR: string;
export declare const MODEL_HISTORY_TURNS: number;
export declare const SEED_CHAR_BUDGET: number;

export declare function appendTurn(turn: Partial<ConversationTurn>): ConversationTurn | null;
export declare function appendTurns(turns: Partial<ConversationTurn>[]): ConversationTurn[];
export declare function readTurns(options?: { limit?: number }): ConversationTurn[];
export declare function readState(): ConversationState;
export declare function patchState(partial: ConversationState): ConversationState;
export declare function mergeTranscriptText(previous: string, next: string): string;
export declare function selectSeedTurns(turns: ConversationTurn[], charBudget?: number): SeedTurn[];
export declare function compactAfterFiling(keepCount?: number): number;
export declare function newTurnId(): string;
