// ============================================================================
// Image style toolbar — Phase 1 (enrichment) wiring for the "Style" section
// of the image toolbar. Loaded dynamically from toolbar.ts (thin hook).
//
// Two exported functions, mirroring the existing image-toolbar pattern:
//   - setupImageStyleToolbar(view): bind listeners once at startup;
//   - syncImageStyleControls(view): refresh values on selection change
//     (called from updateImageToolbar).
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { getSelectedImage } from "./image-commands";
import { setImageStyleAttrs } from "./image-commands";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function parseIntOrNaN(v: string): number {
  return parseInt(v, 10);
}

/** Bind the Style section controls once. */
export function setupImageStyleToolbar(view: EditorView): void {
  const radius = el<HTMLInputElement>("img-radius");
  const borderStyle = el<HTMLSelectElement>("img-border-style");
  const borderWidth = el<HTMLInputElement>("img-border-width");
  const borderColor = el<HTMLInputElement>("img-border-color");
  const frameEffect = el<HTMLSelectElement>("img-frame-effect");
  const shadowToggle = el<HTMLButtonElement>("img-shadow-toggle");
  const shadowDistance = el<HTMLInputElement>("img-shadow-distance");
  const shadowBlur = el<HTMLInputElement>("img-shadow-blur");
  const shadowOpacity = el<HTMLInputElement>("img-shadow-opacity");
  const shadowColor = el<HTMLInputElement>("img-shadow-color");
  const shadowAngle = el<HTMLInputElement>("img-shadow-angle");

  // Radius
  radius?.addEventListener("change", () => {
    const v = parseIntOrNaN(radius.value);
    void setImageStyleAttrs(view, { cornerRadius: isNaN(v) || v < 0 ? 0 : v });
  });

  // Border style: choosing a style with width still 0 gives a sensible default
  borderStyle?.addEventListener("change", async () => {
    const info = await getSelectedImage(view);
    if (!info) return;
    const patch: Record<string, unknown> = { borderStyle: borderStyle.value };
    if (borderStyle.value !== "none" && !(info.node.attrs.borderWidth > 0)) {
      patch.borderWidth = 2;
    }
    void setImageStyleAttrs(view, patch);
  });

  // Border width: setting a width with no style picks solid
  borderWidth?.addEventListener("change", async () => {
    const info = await getSelectedImage(view);
    if (!info) return;
    const v = parseIntOrNaN(borderWidth.value);
    if (isNaN(v)) return;
    const w = Math.max(0, Math.min(24, v));
    const patch: Record<string, unknown> = { borderWidth: w };
    if (w > 0 && (info.node.attrs.borderStyle as string) === "none") {
      patch.borderStyle = "solid";
    }
    void setImageStyleAttrs(view, patch);
  });

  borderColor?.addEventListener("input", () => {
    if (!borderColor.value) return;
    void setImageStyleAttrs(view, { borderColor: borderColor.value });
  });

  frameEffect?.addEventListener("change", () => {
    void setImageStyleAttrs(view, { frameEffect: frameEffect.value });
  });

  shadowToggle?.addEventListener("click", async () => {
    const info = await getSelectedImage(view);
    if (!info) return;
    void setImageStyleAttrs(view, { shadowEnabled: !info.node.attrs.shadowEnabled });
  });

  const bindShadow = (input: HTMLInputElement | null, key: string, min: number, max: number) => {
    input?.addEventListener("change", () => {
      const v = parseIntOrNaN(input.value);
      if (isNaN(v)) return;
      void setImageStyleAttrs(view, { [key]: Math.max(min, Math.min(max, v)) });
    });
  };
  bindShadow(shadowDistance, "shadowDistance", 0, 60);
  bindShadow(shadowBlur, "shadowBlur", 0, 100);
  bindShadow(shadowOpacity, "shadowOpacity", 0, 100);
  bindShadow(shadowAngle, "shadowAngle", 0, 359);

  shadowColor?.addEventListener("input", () => {
    if (!shadowColor.value) return;
    void setImageStyleAttrs(view, { shadowColor: shadowColor.value });
  });
}

/** Refresh the Style section values for the currently selected image. */
export async function syncImageStyleControls(view: EditorView): Promise<void> {
  const info = await getSelectedImage(view);
  if (!info) return; // toolbar is hidden by updateImageToolbar in that case

  const a = info.node.attrs;

  const radius = el<HTMLInputElement>("img-radius");
  if (radius) radius.value = a.cornerRadius ? String(a.cornerRadius) : "";

  const borderStyle = el<HTMLSelectElement>("img-border-style");
  if (borderStyle) borderStyle.value = (a.borderStyle as string) || "none";

  const borderWidth = el<HTMLInputElement>("img-border-width");
  if (borderWidth) borderWidth.value = a.borderWidth ? String(a.borderWidth) : "";

  const borderColor = el<HTMLInputElement>("img-border-color");
  if (borderColor) borderColor.value = (a.borderColor as string) || "#333333";

  const frameEffect = el<HTMLSelectElement>("img-frame-effect");
  if (frameEffect) frameEffect.value = (a.frameEffect as string) || "none";

  const shadowToggle = el<HTMLButtonElement>("img-shadow-toggle");
  const enabled = !!a.shadowEnabled;
  shadowToggle?.classList.toggle("image-toolbar__btn--active", enabled);

  const fields = el<HTMLElement>("img-shadow-fields");
  if (fields) fields.hidden = !enabled;

  if (enabled) {
    const distance = el<HTMLInputElement>("img-shadow-distance");
    if (distance) distance.value = String(a.shadowDistance ?? "");
    const blur = el<HTMLInputElement>("img-shadow-blur");
    if (blur) blur.value = String(a.shadowBlur ?? "");
    const opacity = el<HTMLInputElement>("img-shadow-opacity");
    if (opacity) opacity.value = String(a.shadowOpacity ?? "");
    const color = el<HTMLInputElement>("img-shadow-color");
    if (color) color.value = (a.shadowColor as string) || "#000000";
    const angle = el<HTMLInputElement>("img-shadow-angle");
    if (angle) angle.value = String(a.shadowAngle ?? "");
  }
}
