import {
  getActiveSession,
  getActiveSessionByDomain,
  getActiveSessions,
  hasActiveSessionId,
  getPendingPrompt,
  isWhitelistedDomain,
  removeActiveSession,
  saveSession,
  setActiveSession,
  setPendingPrompt,
  takePendingPrompt,
  toDateKey
} from "./storage.js";
import type { BackgroundMessage, PurposeResponseMessage } from "./types.js";

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("stats.html") });
});

chrome.runtime.onInstalled.addListener(() => {
  void closeAllUnknownSessions();
});

chrome.runtime.onStartup.addListener(() => {
  void closeAllUnknownSessions();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    void beginPromptedSession(tabId, tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void finishSession(tabId);
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender) => {
  const senderTab = getValidSenderTab(sender);
  if (!senderTab || !isBackgroundMessage(message)) {
    return;
  }

  if (message.type === "focus:content-ready") {
    void handleContentReady(senderTab.id, senderTab.url);
    return;
  }

  if (message.type === "focus:early-exit") {
    void recordEarlyExit(senderTab.id, senderTab.url);
    return;
  }

  if (message.type !== "focus:purpose-result" || !isPurposeResponseMessage(message)) {
    return;
  }

  const domain = getDomain(senderTab.url);
  if (!domain) {
    return;
  }

  void startSession(senderTab.id, domain, normalizePurpose(message));
});

async function handleContentReady(tabId: number, url: string): Promise<void> {
  const domain = getDomain(url);
  if (!domain) {
    return;
  }

  if (await isWhitelistedDomain(domain)) {
    await finishSession(tabId);
    return;
  }

  const current = await getActiveSession(tabId);
  if (current?.domain === domain) {
    return;
  }

  const reusable = await getActiveSessionByDomain(domain);
  if (reusable) {
    const pending = await getPendingPrompt(tabId);
    if (pending?.domain === domain) {
      await takePendingPrompt(tabId);
      await setActiveSession({ ...reusable, tabId });
      return;
    }

    await finishSession(tabId);
    await takePendingPrompt(tabId);
    await setActiveSession({ ...reusable, tabId });
    return;
  }

  const pending = await getPendingPrompt(tabId);
  if (pending?.domain === domain) {
    await sendPrompt(tabId, domain);
    return;
  }

  await beginPromptedSession(tabId, url);
}

async function beginPromptedSession(tabId: number, url: string): Promise<void> {
  const domain = getDomain(url);
  if (!domain) {
    return;
  }

  if (await isWhitelistedDomain(domain)) {
    await finishSession(tabId);
    return;
  }

  const current = await getActiveSession(tabId);
  if (current?.domain === domain) {
    return;
  }

  const pending = await getPendingPrompt(tabId);
  if (pending?.domain === domain) {
    await sendPrompt(tabId, domain);
    return;
  }

  const reusable = await getActiveSessionByDomain(domain);
  if (reusable) {
    await finishSession(tabId);
    await takePendingPrompt(tabId);
    await setActiveSession({ ...reusable, tabId });
    return;
  }

  await finishSession(tabId);
  await setPendingPrompt({ tabId, domain });
  await sendPrompt(tabId, domain);
}

async function sendPrompt(tabId: number, domain: string): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "focus:get-purpose",
      domain,
      activeProjects: await getActiveProjects(domain)
    });
  } catch {
    // Content scripts are unavailable on restricted pages and can be late on fresh loads.
    // Keep the pending prompt so a ready content script can pick it up, or tab close logs it as skipped.
  }
}

async function getActiveProjects(currentDomain: string): Promise<Array<{ purpose: string; domain: string; startedAt: number }>> {
  const projects = new Map<string, { purpose: string; domain: string; startedAt: number }>();

  for (const session of await getActiveSessions()) {
    const purpose = session.purpose.trim();
    if (!purpose || purpose === "Unspecified" || session.status !== "answered" || session.domain === currentDomain) {
      continue;
    }

    const existing = projects.get(purpose);
    if (!existing || session.startedAt < existing.startedAt) {
      projects.set(purpose, { purpose, domain: session.domain, startedAt: session.startedAt });
    }
  }

  return [...projects.values()].sort((a, b) => a.startedAt - b.startedAt || a.purpose.localeCompare(b.purpose));
}

async function startSession(
  tabId: number,
  domain: string,
  result: Pick<PurposeResponseMessage, "purpose" | "status">,
  fallbackStartedAt = Date.now()
): Promise<void> {
  await takePendingPrompt(tabId);

  const reusable = await getActiveSessionByDomain(domain);
  if (reusable) {
    await finishSession(tabId);
    await setActiveSession({ ...reusable, tabId });
    return;
  }

  const startedAt = fallbackStartedAt;
  await setActiveSession({
    id: crypto.randomUUID(),
    tabId,
    domain,
    purpose: result.purpose,
    status: result.status,
    startedAt
  });
}

async function recordEarlyExit(tabId: number, url: string): Promise<void> {
  const domain = getDomain(url);
  if (!domain) {
    return;
  }

  const existing = await removeActiveSession(tabId);
  const pending = await takePendingPrompt(tabId);
  const timestamp = existing?.startedAt ?? Date.now();

  await saveSession({
    id: crypto.randomUUID(),
    tabId,
    date: toDateKey(timestamp),
    domain: pending?.domain ?? domain,
    purpose: "Early Exit",
    status: "early-exit",
    startedAt: timestamp,
    endedAt: Date.now(),
    durationMs: 0
  });

  await chrome.tabs.remove(tabId);
}

async function finishSession(tabId: number): Promise<void> {
  const session = await removeActiveSession(tabId);
  const pending = session ? undefined : await takePendingPrompt(tabId);

  if (!session && !pending) {
    return;
  }

  if (session && (await hasActiveSessionId(session.id))) {
    return;
  }

  const endedAt = Date.now();
  const finished = session ?? {
    id: crypto.randomUUID(),
    tabId,
    domain: pending?.domain ?? "unknown",
    purpose: "Unspecified",
    status: "skipped" as const,
    startedAt: endedAt
  };

  await saveSession({
    ...finished,
    date: toDateKey(finished.startedAt),
    endedAt,
    durationMs: Math.max(0, endedAt - finished.startedAt)
  });
}

async function closeAllUnknownSessions(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const liveTabIds = new Set(tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id])));
  const stored = await chrome.storage.session.get("activeFocusSessions");
  const sessions = stored["activeFocusSessions"];

  if (typeof sessions !== "object" || sessions === null || Array.isArray(sessions)) {
    return;
  }

  for (const tabId of Object.keys(sessions).map(Number)) {
    if (!liveTabIds.has(tabId)) {
      void finishSession(tabId);
    }
  }
}

function normalizePurpose(message: PurposeResponseMessage): Pick<PurposeResponseMessage, "purpose" | "status"> {
  const trimmed = message.purpose.trim();
  return {
    purpose: trimmed || "Unspecified",
    status: message.status
  };
}

function getValidSenderTab(sender: chrome.runtime.MessageSender): { id: number; url: string } | null {
  if (sender.tab?.id === undefined || !sender.tab.url || !getDomain(sender.tab.url)) {
    return null;
  }

  return { id: sender.tab.id, url: sender.tab.url };
}

function isBackgroundMessage(message: unknown): message is BackgroundMessage {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return false;
  }

  const type = (message as { type: unknown }).type;
  return type === "focus:content-ready" || type === "focus:early-exit" || type === "focus:purpose-result";
}

function isPurposeResponseMessage(message: BackgroundMessage): message is PurposeResponseMessage {
  return (
    message.type === "focus:purpose-result" &&
    typeof message.purpose === "string" &&
    (message.status === "answered" || message.status === "skipped")
  );
}

function getDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return getBaseDomain(parsed.hostname.replace(/^www\./i, ""));
  } catch {
    return null;
  }
}

function getBaseDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);

  if (parts.length <= 2 || isIpAddress(hostname)) {
    return hostname.toLowerCase();
  }

  const last = parts.at(-1);
  const secondLast = parts.at(-2);
  const thirdLast = parts.at(-3);

  if (!last || !secondLast || !thirdLast) {
    return hostname.toLowerCase();
  }

  const commonSecondLevelDomains = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);
  if (last.length === 2 && commonSecondLevelDomains.has(secondLast)) {
    return `${thirdLast}.${secondLast}.${last}`;
  }

  return `${secondLast}.${last}`;
}

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}
