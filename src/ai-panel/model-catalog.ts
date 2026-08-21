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

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "gemma-4-e2b-it",
    name: "Gemma 4 E2B",
    description: "Small model, 2.3B effective params. Best for 4 GB VRAM. Text + vision + audio.",
    architecture: "dense_ple",
    total_params: "5.1B",
    effective_params: "2.3B",
    context_length: 128000,
    license: "Apache-2.0",
    hf_repo: "unsloth/gemma-4-E2B-it-GGUF",
    is_multimodal: true,
    mmproj_filename: "mmproj-F16.gguf",
    mmproj_url: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/mmproj-F16.gguf",
    mmproj_size_bytes: 987000000,
    quantizations: [
      {
        id: "gemma-4-e2b-it-q4-k-m",
        name: "Q4_K_M (3.1 GB)",
        filename: "gemma-4-E2B-it-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf",
        size_bytes: 3100000000,
        sha256: "",
        recommended_vram_bytes: 4 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 8 * 1024 * 1024 * 1024,
      },
      {
        id: "gemma-4-e2b-it-qat-ud-q4-k-xl",
        name: "QAT UD-Q4_K_XL (2.6 GB)",
        filename: "gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf",
        url: "https://huggingface.co/unsloth/gemma-4-E2B-it-qat-GGUF/resolve/main/gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf",
        size_bytes: 2620000000,
        sha256: "",
        recommended_vram_bytes: 4 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 8 * 1024 * 1024 * 1024,
      },
      {
        id: "gemma-4-e2b-it-q6-k",
        name: "Q6_K (4.5 GB)",
        filename: "gemma-4-E2B-it-Q6_K.gguf",
        url: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q6_K.gguf",
        size_bytes: 4500000000,
        sha256: "",
        recommended_vram_bytes: 6 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 8 * 1024 * 1024 * 1024,
      },
    ],
    tags: ["small", "multimodal", "recommended-4gb"],
  },
  {
    id: "gemma-4-e4b-it",
    name: "Gemma 4 E4B",
    description: "Medium model, 4.5B effective params. Good for 6-8 GB VRAM. Text + vision + audio.",
    architecture: "dense_ple",
    total_params: "8B",
    effective_params: "4.5B",
    context_length: 128000,
    license: "Apache-2.0",
    hf_repo: "unsloth/gemma-4-E4B-it-GGUF",
    is_multimodal: true,
    mmproj_filename: "mmproj-F16.gguf",
    mmproj_url: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/mmproj-F16.gguf",
    mmproj_size_bytes: 990000000,
    quantizations: [
      {
        id: "gemma-4-e4b-it-q4-k-m",
        name: "Q4_K_M (5.0 GB)",
        filename: "gemma-4-E4B-it-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf",
        size_bytes: 4980000000,
        sha256: "",
        recommended_vram_bytes: 6 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 8 * 1024 * 1024 * 1024,
      },
      {
        id: "gemma-4-e4b-it-q6-k",
        name: "Q6_K (7.1 GB)",
        filename: "gemma-4-E4B-it-Q6_K.gguf",
        url: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q6_K.gguf",
        size_bytes: 7070000000,
        sha256: "",
        recommended_vram_bytes: 8 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 12 * 1024 * 1024 * 1024,
      },
      {
        id: "gemma-4-e4b-it-qat-ud-q4-k-xl",
        name: "QAT UD-Q4_K_XL (4.2 GB)",
        filename: "gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf",
        url: "https://huggingface.co/unsloth/gemma-4-E4B-it-qat-GGUF/resolve/main/gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf",
        size_bytes: 4220000000,
        sha256: "",
        recommended_vram_bytes: 6 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 8 * 1024 * 1024 * 1024,
      },
    ],
    tags: ["medium", "multimodal", "recommended-6gb"],
  },
  {
    id: "gemma-4-12b-it",
    name: "Gemma 4 12B",
    description: "Large model, 12B params unified encoder-free. Best for 12-16 GB VRAM. Text + vision + audio.",
    architecture: "dense",
    total_params: "12B",
    effective_params: "12B",
    context_length: 256000,
    license: "Apache-2.0",
    hf_repo: "unsloth/gemma-4-12b-it-GGUF",
    is_multimodal: true,
    mmproj_filename: "mmproj-F16.gguf",
    mmproj_url: "https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/mmproj-F16.gguf",
    mmproj_size_bytes: 175000000,
    quantizations: [
      {
        id: "gemma-4-12b-it-q4-k-m",
        name: "Q4_K_M (7.1 GB)",
        filename: "gemma-4-12b-it-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q4_K_M.gguf",
        size_bytes: 7120000000,
        sha256: "",
        recommended_vram_bytes: 12 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 16 * 1024 * 1024 * 1024,
      },
      {
        id: "gemma-4-12b-it-qat-ud-q4-k-xl",
        name: "QAT UD-Q4_K_XL (6.7 GB)",
        filename: "gemma-4-12B-it-qat-UD-Q4_K_XL.gguf",
        url: "https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF/resolve/main/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf",
        size_bytes: 6720000000,
        sha256: "",
        recommended_vram_bytes: 12 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 16 * 1024 * 1024 * 1024,
      },
      {
        id: "gemma-4-12b-it-q6-k",
        name: "Q6_K (9.8 GB)",
        filename: "gemma-4-12b-it-Q6_K.gguf",
        url: "https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q6_K.gguf",
        size_bytes: 9790000000,
        sha256: "",
        recommended_vram_bytes: 16 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 16 * 1024 * 1024 * 1024,
      },
    ],
    tags: ["large", "multimodal", "recommended-12gb"],
  },
  {
    id: "qwen3.6-27b",
    name: "Qwen 3.6 27B",
    description: "Dense 27B model. Barely fits in 24 GB VRAM with Q4_K_M.",
    architecture: "dense",
    total_params: "27B",
    effective_params: "27B",
    context_length: 131072,
    license: "Apache-2.0",
    hf_repo: "lmstudio-community/Qwen3.6-27B-GGUF",
    is_multimodal: false,
    quantizations: [
      {
        id: "qwen3.6-27b-q4-k-m",
        name: "Q4_K_M (16.5 GB)",
        filename: "Qwen3.6-27B-Q4_K_M.gguf",
        url: "https://huggingface.co/lmstudio-community/Qwen3.6-27B-GGUF/resolve/main/Qwen3.6-27B-Q4_K_M.gguf",
        size_bytes: 16500000000,
        sha256: "",
        recommended_vram_bytes: 24 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 32 * 1024 * 1024 * 1024,
      },
      {
        id: "qwen3.6-27b-q6-k",
        name: "Q6_K (22.1 GB)",
        filename: "Qwen3.6-27B-Q6_K.gguf",
        url: "https://huggingface.co/lmstudio-community/Qwen3.6-27B-GGUF/resolve/main/Qwen3.6-27B-Q6_K.gguf",
        size_bytes: 22100000000,
        sha256: "",
        recommended_vram_bytes: 24 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 32 * 1024 * 1024 * 1024,
      },
    ],
    tags: ["large", "recommended-24gb"],
  },
  {
    id: "qwen3.6-35b-a3b",
    name: "Qwen 3.6 35B MoE",
    description: "MoE model: 35B total, 3B active per token. Barely fits 24 GB VRAM. 262K context.",
    architecture: "moe",
    total_params: "35B",
    effective_params: "3B",
    context_length: 262144,
    license: "Apache-2.0",
    hf_repo: "lmstudio-community/Qwen3.6-35B-A3B-GGUF",
    is_multimodal: false,
    quantizations: [
      {
        id: "qwen3.6-35b-a3b-q4-k-m",
        name: "Q4_K_M (21.2 GB)",
        filename: "Qwen3.6-35B-A3B-Q4_K_M.gguf",
        url: "https://huggingface.co/lmstudio-community/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.6-35B-A3B-Q4_K_M.gguf",
        size_bytes: 21200000000,
        sha256: "",
        recommended_vram_bytes: 24 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 32 * 1024 * 1024 * 1024,
      },
      {
        id: "qwen3.6-35b-a3b-q6-k",
        name: "Q6_K (28.5 GB)",
        filename: "Qwen3.6-35B-A3B-Q6_K.gguf",
        url: "https://huggingface.co/lmstudio-community/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.6-35B-A3B-Q6_K.gguf",
        size_bytes: 28500000000,
        sha256: "",
        recommended_vram_bytes: 32 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 48 * 1024 * 1024 * 1024,
      },
    ],
    tags: ["large", "moe", "recommended-24gb"],
  },
  {
    id: "qwen3.6-35b-a3b-uncensored",
    name: "Qwen 3.6 35B MoE Uncensored",
    description: "MoE 35B/3B active, uncensored (0/465 refusals). Multimodal with mmproj. Barely fits 24 GB.",
    architecture: "moe",
    total_params: "35B",
    effective_params: "3B",
    context_length: 262144,
    license: "Apache-2.0",
    hf_repo: "HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive",
    is_multimodal: true,
    mmproj_filename: "mmproj-Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-f16.gguf",
    mmproj_url: "https://huggingface.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive/resolve/main/mmproj-Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-f16.gguf",
    mmproj_size_bytes: 899000000,
    quantizations: [
      {
        id: "qwen3.6-35b-a3b-uncensored-q4-k-m",
        name: "Q4_K_M (21 GB)",
        filename: "Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf",
        url: "https://huggingface.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive/resolve/main/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf",
        size_bytes: 21000000000,
        sha256: "",
        recommended_vram_bytes: 24 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 32 * 1024 * 1024 * 1024,
      },
      {
        id: "qwen3.6-35b-a3b-uncensored-q4-k-p",
        name: "Q4_K_P (23 GB)",
        filename: "Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf",
        url: "https://huggingface.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive/resolve/main/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf",
        size_bytes: 23000000000,
        sha256: "",
        recommended_vram_bytes: 24 * 1024 * 1024 * 1024,
        recommended_ram_bytes: 32 * 1024 * 1024 * 1024,
      },
    ],
    tags: ["large", "moe", "uncensored", "multimodal", "recommended-24gb"],
  },
];

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