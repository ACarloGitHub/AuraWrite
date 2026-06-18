import { invoke, convertFileSrc } from "@tauri-apps/api/core";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

export function isImageFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith("." + ext));
}

export function getImageMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.substring(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export interface UploadedImage {
  src: string;
  filename: string;
  width: number | null;
  height: number | null;
}

export async function uploadImageFile(file: File): Promise<UploadedImage> {
  if (!isImageFilename(file.name)) {
    throw new Error(`File ${file.name} is not a recognized image format`);
  }
  const base64 = await readFileAsBase64(file);
  const relativePath: string = await invoke("save_image_to_assets", {
    filename: file.name,
    base64Content: base64,
  });
  const dimensions = await getImageDimensionsFromFile(file);
  return {
    src: relativePath,
    filename: file.name,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}

export async function resolveImageSrc(relativePath: string): Promise<string> {
  if (!relativePath) return "";
  if (
    relativePath.startsWith("http://") ||
    relativePath.startsWith("https://") ||
    relativePath.startsWith("data:") ||
    relativePath.startsWith("file:") ||
    relativePath.startsWith("blob:") ||
    relativePath.startsWith("tauri:") ||
    relativePath.startsWith("asset:")
  ) {
    return relativePath;
  }
  if (relativePath.match(/^[a-zA-Z]:[\\/]/) || relativePath.startsWith("/")) {
    return convertFileSrc(relativePath);
  }
  try {
    const absolutePath = await invoke<string>("get_image_asset_url", {
      relativePath,
    });
    return convertFileSrc(absolutePath);
  } catch (e) {
    console.warn("[image] get_image_asset_url failed:", e);
    return convertFileSrc(relativePath);
  }
}

function getImageDimensionsFromFile(
  file: File
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
