export interface ModelQuantization {
  id: string;
  name: string;
  filename: string;
  url: string;
  size_bytes: number;
  sha256: string;
  recommended_vram_bytes: number;
  recommended_ram_bytes: number;
}

export interface ModelCatalogEntry {
  id: string;
  name: string;
  description: string;
  architecture: "dense" | "moe" | "dense_ple";
  total_params: string;
  effective_params: string;
  context_length: number;
  license: string;
  hf_repo: string;
  is_multimodal: boolean;
  mmproj_filename?: string;
  mmproj_url?: string;
  mmproj_size_bytes?: number;
  quantizations: ModelQuantization[];
  tags: string[];
}

/**
 * Model catalog DATA lives in model-catalog.json (same folder).
 * To add/remove/update recommended models, edit the JSON file only —
 * do not touch this module. Recommendations (stars) are computed from
 * the recommended_vram_bytes / recommended_ram_bytes values in the JSON.
 * The build inlines the JSON via Vite; a syntax error in the JSON breaks
 * the build immediately (developer catches it, never the end user).
 */
import catalogData from "./model-catalog.json";

export const MODEL_CATALOG: ModelCatalogEntry[] = catalogData as ModelCatalogEntry[];

export function getModelById(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export function getQuantizationById(id: string): { model: ModelCatalogEntry; quant: ModelQuantization } | undefined {
  for (const model of MODEL_CATALOG) {
    const quant = model.quantizations.find((q) => q.id === id);
    if (quant) return { model, quant };
  }
  return undefined;
}

export function recommendModelsForHardware(
  vramBytes: number,
  ramBytes: number
): ModelCatalogEntry[] {
  const _vramGB = vramBytes / (1024 * 1024 * 1024);
  const _ramGB = ramBytes / (1024 * 1024 * 1024);

  return MODEL_CATALOG.filter((model) =>
    model.quantizations.some(
      (q) =>
        q.recommended_vram_bytes <= vramBytes ||
        (vramBytes === 0 && q.recommended_ram_bytes <= ramBytes)
    )
  ).sort((a, b) => {
    const aMinVram = Math.min(...a.quantizations.map((q) => q.recommended_vram_bytes));
    const bMinVram = Math.min(...b.quantizations.map((q) => q.recommended_vram_bytes));
    return aMinVram - bMinVram;
  });
}

export function getRecommendedQuantization(
  model: ModelCatalogEntry,
  vramBytes: number,
  ramBytes: number
): ModelQuantization | undefined {
  const fitting = model.quantizations.filter(
    (q) =>
      q.recommended_vram_bytes <= vramBytes ||
      (vramBytes === 0 && q.recommended_ram_bytes <= ramBytes)
  );
  if (fitting.length === 0) return undefined;
  return fitting[fitting.length - 1];
}

export { formatBytes } from "../utils/format";