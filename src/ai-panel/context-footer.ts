import { formatContextNumber, getContextWindow } from "./context-window";
import { getSessionUsage } from "./chat-session-usage";

let providerName = "minimax";
let modelName = "MiniMax-M3";

export function setContextFooterModel(provider: string, model: string): void {
  providerName = provider || providerName;
  modelName = model || modelName;
  updateContextFooter();
}

export function updateContextFooter(): void {
  const barEl = document.getElementById("ai-context-bar-fill");
  const textEl = document.getElementById("ai-context-text");
  if (!barEl || !textEl) return;

  const window = getContextWindow(providerName, modelName);
  const usage = getSessionUsage();
  const pct = window.context > 0 ? (usage.totalTokens / window.context) * 100 : 0;
  const clamped = Math.min(100, Math.max(0, pct));
  const widthStr = `${clamped.toFixed(1)}%`;

  (barEl as HTMLElement).style.width = widthStr;
  barEl.classList.remove("warn", "danger");
  if (clamped >= 90) {
    barEl.classList.add("danger");
  } else if (clamped >= 70) {
    barEl.classList.add("warn");
  }

  const used = formatContextNumber(usage.totalTokens);
  const cap = formatContextNumber(window.context);
  const pctStr = `${pct.toFixed(1)}%`;
  textEl.textContent = `Context ${used} / ${cap} (${pctStr})${usage.source === "estimated" ? " ~est." : ""}`;
}
