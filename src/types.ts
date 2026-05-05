export type PurposeStatus = "answered" | "skipped" | "early-exit";

export interface FocusSession {
  id: string;
  tabId: number;
  date: string;
  domain: string;
  purpose: string;
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
  status: PurposeStatus;
  startedAt: number;
}

export interface PendingPrompt {
  tabId: number;
  domain: string;
}

export interface PurposeRequestMessage {
  type: "focus:get-purpose";
  domain: string;
}

export interface PurposeResponseMessage {
  type: "focus:purpose-result";
  purpose: string;
  status: PurposeStatus;
}

export interface EarlyExitMessage {
  type: "focus:early-exit";
}

export interface ContentReadyMessage {
  type: "focus:content-ready";
}

export type ContentMessage = PurposeRequestMessage;
export type BackgroundMessage = PurposeResponseMessage | EarlyExitMessage | ContentReadyMessage;
