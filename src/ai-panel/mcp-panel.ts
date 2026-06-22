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