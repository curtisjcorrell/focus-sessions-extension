import type { ActiveSession, FocusSession, PendingPrompt } from "./types.js";

const SESSIONS_KEY = "focusSessions";
const ACTIVE_SESSIONS_KEY = "activeFocusSessions";
const PENDING_PROMPTS_KEY = "pendingFocusPrompts";
const WHITELIST_KEY = "whitelistedDomains";
const AUTH_EXEMPTIONS_KEY = "authExemptions";
const CATEGORIES_KEY = "focusCategories";
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_CATEGORIES = ["Work", "Research", "Communication", "Admin", "Shopping", "Entertainment", "Other"];
const DEFAULT_AUTH_EXEMPTIONS = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "okta.com",
  "auth0.com",
  "github.com/login",
  "appleid.apple.com",
  "id.atlassian.com"
];

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

export async function getActiveSessions(): Promise<ActiveSession[]> {
  return Object.values(await getSessionMap());
}

export async function getActiveSessionByDomain(domain: string): Promise<ActiveSession | undefined> {
  return (await getActiveSessions()).find((session) => session.domain === domain);
}

export async function setActiveSession(session: ActiveSession): Promise<void> {
  const sessions = await getSessionMap();
  sessions[String(session.tabId)] = session;
  await chrome.storage.session.set({ [ACTIVE_SESSIONS_KEY]: sessions });
}

export async function hasActiveSessionId(sessionId: string): Promise<boolean> {
  return (await getActiveSessions()).some((session) => session.id === sessionId);
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

export async function updatePendingPrompt(prompt: PendingPrompt): Promise<void> {
  await setPendingPrompt(prompt);
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

export async function getCategories(): Promise<string[]> {
  const result = await chrome.storage.local.get(CATEGORIES_KEY);
  const categories = result[CATEGORIES_KEY];
  const normalized = normalizeStringList(categories, DEFAULT_CATEGORIES);
  return normalized.some((category) => category.toLowerCase() === "other") ? normalized : [...normalized, "Other"];
}

export async function addCategory(input: string): Promise<string | null> {
  const category = input.trim();
  if (!category) {
    return null;
  }

  const categories = await getCategories();
  if (!categories.some((item) => item.toLowerCase() === category.toLowerCase())) {
    categories.push(category);
    await chrome.storage.local.set({ [CATEGORIES_KEY]: categories });
  }

  return category;
}

export async function removeCategory(category: string): Promise<void> {
  const categories = (await getCategories()).filter((item) => item !== category);
  await chrome.storage.local.set({ [CATEGORIES_KEY]: categories.length ? categories : DEFAULT_CATEGORIES });
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

export async function getAuthExemptions(): Promise<string[]> {
  const result = await chrome.storage.local.get(AUTH_EXEMPTIONS_KEY);
  return normalizeStringList(result[AUTH_EXEMPTIONS_KEY], DEFAULT_AUTH_EXEMPTIONS);
}

export async function addAuthExemption(input: string): Promise<string | null> {
  const exemption = normalizeExemptionInput(input);
  if (!exemption) {
    return null;
  }

  const exemptions = await getAuthExemptions();
  if (!exemptions.includes(exemption)) {
    exemptions.push(exemption);
    exemptions.sort();
    await chrome.storage.local.set({ [AUTH_EXEMPTIONS_KEY]: exemptions });
  }

  return exemption;
}

export async function removeAuthExemption(exemption: string): Promise<void> {
  const normalized = normalizeExemptionInput(exemption);
  if (!normalized) {
    return;
  }

  const exemptions = (await getAuthExemptions()).filter((item) => item !== normalized);
  await chrome.storage.local.set({ [AUTH_EXEMPTIONS_KEY]: exemptions });
}

export async function isAuthExemptUrl(url: string): Promise<boolean> {
  const exemptions = await getAuthExemptions();

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const path = parsed.pathname.toLowerCase();

    return exemptions.some((entry) => {
      const [entryHost, ...pathParts] = entry.split("/");
      if (!entryHost || (hostname !== entryHost && !hostname.endsWith(`.${entryHost}`))) {
        return false;
      }

      const entryPath = pathParts.join("/");
      return !entryPath || path === `/${entryPath}` || path.startsWith(`/${entryPath}/`);
    });
  } catch {
    return false;
  }
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

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  const list = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : fallback;
  return [...new Set(list.map((item) => item.trim()))];
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

function normalizeExemptionInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/^www\./i, "");
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.replace(/^www\./i, "");
    const pathname = parsed.pathname.replace(/^\/+|\/+$/g, "");
    if (!hostname || !hostname.includes(".")) {
      return null;
    }

    return pathname ? `${hostname}/${pathname}` : hostname;
  } catch {
    return null;
  }
}
