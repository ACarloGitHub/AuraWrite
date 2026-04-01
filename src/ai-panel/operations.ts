export type MarkType = "strong" | "em" | "underline" | "code" | "link";

export interface TextNode {
  type: "text";
  text: string;
  marks?: MarkType[];
  href?: string;
}

export interface ParagraphNode {
  type: "paragraph";
  content: TextNode[];
}

export interface HeadingNode {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  content: TextNode[];
}

export interface ListItemNode {
  type: "list_item";
  content: TextNode[];
}

export interface BulletListNode {
  type: "bullet_list";
  items: ListItemNode[];
}

export interface OrderedListNode {
  type: "ordered_list";
  items: ListItemNode[];
}

export interface BlockquoteNode {
  type: "blockquote";
  content: ParagraphNode[];
}

export type ContentNode =
  | TextNode
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | BlockquoteNode;

export type OperationType = "replace" | "insert" | "delete" | "format";

export interface ReplaceOp {
  op: "replace";
  find: string;
  content: ContentNode[];
}

export interface InsertOp {
  op: "insert";
  find: string;
  position: "before" | "after";
  content: ContentNode[];
}

export interface DeleteOp {
  op: "delete";
  find: string;
}

export interface FormatOp {
  op: "format";
  find: string;
  addMark?: MarkType;
  removeMark?: MarkType;
}

export type Operation = ReplaceOp | InsertOp | DeleteOp | FormatOp;

export interface AuraEdit {
  aura_edit?: {
    message?: string;
    operations: Operation[];
  };
}
