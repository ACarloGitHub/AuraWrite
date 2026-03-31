export function toPlainText(doc: any): string {
  return doc.textContent;
}

export function fromPlainText(text: string): any {
  const lines = text.split("\n").filter((line) => line.length > 0);
  
  const content = lines.map((line) => ({
    type: "paragraph",
    content: line
      ? [
          {
            type: "text",
            text: line,
          },
        ]
      : undefined,
  })).filter((p) => p.content !== undefined);

  return {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
}
