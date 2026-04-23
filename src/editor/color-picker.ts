// ============================================================================
// Color Picker - Modal for item customization (name, bg_color, text_color)
// ============================================================================

const PRESET_COLORS: string[] = [
  "#e74c3c", "#e67e22", "#f39c12", "#f1c40f",
  "#2ecc71", "#1abc9c", "#3498db", "#9b59b6",
  "#e91e63", "#00bcd4", "#795548", "#607d8b",
  "#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff",
];

const PRESET_TEXT_COLORS: string[] = [
  "#ffffff", "#000000", "#333333", "#e74c3c",
  "#2ecc71", "#3498db", "#9b59b6", "#f39c12",
];

const ALPHA_MAP: Record<string, number> = {
  project: 0.15,
  section: 0.12,
  document: 0.08,
};

export interface ColorPickerOptions {
  itemType: "project" | "section" | "document";
  itemId: string;
  currentName: string;
  currentBg?: string;
  currentText?: string;
  onSave: (newName: string, bgColor: string | undefined, textColor: string | undefined) => Promise<void>;
  onReset: () => Promise<void>;
}

export function openColorPicker(options: ColorPickerOptions): void {
  const { itemType, currentName, currentBg, currentText, onSave, onReset } = options;

  let selectedBg: string | undefined = currentBg;
  let selectedText: string | undefined = currentText;

  const overlay = document.createElement("div");
  overlay.className = "color-picker-overlay active";

  const alpha = ALPHA_MAP[itemType] || 0.12;
  const labelMap: Record<string, string> = { project: "Project", section: "Section", document: "Document" };

  overlay.innerHTML = `
    <div class="color-picker-modal">
      <div class="color-picker-header">
        <span>Customize ${labelMap[itemType]}</span>
        <button class="color-picker-close" title="Close">&times;</button>
      </div>
      <div class="color-picker-body">
        <div class="color-picker-section">
          <label>Name</label>
          <input type="text" id="cp-name" class="cp-name-input" value="${escapeAttr(currentName)}" placeholder="Enter name...">
        </div>
        <div class="color-picker-section">
          <label>Background</label>
          <div class="color-swatches" id="cp-bg-swatches"></div>
          <div class="color-custom-row">
            <input type="color" id="cp-bg-custom" value="${currentBg || "#3498db"}" title="Custom color">
            <span class="color-custom-label">Custom</span>
          </div>
        </div>
        <div class="color-picker-section">
          <label>Text</label>
          <div class="color-swatches" id="cp-text-swatches"></div>
          <div class="color-custom-row">
            <input type="color" id="cp-text-custom" value="${currentText || "#ffffff"}" title="Custom text color">
            <span class="color-custom-label">Custom</span>
          </div>
        </div>
        <div class="color-picker-preview" id="cp-preview">
          <div class="color-picker-preview-label">Preview</div>
          <div class="color-picker-preview-box" id="cp-preview-box">
            <span class="color-picker-preview-text"></span>
          </div>
        </div>
      </div>
      <div class="color-picker-footer">
        <button class="color-picker-btn reset" id="cp-reset">Reset</button>
        <button class="color-picker-btn save" id="cp-save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector("#cp-name") as HTMLInputElement;
  const previewText = overlay.querySelector(".color-picker-preview-text") as HTMLSpanElement;
  previewText.textContent = currentName;

  nameInput.addEventListener("input", () => {
    previewText.textContent = nameInput.value || currentName;
  });

  // Populate bg swatches
  const bgSwatches = overlay.querySelector("#cp-bg-swatches") as HTMLDivElement;
  PRESET_COLORS.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.className = "color-swatch";
    if (color === selectedBg) swatch.classList.add("selected");
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedBg = color;
      bgSwatches.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
      swatch.classList.add("selected");
      (overlay.querySelector("#cp-bg-custom") as HTMLInputElement).value = color;
      updatePreview();
    });
    bgSwatches.appendChild(swatch);
  });

  // Populate text swatches
  const textSwatches = overlay.querySelector("#cp-text-swatches") as HTMLDivElement;
  PRESET_TEXT_COLORS.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.className = "color-swatch";
    if (color === selectedText) swatch.classList.add("selected");
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedText = color;
      textSwatches.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
      swatch.classList.add("selected");
      (overlay.querySelector("#cp-text-custom") as HTMLInputElement).value = color;
      updatePreview();
    });
    textSwatches.appendChild(swatch);
  });

  // Custom color inputs
  const bgCustom = overlay.querySelector("#cp-bg-custom") as HTMLInputElement;
  bgCustom.addEventListener("input", () => {
    selectedBg = bgCustom.value;
    bgSwatches.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
    updatePreview();
  });

  const textCustom = overlay.querySelector("#cp-text-custom") as HTMLInputElement;
  textCustom.addEventListener("input", () => {
    selectedText = textCustom.value;
    textSwatches.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
    updatePreview();
  });

  // Preview
  function updatePreview(): void {
    const box = overlay.querySelector("#cp-preview-box") as HTMLDivElement;
    const rgb = hexToRgb(selectedBg || "#3498db");
    box.style.background = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    box.style.color = selectedText || "#ffffff";
  }
  updatePreview();

  // Close
  overlay.querySelector(".color-picker-close")?.addEventListener("click", (e) => {
    e.stopPropagation();
    overlay.remove();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Reset
  overlay.querySelector("#cp-reset")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await onReset();
    overlay.remove();
  });

  // Save
  overlay.querySelector("#cp-save")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const newName = nameInput.value.trim();
    await onSave(newName || currentName, selectedBg, selectedText);
    overlay.remove();
  });

  nameInput.focus();
  nameInput.select();
}

export function applyItemColors(
  el: HTMLElement,
  bgColor: string | undefined,
  textColor: string | undefined,
  itemType: "project" | "section" | "document"
): void {
  const alpha = ALPHA_MAP[itemType] || 0.12;

  if (bgColor) {
    const rgb = hexToRgb(bgColor);
    el.style.setProperty("--custom-bg", bgColor);
    el.style.setProperty("--custom-bg-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    el.style.background = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    el.classList.add("has-custom-colors");
  } else {
    el.style.removeProperty("--custom-bg");
    el.style.removeProperty("--custom-bg-rgb");
    el.style.removeProperty("background");
    el.classList.remove("has-custom-colors");
  }

  if (textColor) {
    el.style.setProperty("--custom-text", textColor);
    const nameEl = el.querySelector(".item-name") as HTMLElement | null;
    if (nameEl) nameEl.style.color = textColor;
  } else {
    el.style.removeProperty("--custom-text");
    const nameEl = el.querySelector(".item-name") as HTMLElement | null;
    if (nameEl) nameEl.style.removeProperty("color");
  }
}

export function createColorBtn(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "item-color-btn";
  btn.title = "Customize";
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12.1 1.4a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2L5.6 12.9a1 1 0 0 1-.4.2l-3 .7a.3.3 0 0 1-.4-.4l.7-3a1 1 0 0 1 .2-.4L12.1 1.4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    <circle cx="4" cy="13" r="1.5" fill="currentColor" opacity="0.4"/>
  </svg>`;
  return btn;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}