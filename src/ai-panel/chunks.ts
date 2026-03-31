export interface Chunk {
  id: string;
  index: number;
  title: string;
  content: string;
  startOffset: number;
  endOffset: number;
}

export interface ChunkSettings {
  maxTokens: number;
  tokensPerChunk: number;
}

const DEFAULT_MAX_TOKENS = 8000;
const CHARS_PER_TOKEN = 4;

export function getChunkSettings(): ChunkSettings {
  const saved = localStorage.getItem("aurawrite-ai-settings");
  if (saved) {
    const settings = JSON.parse(saved);
    return {
      maxTokens: settings.maxContextTokens || DEFAULT_MAX_TOKENS,
      tokensPerChunk: settings.tokensPerChunk || DEFAULT_MAX_TOKENS,
    };
  }
  return { maxTokens: DEFAULT_MAX_TOKENS, tokensPerChunk: DEFAULT_MAX_TOKENS };
}

export function saveChunkSettings(settings: ChunkSettings): void {
  const saved = localStorage.getItem("aurawrite-ai-settings");
  const current = saved ? JSON.parse(saved) : {};
  current.maxContextTokens = settings.maxTokens;
  current.tokensPerChunk = settings.tokensPerChunk;
  localStorage.setItem("aurawrite-ai-settings", JSON.stringify(current));
}

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function splitIntoChunks(
  text: string,
  documentTitle: string,
  maxTokens?: number,
): Chunk[] {
  const settings = getChunkSettings();
  const limit = maxTokens || settings.tokensPerChunk;
  const charLimit = limit * CHARS_PER_TOKEN;

  if (text.length <= charLimit) {
    return [
      {
        id: `${documentTitle}-chunk_001`,
        index: 0,
        title: `${documentTitle}-chunk_001`,
        content: text,
        startOffset: 0,
        endOffset: text.length,
      },
    ];
  }

  const chunks: Chunk[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let currentChunk = "";
  let currentLength = 0;
  let chunkIndex = 0;
  let startOffset = 0;
  let chunkStartOffset = 0;

  for (const sentence of sentences) {
    const sentenceLen = sentence.length;

    if (currentLength + sentenceLen > charLimit && currentChunk.length > 0) {
      const paddedTitle = String(chunkIndex + 1).padStart(3, "0");
      chunks.push({
        id: `${documentTitle}-chunk_${paddedTitle}`,
        index: chunkIndex,
        title: `${documentTitle}-chunk_${paddedTitle}`,
        content: currentChunk.trim(),
        startOffset: chunkStartOffset,
        endOffset: startOffset,
      });

      chunkIndex++;
      currentChunk = "";
      currentLength = 0;
      chunkStartOffset = startOffset;
    }

    currentChunk += sentence;
    currentLength += sentenceLen;
    startOffset += sentenceLen;
  }

  if (currentChunk.trim().length > 0) {
    const paddedTitle = String(chunkIndex + 1).padStart(3, "0");
    chunks.push({
      id: `${documentTitle}-chunk_${paddedTitle}`,
      index: chunkIndex,
      title: `${documentTitle}-chunk_${paddedTitle}`,
      content: currentChunk.trim(),
      startOffset: chunkStartOffset,
      endOffset: startOffset,
    });
  }

  return chunks;
}

export function findChunkForPosition(
  chunks: Chunk[],
  position: number,
): Chunk | null {
  for (const chunk of chunks) {
    if (position >= chunk.startOffset && position <= chunk.endOffset) {
      return chunk;
    }
  }
  return null;
}

export function getChunkById(chunks: Chunk[], id: string): Chunk | null {
  return chunks.find((c) => c.id === id) || null;
}
