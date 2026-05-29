import type { PromptDetailsResponseMessage } from "./types.js";

const form = document.querySelector<HTMLFormElement>("#promptForm");
const domain = document.querySelector<HTMLParagraphElement>("#domain");
const categoryOptions = document.querySelector<HTMLDivElement>("#categoryOptions");
const note = document.querySelector<HTMLTextAreaElement>("#note");
const exit = document.querySelector<HTMLButtonElement>("#exit");

void init();

async function init(): Promise<void> {
  const details = await chrome.runtime.sendMessage({ type: "focus:get-prompt-details" });
  if (!isPromptDetails(details)) {
    if (domain) {
      domain.textContent = "No pending destination.";
    }
    return;
  }

  if (domain) {
    domain.textContent = details.domain;
  }

  renderCategories(details.categories);
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const category = getSelectedCategory();
  if (!category) {
    return;
  }

  void chrome.runtime.sendMessage({
    type: "focus:prompt-submit",
    category,
    note: note?.value ?? ""
  });
});

exit?.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "focus:early-exit" });
});

function renderCategories(categories: string[]): void {
  if (!categoryOptions) {
    return;
  }

  categoryOptions.replaceChildren(...categories.map((category, index) => createCategoryOption(category, index === 0)));
}

function createCategoryOption(category: string, checked: boolean): HTMLLabelElement {
  const label = document.createElement("label");
  const input = document.createElement("input");
  const text = document.createElement("span");

  label.className = "category-option";
  input.type = "radio";
  input.name = "category";
  input.value = category;
  input.checked = checked;
  text.textContent = category;

  label.append(input, text);
  return label;
}

function getSelectedCategory(): string | null {
  const selected = document.querySelector<HTMLInputElement>('input[name="category"]:checked');
  return selected?.value ?? null;
}

function isPromptDetails(value: unknown): value is PromptDetailsResponseMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { domain?: unknown }).domain === "string" &&
    typeof (value as { targetUrl?: unknown }).targetUrl === "string" &&
    Array.isArray((value as { categories?: unknown }).categories)
  );
}
