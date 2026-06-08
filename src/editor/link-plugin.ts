import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

export const linkPluginKey = new PluginKey("linkPopover");

let popoverEl: HTMLElement | null = null;
let currentView: EditorView | null = null;

function createPopover(): HTMLElement {
  if (popoverEl) return popoverEl;

  popoverEl = document.createElement("div");
  popoverEl.className = "link-popover hidden";
  popoverEl.innerHTML = `
    <div class="link-popover__row">
      <input type="url" class="link-popover__input" placeholder="https://example.com" />
    </div>
    <div class="link-popover__row link-popover__actions">
      <button class="link-popover__btn link-popover__btn--apply" title="Apply link">Apply</button>
      <button class="link-popover__btn link-popover__btn--remove" title="Remove link">Remove</button>
      <button class="link-popover__btn link-popover__btn--cancel" title="Cancel">Cancel</button>
    </div>
  `;

  document.body.appendChild(popoverEl);

  const input = popoverEl.querySelector(".link-popover__input") as HTMLInputElement;
  const btnApply = popoverEl.querySelector(".link-popover__btn--apply") as HTMLButtonElement;
  const btnRemove = popoverEl.querySelector(".link-popover__btn--remove") as HTMLButtonElement;
  const btnCancel = popoverEl.querySelector(".link-popover__btn--cancel") as HTMLButtonElement;

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyLink();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePopover();
      currentView?.focus();
    }
  });

  btnApply.addEventListener("click", (e: MouseEvent) => {
    e.preventDefault();
    applyLink();
  });

  btnRemove.addEventListener("click", (e: MouseEvent) => {
    e.preventDefault();
    removeLink();
  });

  btnCancel.addEventListener("click", (e: MouseEvent) => {
    e.preventDefault();
    closePopover();
    currentView?.focus();
  });

  popoverEl.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
  });

  return popoverEl;
}

function applyLink(): void {
  if (!currentView || !popoverEl) return;

  const input = popoverEl.querySelector(".link-popover__input") as HTMLInputElement;
  let url = input.value.trim();

  if (!url) {
    removeLink();
    return;
  }

  if (!isValidUrl(url)) {
    input.classList.add("link-popover__input--error");
    input.focus();
    return;
  }

  input.classList.remove("link-popover__input--error");
  const { state } = currentView;
  const linkType = state.schema.marks.link;
  if (!linkType) return;

  const { from, to } = state.selection;

  if (from === to) {
    closePopover();
    currentView.focus();
    return;
  }

  const mark = linkType.create({ href: url });
  const tr = state.tr.addMark(from, to, mark);
  currentView.dispatch(tr);
  closePopover();
  currentView.focus();
}

function removeLink(): void {
  if (!currentView) return;

  const { state } = currentView;
  const linkType = state.schema.marks.link;
  if (!linkType) return;

  const { from, to } = state.selection;

  const tr = state.tr.removeMark(from, to, linkType);
  currentView.dispatch(tr);
  closePopover();
  currentView.focus();
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "file:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function positionPopover(view: EditorView): void {
  if (!popoverEl) return;

  const { from, to } = view.state.selection;
  const startCoords = view.coordsAtPos(from);
  const endCoords = view.coordsAtPos(to);

  const popoverRect = popoverEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth;

  let left = (startCoords.left + endCoords.left) / 2 - popoverRect.width / 2;
  const top = startCoords.bottom + 8;

  if (left < 8) left = 8;
  if (left + popoverRect.width > viewportWidth - 8) {
    left = viewportWidth - popoverRect.width - 8;
  }

  popoverEl.style.left = `${left}px`;
  popoverEl.style.top = `${top}px`;
}

function showPopover(view: EditorView, existingHref?: string): void {
  const popover = createPopover();
  const input = popover.querySelector(".link-popover__input") as HTMLInputElement;
  const btnRemove = popover.querySelector(".link-popover__btn--remove") as HTMLButtonElement;

  currentView = view;

  if (existingHref) {
    input.value = existingHref;
    btnRemove.style.display = "";
  } else {
    input.value = "";
    btnRemove.style.display = "none";
  }

  popover.classList.remove("hidden");
  input.classList.remove("link-popover__input--error");

  requestAnimationFrame(() => {
    positionPopover(view);
    input.focus();
  });
}

function closePopover(): void {
  if (popoverEl) {
    popoverEl.classList.add("hidden");
  }
  currentView = null;
}

function isInsideLink(view: EditorView): { pos: number; href: string } | null {
  const { state } = view;
  const { $from } = state.selection;
  const linkType = state.schema.marks.link;
  if (!linkType) return null;

  for (let d = $from.depth; d >= 0; d--) {
    const marks = $from.node(d).marks;
    const linkMark = marks.find((m) => m.type === linkType);
    if (linkMark) {
      return { pos: $from.start(d), href: linkMark.attrs.href };
    }
  }

  const nodeBefore = $from.nodeBefore;
  if (nodeBefore && nodeBefore.isText) {
    const linkMark = nodeBefore.marks.find((m) => m.type === linkType);
    if (linkMark) {
      return { pos: $from.pos - nodeBefore.text!.length, href: linkMark.attrs.href };
    }
  }

  return null;
}

export function openLinkPopover(view: EditorView): void {
  const existingLink = isInsideLink(view);
  if (existingLink) {
    showPopover(view, existingLink.href);
  } else {
    const { from, to } = view.state.selection;
    if (from === to) {
      view.focus();
      return;
    }
    showPopover(view);
  }
}

export function closeLinkPopover(): void {
  closePopover();
}

export const linkPopoverPlugin = new Plugin({
  key: linkPluginKey,
  props: {
    handleDOMEvents: {
      mousedown: (view, event) => {
        const target = event.target as HTMLElement;
        if (target.closest(".link-popover")) return false;

        if (popoverEl && !popoverEl.classList.contains("hidden")) {
          closePopover();
        }
        return false;
      },
      click: (view, event) => {
        const target = event.target as HTMLElement;
        const linkEl = target.closest("a");
        if (linkEl && view.dom.contains(linkEl)) {
          const href = linkEl.getAttribute("href");
          if (href) {
            event.preventDefault();
            showPopover(view, href);
          }
        }
        return false;
      },
    },
  },
});

export function toggleLink(view: EditorView): void {
  openLinkPopover(view);
}
