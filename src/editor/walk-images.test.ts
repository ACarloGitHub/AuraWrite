// Test the walkAndCopyImages-like traversal logic in isolation
// (the helper in toolbar.ts is not exported, so we test the equivalent
// pattern here to catch regressions in the iteration over content).

import { describe, it, expect } from "vitest";

// Mirror of the fix in toolbar.ts:walkAndCopyImages
async function walkAndCopyImages(node: any, out: any[]): Promise<void> {
  if (!node) return;
  if (node.type === "image" || (node.type && node.attrs?.src)) {
    const src: string = node.attrs?.src;
    if (src && !out.includes(src)) out.push(src);
    return;
  }
  // node.content can be:
  //  - undefined (already handled above)
  //  - a plain array (serialized ProseMirror JSON from the database)
  //  - a Fragment (live ProseMirror Node, has .forEach but no Symbol.iterator)
  //  - anything else (defensive: skip)
  const content = node.content;
  if (content && typeof content.forEach === "function") {
    // Fragment: collect via forEach
    const children: any[] = [];
    content.forEach((c: any) => children.push(c));
    for (const child of children) {
      await walkAndCopyImages(child, out);
    }
  } else if (Array.isArray(content)) {
    for (const child of content) {
      await walkAndCopyImages(child, out);
    }
  }
}

describe("walkAndCopyImages content iteration", () => {
  it("walks a live ProseMirror Fragment-like doc without throwing", async () => {
    // Simulate a live ProseMirror Node: .content is a Fragment-like object
    // (has forEach but is not a real array and is not directly iterable)
    const fakeFragment = {
      nodes: [
        { type: "heading", content: undefined },
        { type: "paragraph", content: { forEach: () => {} } },
      ],
      forEach(cb: any) {
        this.nodes.forEach((n) => cb(n));
      },
    };
    const liveDoc = { type: "doc", content: fakeFragment };
    const out: string[] = [];
    await walkAndCopyImages(liveDoc, out);
    expect(out).toEqual([]);
  });

  it("walks a plain JSON-serialized doc and collects images", async () => {
    const jsonDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before " },
            { type: "image", attrs: { src: "images/a.png" } },
            { type: "image", attrs: { src: "images/b.png" } },
            { type: "text", text: " after" },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "images/c.png" } },
          ],
        },
      ],
    };
    const out: string[] = [];
    await walkAndCopyImages(jsonDoc, out);
    expect(out).toEqual(["images/a.png", "images/b.png", "images/c.png"]);
  });

  it("does not double-collect the same image src", async () => {
    const jsonDoc = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "images/same.png" } },
        { type: "image", attrs: { src: "images/same.png" } },
      ],
    };
    const out: string[] = [];
    await walkAndCopyImages(jsonDoc, out);
    expect(out).toEqual(["images/same.png"]);
  });

  it("handles a node with no content (leaf node)", async () => {
    const jsonDoc = { type: "image", attrs: { src: "images/leaf.png" } };
    const out: string[] = [];
    await walkAndCopyImages(jsonDoc, out);
    expect(out).toEqual(["images/leaf.png"]);
  });

  it("walks a live ProseMirror doc with real Fragment content (matches AuraWrite runtime)", async () => {
    // This mirrors what AuraWrite does at runtime: editorView.state.doc
    // is a live ProseMirror Node, its .content is a Fragment.
    // The live ProseMirror Fragment forEach callbacks pass each child Node.
    const childParagraphs = [
      {
        type: "paragraph",
        content: {
          nodes: [
            { type: "text", text: "Hello " },
            {
              type: "image",
              attrs: { src: "images/runtime-1.png" },
            },
            { type: "text", text: " world" },
          ],
          forEach(cb: any) {
            this.nodes.forEach((n) => cb(n));
          },
        },
      },
      {
        type: "paragraph",
        content: {
          nodes: [
            {
              type: "image",
              attrs: { src: "images/runtime-2.png" },
            },
          ],
          forEach(cb: any) {
            this.nodes.forEach((n) => cb(n));
          },
        },
      },
    ];
    const fakeDocFragment = {
      nodes: childParagraphs,
      forEach(cb: any) {
        this.nodes.forEach((n) => cb(n));
      },
    };
    const liveDoc = { type: "doc", content: fakeDocFragment };
    const out: string[] = [];
    await walkAndCopyImages(liveDoc, out);
    expect(out).toEqual(["images/runtime-1.png", "images/runtime-2.png"]);
  });
});
