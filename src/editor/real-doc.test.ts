// Diagnostic test: verify how getNodeType behaves for an image node
// extracted from a real ProseMirror document
import { describe, it, expect } from "vitest";
import fs from "fs";
import { toMarkdown, toMarkdownWithRewrites } from "../formats/markdown";

describe("diagnostic: real doc image node", () => {
  it("extracts the image node from the real DB and converts it", () => {
    const dbPath = "C:\\Users\\carlo\\AppData\\Roaming\\aurawrite\\aurawrite.db";
    if (!fs.existsSync(dbPath)) {
      console.log("DB not found");
      return;
    }
    // Read the doc that has the image
    const buf = fs.readFileSync(dbPath);
    // Find all image nodes via byte search
    const imageNeedle = Buffer.from('"type":"image"');
    const positions: number[] = [];
    let p = 0;
    while ((p = buf.indexOf(imageNeedle, p)) >= 0) {
      positions.push(p);
      p++;
    }
    console.log(`Found ${positions.length} image node(s) in DB`);
    if (positions.length === 0) return;

    // Find the closest '{' before the first image to get the parent paragraph
    const imgPos = positions[0];
    console.log("First image at byte", imgPos);
    console.log("Context (200 bytes before, 200 after):");
    const ctx = buf.subarray(Math.max(0, imgPos - 200), imgPos + 200).toString("utf8").replace(/[^\x20-\x7E]/g, ".");
    console.log(ctx);

    // Find the parent paragraph by walking backward to find {
    let depth = 0;
    let paragraphStart = -1;
    let p2 = imgPos;
    while (p2 > 0) {
      if (buf[p2] === 0x7d) depth++;
      if (buf[p2] === 0x7b) {
        if (depth === 0) { paragraphStart = p2; break; }
        depth--;
      }
      p2--;
    }
    console.log("Approx paragraph start:", paragraphStart);
    // Print 300 bytes from the paragraph start
    if (paragraphStart > 0) {
      const paraCtx = buf.subarray(paragraphStart, Math.min(paragraphStart + 300, buf.length)).toString("utf8").replace(/[^\x20-\x7E]/g, ".");
      console.log("Paragraph context:");
      console.log(paraCtx);
    }
  });

  it("walks a synthetic doc with the EXACT real structure we observed", () => {
    // From the user's screenshots, the JSON is:
    // {"type":"doc", "content":[{"type":"page", "attrs":{...}, "content":[
    //   {"type":"heading", "attrs":{"level":1, "align":"center", "lineHeight":"1.5"}, "content":[{"type":"text", "text":"Chapter One — ..."}]},
    //   {"type":"paragraph", "attrs":{...}, "content":[{"type":"text", "text":"..."}]},
    //   ...
    //   {"type":"paragraph", "attrs":{...}, "content":[
    //     {"type":"image", "attrs":{"src":"images/1781...png", ...}}
    //   ]}
    // ]}]}
    //
    // The image is a leaf node inside paragraph.content. The fix should
    // call inlineToMarkdown on the image, which matches the "image" case.
    const doc = {
      type: "doc",
      content: [
        {
          type: "page",
          attrs: { pageNumber: 1 },
          content: [
            { type: "heading", attrs: { level: 1, align: "center", lineHeight: "1.5" }, content: [{ type: "text", text: "Chapter One" }] },
            { type: "paragraph", attrs: { align: "left", lineHeight: "1.5" }, content: [{ type: "text", text: "intro" }] },
            // The image is the only content of the LAST paragraph (the 2nd page break case)
            {
              type: "paragraph",
              attrs: { align: "center", lineHeight: "1.5", pageBreakBefore: true },
              content: [
                {
                  type: "image",
                  attrs: {
                    src: "images/1781253306593-an_android_with_human_proportion_standing_in_a_high__0eb4b7ca-33c9-480c-84f5-910f7eaebccc.png",
                    alt: "an_android_with_human_proportion_standing_in_a_high__0eb4b7ca-33c9-480c-84f5-910f7eaebccc",
                    title: "...",
                    width: 146,
                    height: 152,
                    align: "center",
                    offsetX: -227,
                    offsetY: -429,
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const map = new Map<string, string>();
    function walk(node: any) {
      if (!node) return;
      if (node.type === "image" || (node.type && node.attrs?.src)) {
        const src = node.attrs?.src;
        if (src) map.set(src, "8_attachments/" + src.substring("images/".length));
        return;
      }
      if (Array.isArray(node.content)) { for (const c of node.content) walk(c); return; }
      if (node.content && typeof node.content.forEach === "function") {
        const ch: any[] = [];
        node.content.forEach((c: any) => ch.push(c));
        for (const c of ch) walk(c);
        return;
      }
    }
    walk(doc);
    console.log("walked, map size:", map.size);

    // Now toMarkdownWithRewrites with the same map
    let pathForCallCount = 0;
    const result = toMarkdownWithRewrites(doc, {
      imagePathFor: (src: string) => {
        pathForCallCount++;
        console.log("[test] imagePathFor called with:", src);
        return map.get(src) ?? null;
      },
    });
    console.log("pathForCallCount:", pathForCallCount);
    console.log("result length:", result.length);
    console.log("result has ![:", result.includes("!["));
    console.log("first 300 chars:", result.substring(0, 300));
  });
});
