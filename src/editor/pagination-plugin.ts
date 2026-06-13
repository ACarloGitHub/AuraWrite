import { Plugin, PluginKey } from "prosemirror-state";
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
      const contentEl = dom.querySelector(".pm-page-content");
      if (contentEl instanceof HTMLElement) {
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

    const tr = state.tr;
    tr.replaceWith(pagePos, endPos, [page1, page2]);
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

    const totalBlocks = curNode.content.childCount + nextNode.content.childCount;
    if (totalBlocks === 0) continue;

    const curHeight = measurePageScrollHeight(view, curPos);
    const nextHeight = measurePageScrollHeight(view, nextPos);

    if (curHeight > 0 && nextHeight > 0 && curHeight + nextHeight <= CONTENT_HEIGHT * MERGE_THRESHOLD) {
      const allBlocks: PMNode[] = [];
      curNode.forEach((b) => allBlocks.push(b));
      nextNode.forEach((b) => allBlocks.push(b));

      if (allBlocks.length === 0) continue;

      const merged = pageType.create(null, Fragment.from(allBlocks));
      const tr = state.tr;
      tr.replaceWith(curPos, nextPos + nextNode.nodeSize, merged);
      tr.setMeta(paginationPluginKey, { rebalance: true });
      tr.setMeta("addToHistory", false);
      view.dispatch(tr);
      return true;
    }
  }

  const lastPage = pages[pages.length - 1];
  if (lastPage.node.content.size === 0 && paragraphType) {
    const tr = state.tr;
    tr.insert(lastPage.pos + 1, paragraphType.create());
    tr.setMeta(paginationPluginKey, { rebalance: true });
    tr.setMeta("addToHistory", false);
    view.dispatch(tr);
    return true;
  }

  return false;
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
          retryCount++;
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