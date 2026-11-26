import {
  getActiveFile,
  getEditorManager,
  isMarkdownFile,
} from "../cm/runtime";
import { configManager } from "../config";

/**
 * Opens Acode's 100% native built-in Markdown preview (`openMarkdownPreview` via `run-file` / `activeFile.runFile()`).
 */
export function openNativeMarkdownPreview(): boolean {
  if (typeof window === "undefined" || !(window as any).acode) return false;

  const file = getActiveFile();
  if (!file || !isMarkdownFile(file)) {
    try {
      const toast = acode.require("toast");
      toast("Open a Markdown file to preview.", 2500);
    } catch {
      // Ignore
    }
    return false;
  }

  if (typeof file.runFile === "function") {
    file.runFile();
    return true;
  }
  if (typeof file.run === "function") {
    file.run();
    return true;
  }
  acode.exec("run-file");
  return true;
}

export function closeNativeMarkdownPreview(): boolean {
  if (typeof window === "undefined" || !(window as any).acode) return false;
  try {
    const actionStack = acode.require("actionStack");
    if (actionStack?.has?.("markdown-preview")) {
      actionStack.pop();
      return true;
    }
  } catch {
    // Fallback
  }
  return false;
}

export class AutoPreviewService {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPreviewedId: string | null = null;
  private onSwitchBound = this.onSwitchFile.bind(this);

  public activate(): void {
    getEditorManager()?.on("switch-file", this.onSwitchBound);
  }

  private onSwitchFile(): void {
    if (!configManager.get("preview.autoShowPreviewToSide")) return;

    const file = getActiveFile();
    if (!file || !isMarkdownFile(file)) return;

    const key = file.id || file.uri || file.filename;
    if (key === this.lastPreviewedId) return;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const current = getActiveFile();
      if (current === file && isMarkdownFile(current)) {
        this.lastPreviewedId = key;
        openNativeMarkdownPreview();
      }
    }, 150);
  }

  public dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    getEditorManager()?.off("switch-file", this.onSwitchBound);
  }
}
