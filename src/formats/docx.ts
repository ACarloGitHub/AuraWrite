import mammoth from "mammoth";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

export async function fromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value;
}

export function toDocx(doc: any): Document {
  const children: Paragraph[] = [];
  
  doc.forEach((node: any) => {
    const paragraph = nodeToParagraph(node);
    if (paragraph) {
      children.push(paragraph);
    }
  });

  return new Document({
    sections: [
      {
        children,
      },
    ],
  });
}

function nodeToParagraph(node: any): Paragraph | null {
  switch (node.type.name) {
    case "paragraph":
      return new Paragraph({
        children: nodeContentToRuns(node),
      });
    case "heading":
      return new Paragraph({
        text: getTextContent(node),
        heading: getHeadingLevel(node.attrs.level),
      });
    case "blockquote":
      return new Paragraph({
        children: [
          new TextRun({
            text: getBlockTextContent(node),
            italics: true,
          }),
        ],
        indent: { left: 720 },
      });
    case "code_block":
      return new Paragraph({
        children: [
          new TextRun({
            text: node.textContent,
            font: "Courier New",
          }),
        ],
        shading: { fill: "F5F5F5" },
      });
    case "bullet_list":
      return new Paragraph({
        children: node.content?.flatMap((item: any) => nodeContentToRuns(item)) || [],
        bullet: { level: 0 },
      });
    case "ordered_list":
      return new Paragraph({
        children: node.content?.flatMap((item: any) => nodeContentToRuns(item)) || [],
        numbering: { reference: "default-numbering", level: 0 },
      });
    case "horizontal_rule":
      return new Paragraph({
        children: [new TextRun("")],
        border: { bottom: { color: "CCCCCC", size: 1, space: 1, style: "single" } },
      });
    default:
      if (node.isBlock) {
        return new Paragraph({ children: [new TextRun({ text: getTextContent(node) })] });
      }
      return null;
  }
}

function nodeContentToRuns(node: any): TextRun[] {
  if (!node.content) {
    const text = node.text || "";
    return text ? [new TextRun({ text })] : [];
  }

  return node.content.map((child: any) => {
    if (child.type.name === "text") {
      const run: any = { text: child.text || "" };
      if (child.marks) {
        for (const mark of child.marks) {
          switch (mark.type.name) {
            case "strong":
              run.bold = true;
              break;
            case "em":
              run.italics = true;
              break;
            case "code":
              run.font = "Courier New";
              break;
          }
        }
      }
      return new TextRun(run);
    }
    return new TextRun({ text: getTextContent(child) });
  });
}

function getTextContent(node: any): string {
  if (!node.content) return node.text || "";
  return node.content.map((child: any) => child.text || "").join("");
}

function getBlockTextContent(node: any): string {
  if (!node.content) return "";
  return node.content.map((child: any) => getTextContent(child)).join(" ");
}

function getHeadingLevel(level: number) {
  switch (level) {
    case 1:
      return "Heading1" as const;
    case 2:
      return "Heading2" as const;
    case 3:
      return "Heading3" as const;
    case 4:
      return "Heading4" as const;
    case 5:
      return "Heading5" as const;
    case 6:
      return "Heading6" as const;
    default:
      return "Heading1" as const;
  }
}

export { Packer };
