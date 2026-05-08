let activeOverlay: HTMLElement | null = null;
let activeKeyboardController: AbortController | null = null;
const PROMPT_DRAFTS_KEY = "focusPromptDrafts";

interface PurposeRequestMessage {
  type: "focus:get-purpose";
  domain: string;
}

interface PurposeResponseMessage {
  type: "focus:purpose-result";
  purpose: string;
  status: "answered" | "skipped";
}

interface EarlyExitMessage {
  type: "focus:early-exit";
}

chrome.runtime.onMessage.addListener((message: PurposeRequestMessage) => {
  if (message.type !== "focus:get-purpose") {
    return;
  }

  showPrompt(message.domain);
});

void chrome.runtime.sendMessage({ type: "focus:content-ready" });

function showPrompt(domain: string): void {
  activeOverlay?.remove();

  const host = document.createElement("div");
  host.id = "focus-session-prompt";
  activeOverlay = host;

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.append(createStyles(), createDialog(domain));
  document.documentElement.append(host);
  trapPageKeyboard();

  const input = shadow.querySelector<HTMLInputElement>("textarea");
  if (input) {
    void getDraft(domain).then((draft) => {
      if (activeOverlay === host) {
        input.value = draft;
      }
    });
  }
  input?.focus();
}

function createDialog(domain: string): HTMLElement {
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";

  const panel = document.createElement("form");
  panel.className = "panel";

  const title = document.createElement("h1");
  title.textContent = "What are you planning on using this site for this session?";

  const domainText = document.createElement("p");
  domainText.className = "domain";
  domainText.textContent = domain;

  const input = document.createElement("textarea");
  input.name = "purpose";
  input.rows = 3;
  input.maxLength = 240;
  input.placeholder = "Example: Research a client issue, answer messages, find a reference...";
  input.addEventListener("input", () => {
    void setDraft(domain, input.value);
  });

  const actions = document.createElement("div");
  actions.className = "actions";

  const exit = document.createElement("button");
  exit.type = "button";
  exit.className = "danger";
  exit.textContent = "Exit instead";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "Start session";

  actions.append(exit, submit);
  panel.append(title, domainText, input, actions);
  backdrop.append(panel);

  backdrop.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  backdrop.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  backdrop.addEventListener("keydown", (event) => {
    event.stopPropagation();

    if (event.key === "Tab") {
      trapTab(event, panel);
      return;
    }

    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      void clearDraft(domain);
      sendResult({
        type: "focus:purpose-result",
        purpose: input.value,
        status: input.value.trim() ? "answered" : "skipped"
      });
    }
  });

  for (const eventName of ["keyup", "keypress", "beforeinput", "input"]) {
    backdrop.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  }

  exit.addEventListener("click", () => {
    void clearDraft(domain);
    sendEarlyExit({ type: "focus:early-exit" });
  });

  panel.addEventListener("submit", (event) => {
    event.preventDefault();
    void clearDraft(domain);
    sendResult({
      type: "focus:purpose-result",
      purpose: input.value,
      status: input.value.trim() ? "answered" : "skipped"
    });
  });

  return backdrop;
}

async function getDraft(domain: string): Promise<string> {
  const drafts = await getDraftMap();
  return drafts[getDraftKey(domain)] ?? "";
}

async function setDraft(domain: string, value: string): Promise<void> {
  const drafts = await getDraftMap();
  const key = getDraftKey(domain);

  if (value) {
    drafts[key] = value;
  } else {
    delete drafts[key];
  }

  await chrome.storage.session.set({ [PROMPT_DRAFTS_KEY]: drafts });
}

async function clearDraft(domain: string): Promise<void> {
  const drafts = await getDraftMap();
  delete drafts[getDraftKey(domain)];
  await chrome.storage.session.set({ [PROMPT_DRAFTS_KEY]: drafts });
}

async function getDraftMap(): Promise<Record<string, string>> {
  const result = await chrome.storage.session.get(PROMPT_DRAFTS_KEY);
  const drafts = result[PROMPT_DRAFTS_KEY];
  return typeof drafts === "object" && drafts !== null && !Array.isArray(drafts)
    ? (drafts as Record<string, string>)
    : {};
}

function getDraftKey(domain: string): string {
  return domain;
}

function sendResult(message: PurposeResponseMessage): void {
  closeOverlay();
  void chrome.runtime.sendMessage(message);
}

function sendEarlyExit(message: EarlyExitMessage): void {
  closeOverlay();
  void chrome.runtime.sendMessage(message);
}

function closeOverlay(): void {
  activeKeyboardController?.abort();
  activeKeyboardController = null;
  activeOverlay?.remove();
  activeOverlay = null;
}

function trapPageKeyboard(): void {
  activeKeyboardController?.abort();
  activeKeyboardController = new AbortController();

  for (const eventName of ["keydown", "keyup", "keypress", "beforeinput", "input"]) {
    window.addEventListener(
      eventName,
      (event) => {
        if (!activeOverlay) {
          return;
        }

        const path = event.composedPath();
        if (path.includes(activeOverlay)) {
          return;
        }

        event.stopImmediatePropagation();
        event.preventDefault();
      },
      { capture: true, signal: activeKeyboardController.signal }
    );
  }
}

function trapTab(event: KeyboardEvent, panel: HTMLElement): void {
  const controls = Array.from(panel.querySelectorAll<HTMLElement>("textarea, button")).filter(
    (control) => !control.hasAttribute("disabled")
  );

  if (!controls.length) {
    return;
  }

  const first = controls[0];
  const last = controls[controls.length - 1];

  if (!first || !last) {
    return;
  }

  const root = panel.getRootNode();
  const activeElement = root instanceof ShadowRoot ? root.activeElement : document.activeElement;

  if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function createStyles(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: grid;
      place-items: center;
      background: #f8fafc;
    }

    .panel {
      box-sizing: border-box;
      width: min(520px, calc(100vw - 32px));
      padding: 22px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.28);
    }

    h1 {
      margin: 0;
      color: #111827;
      font-size: 20px;
      line-height: 1.3;
      font-weight: 700;
      letter-spacing: 0;
    }

    .domain {
      margin: 8px 0 16px;
      color: #4b5563;
      font-size: 14px;
      line-height: 1.4;
    }

    textarea {
      box-sizing: border-box;
      width: 100%;
      resize: vertical;
      min-height: 88px;
      padding: 10px 12px;
      border: 1px solid #9ca3af;
      border-radius: 6px;
      color: #111827;
      background: #ffffff;
      font: inherit;
      font-size: 14px;
      line-height: 1.4;
      outline: none;
    }

    textarea:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 16px;
    }

    button {
      box-sizing: border-box;
      min-height: 38px;
      padding: 8px 13px;
      border-radius: 6px;
      font: inherit;
      font-size: 14px;
      font-weight: 650;
      cursor: pointer;
    }

    .secondary {
      border: 1px solid #d1d5db;
      color: #374151;
      background: #ffffff;
    }

    .primary {
      border: 1px solid #1d4ed8;
      color: #ffffff;
      background: #2563eb;
    }

    .danger {
      border: 1px solid #dc2626;
      color: #ffffff;
      background: #dc2626;
    }
  `;
  return style;
}
