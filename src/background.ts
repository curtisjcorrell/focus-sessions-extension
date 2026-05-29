import {
  getActiveSession,
  getActiveSessionByDomain,
  getCategories,
  getDefaultCategoryForDomain,
  getPendingPrompt,
  hasActiveSessionId,
  isAuthExemptUrl,
  isWhitelistedDomain,
  removeActiveSession,
  saveSession,
  setDefaultCategoryForDomain,
  setActiveSession,
  setPendingPrompt,
  takePendingPrompt,
  toDateKey,
  updatePendingPrompt
} from "./storage.js";
import type { BackgroundMessage, FocusSession, PendingPrompt, PromptDetailsResponseMessage, PromptSubmitMessage } from "./types.js";

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("stats.html") });
});

chrome.runtime.onInstalled.addListener(() => {
  void closeAllUnknownSessions();
});

chrome.runtime.onStartup.addListener(() => {
  void closeAllUnknownSessions();
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  void handleNavigation(details.tabId, details.url);
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  void maybeStartSelectedSession(details.tabId, details.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void finishSession(tabId, "closed");
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  const senderTabId = sender.tab?.id;
  if (senderTabId === undefined || !isBackgroundMessage(message)) {
    return false;
  }

  if (message.type === "focus:get-prompt-details") {
    void getPromptDetails(senderTabId).then(sendResponse);
    return true;
  }

  if (message.type === "focus:prompt-submit" && isPromptSubmitMessage(message)) {
    void submitPrompt(senderTabId, message);
    return false;
  }

  if (message.type === "focus:early-exit") {
    void recordEarlyExit(senderTabId);
    return false;
  }

  return false;
});

async function handleNavigation(tabId: number, url: string): Promise<void> {
  if (isExtensionUrl(url)) {
    return;
  }

  const domain = getDomain(url);
  if (!domain) {
    return;
  }

  const pending = await getPendingPrompt(tabId);
  if (pending?.status === "selected") {
    if (domain === pending.domain || (await isAuthExemptUrl(url))) {
      return;
    }

    await takePendingPrompt(tabId);
  }

  const current = await getActiveSession(tabId);
  if (current?.domain === domain) {
    return;
  }

  if (await isWhitelistedDomain(domain)) {
    await finishSession(tabId, "navigated");
    return;
  }

  if (await isAuthExemptUrl(url)) {
    await finishSession(tabId, "navigated");
    return;
  }

  const reusable = await getActiveSessionByDomain(domain);
  if (reusable) {
    await finishSession(tabId, "navigated");
    await setActiveSession({ ...reusable, tabId });
    return;
  }

  if (pending?.status === "awaiting-selection" && pending.domain === domain) {
    await showInterstitial(tabId);
    return;
  }

  await finishSession(tabId, "navigated");
  await setPendingPrompt({
    tabId,
    status: "awaiting-selection",
    targetUrl: url,
    domain,
    startedAt: Date.now()
  });
  await showInterstitial(tabId);
}

async function showInterstitial(tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { url: chrome.runtime.getURL("prompt.html") });
}

async function getPromptDetails(tabId: number): Promise<PromptDetailsResponseMessage | null> {
  const pending = await getPendingPrompt(tabId);
  if (!pending) {
    return null;
  }

  const [categories, defaultCategory] = await Promise.all([getCategories(), getDefaultCategoryForDomain(pending.domain)]);

  const response: PromptDetailsResponseMessage = {
    domain: pending.domain,
    targetUrl: pending.targetUrl,
    categories
  };

  if (defaultCategory) {
    response.defaultCategory = defaultCategory;
  }

  return response;
}

async function submitPrompt(tabId: number, message: PromptSubmitMessage): Promise<void> {
  const pending = await getPendingPrompt(tabId);
  if (!pending) {
    return;
  }

  const category = message.category.trim();
  const note = message.note.trim();
  const selected: PendingPrompt = {
    ...pending,
    status: "selected",
    category: category || "Other",
    note,
    startedAt: Date.now()
  };

  await updatePendingPrompt(selected);
  await setDefaultCategoryForDomain(pending.domain, selected.category ?? "Other");
  await chrome.tabs.update(tabId, { url: selected.targetUrl });
}

async function maybeStartSelectedSession(tabId: number, url: string): Promise<void> {
  const pending = await getPendingPrompt(tabId);
  const domain = getDomain(url);
  if (!pending || pending.status !== "selected" || !domain || domain !== pending.domain) {
    return;
  }

  await takePendingPrompt(tabId);

  const reusable = await getActiveSessionByDomain(domain);
  if (reusable) {
    await finishSession(tabId, "navigated");
    await setActiveSession({ ...reusable, tabId });
    return;
  }

  const category = pending.category?.trim() || "Other";
  const note = pending.note?.trim() ?? "";
  const purpose = note ? `${category}: ${note}` : category;

  await setActiveSession({
    id: crypto.randomUUID(),
    tabId,
    domain,
    purpose,
    category,
    note,
    status: "answered",
    startedAt: Date.now()
  });
}

async function recordEarlyExit(tabId: number): Promise<void> {
  await saveEarlyExit(tabId);
  await chrome.tabs.remove(tabId);
}

async function finishSession(tabId: number, reason: "closed" | "navigated"): Promise<void> {
  const session = await removeActiveSession(tabId);
  const pending = session ? undefined : await takePendingPrompt(tabId);

  if (!session && !pending) {
    return;
  }

  if (session && (await hasActiveSessionId(session.id))) {
    return;
  }

  if (!session && pending && reason === "closed") {
    await saveEarlyExit(tabId, pending);
    return;
  }

  if (!session) {
    return;
  }

  const endedAt = Date.now();
  await saveSession({
    ...session,
    date: toDateKey(session.startedAt),
    endedAt,
    durationMs: Math.max(0, endedAt - session.startedAt)
  });
}

async function saveEarlyExit(tabId: number, knownPending?: PendingPrompt): Promise<void> {
  const existing = await removeActiveSession(tabId);
  const pending = knownPending ?? (existing ? undefined : await takePendingPrompt(tabId));
  const timestamp = existing?.startedAt ?? pending?.startedAt ?? Date.now();
  const category = existing?.category ?? pending?.category;
  const note = existing?.note ?? pending?.note;
  const session: FocusSession = {
    id: crypto.randomUUID(),
    tabId,
    date: toDateKey(timestamp),
    domain: existing?.domain ?? pending?.domain ?? "unknown",
    purpose: "Early Exit",
    status: "early-exit",
    startedAt: timestamp,
    endedAt: Date.now(),
    durationMs: 0
  };

  if (category) {
    session.category = category;
  }

  if (note) {
    session.note = note;
  }

  await saveSession(session);
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
      void finishSession(tabId, "closed");
    }
  }
}

function isBackgroundMessage(message: unknown): message is BackgroundMessage {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return false;
  }

  const type = (message as { type: unknown }).type;
  return type === "focus:get-prompt-details" || type === "focus:prompt-submit" || type === "focus:early-exit";
}

function isPromptSubmitMessage(message: BackgroundMessage): message is PromptSubmitMessage {
  return message.type === "focus:prompt-submit" && typeof message.category === "string" && typeof message.note === "string";
}

function isExtensionUrl(url: string): boolean {
  return url.startsWith(chrome.runtime.getURL(""));
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
