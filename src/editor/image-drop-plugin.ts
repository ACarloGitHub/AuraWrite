import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { insertImageFromFile } from "./image-commands";

const imageDropPluginKey = new PluginKey("imageDrop");

export function createImageDropPlugin() {
  return new Plugin({
    key: imageDropPluginKey,
    props: {
      handleDOMEvents: {
        dragover(view: EditorView, event: DragEvent) {
          const types = event.dataTransfer?.types;
          if (!types) return false;
          if (Array.from(types).includes("Files")) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        drop(view: EditorView, event: DragEvent) {
          const files = event.dataTransfer?.files;
          if (!files || files.length === 0) return false;
          event.preventDefault();
          const imageFiles = Array.from(files).filter((f) =>
            /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name)
          );
          if (imageFiles.length === 0) return false;
          (async () => {
            for (const file of imageFiles) {
              await insertImageFromFile(view, file);
            }
          })();
          return true;
        },
      },
    },
  });
}

export function createImagePastePlugin() {
  return new Plugin({
    key: new PluginKey("imagePaste"),
    props: {
      handleDOMEvents: {
        paste(view: EditorView, event: ClipboardEvent) {
          const items = event.clipboardData?.items;
          if (!items) return false;
          const imageItems = Array.from(items).filter(
            (item) => item.kind === "file" && item.type.startsWith("image/")
          );
          if (imageItems.length === 0) return false;
          event.preventDefault();
          (async () => {
            for (const item of imageItems) {
              const file = item.getAsFile();
              if (file) await insertImageFromFile(view, file);
            }
          })();
          return true;
        },
      },
    },
  });
}
