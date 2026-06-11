import type { EditorView } from "prosemirror-view";
import { Node as PMNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { uploadImageFile, resolveImageSrc, type UploadedImage } from "./image-uploader";

export function createImageNode(
  view: EditorView,
  uploaded: UploadedImage
): PMNode | null {
  const { state } = view;
  const imageType = state.schema.nodes.image;
  if (!imageType) return null;

  const attrs: Record<string, unknown> = {
    src: uploaded.src,
    alt: uploaded.filename,
    title: uploaded.filename,
    width: uploaded.width,
    height: uploaded.height,
    align: "center",
  };
  return imageType.create(attrs);
}

function findInsertPos(view: EditorView): { pos: number; depth: number } | null {
  const { $from } = view.state.selection;
  const { image } = view.state.schema.nodes;
  if (!image) return null;
  let leafDepth = -1;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).isTextblock) {
      leafDepth = d;
      break;
    }
  }
  if (leafDepth < 0) return null;
  return { pos: $from.pos, depth: leafDepth };
}

export async function insertImageFromFile(
  view: EditorView,
  file: File
): Promise<boolean> {
  try {
    const uploaded = await uploadImageFile(file);
    const node = createImageNode(view, uploaded);
    if (!node) return false;
    const insert = findInsertPos(view);
    if (!insert) return false;
    const tr = view.state.tr.insert(insert.pos, node);
    const cursorPos = insert.pos + node.nodeSize;
    tr.setSelection(TextSelection.create(tr.doc, Math.min(cursorPos, tr.doc.content.size)));
    view.dispatch(tr);
    view.focus();
    return true;
  } catch (e) {
    console.error("[image] insert from file failed:", e);
    return false;
  }
}

export function insertImageFromSrc(
  view: EditorView,
  src: string,
  alt: string = ""
): boolean {
  const { state } = view;
  const imageType = state.schema.nodes.image;
  if (!imageType) return false;
  const insert = findInsertPos(view);
  if (!insert) return false;
  const node = imageType.create({
    src,
    alt,
    title: alt,
    width: null,
    height: null,
    align: "center",
  });
  const tr = state.tr.insert(insert.pos, node);
  const cursorPos = insert.pos + node.nodeSize;
  tr.setSelection(TextSelection.create(tr.doc, Math.min(cursorPos, tr.doc.content.size)));
  view.dispatch(tr);
  view.focus();
  return true;
}

export interface SelectedImageInfo {
  pos: number;
  node: PMNode;
  resolvedSrc: string;
}

export async function getSelectedImage(view: EditorView): Promise<SelectedImageInfo | null> {
  const { $from } = view.state.selection;
  if ($from.parent.type.spec.inline) return null;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "image") {
      const pos = $from.before(d);
      const resolvedSrc = await resolveImageSrc(node.attrs.src as string);
      return { pos, node, resolvedSrc };
    }
  }
  return null;
}

export async function setImageAlignment(
  view: EditorView,
  align: "left" | "center" | "right" | "inline"
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const tr = view.state.tr.setNodeMarkup(info.pos, undefined, {
    ...info.node.attrs,
    align,
  });
  view.dispatch(tr);
  return true;
}

export async function setImageSize(
  view: EditorView,
  width: number | null,
  height: number | null
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const tr = view.state.tr.setNodeMarkup(info.pos, undefined, {
    ...info.node.attrs,
    width,
    height,
  });
  view.dispatch(tr);
  return true;
}

export async function removeImage(view: EditorView): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const tr = view.state.tr.delete(info.pos, info.pos + info.node.nodeSize);
  view.dispatch(tr);
  return true;
}
