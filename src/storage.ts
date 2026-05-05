import type { ActiveSession, FocusSession, PendingPrompt } from "./types.js";

const SESSIONS_KEY = "focusSessions";
const ACTIVE_SESSIONS_KEY = "activeFocusSessions";
const PENDING_PROMPTS_KEY = "pendingFocusPrompts";
const WHITELIST_KEY = "whitelistedDomains";
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function getSessions(): Promise<FocusSession[]> {
  const result = await chrome.storage.local.get(SESSIONS_KEY);
  const sessions = result[SESSIONS_KEY];
  return Array.isArray(sessions) ? (sessions as FocusSession[]) : [];
}

export async function saveSession(session: FocusSession): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  const sessions = (await getSessions()).filter((item) => item.endedAt >= cutoff);
  sessions.push(session);
  await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
}

export async function clearAllSessions(): Promise<void> {
  await chrome.storage.local.remove(SESSIONS_KEY);
}

export async function clearTodaySessions(): Promise<void> {
  const today = toDateKey(Date.now());
  const sessions = (await getSessions()).filter((session) => session.date !== today);
  await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
}

export function toDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function getActiveSession(tabId: number): Promise<ActiveSession | undefined> {
  return (await getSessionMap())[String(tabId)];
}

export async function setActiveSession(session: ActiveSession): Promise<void> {
  const sessions = await getSessionMap();
  sessions[String(session.tabId)] = session;
  await chrome.storage.session.set({ [ACTIVE_SESSIONS_KEY]: sessions });
}

export async function removeActiveSession(tabId: number): Promise<ActiveSession | undefined> {
  const sessions = await getSessionMap();
  const key = String(tabId);
  const session = sessions[key];
  delete sessions[key];
  await chrome.storage.session.set({ [ACTIVE_SESSIONS_KEY]: sessions });
  return session;
}

export async function setPendingPrompt(prompt: PendingPrompt): Promise<void> {
  const prompts = await getPromptMap();
  prompts[String(prompt.tabId)] = prompt;
  await chrome.storage.session.set({ [PENDING_PROMPTS_KEY]: prompts });
}

export async function takePendingPrompt(tabId: number): Promise<PendingPrompt | undefined> {
  const prompts = await getPromptMap();
  const key = String(tabId);
  const prompt = prompts[key];
  delete prompts[key];
  await chrome.storage.session.set({ [PENDING_PROMPTS_KEY]: prompts });
  return prompt;
}

export async function getPendingPrompt(tabId: number): Promise<PendingPrompt | undefined> {
  return (await getPromptMap())[String(tabId)];
}

export async function getWhitelistedDomains(): Promise<string[]> {
  const result = await chrome.storage.local.get(WHITELIST_KEY);
  const domains = result[WHITELIST_KEY];
  return Array.isArray(domains) ? domains.filter((domain): domain is string => typeof domain === "string") : [];
}

export async function addWhitelistedDomain(input: string): Promise<string | null> {
  const domain = normalizeDomainInput(input);
  if (!domain) {
    return null;
  }

  const domains = await getWhitelistedDomains();
  if (!domains.includes(domain)) {
    domains.push(domain);
    domains.sort();
    await chrome.storage.local.set({ [WHITELIST_KEY]: domains });
  }

  return domain;
}

export async function removeWhitelistedDomain(domain: string): Promise<void> {
  const normalized = normalizeDomainInput(domain);
  if (!normalized) {
    return;
  }

  const domains = (await getWhitelistedDomains()).filter((item) => item !== normalized);
  await chrome.storage.local.set({ [WHITELIST_KEY]: domains });
}

export async function isWhitelistedDomain(domain: string): Promise<boolean> {
  const normalized = normalizeDomainInput(domain);
  if (!normalized) {
    return false;
  }

  const domains = await getWhitelistedDomains();
  return domains.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
}

async function getSessionMap(): Promise<Record<string, ActiveSession>> {
  const result = await chrome.storage.session.get(ACTIVE_SESSIONS_KEY);
  const sessions = result[ACTIVE_SESSIONS_KEY];
  return isObject(sessions) ? (sessions as Record<string, ActiveSession>) : {};
}

async function getPromptMap(): Promise<Record<string, PendingPrompt>> {
  const result = await chrome.storage.session.get(PENDING_PROMPTS_KEY);
  const prompts = result[PENDING_PROMPTS_KEY];
  return isObject(prompts) ? (prompts as Record<string, PendingPrompt>) : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDomainInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.replace(/^www\./i, "");
    return hostname && hostname.includes(".") ? hostname : null;
  } catch {
    return null;
  }
}
