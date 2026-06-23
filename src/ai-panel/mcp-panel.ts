import { invoke } from "@tauri-apps/api/core";

let currentPlanName: string | null = null;

export function setupMCPPanel(): void {
  const panel = document.getElementById("mcp-panel");
  const btnMcp = document.getElementById("btn-mcp");
  const btnClose = document.getElementById("mcp-close");
  const planSelect = document.getElementById("mcp-plan-select") as HTMLSelectElement | null;
  const btnNew = document.getElementById("mcp-plan-new");
  const btnDelete = document.getElementById("mcp-plan-delete");
  const btnOpenEditor = document.getElementById("mcp-plan-open-editor");
  const newPlanForm = document.getElementById("mcp-plan-new-form") as HTMLDivElement | null;

  if (!panel || !btnMcp) return;

  btnMcp.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    btnMcp.classList.toggle("active", !panel.classList.contains("hidden"));
    if (!panel.classList.contains("hidden")) {
      loadPlanList();
    }
  });

  btnClose?.addEventListener("click", () => {
    panel.classList.add("hidden");
    btnMcp.classList.remove("active");
  });

  planSelect?.addEventListener("change", () => {
    currentPlanName = planSelect.value || null;
    if (currentPlanName) {
      loadPlanContent(currentPlanName);
    } else {
      clearPlanContent();
    }
  });

  btnNew?.addEventListener("click", () => {
    newPlanForm?.classList.toggle("active");
    const nameInput = newPlanForm?.querySelector("input");
    if (nameInput) nameInput.focus();
  });

  btnDelete?.addEventListener("click", async () => {
    if (!currentPlanName) return;
    if (!confirm(`Delete plan "${currentPlanName}"?`)) return;
    try {
      await invoke("plan_delete", { name: currentPlanName });
      currentPlanName = null;
      await loadPlanList();
      clearPlanContent();
    } catch (e) {
      console.error("[mcp] delete plan failed:", e);
    }
  });

  btnOpenEditor?.addEventListener("click", async () => {
    if (!currentPlanName) return;
    try {
      await invoke("workspace_open");
    } catch (e) {
      console.error("[mcp] open in explorer failed:", e);
    }
  });

  if (newPlanForm) {
    const nameInput = newPlanForm.querySelector("#mcp-new-plan-name") as HTMLInputElement;
    const confirmBtn = newPlanForm.querySelector("#mcp-new-plan-confirm");
    confirmBtn?.addEventListener("click", async () => {
      const name = nameInput?.value.trim();
      if (!name) return;
      try {
        const content = `status: active\n\n# ${name}\n\n- [ ] First task\n- [ ] Second task\n- [ ] Third task`;
        await invoke("plan_create", { name, content });
        currentPlanName = name;
        await loadPlanList();
        if (planSelect) planSelect.value = name;
        await loadPlanContent(name);
        newPlanForm.classList.remove("active");
        if (nameInput) nameInput.value = "";
      } catch (e) {
        console.error("[mcp] create plan failed:", e);
        alert("Failed to create plan: " + (e as Error).message);
      }
    });
  }

  window.addEventListener("aurawrite:plan-changed", ((e: CustomEvent) => {
    console.log("[mcp] plan-changed event received", e.detail);
    const planName = e.detail?.planName as string | undefined;
    if (planName) {
      currentPlanName = planName;
    }
    loadPlanList().then(() => {
      if (currentPlanName) {
        const planSelect = document.getElementById("mcp-plan-select") as HTMLSelectElement | null;
        if (planSelect) planSelect.value = currentPlanName;
        loadPlanContent(currentPlanName);
      }
    });
    if (panel.classList.contains("hidden")) {
      panel.classList.remove("hidden");
      btnMcp.classList.add("active");
    }
  }) as EventListener);

  // Wiki & Web panel setup
  const btnWikiRefresh = document.getElementById("mcp-wiki-refresh");
  const btnWikiNew = document.getElementById("mcp-wiki-new");
  const wikiNewForm = document.getElementById("mcp-wiki-new-form") as HTMLDivElement | null;

  btnWikiRefresh?.addEventListener("click", () => loadWikiList());

  btnWikiNew?.addEventListener("click", () => {
    if (wikiNewForm) {
      wikiNewForm.style.display = wikiNewForm.style.display === "none" ? "flex" : "none";
      const nameInput = wikiNewForm.querySelector("input");
      if (nameInput) nameInput.focus();
    }
  });

  const wikiNewConfirm = document.getElementById("mcp-wiki-new-confirm");
  const wikiNewNameInput = document.getElementById("mcp-wiki-new-name") as HTMLInputElement | null;

  wikiNewConfirm?.addEventListener("click", async () => {
    const name = wikiNewNameInput?.value.trim();
    if (!name) return;
    await createWikiPage(name);
    if (wikiNewForm) wikiNewForm.style.display = "none";
    if (wikiNewNameInput) wikiNewNameInput.value = "";
  });

  wikiNewNameInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      wikiNewConfirm?.click();
    }
  });

  window.addEventListener("aurawrite:wiki-changed", (() => {
    loadWikiList();
    const mcpPanel = document.getElementById("mcp-panel");
    const mcpBtn = document.getElementById("btn-mcp");
    if (mcpPanel?.classList.contains("hidden")) {
      mcpPanel.classList.remove("hidden");
      mcpBtn?.classList.add("active");
    }
  }) as EventListener);

  window.addEventListener("aurawrite:web-activity", ((e: CustomEvent) => {
    const { type, query } = e.detail as { type: "search" | "fetch" | "images"; query: string };
    logWebActivity(type, query);
    const mcpPanel = document.getElementById("mcp-panel");
    const mcpBtn = document.getElementById("btn-mcp");
    if (mcpPanel?.classList.contains("hidden")) {
      mcpPanel.classList.remove("hidden");
      mcpBtn?.classList.add("active");
    }
  }) as EventListener);

  // Data & Privacy section
  loadDataPrivacyStats();

  document.getElementById("mcp-data-chat-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete ALL chat history? This cannot be undone.")) return;
    try {
      const result = await invoke<string>("chat_reset_all");
      alert(result);
      loadDataPrivacyStats();
    } catch (e) {
      console.error("[mcp] chat reset failed:", e);
      alert("Failed to delete chat history: " + (e as Error).message);
    }
  });

  document.getElementById("mcp-data-rag-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete ALL RAG data? This cannot be undone.")) return;
    try {
      const result = await invoke<string>("rag_reset_all");
      alert(result);
      loadDataPrivacyStats();
    } catch (e) {
      console.error("[mcp] rag reset failed:", e);
      alert("Failed to delete RAG data: " + (e as Error).message);
    }
  });

  document.getElementById("mcp-data-wiki-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete ALL wiki pages? This cannot be undone.")) return;
    try {
      const result = await invoke<string>("wiki_reset_all");
      alert(result);
      loadDataPrivacyStats();
      loadWikiList();
    } catch (e) {
      console.error("[mcp] wiki reset failed:", e);
      alert("Failed to delete wiki pages: " + (e as Error).message);
    }
  });

  document.getElementById("mcp-data-plans-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete ALL plans? This cannot be undone.")) return;
    try {
      const result = await invoke<string>("plan_reset_all");
      alert(result);
      loadDataPrivacyStats();
      loadPlanList();
    } catch (e) {
      console.error("[mcp] plans reset failed:", e);
      alert("Failed to delete plans: " + (e as Error).message);
    }
  });

  document.getElementById("mcp-data-delete-all")?.addEventListener("click", async () => {
    if (!confirm("⚠️ Delete ALL AI data? This includes chat history, RAG index, wiki pages, and plans. This CANNOT be undone.")) return;
    try {
      const result = await invoke<string>("data_reset_all");
      alert(result);
      loadDataPrivacyStats();
      loadPlanList();
      loadWikiList();
    } catch (e) {
      console.error("[mcp] data reset all failed:", e);
      alert("Failed to delete all AI data: " + (e as Error).message);
    }
  });
}

async function loadPlanList(): Promise<void> {
  const planSelect = document.getElementById("mcp-plan-select") as HTMLSelectElement | null;
  if (!planSelect) return;

  try {
    const plans = await invoke<string[]>("plan_list");
    const currentValue = planSelect.value;
    planSelect.innerHTML = '<option value="">— Select plan —</option>';
    for (const name of plans) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      planSelect.appendChild(opt);
    }
    if (currentValue && plans.includes(currentValue)) {
      planSelect.value = currentValue;
    } else if (currentPlanName && plans.includes(currentPlanName)) {
      planSelect.value = currentPlanName;
    }
  } catch (e) {
    console.error("[mcp] load plan list failed:", e);
  }
}

function clearPlanContent(): void {
  const list = document.getElementById("mcp-plan-list");
  const progress = document.getElementById("mcp-plan-progress");
  const progressText = document.getElementById("mcp-plan-progress-text");
  const progressFill = document.getElementById("mcp-plan-progress-fill");
  if (list) list.innerHTML = '<div class="mcp-plan-empty">No plan selected</div>';
  if (progress) progress.style.display = "none";
  if (progressText) progressText.textContent = "";
  if (progressFill) progressFill.style.width = "0%";
}

async function loadPlanContent(name: string): Promise<void> {
  const list = document.getElementById("mcp-plan-list");
  const progress = document.getElementById("mcp-plan-progress");
  const progressText = document.getElementById("mcp-plan-progress-text");
  const progressFill = document.getElementById("mcp-plan-progress-fill");
  if (!list) return;

  try {
    const content = await invoke<string>("plan_read", { name });
    const lines = content.split("\n");
    list.innerHTML = "";

    let total = 0;
    let completed = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.match(/^status:/i)) continue;

      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        const heading = document.createElement("div");
        heading.className = "mcp-plan-heading";
        heading.textContent = headingMatch[2];
        list.appendChild(heading);
        continue;
      }

      const taskMatch = line.match(/^- \[([ xX])\] (.+)/);
      if (taskMatch) {
        total++;
        const checked = taskMatch[1] !== " ";
        if (checked) completed++;

        const taskDiv = document.createElement("div");
        taskDiv.className = "mcp-plan-task" + (checked ? " mcp-plan-task--done" : "");
        taskDiv.dataset.lineIndex = String(i);

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = checked;
        checkbox.addEventListener("change", () => {
          toggleTask(name, i, checkbox.checked);
        });

        const textSpan = document.createElement("span");
        textSpan.className = "mcp-plan-task-text";
        textSpan.contentEditable = "true";
        textSpan.textContent = taskMatch[2];
        textSpan.addEventListener("blur", () => {
          updateTaskText(name, i, textSpan.textContent || "");
        });
        textSpan.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            textSpan.blur();
          }
        });

        taskDiv.appendChild(checkbox);
        taskDiv.appendChild(textSpan);
        list.appendChild(taskDiv);
        continue;
      }

      if (line.trim() === "") continue;

      const lineDiv = document.createElement("div");
      lineDiv.className = "mcp-plan-task";
      const lineText = document.createElement("span");
      lineText.className = "mcp-plan-task-text";
      lineText.contentEditable = "true";
      lineText.textContent = line;
      lineDiv.appendChild(lineText);
      list.appendChild(lineDiv);
    }

    if (progress && progressText && progressFill) {
      progress.style.display = total > 0 ? "block" : "none";
      progressText.textContent = `${completed}/${total}`;
      progressFill.style.width = total > 0 ? `${(completed / total) * 100}%` : "0%";
    }
  } catch (e) {
    console.error("[mcp] load plan content failed:", e);
    list.innerHTML = '<div class="mcp-plan-empty">Error loading plan</div>';
  }
}

async function toggleTask(planName: string, lineIndex: number, checked: boolean): Promise<void> {
  try {
    const content = await invoke<string>("plan_read", { name: planName });
    const lines = content.split("\n");
    if (lineIndex >= 0 && lineIndex < lines.length) {
      if (checked) {
        lines[lineIndex] = lines[lineIndex].replace(/^- \[ \]/, "- [x]");
      } else {
        lines[lineIndex] = lines[lineIndex].replace(/^- \[[xX]\]/, "- [ ]");
      }
      await invoke("plan_update", { name: planName, content: lines.join("\n") });
      await loadPlanContent(planName);
    }
  } catch (e) {
    console.error("[mcp] toggle task failed:", e);
  }
}

async function updateTaskText(planName: string, lineIndex: number, newText: string): Promise<void> {
  try {
    const content = await invoke<string>("plan_read", { name: planName });
    const lines = content.split("\n");
    if (lineIndex >= 0 && lineIndex < lines.length) {
      const line = lines[lineIndex];
      const taskMatch = line.match(/^- \[([ xX])\] (.+)/);
      if (taskMatch) {
        lines[lineIndex] = `- [${taskMatch[1]}] ${newText}`;
        await invoke("plan_update", { name: planName, content: lines.join("\n") });
      }
    }
  } catch (e) {
    console.error("[mcp] update task text failed:", e);
  }
}

// ============================================================================
// Wiki Explorer
// ============================================================================

async function loadWikiList(): Promise<void> {
  const wikiList = document.getElementById("mcp-wiki-list");
  if (!wikiList) return;

  try {
    wikiList.innerHTML = '<div class="mcp-plan-empty">Loading...</div>';
    const result = await invoke<string>("wiki_list");
    // Strip [INSTRUCTION: ...] prefix
    const cleanResult = result.replace(/\[INSTRUCTION:.*?\]\s*/, "").trim();
    const lines = cleanResult.split("\n").filter(l => l.trim().startsWith("-"));

    if (lines.length === 0) {
      wikiList.innerHTML = '<div class="mcp-plan-empty">No wiki pages yet</div>';
      return;
    }

    wikiList.innerHTML = "";
    for (const line of lines) {
      // Parse "- pagename (N lines)"
      const match = line.match(/^- (.+?) \((\d+) lines\)/);
      if (!match) continue;
      const [, pageName, lineCount] = match;

      const div = document.createElement("div");
      div.className = "mcp-plan-task";
      div.innerHTML = `<span class="mcp-plan-task-text" style="cursor:pointer" title="Click to read">📝 ${pageName} <small>(${lineCount} lines)</small></span>`;
      div.addEventListener("click", () => readWikiPage(pageName));
      wikiList.appendChild(div);
    }
  } catch (e) {
    console.error("[mcp] load wiki list failed:", e);
    wikiList.innerHTML = '<div class="mcp-plan-empty">Error loading wiki</div>';
  }
}

async function readWikiPage(name: string): Promise<void> {
  const wikiList = document.getElementById("mcp-wiki-list");
  if (!wikiList) return;

  try {
    const result = await invoke<string>("wiki_read", { name });
    // Strip [INSTRUCTION: ...] prefix
    const cleanResult = result.replace(/\[INSTRUCTION:.*?\]\s*/, "").trim();
    // Show page content inline in the panel
    wikiList.innerHTML = `<div class="mcp-plan-empty" style="margin-bottom:8px">
      <button class="mcp-panel__btn" id="mcp-wiki-back" style="margin-right:8px">← Back</button>
      <strong>📝 ${name}</strong>
    </div>`;

    const backBtn = document.getElementById("mcp-wiki-back");
    backBtn?.addEventListener("click", () => loadWikiList());

    const contentDiv = document.createElement("div");
    contentDiv.className = "mcp-wiki-content";
    contentDiv.style.cssText = "font-size: 12px; line-height: 1.5; white-space: pre-wrap; max-height: 300px; overflow-y: auto; padding: 4px;";
    // Show first 2000 chars of the page content
    const displayContent = cleanResult.length > 2000 ? cleanResult.slice(0, 2000) + "..." : cleanResult;
    contentDiv.textContent = displayContent;
    wikiList.appendChild(contentDiv);
  } catch (e) {
    console.error("[mcp] read wiki page failed:", e);
    wikiList.innerHTML = '<div class="mcp-plan-empty">Error reading page</div>';
  }
}

async function createWikiPage(name: string): Promise<void> {
  try {
    const content = `# ${name}\n\n`;
    await invoke<string>("wiki_write", { name, content, frontmatter: null });
    await loadWikiList();
  } catch (e) {
    console.error("[mcp] create wiki page failed:", e);
    alert("Failed to create wiki page: " + (e as Error).message);
  }
}

// ============================================================================
// Web Activity
// ============================================================================

interface WebActivityEntry {
  type: "search" | "fetch" | "images";
  query: string;
  timestamp: number;
}

const webActivityLog: WebActivityEntry[] = [];
const MAX_WEB_ACTIVITY = 20;

export function logWebActivity(type: "search" | "fetch" | "images", query: string): void {
  webActivityLog.unshift({ type, query, timestamp: Date.now() });
  if (webActivityLog.length > MAX_WEB_ACTIVITY) {
    webActivityLog.pop();
  }
  renderWebActivity();
}

function renderWebActivity(): void {
  const container = document.getElementById("mcp-web-activity");
  if (!container) return;

  if (webActivityLog.length === 0) {
    container.innerHTML = '<div class="mcp-plan-empty">Web activity will appear here</div>';
    return;
  }

  const typeIcons: Record<string, string> = {
    search: "🔍",
    fetch: "🌐",
    images: "🖼️",
  };

  container.innerHTML = "";
  for (const entry of webActivityLog) {
    const div = document.createElement("div");
    div.className = "mcp-plan-task";
    const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    div.innerHTML = `<span class="mcp-plan-task-text">${typeIcons[entry.type] || "🔗"} <small>${timeStr}</small> ${entry.query.length > 60 ? entry.query.slice(0, 57) + "..." : entry.query}</span>`;
    container.appendChild(div);
  }
}

async function loadDataPrivacyStats(): Promise<void> {
  try {
    const stats = await invoke<{
      chat_sessions: number;
      chat_messages: number;
      rag_entities: number;
      rag_chunks: number;
      wiki_pages: number;
      plans: number;
    }>("data_stats");

    const chatCount = document.getElementById("mcp-data-chat-count");
    const ragCount = document.getElementById("mcp-data-rag-count");
    const wikiCount = document.getElementById("mcp-data-wiki-count");
    const plansCount = document.getElementById("mcp-data-plans-count");

    if (chatCount) chatCount.textContent = `${stats.chat_sessions} sessions, ${stats.chat_messages} messages`;
    if (ragCount) ragCount.textContent = `${stats.rag_entities} entities, ${stats.rag_chunks} chunks`;
    if (wikiCount) wikiCount.textContent = `${stats.wiki_pages} pages`;
    if (plansCount) plansCount.textContent = `${stats.plans} plans`;
  } catch (e) {
    console.error("[mcp] failed to load data stats:", e);
  }
}