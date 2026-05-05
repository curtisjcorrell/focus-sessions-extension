import {
  addWhitelistedDomain,
  clearAllSessions,
  clearTodaySessions,
  getSessions,
  getWhitelistedDomains,
  removeWhitelistedDomain,
  toDateKey
} from "./storage.js";
import type { FocusSession } from "./types.js";

interface GroupedSession {
  domain: string;
  purpose: string;
  durationMs: number;
  count: number;
  earlyExits: number;
}

const summary = document.querySelector<HTMLParagraphElement>("#summary");
const table = document.querySelector<HTMLTableElement>("#table");
const rows = document.querySelector<HTMLTableSectionElement>("#rows");
const empty = document.querySelector<HTMLDivElement>("#empty");
const clearToday = document.querySelector<HTMLButtonElement>("#clearToday");
const clearAll = document.querySelector<HTMLButtonElement>("#clearAll");
const whitelistForm = document.querySelector<HTMLFormElement>("#whitelistForm");
const whitelistInput = document.querySelector<HTMLInputElement>("#whitelistInput");
const whitelistList = document.querySelector<HTMLUListElement>("#whitelistList");
const whitelistEmpty = document.querySelector<HTMLDivElement>("#whitelistEmpty");

clearToday?.addEventListener("click", () => {
  void clearTodaySessions().then(render);
});

clearAll?.addEventListener("click", () => {
  void clearAllSessions().then(render);
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

void render();

async function render(): Promise<void> {
  const today = toDateKey(Date.now());
  const [allSessions, whitelistedDomains] = await Promise.all([getSessions(), getWhitelistedDomains()]);
  const sessions = allSessions.filter((session) => session.date === today);
  const grouped = groupSessions(sessions);
  const totalMs = grouped.reduce((sum, item) => sum + item.durationMs, 0);
  const earlyExits = sessions.filter((session) => session.status === "early-exit").length;

  if (summary) {
    summary.textContent = sessions.length
      ? `${formatDuration(totalMs)} logged across ${sessions.length} ${sessions.length === 1 ? "event" : "events"}${
          earlyExits ? `, including ${earlyExits} early ${earlyExits === 1 ? "exit" : "exits"}` : ""
        }.`
      : "No time logged yet.";
  }

  if (!table || !rows || !empty) {
    return;
  }

  rows.replaceChildren(...grouped.map(createRow));
  table.hidden = grouped.length === 0;
  empty.hidden = grouped.length > 0;
  renderWhitelist(whitelistedDomains);
}

function groupSessions(sessions: FocusSession[]): GroupedSession[] {
  const groups = new Map<string, GroupedSession>();

  for (const session of sessions) {
    const key = `${session.domain}\n${session.purpose}`;
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
  const purpose = document.createElement("td");
  const time = document.createElement("td");
  const count = document.createElement("td");

  purpose.className = "purpose";
  time.className = "time";

  domain.textContent = group.domain;
  purpose.textContent = group.purpose;
  time.textContent = group.earlyExits === group.count ? "Early exit" : formatDuration(group.durationMs);
  count.textContent = group.earlyExits ? `${group.count} (${group.earlyExits} exit${group.earlyExits === 1 ? "" : "s"})` : String(group.count);

  row.append(domain, purpose, time, count);
  return row;
}

function renderWhitelist(domains: string[]): void {
  if (!whitelistList || !whitelistEmpty) {
    return;
  }

  whitelistList.replaceChildren(...domains.map(createWhitelistItem));
  whitelistEmpty.hidden = domains.length > 0;
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
