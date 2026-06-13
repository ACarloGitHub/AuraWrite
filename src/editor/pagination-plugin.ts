import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { Fragment } from "prosemirror-model";
import { getPagedMode } from "./pagination-state";

export const paginationPluginKey = new PluginKey("pagination");

const A4_HEIGHT_PX = 1123;
const MARGIN_PX = 96;
const HEADER_PX = 48;
const FOOTER_PX = 24;
const CONTENT_HEIGHT = A4_HEIGHT_PX - 2 * MARGIN_PX - HEADER_PX - FOOTER_PX;
const DEFAULT_BLOCK_HEIGHT = 30;
const MERGE_THRESHOLD = 0.85;

let currentView: EditorView | null = null;
let rafId: number | null = null;
let rebalancing = false;
let retryCount = 0;
const MAX_RETRIES = 5;

function getBlockHeight(view: EditorView, pos: number): number {
  try {
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      // Force a layout flush so offsetHeight is accurate. Without this,
      // right after a ProseMirror transaction, the browser may not have
      // computed the layout yet and offsetHeight returns 0 (or stale).
      // Reading offsetWidth/offsetHeight triggers a synchronous reflow.
      void dom.offsetHeight;
      const style = window.getComputedStyle(dom);
      const mt = parseFloat(style.marginTop) || 0;
      const mb = parseFloat(style.marginBottom) || 0;
      const h = dom.offsetHeight;
      if (h > 0) return h + mt + mb;
    }
  } catch {
    // nodeDOM may fail for certain positions
  }
  return DEFAULT_BLOCK_HEIGHT;
}

function measurePageScrollHeight(view: EditorView, pagePos: number): number {
  try {
    const dom = view.nodeDOM(pagePos);
    if (dom instanceof HTMLElement) {
      // Force a synchronous reflow so scrollHeight is accurate.
      // Without this, the page-content area may report scrollHeight = 0
      // (or the previous frame's value) right after a ProseMirror
      // transaction, because the browser hasn't yet calculated the
      // layout of the new content. Reading offsetHeight here forces the
      // browser to compute the layout synchronously.
      void dom.offsetHeight;
      const contentEl = dom.querySelector(".pm-page-content");
      if (contentEl instanceof HTMLElement) {
        void contentEl.offsetHeight;
        return contentEl.scrollHeight;
      }
      return dom.scrollHeight;
    }
  } catch {
    // fallback
  }
  return 0;
}

function rebalancePages(view: EditorView): boolean {
  const { state } = view;
  const { doc, schema } = state;
  const pageType = schema.nodes.page;
  const paragraphType = schema.nodes.paragraph;
  if (!pageType) return false;

  const pages: { node: PMNode; pos: number }[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name === "page") {
      pages.push({ node, pos });
    }
  });
  if (pages.length === 0) return false;

  for (let pi = pages.length - 1; pi >= 0; pi--) {
    const { node: pageNode, pos: pagePos } = pages[pi];
    const childCount = pageNode.content.childCount;
    if (childCount <= 1) continue;

    const scrollH = measurePageScrollHeight(view, pagePos);
    if (scrollH > 0 && scrollH <= CONTENT_HEIGHT) continue;

    let accumulated = 0;
    let splitAfterBlockIdx = -1;
    let blockOffset = 0;
    let hasRealMeasurement = false;

    for (let bi = 0; bi < childCount; bi++) {
      const block = pageNode.content.child(bi);
      const blockPos = pagePos + 1 + blockOffset;
      const h = getBlockHeight(view, blockPos);
      if (h !== DEFAULT_BLOCK_HEIGHT) hasRealMeasurement = true;

      if (splitAfterBlockIdx === -1 && accumulated > 0 && accumulated + h > CONTENT_HEIGHT) {
        splitAfterBlockIdx = bi - 1;
      }
      accumulated += h;
      blockOffset += block.nodeSize;
    }

    if (splitAfterBlockIdx < 0) continue;
    if (!hasRealMeasurement) continue;

    const firstBlocks: PMNode[] = [];
    const secondBlocks: PMNode[] = [];
    for (let bi = 0; bi < childCount; bi++) {
      const block = pageNode.content.child(bi);
      if (bi <= splitAfterBlockIdx) {
        firstBlocks.push(block);
      } else {
        secondBlocks.push(block);
      }
    }

    if (firstBlocks.length === 0 || secondBlocks.length === 0) continue;

    const page1 = pageType.create(null, Fragment.from(firstBlocks));
    const page2 = pageType.create(null, Fragment.from(secondBlocks));
    const endPos = pagePos + pageNode.nodeSize;

    const cursorSnap = captureCursor(view);
    const tr = state.tr;
    tr.replaceWith(pagePos, endPos, [page1, page2]);
    restoreCursor(tr, cursorSnap);
    tr.setMeta(paginationPluginKey, { rebalance: true });
    tr.setMeta("addToHistory", false);
    view.dispatch(tr);
    return true;
  }

  for (let pi = 0; pi < pages.length - 1; pi++) {
    const curNode = pages[pi].node;
    const curPos = pages[pi].pos;
    const nextNode = pages[pi + 1].node;
    const nextPos = curPos + curNode.nodeSize;

    const curChildCount = curNode.content.childCount;
    const nextChildCount = nextNode.content.childCount;
    const totalBlocks = curChildCount + nextChildCount;
    if (totalBlocks === 0) continue;

    const nextHeight = measurePageScrollHeight(view, nextPos);

    // Special case: next page is effectively empty. This happens when
    // the user pressed Enter on a previous page and the cursor moved to
    // page 2, but the page 2 is just a single empty paragraph (or
    // nothing). After deleting the Enter, the page 2 stays in the
    // document as an empty container. We must REMOVE it and merge any
    // remaining content into the previous page, otherwise the text
    // that "slid" to page 2 never returns.
    //
    // Heuristic: if next page has 0 blocks, OR has 1 block that is an
    // empty paragraph, treat it as empty and delete it.
    const nextIsEffectivelyEmpty =
      nextChildCount === 0 ||
      (nextChildCount === 1 && isEmptyParagraph(nextNode.firstChild));
    if (nextIsEffectivelyEmpty) {
      const remainingBlocks: PMNode[] = [];
      curNode.forEach((b) => remainingBlocks.push(b));
      if (remainingBlocks.length === 0 && paragraphType) {
        remainingBlocks.push(paragraphType.create());
      }
      const merged = pageType.create(null, Fragment.from(remainingBlocks));
      const cursorSnap = captureCursor(view);
      const tr = state.tr;
      tr.replaceWith(curPos, nextPos + nextNode.nodeSize, merged);
      restoreCursor(tr, cursorSnap);
      tr.setMeta(paginationPluginKey, { rebalance: true });
      tr.setMeta("addToHistory", false);
      view.dispatch(tr);
      return true;
    }

    // Special case: current page is empty. Move its content (or a
    // placeholder paragraph) to the next page and remove the current.
    if (curChildCount === 0 ||
        (curChildCount === 1 && isEmptyParagraph(curNode.firstChild))) {
      const remainingBlocks: PMNode[] = [];
      nextNode.forEach((b) => remainingBlocks.push(b));
      if (remainingBlocks.length === 0 && paragraphType) {
        remainingBlocks.push(paragraphType.create());
      }
      const merged = pageType.create(null, Fragment.from(remainingBlocks));
      const cursorSnap = captureCursor(view);
      const tr = state.tr;
      tr.replaceWith(curPos, nextPos + nextNode.nodeSize, merged);
      restoreCursor(tr, cursorSnap);
      tr.setMeta(paginationPluginKey, { rebalance: true });
      tr.setMeta("addToHistory", false);
      view.dispatch(tr);
      return true;
    }

    const curHeight = measurePageScrollHeight(view, curPos);

    if (curHeight > 0 && nextHeight > 0 && curHeight + nextHeight <= CONTENT_HEIGHT * MERGE_THRESHOLD) {
      const allBlocks: PMNode[] = [];
      curNode.forEach((b) => allBlocks.push(b));
      nextNode.forEach((b) => allBlocks.push(b));

      if (allBlocks.length === 0) continue;

      const merged = pageType.create(null, Fragment.from(allBlocks));
      const cursorSnap = captureCursor(view);
      const tr = state.tr;
      tr.replaceWith(curPos, nextPos + nextNode.nodeSize, merged);
      restoreCursor(tr, cursorSnap);
      tr.setMeta(paginationPluginKey, { rebalance: true });
      tr.setMeta("addToHistory", false);
      view.dispatch(tr);
      return true;
    }
  }

  const lastPage = pages[pages.length - 1];
  if (lastPage.node.content.size === 0 && paragraphType) {
    const cursorSnap = captureCursor(view);
    const tr = state.tr;
    tr.insert(lastPage.pos + 1, paragraphType.create());
    restoreCursor(tr, cursorSnap);
    tr.setMeta(paginationPluginKey, { rebalance: true });
    tr.setMeta("addToHistory", false);
    view.dispatch(tr);
    return true;
  }

  return false;
}

/**
 * Returns true if the given node is a paragraph that contains no text
 * (i.e. an empty placeholder paragraph, often created automatically
 * by ProseMirror or by the pagination plugin itself).
 */
function isEmptyParagraph(node: PMNode | null | undefined): boolean {
  if (!node) return true;
  if (node.type.name !== "paragraph") return false;
  if (node.content.childCount === 0) return true;
  if (node.textContent.length > 0) return false;
  return true;
}

/**
 * Captures the current cursor position along with the text node the
 * cursor is in, so that after a structural change (split/merge) we
 * can restore the cursor to the SAME logical place (same text content
 * + same offset), not just the same absolute document position.
 *
 * Why this matters: when the rebalance merges two pages, ProseMirror
 * maps the cursor position by node size, but the page nodes have
 * isolating: true, so the mapped position can end up in the WRONG
 * page or even in the wrong paragraph. We instead remember the text
 * node identity and re-derive the position after the change.
 */
interface CursorSnapshot {
  textNodeIdentity: string | null;
  offsetInText: number;
  wasAtTextEnd: boolean;
}

function captureCursor(view: EditorView): CursorSnapshot | null {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection)) return null;
  const $from = selection.$from;
  // Find the deepest text node the cursor is in (parent of $from.parent)
  const parent = $from.parent;
  if (!parent || !parent.isTextblock) return null;
  // parent is the textblock (paragraph); the cursor is at $from.parentOffset
  // within it. The text the user sees is parent.textContent.
  return {
    textNodeIdentity: parent.textContent,
    offsetInText: $from.parentOffset,
    wasAtTextEnd: $from.parentOffset >= parent.textContent.length,
  };
}

/**
 * Restores the cursor to the position that has the same text
 * identity + offset as the captured snapshot, falling back to a
 * sensible position if the text is no longer present.
 */
function restoreCursor(tr: any, snapshot: CursorSnapshot | null): void {
  if (!snapshot) return;
  if (!snapshot.textNodeIdentity) return;
  // Find the text node that has the same text content
  const targetText = snapshot.textNodeIdentity;
  let bestPos: number | null = null;
  let bestOffset = snapshot.offsetInText;
  tr.doc.descendants((node: PMNode, pos: number) => {
    if (bestPos !== null) return false;
    if (!node.isTextblock) return true;
    if (node.textContent !== targetText) return true;
    // Found a textblock with matching text. Set the cursor there.
    let targetPos = pos + 1; // start of the textblock content
    let remaining = Math.min(bestOffset, node.content.size);
    // Walk into the textblock to find the right character offset
    let acc = 0;
    let found = false;
    node.content.forEach((child: PMNode, childPos: number) => {
      if (found) return false;
      if (child.isText) {
        const text = child.textContent || "";
        if (acc + text.length >= remaining) {
          targetPos = pos + 1 + childPos + (remaining - acc);
          found = true;
          return false;
        }
        acc += text.length;
      }
    });
    if (found) {
      bestPos = targetPos;
      return false;
    }
    return true;
  });
  if (bestPos !== null) {
    try {
      tr.setSelection(TextSelection.near(tr.doc.resolve(bestPos)));
    } catch {
      // Position invalid; leave selection as-is
    }
  }
}

function scheduleRebalance(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (currentView && getPagedMode() && !rebalancing) {
      rebalancing = true;
      try {
        const changed = rebalancePages(currentView);
        if (changed) {
          retryCount = 0;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (currentView && getPagedMode()) {
                scheduleRebalance();
              }
            });
          });
        } else if (retryCount < MAX_RETRIES) {
          // The rebalance did nothing. The most common reason is that
          // the DOM scrollHeight was 0 or stale (browser had not yet
          // laid out the page after the user transaction). Retry with
          // a longer wait (4 rAFs instead of 2) to give the browser
          // more time, and force a reflow before measuring.
          retryCount++;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  if (currentView && getPagedMode()) {
                    rebalancing = true;
                    try {
                      rebalancePages(currentView);
                    } finally {
                      rebalancing = false;
                    }
                  }
                });
              });
            });
          });
        } else {
          retryCount = 0;
        }
      } finally {
        rebalancing = false;
      }
    }
  });
}

export function createPaginationPlugin(): Plugin {
  return new Plugin({
    key: paginationPluginKey,

    state: {
      init: () => ({ lastRebalance: 0 }),
      apply: (tr, prev) => {
        if (tr.getMeta(paginationPluginKey)?.rebalance) {
          return { lastRebalance: Date.now() };
        }
        return prev;
      },
    },

    appendTransaction(_transactions, _oldState, newState) {
      if (!getPagedMode()) return null;

      // Wrap bare blocks (non-page children of doc) into a page node
      let hasBareBlocks = false;
      newState.doc.forEach((node) => {
        if (node.type.name !== "page") hasBareBlocks = true;
      });
      if (hasBareBlocks) {
        const pageType = newState.schema.nodes.page;
        if (!pageType) return null;
        const blocks: PMNode[] = [];
        newState.doc.forEach((node) => blocks.push(node));
        const page = pageType.create(null, Fragment.from(blocks));
        const tr = newState.tr;
        tr.replaceWith(0, newState.doc.content.size, page);
        tr.setMeta(paginationPluginKey, { rebalance: true });
        tr.setMeta("addToHistory", false);
        return tr;
      }

      // Always rebalance when the document changes. The user pressing Enter,
      // Backspace, or any other edit can change page heights and require
      // splits/merges. The view.update hook also calls scheduleRebalance,
      // but it can race with user transactions; calling it here too
      // guarantees a rebalance right after the user's edit is applied.
      // The rebalance itself is idempotent and skip-safe.
      //
      // We do NOT return a transaction from appendTransaction for the
      // rebalance itself. Returning a tr here would mean: the
      // pagination plugin owns the structural changes (split/merge) and
      // the user transaction is paired with them. That works in
      // theory, but the DOM measurements (scrollHeight) are stale at
      // this point because the browser has not yet rendered the new
      // content. Returning a tr now would lead to a "first measurement
      // returns 0" problem, which means the split/merge decisions are
      // made on bad data. Instead, we schedule a deferred rebalance
      // via scheduleRebalance, which waits for the DOM to settle and
      // retries up to MAX_RETRIES if the first measurement is 0.
      scheduleRebalance();
      return null;
    },

    view(view: EditorView) {
      currentView = view;
      return {
        update() {
          if (getPagedMode()) {
            scheduleRebalance();
          }
        },
        destroy() {
          currentView = null;
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
        },
      };
    },
  });
}

export function requestPaginationRecalc(): void {
  scheduleRebalance();
}