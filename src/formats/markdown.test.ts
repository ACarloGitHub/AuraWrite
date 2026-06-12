import { describe, it, expect } from "vitest";
import { toMarkdown, toMarkdownWithRewrites } from "./markdown";

describe("toMarkdown — multi-page with inline image", () => {
  it("renders a doc with 2 pages, second page has inline image", () => {
    const testJson = {
      type: "doc",
      content: [
        {
          type: "page",
          attrs: { pageNumber: 1 },
          content: [
            { type: "heading", attrs: { level: 1, align: "center", lineHeight: "1.5" }, content: [{ type: "text", text: "Chapter One" }] },
            { type: "paragraph", attrs: { align: "left" }, content: [{ type: "text", text: "Text of page 1." }] }
          ]
        },
        {
          type: "page",
          attrs: { pageNumber: 1 },
          content: [
            { type: "paragraph", attrs: { align: "left" }, content: [
              { type: "image", attrs: { src: "images/foo.png", alt: "Image" } }
            ]}
          ]
        }
      ]
    };
    const result = toMarkdown(testJson);
    expect(result).toContain("Chapter One");
    expect(result).toContain("Text of page 1.");
    expect(result).toContain("![Image](images/foo.png)");
  });

  it("renders an image inline in a paragraph without page wrapper", () => {
    const testJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Below: " },
            { type: "image", attrs: { src: "images/bar.png", alt: "Bar" } },
            { type: "text", text: " after." }
          ]
        }
      ]
    };
    const result = toMarkdown(testJson);
    expect(result).toContain("![Bar](images/bar.png)");
  });

  it("renders correctly with a live ProseMirror node shape (type as object)", () => {
    const testJson = {
      type: { name: "doc" },
      content: [
        {
          type: { name: "paragraph" },
          content: [
            { type: { name: "text" }, text: "Hello " },
            { type: { name: "text" }, text: "world" }
          ]
        }
      ]
    };
    const result = toMarkdown(testJson);
    expect(result).toContain("Hello world");
  });

  it("rewrites image src via imagePathFor (Obsidian export use case)", () => {
    const testJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "images/foo.png", alt: "Foo" } }
          ]
        }
      ]
    };
    const result = toMarkdownWithRewrites(testJson, {
      imagePathFor: (src) => `_attachments/Doc1/${src.substring("images/".length)}`
    });
    expect(result).toContain("![Foo](_attachments/Doc1/foo.png)");
  });

  it("emits Obsidian wikilink ![[]] for attachments/ paths when useObsidianWikilinks is true", () => {
    const testJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "images/foo.png", alt: "Foo" } }
          ]
        }
      ]
    };
    const result = toMarkdownWithRewrites(testJson, {
      useObsidianWikilinks: true,
      imagePathFor: (src) => `attachments/Doc1-${src.substring("images/".length)}`,
    });
    expect(result).toContain("![[attachments/Doc1-foo.png]]");
    // alt should NOT appear in wikilink form
    expect(result).not.toContain("![Foo]");
  });

  it("keeps standard markdown ![]() when useObsidianWikilinks is false", () => {
    const testJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "images/foo.png", alt: "Foo" } }
          ]
        }
      ]
    };
    const result = toMarkdownWithRewrites(testJson, {
      useObsidianWikilinks: false,
      imagePathFor: (src) => `attachments/Doc1-${src.substring("images/".length)}`,
    });
    expect(result).toContain("![Foo](attachments/Doc1-foo.png)");
  });

  it("rewrites aurawrite-doc:// links to wikilinks", () => {
    const testJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "see ",
              marks: [{ type: "link", attrs: { href: "aurawrite-doc://abc-123" } }]
            },
            { type: "text", text: " for details" }
          ]
        }
      ]
    };
    const result = toMarkdownWithRewrites(testJson, {
      linkPathFor: (href) => {
        const m = href.match(/^aurawrite-doc:\/\/([a-zA-Z0-9-]+)$/);
        if (m) return `[[Doc Title ${m[1]}]]`;
        return null;
      }
    });
    expect(result).toContain("[[Doc Title abc-123]]");
  });
});
