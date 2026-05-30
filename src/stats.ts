import {
  addAuthExemption,
  addCategory,
  addWhitelistedDomain,
  clearAllSessions,
  clearTodaySessions,
  getAuthExemptions,
  getCategories,
  getDailyRollups,
  getSessions,
  getWhitelistedDomains,
  removeAuthExemption,
  removeCategory,
  removeWhitelistedDomain,
  toDateKey
} from "./storage.js";
import {
  BRIEF_SESSION_THRESHOLD_MS,
  getDashboardTrends,
  isBriefSession,
  type CategoryTrend,
  type DomainTrend,
  type NotableChange,
  type TrendMetric
} from "./analytics.js";
import type { FocusSession } from "./types.js";

interface GroupedSession {
  domain: string;
  category: string;
  purpose: string;
  durationMs: number;
  count: number;
  earlyExits: number;
}

const STORAGE_SESSION_NOTICE_THRESHOLD = 5000;
const STORAGE_BYTES_NOTICE_THRESHOLD = 3 * 1024 * 1024;

const summary = document.querySelector<HTMLParagraphElement>("#summary");
const todayTotal = document.querySelector<HTMLDivElement>("#todayTotal");
const todayTrend = document.querySelector<HTMLDivElement>("#todayTrend");
const weekTotal = document.querySelector<HTMLDivElement>("#weekTotal");
const weekTrend = document.querySelector<HTMLDivElement>("#weekTrend");
const briefToday = document.querySelector<HTMLDivElement>("#briefToday");
const briefWeek = document.querySelector<HTMLDivElement>("#briefWeek");
const yesterdayRecap = document.querySelector<HTMLDivElement>("#yesterdayRecap");
const sessionCount = document.querySelector<HTMLDivElement>("#sessionCount");
const storageUsage = document.querySelector<HTMLDivElement>("#storageUsage");
const storageNotice = document.querySelector<HTMLDivElement>("#storageNotice");
const notableList = document.querySelector<HTMLUListElement>("#notableList");
const notableEmpty = document.querySelector<HTMLDivElement>("#notableEmpty");
const categoryTrendRows = document.querySelector<HTMLTableSectionElement>("#categoryTrendRows");
const categoryTrendTable = document.querySelector<HTMLTableElement>("#categoryTrendTable");
const categoryTrendEmpty = document.querySelector<HTMLDivElement>("#categoryTrendEmpty");
const domainTrendRows = document.querySelector<HTMLTableSectionElement>("#domainTrendRows");
const domainTrendTable = document.querySelector<HTMLTableElement>("#domainTrendTable");
const domainTrendEmpty = document.querySelector<HTMLDivElement>("#domainTrendEmpty");
const table = document.querySelector<HTMLTableElement>("#table");
const rows = document.querySelector<HTMLTableSectionElement>("#rows");
const empty = document.querySelector<HTMLDivElement>("#empty");
const clearToday = document.querySelector<HTMLButtonElement>("#clearToday");
const clearAll = document.querySelector<HTMLButtonElement>("#clearAll");
const exportJson = document.querySelector<HTMLButtonElement>("#exportJson");
const whitelistForm = document.querySelector<HTMLFormElement>("#whitelistForm");
const whitelistInput = document.querySelector<HTMLInputElement>("#whitelistInput");
const whitelistList = document.querySelector<HTMLUListElement>("#whitelistList");
const whitelistEmpty = document.querySelector<HTMLDivElement>("#whitelistEmpty");
const categoryForm = document.querySelector<HTMLFormElement>("#categoryForm");
const categoryInput = document.querySelector<HTMLInputElement>("#categoryInput");
const categoryList = document.querySelector<HTMLUListElement>("#categoryList");
const categoryEmpty = document.querySelector<HTMLDivElement>("#categoryEmpty");
const authForm = document.querySelector<HTMLFormElement>("#authForm");
const authInput = document.querySelector<HTMLInputElement>("#authInput");
const authList = document.querySelector<HTMLUListElement>("#authList");
const authEmpty = document.querySelector<HTMLDivElement>("#authEmpty");

clearToday?.addEventListener("click", () => {
  void clearTodaySessions().then(render);
});

clearAll?.addEventListener("click", () => {
  void clearAllSessions().then(render);
});

exportJson?.addEventListener("click", () => {
  void exportSessions();
});

whitelistForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = whitelistInput?.value ?? "";
  void addWhitelistedDomain(value).then((domain) => {
    if (domain && whitelistInput) {
      whitelistInput.value = "";
    }
    return render();
  });
});

categoryForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = categoryInput?.value ?? "";
  void addCategory(value).then((category) => {
    if (category && categoryInput) {
      categoryInput.value = "";
    }
    return render();
  });
});

authForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = authInput?.value ?? "";
  void addAuthExemption(value).then((domain) => {
    if (domain && authInput) {
      authInput.value = "";
    }
    return render();
  });
});

void render();

async function render(): Promise<void> {
  const today = toDateKey(Date.now());
  const [allSessions, whitelistedDomains, categories, authExemptions, storageBytes] = await Promise.all([
    getSessions(),
    getWhitelistedDomains(),
    getCategories(),
    getAuthExemptions(),
    getLocalStorageBytesInUse()
  ]);
  const sessions = allSessions.filter((session) => session.date === today);
  const trends = getDashboardTrends(allSessions, today);
  const grouped = groupSessions(sessions.filter((session) => !isBriefSession(session)));
  const totalMs = grouped.reduce((sum, item) => sum + item.durationMs, 0);
  const earlyExits = sessions.filter((session) => session.status === "early-exit").length;
  const countedEvents = sessions.length - trends.briefTodayCount;

  if (summary) {
    summary.textContent = countedEvents
      ? `${formatDuration(totalMs)} logged across ${countedEvents} ${countedEvents === 1 ? "event" : "events"}${
          earlyExits ? `, including ${earlyExits} early ${earlyExits === 1 ? "exit" : "exits"}` : ""
        }${trends.briefTodayCount ? `, with ${trends.briefTodayCount} brief ${trends.briefTodayCount === 1 ? "visit" : "visits"} ignored` : ""}.`
      : trends.briefTodayCount
        ? `No time logged yet; ${trends.briefTodayCount} brief ${trends.briefTodayCount === 1 ? "visit was" : "visits were"} ignored.`
      : "No time logged yet.";
  }

  if (!table || !rows || !empty) {
    return;
  }

  rows.replaceChildren(...grouped.map(createRow));
  table.hidden = grouped.length === 0;
  empty.hidden = grouped.length > 0;
  renderTrends(trends);
  renderYesterdayRecap(trends.yesterday);
  renderStorageHealth(allSessions.length, storageBytes);
  renderNotableChanges(trends.notableChanges);
  renderCategoryTrends(trends.categories);
  renderWhitelist(whitelistedDomains);
  renderCategories(categories);
  renderAuthExemptions(authExemptions);
}

function renderStorageHealth(sessions: number, bytesInUse: number | null): void {
  if (sessionCount) {
    sessionCount.textContent = sessions.toLocaleString();
  }

  if (storageUsage) {
    storageUsage.textContent = bytesInUse === null ? "Unknown" : formatBytes(bytesInUse);
  }

  if (!storageNotice) {
    return;
  }

  const overSessionThreshold = sessions >= STORAGE_SESSION_NOTICE_THRESHOLD;
  const overStorageThreshold = bytesInUse !== null && bytesInUse >= STORAGE_BYTES_NOTICE_THRESHOLD;

  storageNotice.hidden = !overSessionThreshold && !overStorageThreshold;
  if (!storageNotice.hidden) {
    storageNotice.textContent =
      "Storage is getting large. If the dashboard starts feeling slow, the next levers are daily aggregates and background config caching.";
  }
}

function renderTrends(trends: ReturnType<typeof getDashboardTrends>): void {
  if (todayTotal) {
    todayTotal.textContent = formatDuration(trends.today.currentMs);
  }

  if (todayTrend) {
    todayTrend.textContent = formatTrend(trends.today, "yesterday");
  }

  if (weekTotal) {
    weekTotal.textContent = formatDuration(trends.week.currentMs);
  }

  if (weekTrend) {
    weekTrend.textContent = formatTrend(trends.week, "previous 7 days");
  }

  if (briefToday) {
    briefToday.textContent = formatBriefCount(trends.briefTodayCount);
  }

  if (briefWeek) {
    briefWeek.textContent = formatBriefCount(trends.briefWeekCount);
  }

  if (!domainTrendRows || !domainTrendTable || !domainTrendEmpty) {
    return;
  }

  domainTrendRows.replaceChildren(...trends.domains.map(createDomainTrendRow));
  domainTrendTable.hidden = trends.domains.length === 0;
  domainTrendEmpty.hidden = trends.domains.length > 0;
}

function renderYesterdayRecap(recap: ReturnType<typeof getDashboardTrends>["yesterday"]): void {
  if (!yesterdayRecap) {
    return;
  }

  if (recap.sessionCount === 0 && recap.briefCount === 0) {
    yesterdayRecap.textContent = "No recap available for yesterday.";
    return;
  }

  const parts = [
    `${formatDuration(recap.totalMs)} logged`,
    `${recap.sessionCount} ${recap.sessionCount === 1 ? "event" : "events"}`
  ];

  if (recap.topDomain) {
    parts.push(`top domain ${recap.topDomain}`);
  }

  if (recap.topCategory) {
    parts.push(`top category ${recap.topCategory}`);
  }

  if (recap.earlyExits) {
    parts.push(`${recap.earlyExits} early ${recap.earlyExits === 1 ? "exit" : "exits"}`);
  }

  if (recap.briefCount) {
    parts.push(`${recap.briefCount} brief ${recap.briefCount === 1 ? "visit" : "visits"} ignored`);
  }

  yesterdayRecap.textContent = parts.join(" | ");
}

function renderNotableChanges(changes: NotableChange[]): void {
  if (!notableList || !notableEmpty) {
    return;
  }

  notableList.replaceChildren(...changes.map(createNotableChangeItem));
  notableEmpty.hidden = changes.length > 0;
}

function renderCategoryTrends(categories: CategoryTrend[]): void {
  if (!categoryTrendRows || !categoryTrendTable || !categoryTrendEmpty) {
    return;
  }

  categoryTrendRows.replaceChildren(...categories.map(createCategoryTrendRow));
  categoryTrendTable.hidden = categories.length === 0;
  categoryTrendEmpty.hidden = categories.length > 0;
}

function groupSessions(sessions: FocusSession[]): GroupedSession[] {
  const groups = new Map<string, GroupedSession>();

  for (const session of sessions) {
    const category = session.category ?? getLegacyCategory(session);
    const key = `${session.domain}\n${category}\n${session.purpose}`;
    const current = groups.get(key);

    if (current) {
      current.durationMs += session.durationMs;
      current.count += 1;
      if (session.status === "early-exit") {
        current.earlyExits += 1;
      }
    } else {
      groups.set(key, {
        domain: session.domain,
        category,
        purpose: session.purpose,
        durationMs: session.durationMs,
        count: 1,
        earlyExits: session.status === "early-exit" ? 1 : 0
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.durationMs - a.durationMs || b.earlyExits - a.earlyExits);
}

function createRow(group: GroupedSession): HTMLTableRowElement {
  const row = document.createElement("tr");
  const domain = document.createElement("td");
  const category = document.createElement("td");
  const purpose = document.createElement("td");
  const time = document.createElement("td");
  const count = document.createElement("td");

  purpose.className = "purpose";
  time.className = "time";

  domain.textContent = group.domain;
  category.textContent = group.category;
  purpose.textContent = group.purpose;
  time.textContent = group.earlyExits === group.count ? "Early exit" : formatDuration(group.durationMs);
  count.textContent = group.earlyExits ? `${group.count} (${group.earlyExits} exit${group.earlyExits === 1 ? "" : "s"})` : String(group.count);

  row.append(domain, category, purpose, time, count);
  return row;
}

function createDomainTrendRow(trend: DomainTrend): HTMLTableRowElement {
  const row = document.createElement("tr");
  const domain = document.createElement("td");
  const today = document.createElement("td");
  const dayTrend = document.createElement("td");
  const week = document.createElement("td");
  const weekTrend = document.createElement("td");
  const events = document.createElement("td");

  today.className = "time";
  week.className = "time";
  dayTrend.className = "trend";
  weekTrend.className = "trend";

  domain.textContent = trend.domain;
  today.textContent = formatDuration(trend.todayMs);
  dayTrend.textContent = formatTrend({ currentMs: trend.todayMs, previousMs: trend.yesterdayMs }, "yesterday");
  week.textContent = formatDuration(trend.currentWeekMs);
  weekTrend.textContent = formatTrend({ currentMs: trend.currentWeekMs, previousMs: trend.previousWeekMs }, "previous 7 days");
  events.textContent = trend.todayEarlyExits
    ? `${trend.todayCount} (${trend.todayEarlyExits} exit${trend.todayEarlyExits === 1 ? "" : "s"})`
    : String(trend.todayCount);

  row.append(domain, today, dayTrend, week, weekTrend, events);
  return row;
}

function createCategoryTrendRow(trend: CategoryTrend): HTMLTableRowElement {
  const row = document.createElement("tr");
  const category = document.createElement("td");
  const today = document.createElement("td");
  const dayTrend = document.createElement("td");
  const week = document.createElement("td");
  const weekTrend = document.createElement("td");
  const events = document.createElement("td");

  today.className = "time";
  week.className = "time";
  dayTrend.className = "trend";
  weekTrend.className = "trend";

  category.textContent = trend.category;
  today.textContent = formatDuration(trend.todayMs);
  dayTrend.textContent = formatTrend({ currentMs: trend.todayMs, previousMs: trend.yesterdayMs }, "yesterday");
  week.textContent = formatDuration(trend.currentWeekMs);
  weekTrend.textContent = formatTrend({ currentMs: trend.currentWeekMs, previousMs: trend.previousWeekMs }, "previous 7 days");
  events.textContent = String(trend.todayCount);

  row.append(category, today, dayTrend, week, weekTrend, events);
  return row;
}

function createNotableChangeItem(change: NotableChange): HTMLLIElement {
  const item = document.createElement("li");
  const label = document.createElement("span");
  const detail = document.createElement("strong");
  const time = document.createElement("span");

  label.textContent = change.label;
  detail.textContent = change.detail;
  time.textContent = formatSignedDuration(change.deltaMs);

  item.append(label, detail, time);
  return item;
}

function renderWhitelist(domains: string[]): void {
  if (!whitelistList || !whitelistEmpty) {
    return;
  }

  whitelistList.replaceChildren(...domains.map(createWhitelistItem));
  whitelistEmpty.hidden = domains.length > 0;
}

function renderCategories(categories: string[]): void {
  if (!categoryList || !categoryEmpty) {
    return;
  }

  categoryList.replaceChildren(...categories.map(createCategoryItem));
  categoryEmpty.hidden = categories.length > 0;
}

function renderAuthExemptions(exemptions: string[]): void {
  if (!authList || !authEmpty) {
    return;
  }

  authList.replaceChildren(...exemptions.map(createAuthExemptionItem));
  authEmpty.hidden = exemptions.length > 0;
}

function createCategoryItem(category: string): HTMLLIElement {
  const item = document.createElement("li");
  const label = document.createElement("span");
  const remove = document.createElement("button");

  item.className = "whitelist-item";
  label.textContent = category;
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    void removeCategory(category).then(render);
  });

  item.append(label, remove);
  return item;
}

function createWhitelistItem(domain: string): HTMLLIElement {
  const item = document.createElement("li");
  const label = document.createElement("span");
  const remove = document.createElement("button");

  item.className = "whitelist-item";
  label.textContent = domain;
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    void removeWhitelistedDomain(domain).then(render);
  });

  item.append(label, remove);
  return item;
}

function createAuthExemptionItem(exemption: string): HTMLLIElement {
  const item = document.createElement("li");
  const label = document.createElement("span");
  const remove = document.createElement("button");

  item.className = "whitelist-item";
  label.textContent = exemption;
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    void removeAuthExemption(exemption).then(render);
  });

  item.append(label, remove);
  return item;
}

async function exportSessions(): Promise<void> {
  const [sessions, dailyRollups] = await Promise.all([getSessions(), getDailyRollups()]);
  const blob = new Blob([JSON.stringify({ sessions, dailyRollups }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `focus-sessions-${toDateKey(Date.now())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getLegacyCategory(session: FocusSession): string {
  if (session.status === "early-exit") {
    return "Early Exit";
  }

  return session.purpose === "Unspecified" ? "Unspecified" : "Other";
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatTrend(metric: TrendMetric, label: string): string {
  const deltaMs = metric.currentMs - metric.previousMs;

  if (metric.currentMs === 0 && metric.previousMs === 0) {
    return `No ${label} data`;
  }

  if (metric.previousMs === 0) {
    return metric.currentMs > 0 ? `New vs ${label}` : `Down ${formatDuration(Math.abs(deltaMs))} vs ${label}`;
  }

  const direction = deltaMs >= 0 ? "Up" : "Down";
  const percent = Math.round((Math.abs(deltaMs) / metric.previousMs) * 100);
  return `${direction} ${percent}% vs ${label}`;
}

function formatBriefCount(count: number): string {
  const seconds = Math.round(BRIEF_SESSION_THRESHOLD_MS / 1000);
  return count ? `${count} under ${seconds}s ignored` : `No visits under ${seconds}s`;
}

function formatSignedDuration(durationMs: number): string {
  const sign = durationMs >= 0 ? "+" : "-";
  return `${sign}${formatDuration(Math.abs(durationMs))}`;
}

async function getLocalStorageBytesInUse(): Promise<number | null> {
  try {
    return await chrome.storage.local.getBytesInUse(null);
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}
