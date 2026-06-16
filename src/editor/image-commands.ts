import type { EditorView } from "prosemirror-view";
import { Node as PMNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import { uploadImageFile, resolveImageSrc, type UploadedImage } from "./image-uploader";
import { showErrorToast } from "../error-boundary";

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
    wrap: false,
    rotation: 0,
    flipH: false,
    flipV: false,
    aspectLocked: true,
  };
  return imageType.create(attrs);
}

function insertImageBlock(view: EditorView, imageNode: PMNode): boolean {
  const { $from } = view.state.selection;
  const { paragraph } = view.state.schema.nodes;
  if (!paragraph) return false;

  let tr = view.state.tr;

  const inTextblock = $from.parent.isTextblock;
  const atEnd = inTextblock && $from.parentOffset === $from.parent.content.size;
  const atStart = inTextblock && $from.parentOffset === 0;

  if (inTextblock && !atEnd && !atStart) {
    tr = tr.split($from.pos, 1);
    const afterSplit = $from.pos + 1;
    tr = tr.insert(afterSplit, imageNode);
    const sel = NodeSelection.create(tr.doc, afterSplit);
    tr.setSelection(sel);
  } else if (inTextblock && atEnd) {
    const insertPos = $from.after($from.depth);
    tr = tr.insert(insertPos, imageNode);
    const sel = NodeSelection.create(tr.doc, insertPos);
    tr.setSelection(sel);
  } else if (inTextblock && atStart) {
    const insertPos = $from.before($from.depth);
    tr = tr.insert(insertPos, imageNode);
    const sel = NodeSelection.create(tr.doc, insertPos);
    tr.setSelection(sel);
  } else {
    const insertPos = $from.pos;
    tr = tr.insert(insertPos, imageNode);
    const sel = NodeSelection.create(tr.doc, insertPos);
    tr.setSelection(sel);
  }

  view.dispatch(tr);
  view.focus();
  return true;
}

export async function insertImageFromFile(
  view: EditorView,
  file: File
): Promise<boolean> {
  const { image } = view.state.schema.nodes;
  if (!image) {
    const msg = "Image node is not available in the current editor schema.";
    console.error("[image]", msg);
    showErrorToast(msg);
    return false;
  }
  try {
    const uploaded = await uploadImageFile(file);
    const node = createImageNode(view, uploaded);
    if (!node) return false;

    return insertImageBlock(view, node);
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
  const node = imageType.create({
    src,
    alt,
    title: alt,
    width: null,
    height: null,
    align: "center",
    wrap: false,
    rotation: 0,
    flipH: false,
    flipV: false,
    aspectLocked: true,
  });
  return insertImageBlock(view, node);
}

export interface SelectedImageInfo {
  pos: number;
  node: PMNode;
  resolvedSrc: string;
}

export async function getSelectedImage(view: EditorView): Promise<SelectedImageInfo | null> {
  const { selection } = view.state;
  if (selection instanceof NodeSelection && selection.node.type.name === "image") {
    const pos = selection.from;
    const node = selection.node;
    const resolvedSrc = await resolveImageSrc(node.attrs.src as string);
    return { pos, node, resolvedSrc };
  }
  return null;
}

export async function setImageAlignment(
  view: EditorView,
  align: "left" | "center" | "right"
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const currentWrap = !!info.node.attrs.wrap;
  const wrap = align === "center" ? false : currentWrap;
  const tr = view.state.tr.setNodeMarkup(info.pos, undefined, {
    ...info.node.attrs,
    align,
    wrap,
  });
  view.dispatch(tr);
  return true;
}

export async function setImageWrap(
  view: EditorView,
  wrap: boolean
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const tr = view.state.tr.setNodeMarkup(info.pos, undefined, {
    ...info.node.attrs,
    wrap,
  });
  view.dispatch(tr);
  return true;
}

export async function setImageRotation(
  view: EditorView,
  rotation: number
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const tr = view.state.tr.setNodeMarkup(info.pos, undefined, {
    ...info.node.attrs,
    rotation,
  });
  view.dispatch(tr);
  return true;
}

export async function setImageFlipH(
  view: EditorView,
  flipH: boolean
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const tr = view.state.tr.setNodeMarkup(info.pos, undefined, {
    ...info.node.attrs,
    flipH,
  });
  view.dispatch(tr);
  return true;
}

export async function setImageFlipV(
  view: EditorView,
  flipV: boolean
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const tr = view.state.tr.setNodeMarkup(info.pos, undefined, {
    ...info.node.attrs,
    flipV,
  });
  view.dispatch(tr);
  return true;
}

export async function setImageAspectLocked(
  view: EditorView,
  aspectLocked: boolean
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const tr = view.state.tr.setNodeMarkup(info.pos, undefined, {
    ...info.node.attrs,
    aspectLocked,
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