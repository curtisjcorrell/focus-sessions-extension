export type PurposeStatus = "answered" | "skipped" | "early-exit";

export type PendingPromptStatus = "awaiting-selection" | "selected";

export interface FocusSession {
  id: string;
  tabId: number;
  date: string;
  domain: string;
  purpose: string;
  category?: string;
  note?: string;
  status: PurposeStatus;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export interface ActiveSession {
  id: string;
  tabId: number;
  domain: string;
  purpose: string;
  category?: string;
  note?: string;
  status: PurposeStatus;
  startedAt: number;
}

export interface PendingPrompt {
  tabId: number;
  status: PendingPromptStatus;
  targetUrl: string;
  domain: string;
  category?: string;
  note?: string;
  startedAt: number;
}

export interface PromptDetailsRequestMessage {
  type: "focus:get-prompt-details";
}

export interface PromptDetailsResponseMessage {
  domain: string;
  targetUrl: string;
  categories: string[];
  defaultCategory?: string;
}

export interface PromptSubmitMessage {
  type: "focus:prompt-submit";
  category: string;
  note: string;
}

export interface EarlyExitMessage {
  type: "focus:early-exit";
}

export type BackgroundMessage =
  | EarlyExitMessage
  | PromptDetailsRequestMessage
  | PromptSubmitMessage;
