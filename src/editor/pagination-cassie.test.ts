import { describe, it, expect } from "vitest";
import { Schema } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import {
  measureBlock,
  getBlockLines,
  calculatePageBreaks,
  CONTENT_HEIGHT_PX,
  EDITOR_LINE_HEIGHT_PX,
} from "./pagination-cassie";

const schema = new Schema({
  nodes: basicSchema.spec.nodes,
  marks: basicSchema.spec.marks,
});

function para(text: string) {
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
}

function doc(...paragraphs: ReturnType<typeof para>[]) {
  return schema.nodes.doc.create(null, paragraphs);
}

describe("pagination-cassie / measureBlock", () => {
  it("returns the empty-block height for an empty paragraph", () => {
    const m = measureBlock(para(""));
    expect(m.heightPx).toBe(EDITOR_LINE_HEIGHT_PX);
    expect(m.lineCount).toBe(1);
  });

  it("returns the empty-block height for a paragraph with only whitespace", () => {
    const m = measureBlock(para("   \n\t  "));
    expect(m.heightPx).toBe(EDITOR_LINE_HEIGHT_PX);
  });

  it("returns a positive height for a short paragraph", () => {
    const m = measureBlock(para("Ciao"));
    expect(m.heightPx).toBeGreaterThan(0);
    expect(m.lineCount).toBe(1);
  });

  it("returns a height proportional to a long single-line paragraph (fallback path)", () => {
    const short = measureBlock(para("Ciao"));
    const long = measureBlock(para("Ciao ".repeat(200)));
    expect(long.heightPx).toBeGreaterThan(short.heightPx);
  });

  it("returns multiple line count for text that wraps to many lines (fallback path)", () => {
    const m = measureBlock(para("Parola ".repeat(400)));
    expect(m.lineCount).toBeGreaterThan(5);
  });

  it("returns safe fallback metrics for a null node", () => {
    const m = measureBlock(null);
    expect(m.heightPx).toBe(EDITOR_LINE_HEIGHT_PX);
  });
});

describe("pagination-cassie / getBlockLines", () => {
  it("returns empty lines for a null node", () => {
    const info = getBlockLines(null);
    expect(info.lines).toEqual([]);
    expect(info.fullText).toBe("");
  });

  it("returns the original text in fullText for a non-empty block", () => {
    const info = getBlockLines(para("prima riga\nseconda riga"));
    expect(info.fullText).toBe("prima riga\nseconda riga");
  });
});

describe("pagination-cassie / calculatePageBreaks", () => {
  it("returns no breaks for an empty document", () => {
    const d = doc();
    const result = calculatePageBreaks(d);
    expect(result.breaks).toEqual([]);
    expect(result.totalPages).toBe(1);
  });

  it("returns no breaks when a single short paragraph fits in one page", () => {
    const d = doc(para("Un paragrafo breve."));
    const result = calculatePageBreaks(d);
    expect(result.breaks).toEqual([]);
    expect(result.totalPages).toBe(1);
  });

  it("returns a break when paragraphs together exceed one page (fallback path)", () => {
    const long = "riga di testo di prova ".repeat(120);
    const d = doc(para(long), para(long));
    const result = calculatePageBreaks(d);
    expect(result.breaks.length).toBeGreaterThanOrEqual(1);
    expect(result.totalPages).toBeGreaterThanOrEqual(2);
  });

  it("places breaks in document order (positions are increasing)", () => {
    const long = "riga di testo di prova ".repeat(120);
    const d = doc(para(long), para(long), para(long), para(long));
    const result = calculatePageBreaks(d);
    for (let i = 1; i < result.breaks.length; i++) {
      expect(result.breaks[i].pos).toBeGreaterThan(result.breaks[i - 1].pos);
    }
  });

  it("assigns increasing page numbers to each break", () => {
    const long = "riga di testo di prova ".repeat(120);
    const d = doc(para(long), para(long), para(long), para(long));
    const result = calculatePageBreaks(d);
    for (let i = 1; i < result.breaks.length; i++) {
      expect(result.breaks[i].pageNumber).toBe(result.breaks[i - 1].pageNumber + 1);
    }
  });

  it("returns a deterministic result for the same input (no time, no DOM)", () => {
    const long = "riga di testo di prova ".repeat(120);
    const d = doc(para(long), para(long));
    const a = calculatePageBreaks(d);
    const b = calculatePageBreaks(d);
    expect(a.breaks.length).toBe(b.breaks.length);
    for (let i = 0; i < a.breaks.length; i++) {
      expect(a.breaks[i].pos).toBe(b.breaks[i].pos);
    }
  });

  it("exposes CONTENT_HEIGHT_PX that matches the editor's CSS", () => {
    expect(CONTENT_HEIGHT_PX).toBe(1123 - 2 * 96 - 48 - 24);
  });
});
