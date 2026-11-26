/**
 * E5 — the field panel: date, time, name ([[concepts/editor-enrichment-fields]]).
 *
 * A temporary home. The next chapter of the campaign is B (the toolbar), which
 * will re-place this button: what matters here is that the tool exists, adopts
 * the cursor's marks and writes ONE atom — no structure of the bar is built
 * here that B would have to undo.
 *
 * The list shows every format with the value it would insert, drawn from the
 * same catalog and the same renderer the document uses, so what is read in the
 * panel is what lands in the text.
 */
import type { EditorView } from "prosemirror-view";
import { invoke } from "@tauri-apps/api/core";
import {
  DATE_FORMATS,
  TIME_FORMATS,
  renderFormat,
  type DtFormat,
  type FieldKind,
} from "./field-value";
import { insertField, newFieldAttrs, updateAllFields } from "./field-node";
import { effectiveDocumentLanguage } from "./document-language";

let kind: FieldKind = "date";
let auto = true;
/** The system user name, asked once: opening a panel is not a moment for IPC. */
let userName: string | null = null;
let sampleTimer: number | null = null;

export function setupFieldPanel(view: EditorView): void {
  const button = document.getElementById("btn-field") as HTMLButtonElement | null;
  const menu = document.getElementById("field-menu") as HTMLElement | null;
  const list = document.getElementById("field-format-list") as HTMLElement | null;
  const autoBox = document.getElementById("field-auto") as HTMLInputElement | null;
  const kindsBox = document.getElementById("field-kinds") as HTMLElement | null;
  if (!button || !menu || !list || !kindsBox) return;

  const isOpen = () => !menu.classList.contains("hidden");

  const close = (): void => {
    menu.classList.add("hidden");
    if (sampleTimer !== null) {
      window.clearInterval(sampleTimer);
      sampleTimer = null;
    }
  };

  const formatsFor = (): DtFormat[] => (kind === "time" ? TIME_FORMATS : DATE_FORMATS);

  const renderList = (): void => {
    kindsBox.querySelectorAll<HTMLButtonElement>("[data-field-kind]").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.fieldKind === kind);
    });
    const now = new Date();
    const locale = effectiveDocumentLanguage();
    list.textContent = "";
    if (kind === "name") {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "dropdown-menu__item field-panel__option";
      item.dataset.fieldName = "1";
      const label = document.createElement("span");
      label.className = "dropdown-menu__label";
      label.textContent = userName ? `Author: ${userName}` : "Insert the user name";
      item.appendChild(label);
      list.appendChild(item);
      return;
    }
    for (const fmt of formatsFor()) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "dropdown-menu__item field-panel__option";
      item.dataset.fieldFormat = fmt.key;
      const sample = document.createElement("span");
      sample.className = "dropdown-menu__label";
      sample.textContent = renderFormat(fmt, now, locale);
      item.appendChild(sample);
      list.appendChild(item);
    }
  };

  const open = async (): Promise<void> => {
    menu.classList.remove("hidden");
    if (userName === null) {
      try {
        userName = await invoke<string>("system_user_name");
      } catch {
        userName = "";
      }
    }
    renderList();
    // The samples follow the clock while the panel is open, like Word's list.
    sampleTimer = window.setInterval(() => {
      if (isOpen() && kind !== "name") renderList();
    }, 1000);
  };

  const insert = (format: string): void => {
    const attrs = newFieldAttrs(kind, format, new Date(), effectiveDocumentLanguage(), userName ?? "");
    attrs.auto = kind !== "name" && auto;
    insertField(view, attrs);
    close();
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (isOpen()) close();
    else void open();
  });

  kindsBox.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-field-kind]");
    if (!target) return;
    kind = (target.dataset.fieldKind as FieldKind) ?? "date";
    if (autoBox) autoBox.checked = kind !== "name" && auto;
    renderList();
  });

  list.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-field-format]");
    if (target?.dataset.fieldFormat) {
      insert(target.dataset.fieldFormat);
      return;
    }
    if ((event.target as HTMLElement).closest("[data-field-name]")) insert("");
  });

  autoBox?.addEventListener("change", () => {
    auto = autoBox.checked;
  });

  document.getElementById("field-update-all")?.addEventListener("click", () => {
    updateAllFields(view, new Date(), effectiveDocumentLanguage());
    close();
  });

  document.addEventListener("click", (event) => {
    if (!isOpen()) return;
    const node = event.target as Node;
    if (!menu.contains(node) && !button.contains(node)) close();
  });
}