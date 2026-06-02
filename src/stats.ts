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
  type NotableChange,
  type TrendMetric
} from "./analytics.js";
import type { DailyRollup, DailyRollupBucket, FocusSession } from "./types.js";

interface GroupedSession {
  domain: string;
  category: string;
  purpose: string;
  durationMs: number;
  count: number;
  earlyExits: number;
}

interface BucketRow {
  label: string;
  durationMs: number;
  sessions: number;
  earlyExits: number;
}

interface ChartDay {
  date: string;
  totalMs: number;
  categories: Record<string, DailyRollupBucket>;
}

const STORAGE_SESSION_NOTICE_THRESHOLD = 5000;
const STORAGE_BYTES_NOTICE_THRESHOLD = 3 * 1024 * 1024;
const CATEGORY_CHART_DAYS = 14;
const FALLBACK_CHART_COLOR = "#2563eb";
const CHART_COLORS = [FALLBACK_CHART_COLOR, "#16a34a", "#dc2626", "#9333ea", "#d97706", "#0891b2", "#be123c", "#4f46e5"];

const summary = document.querySelector<HTMLParagraphElement>("#summary");
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>(".tab-panel"));
const analyticsDate = document.querySelector<HTMLInputElement>("#analyticsDate");
const selectedDateSummary = document.querySelector<HTMLParagraphElement>("#selectedDateSummary");
const selectedCategoryRows = document.querySelector<HTMLTableSectionElement>("#selectedCategoryRows");
const selectedCategoryTable = document.querySelector<HTMLTableElement>("#selectedCategoryTable");
const selectedCategoryEmpty = document.querySelector<HTMLDivElement>("#selectedCategoryEmpty");
const selectedDomainRows = document.querySelector<HTMLTableSectionElement>("#selectedDomainRows");
const selectedDomainTable = document.querySelector<HTMLTableElement>("#selectedDomainTable");
const selectedDomainEmpty = document.querySelector<HTMLDivElement>("#selectedDomainEmpty");
const categoryChart = document.querySelector<HTMLDivElement>("#categoryChart");
const categoryChartEmpty = document.querySelector<HTMLDivElement>("#categoryChartEmpty");
const categoryChartLegend = document.querySelector<HTMLDivElement>("#categoryChartLegend");
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

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;
    if (tab) {
      activateTab(tab);
    }
  });
});

analyticsDate?.addEventListener("change", () => {
  void render();
});

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
  const yesterday = addDays(today, -1);
  const [allSessions, dailyRollups, whitelistedDomains, categories, authExemptions, storageBytes] = await Promise.all([
    getSessions(),
    getDailyRollups(),
    getWhitelistedDomains(),
    getCategories(),
    getAuthExemptions(),
    getLocalStorageBytesInUse()
  ]);
  const selectedDate = getSelectedDate(yesterday);
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
  renderSelectedDate(dailyRollups, selectedDate);
  renderCategoryChart(dailyRollups, selectedDate);
  renderTrends(trends);
  renderYesterdayRecap(trends.yesterday);
  renderStorageHealth(allSessions.length, storageBytes);
  renderNotableChanges(trends.notableChanges);
  renderWhitelist(whitelistedDomains);
  renderCategories(categories);
  renderAuthExemptions(authExemptions);
}

function activateTab(tab: string): void {
  tabButtons.forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
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

function renderSelectedDate(rollups: Record<string, DailyRollup>, selectedDate: string): void {
  const rollup = rollups[selectedDate];
  const categoryRows = bucketRows(rollup?.byCategory ?? {});
  const domainRows = bucketRows(rollup?.byDomain ?? {});

  if (selectedDateSummary) {
    selectedDateSummary.textContent = rollup
      ? `${formatDateLabel(selectedDate)}: ${formatDuration(rollup.durationMs)} across ${rollup.sessions} ${
          rollup.sessions === 1 ? "session" : "sessions"
        }${rollup.earlyExits ? `, including ${rollup.earlyExits} early ${rollup.earlyExits === 1 ? "exit" : "exits"}` : ""}.`
      : `${formatDateLabel(selectedDate)}: no time logged.`;
  }

  renderBucketTable(categoryRows, selectedCategoryRows, selectedCategoryTable, selectedCategoryEmpty);
  renderBucketTable(domainRows, selectedDomainRows, selectedDomainTable, selectedDomainEmpty);
}

function renderBucketTable(
  bucketRows: BucketRow[],
  rowsElement: HTMLTableSectionElement | null,
  tableElement: HTMLTableElement | null,
  emptyElement: HTMLDivElement | null
): void {
  if (!rowsElement || !tableElement || !emptyElement) {
    return;
  }

  rowsElement.replaceChildren(...bucketRows.map(createBucketRow));
  tableElement.hidden = bucketRows.length === 0;
  emptyElement.hidden = bucketRows.length > 0;
}

function renderCategoryChart(rollups: Record<string, DailyRollup>, selectedDate: string): void {
  if (!categoryChart || !categoryChartEmpty || !categoryChartLegend) {
    return;
  }

  const days = getChartDays(rollups, selectedDate);
  const categories = getChartCategories(days);
  const maxDurationMs = Math.max(...days.map((day) => day.totalMs), 0);

  categoryChart.replaceChildren();
  categoryChartLegend.replaceChildren();

  if (categories.length === 0 || maxDurationMs === 0) {
    categoryChart.hidden = true;
    categoryChartEmpty.hidden = false;
    return;
  }

  const colorMap = getCategoryColors(categories);
  categoryChart.replaceChildren(...days.map((day) => createChartRow(day, categories, colorMap, maxDurationMs)));
  categoryChartLegend.replaceChildren(...categories.map((category) => createLegendItem(category, colorMap.get(category) ?? FALLBACK_CHART_COLOR)));
  categoryChart.hidden = false;
  categoryChartEmpty.hidden = true;
}

function bucketRows(buckets: Record<string, DailyRollupBucket>): BucketRow[] {
  return Object.entries(buckets)
    .map(([label, bucket]) => ({
      label,
      durationMs: bucket.durationMs,
      sessions: bucket.sessions,
      earlyExits: bucket.earlyExits
    }))
    .sort((a, b) => b.durationMs - a.durationMs || b.sessions - a.sessions || a.label.localeCompare(b.label));
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

function createBucketRow(bucket: BucketRow): HTMLTableRowElement {
  const row = document.createElement("tr");
  const label = document.createElement("td");
  const time = document.createElement("td");
  const sessions = document.createElement("td");
  const earlyExits = document.createElement("td");

  time.className = "time";
  label.textContent = bucket.label;
  time.textContent = formatDuration(bucket.durationMs);
  sessions.textContent = String(bucket.sessions);
  earlyExits.textContent = bucket.earlyExits ? String(bucket.earlyExits) : "-";

  row.append(label, time, sessions, earlyExits);
  return row;
}

function getSelectedDate(defaultDate: string): string {
  if (!analyticsDate) {
    return defaultDate;
  }

  if (!analyticsDate.value) {
    analyticsDate.value = defaultDate;
  }

  return analyticsDate.value;
}

function getChartDays(rollups: Record<string, DailyRollup>, selectedDate: string): ChartDay[] {
  return Array.from({ length: CATEGORY_CHART_DAYS }, (_, index) => {
    const date = addDays(selectedDate, index - CATEGORY_CHART_DAYS + 1);
    const rollup = rollups[date];
    return {
      date,
      totalMs: rollup?.durationMs ?? 0,
      categories: rollup?.byCategory ?? {}
    };
  });
}

function getChartCategories(days: ChartDay[]): string[] {
  const totals = new Map<string, number>();

  for (const day of days) {
    for (const [category, bucket] of Object.entries(day.categories)) {
      totals.set(category, (totals.get(category) ?? 0) + bucket.durationMs);
    }
  }

  return [...totals.entries()]
    .filter(([, durationMs]) => durationMs > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category]) => category);
}

function getCategoryColors(categories: string[]): Map<string, string> {
  return new Map(categories.map((category, index) => [category, CHART_COLORS[index % CHART_COLORS.length] ?? FALLBACK_CHART_COLOR]));
}

function createChartRow(day: ChartDay, categories: string[], colorMap: Map<string, string>, maxDurationMs: number): HTMLDivElement {
  const row = document.createElement("div");
  const label = document.createElement("span");
  const bar = document.createElement("div");
  const total = document.createElement("span");

  row.className = "chart-row";
  label.className = "chart-label";
  bar.className = "chart-bar";
  total.className = "chart-total";
  label.textContent = formatShortDate(day.date);
  total.textContent = day.totalMs > 0 ? formatDuration(day.totalMs) : "-";

  bar.replaceChildren(...categories.map((category) => createChartSegment(category, day, colorMap, maxDurationMs)));
  row.append(label, bar, total);
  return row;
}

function createChartSegment(category: string, day: ChartDay, colorMap: Map<string, string>, maxDurationMs: number): HTMLSpanElement {
  const segment = document.createElement("span");
  const durationMs = day.categories[category]?.durationMs ?? 0;

  segment.className = "chart-segment";
  segment.hidden = durationMs === 0;
  segment.style.width = `${Math.max((durationMs / maxDurationMs) * 100, 0)}%`;
  segment.style.background = colorMap.get(category) ?? FALLBACK_CHART_COLOR;
  segment.title = `${category}: ${formatDuration(durationMs)}`;
  return segment;
}

function createLegendItem(category: string, color: string): HTMLSpanElement {
  const item = document.createElement("span");
  const swatch = document.createElement("span");
  const label = document.createElement("span");

  item.className = "legend-item";
  swatch.className = "legend-swatch";
  swatch.style.background = color;
  label.textContent = category;
  item.append(swatch, label);
  return item;
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

function addDays(dateKey: string, offset: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + offset);
  return toDateKey(date.getTime());
}

function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatShortDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
