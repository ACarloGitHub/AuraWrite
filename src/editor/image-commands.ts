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
    caption: "",
  };
  return imageType.create(attrs);
}

function insertImageBlock(view: EditorView, imageNode: PMNode): boolean {
  const { $from } = view.state.selection;
  const { paragraph } = view.state.schema.nodes;
  if (!paragraph) return false;

  let tr = view.state.tr;
  let insertedPos: number;

  const inTextblock = $from.parent.isTextblock;
  const atEnd = inTextblock && $from.parentOffset === $from.parent.content.size;
  const atStart = inTextblock && $from.parentOffset === 0;

  if (inTextblock && !atEnd && !atStart) {
    tr = tr.split($from.pos, 1);
    insertedPos = $from.pos + 1;
    tr = tr.insert(insertedPos, imageNode);
    const sel = NodeSelection.create(tr.doc, insertedPos);
    tr.setSelection(sel);
  } else if (inTextblock && atEnd) {
    insertedPos = $from.after($from.depth);
    tr = tr.insert(insertedPos, imageNode);
    const sel = NodeSelection.create(tr.doc, insertedPos);
    tr.setSelection(sel);
  } else if (inTextblock && atStart) {
    insertedPos = $from.before($from.depth);
    tr = tr.insert(insertedPos, imageNode);
    const sel = NodeSelection.create(tr.doc, insertedPos);
    tr.setSelection(sel);
  } else {
    insertedPos = $from.pos;
    tr = tr.insert(insertedPos, imageNode);
    const sel = NodeSelection.create(tr.doc, insertedPos);
    tr.setSelection(sel);
  }

  // Ensure a paragraph follows the image so the cursor has a place to land
  // below it. Without this, an image inserted as the last node of the
  // document would leave the cursor stranded on the image with no way to
  // continue writing. Behaviour matches Google Docs and Word: every image
  // is hosted by a paragraph that follows it.
  const imageEnd = insertedPos + imageNode.nodeSize;
  const nodeAfter = tr.doc.nodeAt(imageEnd);
  if (!nodeAfter || nodeAfter.type !== paragraph) {
    tr = tr.insert(imageEnd, paragraph.create());
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
    caption: "",
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
  const { $from } = selection;
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

function safeSetNodeMarkup(
  view: EditorView,
  pos: number,
  attrs: Record<string, unknown>
): boolean {
  try {
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, attrs));
    return true;
  } catch {
    return false;
  }
}

export async function setImageAlignment(
  view: EditorView,
  align: "left" | "center" | "right"
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const currentWrap = !!info.node.attrs.wrap;
  const wrap = align === "center" ? false : currentWrap;
  return safeSetNodeMarkup(view, info.pos, { ...info.node.attrs, align, wrap });
}

export async function setImageWrap(
  view: EditorView,
  wrap: boolean
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  return safeSetNodeMarkup(view, info.pos, { ...info.node.attrs, wrap });
}

export async function setImageRotation(
  view: EditorView,
  rotation: number
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  return safeSetNodeMarkup(view, info.pos, { ...info.node.attrs, rotation });
}

export async function setImageFlipH(
  view: EditorView,
  flipH: boolean
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  return safeSetNodeMarkup(view, info.pos, { ...info.node.attrs, flipH });
}

export async function setImageFlipV(
  view: EditorView,
  flipV: boolean
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  return safeSetNodeMarkup(view, info.pos, { ...info.node.attrs, flipV });
}

export async function setImageAspectLocked(
  view: EditorView,
  aspectLocked: boolean
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  return safeSetNodeMarkup(view, info.pos, { ...info.node.attrs, aspectLocked });
}

export async function setImageSize(
  view: EditorView,
  width: number | null,
  height: number | null
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  return safeSetNodeMarkup(view, info.pos, { ...info.node.attrs, width, height });
}

export async function setImageWidth(
  view: EditorView,
  width: number
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const attrs: Record<string, unknown> = { ...info.node.attrs, width };
  if (info.node.attrs.aspectLocked !== false) {
    const currentW = (info.node.attrs.width as number) || 1;
    const currentH = (info.node.attrs.height as number) || 1;
    attrs.height = Math.round((width / currentW) * currentH);
  }
  return safeSetNodeMarkup(view, info.pos, attrs);
}

export async function setImageHeight(
  view: EditorView,
  height: number
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const attrs: Record<string, unknown> = { ...info.node.attrs, height };
  if (info.node.attrs.aspectLocked !== false) {
    const currentW = (info.node.attrs.width as number) || 1;
    const currentH = (info.node.attrs.height as number) || 1;
    attrs.width = Math.round((height / currentH) * currentW);
  }
  return safeSetNodeMarkup(view, info.pos, attrs);
}

export async function setImageCaption(
  view: EditorView,
  caption: string
): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  return safeSetNodeMarkup(view, info.pos, { ...info.node.attrs, caption });
}

export async function removeImage(view: EditorView): Promise<boolean> {
  const info = await getSelectedImage(view);
  if (!info) return false;
  const tr = view.state.tr.delete(info.pos, info.pos + info.node.nodeSize);
  view.dispatch(tr);
  return true;
}