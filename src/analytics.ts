import type { FocusSession } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTABLE_DELTA_MS = 10 * 60 * 1000;
const NOTABLE_PERCENT = 50;

export const BRIEF_SESSION_THRESHOLD_MS = 10 * 1000;

export interface TrendMetric {
  currentMs: number;
  previousMs: number;
}

export interface DomainTrend {
  domain: string;
  todayMs: number;
  yesterdayMs: number;
  currentWeekMs: number;
  previousWeekMs: number;
  todayCount: number;
  todayEarlyExits: number;
}

export interface CategoryTrend {
  category: string;
  todayMs: number;
  yesterdayMs: number;
  currentWeekMs: number;
  previousWeekMs: number;
  todayCount: number;
}

export interface NotableChange {
  label: string;
  detail: string;
  deltaMs: number;
}

export interface YesterdayRecap {
  totalMs: number;
  sessionCount: number;
  earlyExits: number;
  briefCount: number;
  topDomain?: string;
  topCategory?: string;
}

export interface DashboardTrends {
  today: TrendMetric;
  week: TrendMetric;
  domains: DomainTrend[];
  categories: CategoryTrend[];
  notableChanges: NotableChange[];
  yesterday: YesterdayRecap;
  briefTodayCount: number;
  briefWeekCount: number;
}

export function getDashboardTrends(sessions: FocusSession[], todayKey: string): DashboardTrends {
  const yesterdayKey = addDays(todayKey, -1);
  const currentWeekStart = addDays(todayKey, -6);
  const previousWeekStart = addDays(todayKey, -13);
  const previousWeekEnd = addDays(todayKey, -7);
  const domains = new Map<string, DomainTrend>();
  const categories = new Map<string, CategoryTrend>();
  const yesterdayDomains = new Map<string, number>();
  const yesterdayCategories = new Map<string, number>();
  let todayMs = 0;
  let yesterdayMs = 0;
  let currentWeekMs = 0;
  let previousWeekMs = 0;
  let briefTodayCount = 0;
  let briefWeekCount = 0;
  let yesterdaySessionCount = 0;
  let yesterdayEarlyExits = 0;
  let yesterdayBriefCount = 0;

  for (const session of sessions) {
    const isBrief = isBriefSession(session);
    const durationMs = Math.max(0, session.durationMs);
    const trend = getDomainTrend(domains, session.domain);
    const categoryTrend = getCategoryTrend(categories, getSessionCategory(session));

    if (session.date === todayKey) {
      if (isBrief) {
        briefTodayCount += 1;
      } else {
        todayMs += durationMs;
        trend.todayMs += durationMs;
        trend.todayCount += 1;
        categoryTrend.todayMs += durationMs;
        categoryTrend.todayCount += 1;
        if (session.status === "early-exit") {
          trend.todayEarlyExits += 1;
        }
      }
    }

    if (session.date === yesterdayKey) {
      if (isBrief) {
        yesterdayBriefCount += 1;
      } else {
        yesterdayMs += durationMs;
        trend.yesterdayMs += durationMs;
        categoryTrend.yesterdayMs += durationMs;
        addToMap(yesterdayDomains, session.domain, durationMs);
        addToMap(yesterdayCategories, categoryTrend.category, durationMs);
        yesterdaySessionCount += 1;
        if (session.status === "early-exit") {
          yesterdayEarlyExits += 1;
        }
      }
    }

    if (isDateBetween(session.date, currentWeekStart, todayKey)) {
      if (isBrief) {
        briefWeekCount += 1;
      } else {
        currentWeekMs += durationMs;
        trend.currentWeekMs += durationMs;
        categoryTrend.currentWeekMs += durationMs;
      }
    }

    if (isDateBetween(session.date, previousWeekStart, previousWeekEnd)) {
      if (!isBrief) {
        previousWeekMs += durationMs;
        trend.previousWeekMs += durationMs;
        categoryTrend.previousWeekMs += durationMs;
      }
    }
  }

  const allDomainTrends = [...domains.values()];
  const allCategoryTrends = [...categories.values()];
  const domainTrends = allDomainTrends
    .filter((domain) => domain.todayMs > 0 || domain.currentWeekMs > 0 || domain.todayCount > 0)
    .sort((a, b) => b.todayMs - a.todayMs || b.currentWeekMs - a.currentWeekMs || a.domain.localeCompare(b.domain));
  const categoryTrends = allCategoryTrends
    .filter((category) => category.todayMs > 0 || category.currentWeekMs > 0 || category.todayCount > 0)
    .sort((a, b) => b.todayMs - a.todayMs || b.currentWeekMs - a.currentWeekMs || a.category.localeCompare(b.category));

  const yesterday: YesterdayRecap = {
    totalMs: yesterdayMs,
    sessionCount: yesterdaySessionCount,
    earlyExits: yesterdayEarlyExits,
    briefCount: yesterdayBriefCount
  };
  const topDomain = getTopEntry(yesterdayDomains);
  const topCategory = getTopEntry(yesterdayCategories);

  if (topDomain) {
    yesterday.topDomain = topDomain;
  }

  if (topCategory) {
    yesterday.topCategory = topCategory;
  }

  return {
    today: { currentMs: todayMs, previousMs: yesterdayMs },
    week: { currentMs: currentWeekMs, previousMs: previousWeekMs },
    domains: domainTrends,
    categories: categoryTrends,
    notableChanges: getNotableChanges(allDomainTrends, allCategoryTrends),
    yesterday,
    briefTodayCount,
    briefWeekCount
  };
}

export function isBriefSession(session: FocusSession): boolean {
  return session.status !== "early-exit" && session.durationMs > 0 && session.durationMs < BRIEF_SESSION_THRESHOLD_MS;
}

function getDomainTrend(domains: Map<string, DomainTrend>, domain: string): DomainTrend {
  const existing = domains.get(domain);
  if (existing) {
    return existing;
  }

  const trend = {
    domain,
    todayMs: 0,
    yesterdayMs: 0,
    currentWeekMs: 0,
    previousWeekMs: 0,
    todayCount: 0,
    todayEarlyExits: 0
  };
  domains.set(domain, trend);
  return trend;
}

function getCategoryTrend(categories: Map<string, CategoryTrend>, category: string): CategoryTrend {
  const existing = categories.get(category);
  if (existing) {
    return existing;
  }

  const trend = {
    category,
    todayMs: 0,
    yesterdayMs: 0,
    currentWeekMs: 0,
    previousWeekMs: 0,
    todayCount: 0
  };
  categories.set(category, trend);
  return trend;
}

function getSessionCategory(session: FocusSession): string {
  if (session.category) {
    return session.category;
  }

  if (session.status === "early-exit") {
    return "Early Exit";
  }

  return session.purpose === "Unspecified" ? "Unspecified" : "Other";
}

function getNotableChanges(domains: DomainTrend[], categories: CategoryTrend[]): NotableChange[] {
  const domainChanges = domains.flatMap((trend) =>
    createNotableChange(trend.domain, trend.todayMs, trend.yesterdayMs, "vs yesterday")
  );
  const categoryChanges = categories.flatMap((trend) =>
    createNotableChange(trend.category, trend.currentWeekMs, trend.previousWeekMs, "vs previous 7 days")
  );

  return [...domainChanges, ...categoryChanges].sort((a, b) => Math.abs(b.deltaMs) - Math.abs(a.deltaMs)).slice(0, 4);
}

function createNotableChange(label: string, currentMs: number, previousMs: number, comparison: string): NotableChange[] {
  const deltaMs = currentMs - previousMs;
  const absoluteDelta = Math.abs(deltaMs);
  const percent = previousMs === 0 ? 100 : Math.round((absoluteDelta / previousMs) * 100);

  if (absoluteDelta < NOTABLE_DELTA_MS || percent < NOTABLE_PERCENT) {
    return [];
  }

  const direction = deltaMs >= 0 ? "Up" : "Down";
  return [{ label, detail: `${direction} ${percent}% ${comparison}`, deltaMs }];
}

function addToMap(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

function getTopEntry(map: Map<string, number>): string | undefined {
  let topKey: string | undefined;
  let topValue = 0;

  for (const [key, value] of map) {
    if (value > topValue) {
      topKey = key;
      topValue = value;
    }
  }

  return topKey;
}

function isDateBetween(dateKey: string, startKey: string, endKey: string): boolean {
  return dateKey >= startKey && dateKey <= endKey;
}

function addDays(dateKey: string, offset: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  date.setTime(date.getTime() + offset * DAY_MS);
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
