import type { FocusSession } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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

export interface DashboardTrends {
  today: TrendMetric;
  week: TrendMetric;
  domains: DomainTrend[];
}

export function getDashboardTrends(sessions: FocusSession[], todayKey: string): DashboardTrends {
  const yesterdayKey = addDays(todayKey, -1);
  const currentWeekStart = addDays(todayKey, -6);
  const previousWeekStart = addDays(todayKey, -13);
  const previousWeekEnd = addDays(todayKey, -7);
  const domains = new Map<string, DomainTrend>();
  let todayMs = 0;
  let yesterdayMs = 0;
  let currentWeekMs = 0;
  let previousWeekMs = 0;

  for (const session of sessions) {
    const durationMs = Math.max(0, session.durationMs);
    const trend = getDomainTrend(domains, session.domain);

    if (session.date === todayKey) {
      todayMs += durationMs;
      trend.todayMs += durationMs;
      trend.todayCount += 1;
      if (session.status === "early-exit") {
        trend.todayEarlyExits += 1;
      }
    }

    if (session.date === yesterdayKey) {
      yesterdayMs += durationMs;
      trend.yesterdayMs += durationMs;
    }

    if (isDateBetween(session.date, currentWeekStart, todayKey)) {
      currentWeekMs += durationMs;
      trend.currentWeekMs += durationMs;
    }

    if (isDateBetween(session.date, previousWeekStart, previousWeekEnd)) {
      previousWeekMs += durationMs;
      trend.previousWeekMs += durationMs;
    }
  }

  return {
    today: { currentMs: todayMs, previousMs: yesterdayMs },
    week: { currentMs: currentWeekMs, previousMs: previousWeekMs },
    domains: [...domains.values()]
      .filter((domain) => domain.todayMs > 0 || domain.currentWeekMs > 0 || domain.todayCount > 0)
      .sort((a, b) => b.todayMs - a.todayMs || b.currentWeekMs - a.currentWeekMs || a.domain.localeCompare(b.domain))
  };
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
