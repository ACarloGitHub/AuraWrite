function contentToArray(content: any): any[] {
  if (!content) return [];
  const result: any[] = [];
  if (typeof content.forEach === "function") {
    content.forEach((node: any) => result.push(node));
  }
  return result;
}

/**
 * Get the type name of a ProseMirror node, handling BOTH shapes that appear
 * in AuraWrite:
 *  - Serialized form: `node.type === "page"` (a plain string)
 *  - Live ProseMirror form: `node.type.name === "page"` (a Spec object)
 * Returns the type name as a string, or null if neither shape matches.
 */
function getNodeType(node: any): string | null {
  if (!node) return null;
  if (typeof node.type === "string") return node.type;
  if (node.type && typeof node.type.name === "string") return node.type.name;
  return null;
}

/**
 * Normalize a ProseMirror node-like input into a list of child nodes to
 * convert. Handles the three top-level shapes we see in AuraWrite:
 *  - A raw Fragment (has .forEach directly)
 *  - A ProseMirror "doc" node (has .content which is a Fragment)
 *  - A ProseMirror "page" node (has .content which is a Fragment)
 *  - A plain array of nodes
 */
function rootToNodes(input: any): any[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input.forEach === "function") {
    // Raw Fragment
    const arr: any[] = [];
    input.forEach((n: any) => arr.push(n));
    return arr;
  }
  if (input.content && typeof input.content.forEach === "function") {
    // ProseMirror node with .content (doc, page, list_item, etc.)
    const arr: any[] = [];
    input.content.forEach((n: any) => arr.push(n));
    return arr;
  }
  // Single node passed directly
  if (input.type && typeof input.type.name === "string") {
    return [input];
  }
  return [];
}

export function toMarkdown(doc: any): string {
  const nodes = rootToNodes(doc);
  let result = "";
  for (const node of nodes) {
    result += nodeToMarkdown(node);
  }
  return result;
}

/**
 * Like toMarkdown, but with image and link transformations applied.
 * Used by the Obsidian vault export to rewrite image srcs and internal links.
 *
 * @param doc ProseMirror document node
 * @param opts.imagePathFor Function that maps an image src to a relative
 *   path to use in the .md (e.g. "_attachments/<doc-title>/image.png").
 *   If not provided, image srcs are used as-is.
 * @param opts.linkPathFor Function that maps an internal link href to a
 *   relative path or wikilink. If it returns a string starting with "[[",
 *   it is inserted as-is (wikilink). Otherwise it is wrapped in a
 *   markdown link [text](result).
 */
export function toMarkdownWithRewrites(
  doc: any,
  opts: {
    imagePathFor?: (src: string, alt?: string, title?: string) => string | null;
    linkPathFor?: (href: string) => string | null;
    /**
     * If true, image paths that start with "attachments/" are emitted
     * as Obsidian wikilink embeds (![[attachments/<file>]]) instead of
     * the standard markdown ![]() syntax. This is more reliable for
     * images that live in subfolders of the vault.
     */
    useObsidianWikilinks?: boolean;
  } = {}
): string {
  const nodes = rootToNodes(doc);
  let result = "";
  for (const node of nodes) {
    result += nodeToMarkdown(node, opts);
  }
  return result;
}

function nodeToMarkdown(
  node: any,
  opts: {
    imagePathFor?: (src: string, alt?: string, title?: string) => string | null;
    linkPathFor?: (href: string) => string | null;
    useObsidianWikilinks?: boolean;
  } = {}
): string {
  const t = getNodeType(node);
  switch (t) {
    case "paragraph": {
      const text = contentToArray(node.content)
        .map((n: any) => inlineToMarkdown(n, opts))
        .join("") || "";
      const pageBreak = node.attrs?.pageBreakBefore ? "---\n\n" : "";
      return pageBreak + text + "\n\n";
    }
    case "heading": {
      const level = node.attrs.level || 1;
      const hText = contentToArray(node.content)
        .map((n: any) => inlineToMarkdown(n, opts))
        .join("") || "";
      const hPageBreak = node.attrs?.pageBreakBefore ? "---\n\n" : "";
      return hPageBreak + "#".repeat(level) + " " + hText + "\n\n";
    }
    case "blockquote": {
      const quote = contentToArray(node.content)
        .map((n: any) => nodeToMarkdown(n, opts))
        .join("") || "";
      return "> " + quote.replace(/\n/g, "\n> ");
    }
    case "code_block": {
      const codeText = node.textContent || "";
      let fence = "```";
      while (codeText.includes(fence)) {
        fence += "`";
      }
      return fence + "\n" + codeText + "\n" + fence + "\n\n";
    }
    case "bullet_list":
      return (
        contentToArray(node.content)
          .map((item: any) => {
            const itemContent = contentToArray(item.content)
              .map((n: any) => nodeToMarkdown(n, opts))
              .join("") || "";
            return "- " + itemContent.replace(/\n\n/g, "\n");
          })
          .join("\n") + "\n\n"
      );
    case "ordered_list":
      return (
        contentToArray(node.content)
          .map((item: any, index: number) => {
            const itemContent = contentToArray(item.content)
              .map((n: any) => nodeToMarkdown(n, opts))
              .join("") || "";
            return index + 1 + ". " + itemContent.replace(/\n\n/g, "\n");
          })
          .join("\n") + "\n\n"
      );
    case "horizontal_rule":
      return "---\n\n";
    case "page": {
      // Paged-mode wrapper node. Just render its children; the page break
      // is implicit between pages in the source document, no need to add
      // a `---` separator here (that would create spurious horizontal rules
      // in the exported .md).
      return (
        contentToArray(node.content)
          .map((n: any) => nodeToMarkdown(n, opts))
          .join("") + "\n"
      );
    }
    case "list_item": {
      // Top-level list item (e.g. used by bullet_list/ordered_list). Render
      // its children inline so they sit on the same line as the marker.
      return (
        contentToArray(node.content)
          .map((n: any) => nodeToMarkdown(n, opts))
          .join("")
          .replace(/^\n+|\n+$/g, "")
          .replace(/\n\n+/g, "\n") + "\n"
      );
    }
    case "image": {
      const src: string = node.attrs?.src || "";
      const alt: string = node.attrs?.alt || "";
      const title: string = node.attrs?.title || "";
      // Resolve path: if imagePathFor returns a non-null path, use it;
      // otherwise use src as-is. The Obsidian export uses this to rewrite
      // asset://localhost/... into relative _attachments/<doc-title>/...
      const resolved =
        opts.imagePathFor && src
          ? opts.imagePathFor(src, alt, title)
          : null;
      const finalPath = resolved || src;
      const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
      // Obsidian wikilink embed syntax (no description) is more reliable
      // than the standard ![alt](path) markdown form, especially for
      // images that live in subfolders of the vault. Detect paths that
      // start with the literal "attachments/" and emit the wikilink form.
      if (opts.useObsidianWikilinks && finalPath.startsWith("attachments/")) {
        return `![[${finalPath}]]\n\n`;
      }
      return `![${alt}](${finalPath}${titlePart})\n\n`;
    }
    default:
      if (node.isBlock) {
        return nodeToMarkdown({ ...node, type: { name: "paragraph" } }, opts);
      }
      return "";
  }
}

function inlineToMarkdown(
  node: any,
  opts: {
    imagePathFor?: (src: string, alt?: string, title?: string) => string | null;
    linkPathFor?: (href: string) => string | null;
    useObsidianWikilinks?: boolean;
  } = {}
): string {
  if (getNodeType(node) === "image") {
    // No diagnostic logging here.
  } else if (node && (node.isBlock || getNodeType(node) === "paragraph")) {
    // Block-level node inside a paragraph (unusual but possible if
    // the document has nested paragraphs from a previous bug or import).
    // Recurse into its children to find inline content.
    const sub = node.content;
    if (sub && typeof sub.forEach === "function") {
      const kids: any[] = [];
      sub.forEach((c: any) => kids.push(c));
      return kids.map((k) => inlineToMarkdown(k, opts)).join("");
    }
    if (Array.isArray(sub)) {
      return sub.map((k: any) => inlineToMarkdown(k, opts)).join("");
    }
    return "";
  }
  if (getNodeType(node) === "text") {
    let text = node.text || "";
    if (node.marks) {
      for (const mark of node.marks) {
        switch (getNodeType(mark)) {
          case "strong":
            text = "**" + text + "**";
            break;
          case "em":
            text = "*" + text + "*";
            break;
          case "code":
            text = "`" + text.replace(/`/g, "\u200b`") + "`";
            break;
          case "strikethrough":
            text = "~~" + text + "~~";
            break;
          case "underline":
            text = "<u>" + text + "</u>";
            break;
          case "subscript":
            text = "<sub>" + text + "</sub>";
            break;
          case "superscript":
            text = "<sup>" + text + "</sup>";
            break;
          case "link": {
            const href: string = mark.attrs?.href || "";
            if (opts.linkPathFor && href) {
              const resolved = opts.linkPathFor(href);
              if (resolved !== null && resolved !== undefined) {
                // If resolved starts with "[[", emit as wikilink (no [text])
                if (resolved.startsWith("[[")) {
                  text = resolved;
                  break;
                }
                text = "[" + text + "](" + resolved + ")";
                break;
              }
            }
            text = "[" + text + "](" + href + ")";
            break;
          }
        }
      }
    }
    return text;
  }
  // Inline image: not technically inline in ProseMirror (image is a leaf
  // node), but it can appear inside a paragraph. Emit markdown syntax.
  if (getNodeType(node) === "image") {
    const src: string = node.attrs?.src || "";
    const alt: string = node.attrs?.alt || "";
    const title: string = node.attrs?.title || "";
    const resolved = opts.imagePathFor && src ? opts.imagePathFor(src, alt, title) : null;
    const finalPath = resolved || src;
    // Obsidian wikilink embed syntax for attachments/ paths
    if (opts.useObsidianWikilinks && finalPath.startsWith("attachments/")) {
      return `![[${finalPath}]]`;
    }
    const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
    return `![${alt}](${finalPath}${titlePart})`;
  }
  return "";
}

export function fromMarkdown(markdown: string): any {
  const lines = markdown.split("\n");
  const content: any[] = [];
  let i = 0;
  let pendingPageBreak = false;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("#")) {
      const match = line.match(/^(#{1,6})\s+(.*)/);
      if (match) {
        content.push({
          type: "heading",
          attrs: { level: match[1].length, pageBreakBefore: pendingPageBreak },
          content: [{ type: "text", text: match[2] }],
        });
        pendingPageBreak = false;
        i++;
        continue;
      }
    }

    if (line.startsWith(">")) {
      const quoteLines = [line.substring(1).trim()];
      i++;
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].substring(1).trim());
        i++;
      }
      content.push({
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            attrs: { pageBreakBefore: pendingPageBreak },
            content: [{ type: "text", text: quoteLines.join(" ") }],
          },
        ],
      });
      pendingPageBreak = false;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      content.push({
        type: "code_block",
        attrs: { pageBreakBefore: pendingPageBreak },
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      pendingPageBreak = false;
      i++;
      continue;
    }

    if (line.match(/^[-*]\s+/)) {
      const items: any[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        const text = lines[i].replace(/^[-*]\s+/, "");
        items.push({
          type: "list_item",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text }],
            },
          ],
        });
        i++;
      }
      if (pendingPageBreak && items.length > 0) {
        items[0].attrs = { ...(items[0].attrs || {}), pageBreakBefore: true };
        pendingPageBreak = false;
      }
      content.push({ type: "bullet_list", content: items });
      continue;
    }

    if (line.match(/^\d+\.\s+/)) {
      const items: any[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        const text = lines[i].replace(/^\d+\.\s+/, "");
        items.push({
          type: "list_item",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text }],
            },
          ],
        });
        i++;
      }
      if (pendingPageBreak && items.length > 0) {
        items[0].attrs = { ...(items[0].attrs || {}), pageBreakBefore: true };
        pendingPageBreak = false;
      }
      content.push({
        type: "ordered_list",
        attrs: { order: 1 },
        content: items,
      });
      continue;
    }

    if (line === "---" || line === "***") {
      pendingPageBreak = true;
      i++;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    content.push({
      type: "paragraph",
      attrs: { pageBreakBefore: pendingPageBreak },
      content: parseInlineMarkdown(line),
    });
    pendingPageBreak = false;
    i++;
  }

  return {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
}

function parseInlineMarkdown(text: string): any[] {
  const result: any[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const strongMatch = remaining.match(/^\*\*(.+?)\*\*/);
    const emMatch = remaining.match(/^\*(.+?)\*/);
    const codeMatch = remaining.match(/^`(.+?)`/);

    if (strongMatch) {
      result.push({
        type: "text",
        text: strongMatch[1],
        marks: [{ type: "strong" }],
      });
      remaining = remaining.substring(strongMatch[0].length);
    } else if (emMatch) {
      result.push({ type: "text", text: emMatch[1], marks: [{ type: "em" }] });
      remaining = remaining.substring(emMatch[0].length);
    } else if (codeMatch) {
      result.push({
        type: "text",
        text: codeMatch[1],
        marks: [{ type: "code" }],
      });
      remaining = remaining.substring(codeMatch[0].length);
    } else {
      const nextSpecial = remaining.search(/\*\*|\*|`/);
      if (nextSpecial === -1) {
        if (remaining.trim()) {
          result.push({ type: "text", text: remaining });
        }
        break;
      } else if (nextSpecial === 0) {
        result.push({ type: "text", text: remaining[0] });
        remaining = remaining.substring(1);
      } else {
        result.push({
          type: "text",
          text: remaining.substring(0, nextSpecial),
        });
        remaining = remaining.substring(nextSpecial);
      }
    }
  }

  return result.length > 0 ? result : [{ type: "text", text: "" }];
}
