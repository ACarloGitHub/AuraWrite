import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Chunk } from "../ai-panel/chunks";

export const chunkDecorationsPluginKey = new PluginKey("chunkDecorations");

interface ChunkDecorationsState {
  chunks: Chunk[];
  activeChunkId: string | null;
}

function createChunkMarker(chunk: Chunk, isStart: boolean): Decoration {
  const markerHtml = isStart
    ? `<span class="chunk-marker chunk-marker--start" data-chunk-id="${chunk.id}" data-chunk-title="${chunk.title}">&#8592; ${chunk.title}</span>`
    : `<span class="chunk-marker chunk-marker--end" data-chunk-id="${chunk.id}"></span>`;

  return Decoration.widget(
    isStart ? chunk.startOffset : chunk.endOffset,
    () => {
      const span = document.createElement("span");
      span.className = isStart
        ? "chunk-marker chunk-marker--start"
        : "chunk-marker chunk-marker--end";
      span.setAttribute("data-chunk-id", chunk.id);
      span.setAttribute("data-chunk-title", chunk.title);
      if (isStart) {
        span.textContent = `\u2190 ${chunk.title}`;
      }
      return span;
    },
    { key: `chunk-${chunk.id}-${isStart ? "start" : "end"}` },
  );
}

export const chunkDecorationsPlugin = new Plugin<ChunkDecorationsState>({
  key: chunkDecorationsPluginKey,
  state: {
    init(): ChunkDecorationsState {
      return { chunks: [], activeChunkId: null };
    },
    apply(tr, set, _oldState, newState): ChunkDecorationsState {
      const meta = tr.getMeta(chunkDecorationsPluginKey);

      if (meta === "clear") {
        return { chunks: [], activeChunkId: null };
      }

      if (meta && Array.isArray(meta.chunks)) {
        return {
          chunks: meta.chunks,
          activeChunkId: meta.activeChunkId || null,
        };
      }

      if (meta && meta.activeChunkId) {
        return { ...set, activeChunkId: meta.activeChunkId };
      }

      return set;
    },
  },
  props: {
    decorations(state) {
      const pluginState = chunkDecorationsPluginKey.getState(state);
      if (!pluginState || pluginState.chunks.length === 0) {
        return null;
      }

      const decorations: Decoration[] = [];

      for (const chunk of pluginState.chunks) {
        if (chunk.startOffset < state.doc.content.size) {
          decorations.push(createChunkMarker(chunk, true));
        }
      }

      return DecorationSet.create(state.doc, decorations);
    },
  },
});

export function updateChunkDecorations(
  view: import("prosemirror-view").EditorView,
  chunks: Chunk[],
  activeChunkId: string | null = null,
): void {
  const tr = view.state.tr.setMeta(chunkDecorationsPluginKey, {
    chunks,
    activeChunkId,
  });
  view.dispatch(tr);
}

export function clearChunkDecorations(
  view: import("prosemirror-view").EditorView,
): void {
  const tr = view.state.tr.setMeta(chunkDecorationsPluginKey, "clear");
  view.dispatch(tr);
}

export function setActiveChunk(
  view: import("prosemirror-view").EditorView,
  chunkId: string | null,
): void {
  const tr = view.state.tr.setMeta(chunkDecorationsPluginKey, {
    activeChunkId: chunkId,
  });
  view.dispatch(tr);
}
