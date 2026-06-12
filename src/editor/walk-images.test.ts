// Test the walkAndCopyImages-like traversal logic in isolation
// (the helper in toolbar.ts is not exported, so we test the equivalent
// pattern here to catch regressions in the iteration over content).

import { describe, it, expect } from "vitest";
import { toMarkdownWithRewrites } from "../formats/markdown";

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

  it("end-to-end: walkAndCopyImages builds imageMap, imagePathFor rewrites", async () => {
    // This is the exact scenario in handleExportMarkdownSingle: walk the
    // doc, collect images into a Map<src, newRelPath>, then pass
    // imagePathFor to toMarkdownWithRewrites.
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "intro " },
            { type: "image", attrs: { src: "images/foo.png", alt: "Foo" } },
          ],
        },
      ],
    };
    const map = new Map<string, string>();
    // Mirror the production walkAndCopyImages
    async function walk(node: any) {
      if (!node) return;
      if (node.type === "image") {
        const src = node.attrs?.src;
        if (src) map.set(src, "Chapter One_attachments/foo.png");
        return;
      }
      if (Array.isArray(node.content)) {
        for (const c of node.content) await walk(c);
      } else if (node.content && typeof node.content.forEach === "function") {
        const children: any[] = [];
        node.content.forEach((c: any) => children.push(c));
        for (const c of children) await walk(c);
      }
    }
    await walk(json);
    expect(map.size).toBe(1);
    expect(map.get("images/foo.png")).toBe("Chapter One_attachments/foo.png");

    // Now simulate the imagePathFor callback
    const imagePathFor = (src: string) => map.get(src) ?? null;
    const result = toMarkdownWithRewrites(json, { imagePathFor });
    expect(result).toContain("![Foo](Chapter One_attachments/foo.png)");
  });

  it("REPRODUCES THE BUG: image in 2nd page paragraph with no surrounding text", async () => {
    // The user's actual case: image is the ONLY content of a paragraph
    // in the 2nd page. No surrounding text.
    const liveDocWith2ndPage: any = {
      type: "doc",
      content: {
        nodes: [
          // First page: heading + lots of paragraphs (skipped for brevity)
          {
            type: "heading",
            attrs: { level: 1, align: "center", lineHeight: "1.5" },
            content: {
              nodes: [{ type: "text", text: "Chapter One" }],
              forEach(cb: any) { this.nodes.forEach((n) => cb(n)); },
            },
          },
          {
            type: "paragraph",
            attrs: { align: "left", lineHeight: "1.5" },
            content: {
              nodes: [{ type: "text", text: "Many paragraphs of prose here..." }],
              forEach(cb: any) { this.nodes.forEach((n) => cb(n)); },
            },
          },
          // Second page: only an image
          {
            type: "page",
            attrs: { pageNumber: 1 },
            content: {
              nodes: [
                {
                  type: "paragraph",
                  attrs: { align: "center", lineHeight: "1.5" },
                  content: {
                    nodes: [
                      {
                        type: "image",
                        attrs: {
                          src: "images/1781253306593-an_android_with_human_proportion.png",
                          alt: "An android",
                          title: "An android",
                          width: 146,
                          height: 152,
                          align: "center",
                          offsetX: -227,
                          offsetY: -429,
                        },
                      },
                    ],
                    forEach(cb: any) { this.nodes.forEach((n) => cb(n)); },
                  },
                },
              ],
              forEach(cb: any) { this.nodes.forEach((n) => cb(n)); },
            },
          },
        ],
        forEach(cb: any) { this.nodes.forEach((n) => cb(n)); },
      },
    };

    const map = new Map<string, string>();
    async function walk(node: any) {
      if (!node) return;
      if (node.type === "image" || (node.type && node.attrs?.src)) {
        const src = node.attrs?.src;
        if (src) map.set(src, "8_attachments/1781253306593-an_android_with_human_proportion.png");
        return;
      }
      const c = node.content;
      if (Array.isArray(c)) { for (const x of c) await walk(x); return; }
      if (c && typeof c.forEach === "function") {
        const ch: any[] = [];
        c.forEach((x: any) => ch.push(x));
        for (const x of ch) await walk(x);
        return;
      }
    }
    await walk(liveDocWith2ndPage);
    console.log("map size:", map.size);
    console.log("map keys:", Array.from(map.keys()));
    expect(map.size).toBe(1);

    const imagePathFor = (src: string) => map.get(src) ?? null;
    const result = toMarkdownWithRewrites(liveDocWith2ndPage, { imagePathFor });
    console.log("RESULT:");
    console.log(result);
    expect(result).toContain("![An android](8_attachments/");
  });

  it("end-to-end with image inside a 2nd page (the AuraWrite runtime case)", async () => {
    // The user observed that images in the second page are not rewritten.
    // Walk the doc as it would come from the live editor, and call
    // toMarkdownWithRewrites with imagePathFor pointing to the same map.
    const liveDocWith2ndPage: any = {
      type: "doc",
      content: {
        nodes: [
          {
            type: "page",
            attrs: { pageNumber: 1 },
            content: {
              nodes: [
                {
                  type: "heading",
                  attrs: { level: 1, align: "center", lineHeight: "1.5" },
                  content: {
                    nodes: [{ type: "text", text: "Chapter One" }],
                    forEach(cb: any) { this.nodes.forEach((n) => cb(n)); },
                  },
                },
                {
                  type: "paragraph",
                  attrs: { align: "left", lineHeight: "1.5" },
                  content: {
                    nodes: [{ type: "text", text: "intro" }],
                    forEach(cb: any) { this.nodes.forEach((n) => cb(n)); },
                  },
                },
              ],
              forEach(cb: any) { this.nodes.forEach((n) => cb(n)); },
            },
          },
          {
            type: "page",
            attrs: { pageNumber: 1 },
            content: {
              nodes: [
                {
                  type: "paragraph",
                  attrs: { align: "left", lineHeight: "1.5" },
                  content: {
                    nodes: [
                      { type: "image", attrs: { src: "images/p2-img.png", alt: "P2" } },
                    ],
                    forEach(cb: any) { this.nodes.forEach((n) => cb(n)); },
                  },
                },
              ],
              forEach(cb: any) { this.nodes.forEach((n) => cb(n)); },
            },
          },
        ],
        forEach(cb: any) { this.nodes.forEach((n) => cb(n)); },
      },
    };

    const map = new Map<string, string>();
    async function walk(node: any) {
      if (!node) return;
      if (node.type === "image") {
        const src = node.attrs?.src;
        if (src) map.set(src, "Chapter One_attachments/p2-img.png");
        return;
      }
      const c = node.content;
      if (Array.isArray(c)) { for (const x of c) await walk(x); return; }
      if (c && typeof c.forEach === "function") {
        const ch: any[] = [];
        c.forEach((x: any) => ch.push(x));
        for (const x of ch) await walk(x);
        return;
      }
    }
    await walk(liveDocWith2ndPage);
    expect(map.size).toBe(1);
    expect(map.get("images/p2-img.png")).toBe("Chapter One_attachments/p2-img.png");

    const imagePathFor = (src: string) => map.get(src) ?? null;
    const result = toMarkdownWithRewrites(liveDocWith2ndPage, { imagePathFor });
    // The key assertion: the image link must be in the output
    expect(result).toContain("![P2](Chapter One_attachments/p2-img.png)");
  });
});
