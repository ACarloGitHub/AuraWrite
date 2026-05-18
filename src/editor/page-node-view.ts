import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";

export class PageNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private headerEl: HTMLElement;
  private footerEl: HTMLElement;
  private node: PMNode;
  private view: EditorView;
  private getPos: (() => number | undefined) | null;

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: (() => number | undefined) | null,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement("div");
    this.dom.className = "pm-page";
    this.dom.setAttribute("data-page-node", "true");

    this.headerEl = document.createElement("div");
    this.headerEl.className = "pm-page-header";

    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "pm-page-content";

    this.footerEl = document.createElement("div");
    this.footerEl.className = "pm-page-footer";

    this.dom.appendChild(this.headerEl);
    this.dom.appendChild(this.contentDOM);
    this.dom.appendChild(this.footerEl);

    this.updatePageNumber();
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "page") return false;
    this.node = node;
    this.updatePageNumber();
    return true;
  }

  destroy(): void {
    // ProseMirror handles DOM removal — no manual this.dom.remove()
  }

  private updatePageNumber(): void {
    const pos = this.getPos ? this.getPos() : undefined;
    if (pos === undefined) {
      this.footerEl.textContent = "";
      return;
    }

    let pageNum = 0;
    this.view.state.doc.forEach((child, offset) => {
      if (child.type.name === "page") {
        pageNum++;
        if (offset === pos) {
          this.footerEl.textContent = String(pageNum);
        }
      }
    });
  }

  refreshPageNumber(): void {
    this.updatePageNumber();
  }
}