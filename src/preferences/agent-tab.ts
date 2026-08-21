/**
 * Agent, Security and Data & Privacy preferences tabs.
 * Extracted from main.ts (2026-08-21, refactoring plan step 1.7).
 */
import { invoke } from "@tauri-apps/api/core";
import { getEffectiveProviderName } from "../ai-panel/ai-manager";
import { getPreferences } from "./store";

export async function updateSecretsStatus(): Promise<void> {
  const statusEl = document.getElementById("security-keychain-status");
  if (!statusEl) return;
  const prefs = getPreferences();
  const effectiveProvider = getEffectiveProviderName(prefs.aiProvider, prefs.aiOllamaMode);
  try {
    const key = await invoke<string | null>("secrets_get", { key: `ai-api-key:${effectiveProvider}` });
    if (key) {
      statusEl.textContent = `API key for ${effectiveProvider} stored securely (encrypted).`;
      statusEl.style.color = "";
    } else {
      statusEl.textContent = `No API key stored for ${effectiveProvider} (set one in AI Provider tab).`;
      statusEl.style.color = "";
    }
  } catch {
    statusEl.textContent = "Encrypted storage not available. Please re-enter your API keys.";
    statusEl.style.color = "var(--color-danger, #e53e3e)";
  }
}

async function updateAgentWorkspaceInfo(): Promise<void> {
  const pathInput = document.getElementById("pref-agent-workspace-path") as HTMLInputElement | null;
  try {
    const info = await invoke<{ path: string; exists: boolean }>("workspace_info");
    if (pathInput) pathInput.value = info.path;
  } catch {
    if (pathInput) pathInput.value = "Error";
  }
}

export async function loadPermissionsList(): Promise<void> {
  const listEl = document.getElementById("agent-permissions-list");
  if (!listEl) return;
  try {
    const permissions = await invoke<Array<{ path: string; scope: string; tool: string; granted_at: number }>>("permissions_list");
    if (permissions.length === 0) {
      listEl.innerHTML = '<div style="color:var(--color-text-muted);font-size:12px;">No authorized folders yet.</div>';
      return;
    }
    listEl.innerHTML = permissions.map((p) =>
      `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--color-border);">
        <span style="flex:1;font-size:12px;font-family:monospace;word-break:break-all;">${p.path}</span>
        <span style="font-size:11px;color:var(--color-text-muted);padding:2px 6px;border:1px solid var(--color-border);border-radius:3px;">${p.scope}</span>
        <button class="btn-small permission-remove-btn" data-path="${p.path}" style="color:var(--color-danger, #e53e3e);">Remove</button>
      </div>`
    ).join("");
    listEl.querySelectorAll(".permission-remove-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const path = (btn as HTMLElement).dataset.path || "";
        try {
          await invoke("permissions_revoke", { path });
          await loadPermissionsList();
        } catch (e) {
          console.error("[agent] revoke permission failed:", e);
        }
      });
    });
  } catch {
    listEl.innerHTML = '<div style="color:var(--color-danger);font-size:12px;">Could not load permissions.</div>';
  }
}

async function loadPrivacyStats(): Promise<void> {
  try {
    const stats = await invoke<{
      chat_sessions: number;
      chat_messages: number;
      rag_entities: number;
      rag_chunks: number;
      wiki_pages: number;
      plans: number;
    }>("data_stats");

    const chatCount = document.getElementById("pref-data-chat-count");
    const ragCount = document.getElementById("pref-data-rag-count");
    const wikiCount = document.getElementById("pref-data-wiki-count");
    const plansCount = document.getElementById("pref-data-plans-count");

    if (chatCount) chatCount.textContent = `${stats.chat_sessions} sessions, ${stats.chat_messages} messages`;
    if (ragCount) ragCount.textContent = `${stats.rag_entities} entities, ${stats.rag_chunks} chunks`;
    if (wikiCount) wikiCount.textContent = `${stats.wiki_pages} pages`;
    if (plansCount) plansCount.textContent = `${stats.plans} plans`;
  } catch (e) {
    console.error("[agent] failed to load privacy stats:", e);
  }
}

/**
 * Wire the Agent tab, Security status and Data & Privacy buttons, plus the
 * initial loads. Called once during app bootstrap, in the same position the
 * listeners were originally attached in main.ts.
 */
export function setupAgentAndDataTabs(): void {
  updateSecretsStatus();

  updateAgentWorkspaceInfo();
  document.getElementById("pref-agent-workspace-open")?.addEventListener("click", async () => {
    try {
      await invoke("workspace_open");
    } catch (e) {
      console.error("[agent] workspace open failed:", e);
    }
  });
  document.getElementById("pref-agent-reset-workspace")?.addEventListener("click", async () => {
    const confirmed = confirm("This will delete all files inside the workspace (plans, drafts, notes, attachments).\nThe workspace folder itself will be kept.\n\nAre you sure?");
    if (!confirmed) return;
    try {
      await invoke("workspace_reset");
      updateAgentWorkspaceInfo();
    } catch (e) {
      console.error("[agent] workspace reset failed:", e);
    }
  });

  document.getElementById("pref-agent-add-folder")?.addEventListener("click", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    let selected: string | null = null;
    try {
      const result = await open({ directory: true, multiple: false });
      if (typeof result === "string") selected = result;
    } catch (e) {
      console.error("[agent] folder picker failed:", e);
      return;
    }
    if (!selected) return; // user cancelled the dialog
    try {
      await invoke("permissions_grant", { path: selected, scope: "always", tool: "*" });
      await loadPermissionsList();
    } catch (e) {
      console.error("[agent] add folder permission failed:", e);
      alert("Failed to add folder: " + (e as Error).message);
    }
  });

  document.getElementById("pref-agent-clear-session")?.addEventListener("click", async () => {
    try {
      await invoke("permissions_clear_session");
      await loadPermissionsList();
    } catch (e) {
      console.error("[agent] clear session permissions failed:", e);
    }
  });

  loadPermissionsList();

  // Data & Privacy buttons in Preferences
  loadPrivacyStats();

  document.getElementById("pref-data-chat-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete ALL chat history? This cannot be undone.")) return;
    try {
      const result = await invoke<string>("chat_reset_all");
      alert(result);
      loadPrivacyStats();
    } catch (e) {
      console.error("[agent] chat reset failed:", e);
      alert("Failed: " + (e as Error).message);
    }
  });

  document.getElementById("pref-data-rag-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete ALL RAG data? This cannot be undone.")) return;
    try {
      const result = await invoke<string>("rag_reset_all");
      alert(result);
      loadPrivacyStats();
    } catch (e) {
      console.error("[agent] rag reset failed:", e);
      alert("Failed: " + (e as Error).message);
    }
  });

  document.getElementById("pref-data-wiki-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete ALL wiki pages? This cannot be undone.")) return;
    try {
      const result = await invoke<string>("wiki_reset_all");
      alert(result);
      loadPrivacyStats();
    } catch (e) {
      console.error("[agent] wiki reset failed:", e);
      alert("Failed: " + (e as Error).message);
    }
  });

  document.getElementById("pref-data-plans-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete ALL plans? This cannot be undone.")) return;
    try {
      const result = await invoke<string>("plan_reset_all");
      alert(result);
      loadPrivacyStats();
    } catch (e) {
      console.error("[agent] plans reset failed:", e);
      alert("Failed: " + (e as Error).message);
    }
  });

  document.getElementById("pref-data-delete-all")?.addEventListener("click", async () => {
    if (!confirm("⚠️ Delete ALL AI data? This includes chat history, RAG index, wiki pages, and plans. This CANNOT be undone.")) return;
    try {
      const result = await invoke<string>("data_reset_all");
      alert(result);
      loadPrivacyStats();
    } catch (e) {
      console.error("[agent] data reset all failed:", e);
      alert("Failed: " + (e as Error).message);
    }
  });
}
