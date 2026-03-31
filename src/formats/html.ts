export function toHTML(doc: any): string {
  let html = "";
  
  doc.forEach((node: any) => {
    html += nodeToHTML(node);
  });
  
  return wrapInHTMLDocument(html);
}

function nodeToHTML(node: any): string {
  switch (node.type.name) {
    case "paragraph":
      const content = node.content?.map(inlineToHTML).join("") || "";
      return `<p>${content}</p>`;
    case "heading":
      return `<h${node.attrs.level}>${node.content?.map(inlineToHTML).join("") || ""}</h${node.attrs.level}>`;
    case "blockquote":
      return `<blockquote>${node.content?.map(nodeToHTML).join("") || ""}</blockquote>`;
    case "code_block":
      return `<pre><code>${escapeHTML(node.textContent || "")}</code></pre>`;
    case "bullet_list":
      const items = node.content
        ?.map((item: any) => {
          const itemContent = item.content?.map(nodeToHTML).join("") || "";
          return `<li>${itemContent}</li>`;
        })
        .join("");
      return `<ul>${items}</ul>`;
    case "ordered_list":
      const orderedItems = node.content
        ?.map((item: any) => {
          const itemContent = item.content?.map(nodeToHTML).join("") || "";
          return `<li>${itemContent}</li>`;
        })
        .join("");
      return `<ol>${orderedItems}</ol>`;
    case "horizontal_rule":
      return "<hr/>";
    default:
      if (node.isBlock && node.content) {
        return node.content.map(nodeToHTML).join("");
      }
      return "";
  }
}

function inlineToHTML(node: any): string {
  if (node.type.name === "text") {
    let text = escapeHTML(node.text || "");
    if (node.marks) {
      for (const mark of node.marks) {
        switch (mark.type.name) {
          case "strong":
            text = `<strong>${text}</strong>`;
            break;
          case "em":
            text = `<em>${text}</em>`;
            break;
          case "code":
            text = `<code>${text}</code>`;
            break;
          case "link":
            text = `<a href="${escapeHTML(mark.attrs?.href || "")}">${text}</a>`;
            break;
        }
      }
    }
    return text;
  }
  return "";
}

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function wrapInHTMLDocument(bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AuraWrite Document</title>
  <style>
    body {
      font-family: Georgia, 'Times New Roman', serif;
      max-width: 720px;
      margin: 40px auto;
      padding: 20px;
      line-height: 1.7;
    }
    p { margin-bottom: 1em; }
    h1, h2, h3 { margin-top: 1.5em; }
    blockquote {
      border-left: 3px solid #ccc;
      margin-left: 0;
      padding-left: 1em;
      color: #666;
    }
    pre {
      background: #f5f5f5;
      padding: 1em;
      overflow-x: auto;
    }
    code {
      font-family: monospace;
      background: #f5f5f5;
    }
  </style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}
