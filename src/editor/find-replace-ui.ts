/**
 * Find & Replace bar wiring: open/close, input handling, next/prev/replace.
 * Extracted from main.ts (2026-08-21, refactoring plan step 1.6).
 */
import type { EditorView } from "prosemirror-view";
import {
  setFindQuery,
  setFindOptions,
  getFindState,
  findNext,
  findPrev,
  replaceOne,
  replaceAll,
  clearFind,
  goToFirstMatch,
} from "./find-replace";

export function openFindBar(): void {
  const findBar = document.getElementById("find-bar");
  const findInput = document.getElementById("find-input") as HTMLInputElement | null;
  findBar?.classList.remove("hidden");
  // The three rules survive the bar's close (they are the writer's choice,
  // not the bar's): the buttons must say what the engine is actually doing,
  // or the next open shows a stale face. Caught by the screenshot proof.
  const s = getFindState();
  const pressed: [string, boolean][] = [
    ["find-case", s.caseSensitive],
    ["find-word", s.wholeWord],
    ["find-regex", s.regex],
  ];
  for (const [id, on] of pressed) {
    document.getElementById(id)?.setAttribute("aria-pressed", String(on));
  }
  findInput?.focus();
  findInput?.select();
}

export function setupFindReplaceUI(editorView: EditorView): void {
  const findInput = document.getElementById("find-input") as HTMLInputElement | null;
  const replaceInput = document.getElementById("replace-input") as HTMLInputElement | null;

  function closeFindBar(): void {
    document.getElementById("find-bar")?.classList.add("hidden");
    clearFind(editorView);
  }

  const btnFind = document.getElementById("btn-find");
  btnFind?.addEventListener("click", () => openFindBar());

  document.getElementById("find-close")?.addEventListener("click", closeFindBar);

  findInput?.addEventListener("input", () => {
    setFindQuery(findInput.value, editorView);
  });

  findInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      goToFirstMatch(editorView, true);
    }
    if (e.key === "Escape") {
      closeFindBar();
    }
  });

  document.getElementById("find-next")?.addEventListener("click", () => findNext(editorView));
  document.getElementById("find-prev")?.addEventListener("click", () => findPrev(editorView));

  // The three rules: each toggle re-runs the query under the new rule.
  const toggles: { id: string; key: "caseSensitive" | "wholeWord" | "regex" }[] = [
    { id: "find-case", key: "caseSensitive" },
    { id: "find-word", key: "wholeWord" },
    { id: "find-regex", key: "regex" },
  ];
  for (const { id, key } of toggles) {
    const btn = document.getElementById(id);
    btn?.addEventListener("click", () => {
      const next = !getFindState()[key];
      setFindOptions(editorView, { [key]: next });
      btn.setAttribute("aria-pressed", String(next));
      if (findInput) setFindQuery(findInput.value, editorView);
      findInput?.focus();
    });
  }
  document.getElementById("replace-one")?.addEventListener("click", () => {
    if (replaceInput) replaceOne(editorView, replaceInput.value);
  });
  document.getElementById("replace-all")?.addEventListener("click", () => {
    if (replaceInput) replaceAll(editorView, replaceInput.value);
  });
}
