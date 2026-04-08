import { schema as basicSchema } from "prosemirror-schema-basic";

export function toMarkdown(doc: any): string {
  let result = "";
  doc.forEach((node: any) => {
    result += nodeToMarkdown(node);
  });
  return result;
}

function nodeToMarkdown(node: any): string {
  switch (node.type.name) {
    case "paragraph":
      const text = node.content?.map(inlineToMarkdown).join("") || "";
      const pageBreak = node.attrs?.pageBreakBefore ? "---\n\n" : "";
      return pageBreak + text + "\n\n";
    case "heading":
      const level = node.attrs.level || 1;
      const hText = node.content?.map(inlineToMarkdown).join("") || "";
      const hPageBreak = node.attrs?.pageBreakBefore ? "---\n\n" : "";
      return hPageBreak + "#".repeat(level) + " " + hText + "\n\n";
    case "blockquote":
      const quote = node.content?.map(nodeToMarkdown).join("") || "";
      return "> " + quote.replace(/\n/g, "\n> ");
    case "code_block":
      return "```\n" + (node.textContent || "") + "\n```\n\n";
    case "bullet_list":
      return (
        node.content
          ?.map((item: any) => {
            const itemContent =
              item.content?.map(nodeToMarkdown).join("") || "";
            return "- " + itemContent.replace(/\n\n/g, "\n");
          })
          .join("\n") + "\n\n"
      );
    case "ordered_list":
      return (
        node.content
          ?.map((item: any, index: number) => {
            const itemContent =
              item.content?.map(nodeToMarkdown).join("") || "";
            return index + 1 + ". " + itemContent.replace(/\n\n/g, "\n");
          })
          .join("\n") + "\n\n"
      );
    case "horizontal_rule":
      return "---\n\n";
    default:
      if (node.isBlock) {
        return nodeToMarkdown({ ...node, type: { name: "paragraph" } });
      }
      return "";
  }
}

function inlineToMarkdown(node: any): string {
  if (node.type.name === "text") {
    let text = node.text || "";
    if (node.marks) {
      for (const mark of node.marks) {
        switch (mark.type.name) {
          case "strong":
            text = "**" + text + "**";
            break;
          case "em":
            text = "*" + text + "*";
            break;
          case "code":
            text = "`" + text + "`";
            break;
          case "link":
            text = "[" + text + "](" + (mark.attrs?.href || "") + ")";
            break;
        }
      }
    }
    return text;
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
