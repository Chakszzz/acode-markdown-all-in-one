import type { EditorState, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { configManager } from "../config";
import type {
  AcodeAddedFolder,
  AcodeCodeMirrorNamespace,
  AcodeEditorFile,
  AcodeEditorManager,
} from "../types/acode-cm";

const BASE_MD_EXTENSIONS = new Set([
  "md",
  "markdown",
  "mdown",
  "mkdn",
  "mkd",
  "mdwn",
  "mdtxt",
  "mdtext",
  "workbook",
]);

let cachedCm: AcodeCodeMirrorNamespace | null = null;

/**
 * Retrieves Acode's shared CodeMirror 6 modules at runtime so no duplicate
 * @codemirror/* instances are bundled into main.js.
 * Supports injecting globalThis.__TEST_CM__ during unit tests.
 */
export function getCM(): AcodeCodeMirrorNamespace {
  if (cachedCm) return cachedCm;

  if ((globalThis as any).__TEST_CM__) {
    cachedCm = (globalThis as any).__TEST_CM__ as AcodeCodeMirrorNamespace;
    return cachedCm;
  }

  if (typeof window !== "undefined" && (window as any).acode) {
    const cm = acode.require("codemirror") as AcodeCodeMirrorNamespace | undefined;
    if (cm?.view && cm?.state && cm?.language && cm?.autocomplete && cm?.commands) {
      cachedCm = cm;
      return cachedCm;
    }

    const view = acode.require("@codemirror/view");
    const state = acode.require("@codemirror/state");
    const language = acode.require("@codemirror/language");
    const autocomplete = acode.require("@codemirror/autocomplete");
    const commands = acode.require("@codemirror/commands");
    const lezerHighlight = acode.require("@lezer/highlight");
    const lezerCommon = acode.require("@lezer/common");

    cachedCm = {
      view,
      state,
      language,
      autocomplete,
      commands,
      lezer: Object.assign({}, lezerHighlight, {
        common: lezerCommon,
        highlight: lezerHighlight,
      }),
    };
    return cachedCm;
  }

  throw new Error("CodeMirror 6 runtime is unavailable outside Acode.");
}

export function getEditorManager(): AcodeEditorManager | null {
  if (typeof window !== "undefined" && (window as any).editorManager) {
    return (window as any).editorManager as AcodeEditorManager;
  }
  return null;
}

export function getActiveView(): EditorView | null {
  return getEditorManager()?.editor ?? null;
}

export function getActiveFile(): AcodeEditorFile | null {
  return getEditorManager()?.activeFile ?? null;
}

export function getAddedFolders(): AcodeAddedFolder[] {
  if (typeof window !== "undefined" && Array.isArray((window as any).addedFolder)) {
    return (window as any).addedFolder as AcodeAddedFolder[];
  }
  return [];
}

export function getFileForView(view: EditorView): AcodeEditorFile | null {
  const em = getEditorManager();
  if (!em) return null;

  const paneFromProp = (view as any).__editorPane;
  if (paneFromProp?.activeFile) return paneFromProp.activeFile;

  const pane = (em.panes || []).find((p) => p?.editor === view);
  if (pane?.activeFile) return pane.activeFile;

  if (em.editor === view) return em.activeFile;
  return null;
}

export function getFileForState(state: EditorState): AcodeEditorFile | null {
  const em = getEditorManager();
  if (!em) return null;

  const pane = (em.panes || []).find((p) => p?.editor?.state === state);
  if (pane?.activeFile) return pane.activeFile;

  if (em.editor?.state === state) return em.activeFile;
  return null;
}

export function getFileExtension(filename: string | undefined | null): string {
  if (!filename) return "";
  const base = filename.split(/[\\/]/).pop() || "";
  const dotIdx = base.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx === base.length - 1) return "";
  return base.slice(dotIdx + 1).toLowerCase();
}

export function isMarkdownFilename(filename: string | undefined | null): boolean {
  const ext = getFileExtension(filename);
  if (!ext) return false;
  if (BASE_MD_EXTENSIONS.has(ext)) return true;

  const extra = configManager.get("extraLangIds") || [];
  for (const raw of extra) {
    const normalized = raw.trim().toLowerCase().replace(/^\./, "");
    if (normalized === ext) return true;
    if (normalized === "quarto" && ext === "qmd") return true;
  }
  return false;
}

export function isMarkdownFile(file: AcodeEditorFile | null | undefined): boolean {
  if (!file) return false;
  if (file.type && file.type !== "editor") return false;
  if (isMarkdownFilename(file.filename || file.name || file.uri)) return true;

  // Also detect files whose syntax mode was explicitly switched to Markdown
  const modeId = String(
    file.session?.$modeId ||
      file.session?.$mode?.$id ||
      file.session?.getMode?.()?.$id ||
      "",
  ).toLowerCase();
  if (modeId.endsWith("/markdown") || modeId === "markdown") return true;

  return false;
}

export function isActiveMarkdown(): boolean {
  return isMarkdownFile(getActiveFile());
}

export function isMarkdownState(state: EditorState): boolean {
  const em = getEditorManager();
  if (!em) {
    // In unit tests without editorManager, treat states as Markdown
    return true;
  }
  const file = getFileForState(state);
  if (file) return isMarkdownFile(file);
  return isActiveMarkdown();
}

export function getEditorFormattingOptions(state: EditorState, file?: AcodeEditorFile | null): {
  tabSize: number;
  insertSpaces: boolean;
  eol: "\n" | "\r\n";
} {
  let tabSize = state.tabSize || 2;
  let insertSpaces = true;

  try {
    const cm = getCM();
    const unit = state.facet(cm.language.indentUnit);
    if (unit === "\t") {
      insertSpaces = false;
    } else if (unit && unit.length > 0) {
      tabSize = unit.length;
    }
  } catch {
    // Fallback to Acode appSettings if facet lookup fails
  }

  if (typeof window !== "undefined" && (window as any).acode) {
    try {
      const appSettings = acode.require("settings");
      const softTab = appSettings?.get?.("softTab");
      if (typeof softTab === "boolean") insertSpaces = softTab;
      const cfgTabSize = Number(appSettings?.get?.("tabSize"));
      if (Number.isFinite(cfgTabSize) && cfgTabSize > 0) tabSize = cfgTabSize;
    } catch {
      // Ignore
    }
  }

  let eol: "\n" | "\r\n" = "\n";
  if (file?.eol === "windows") {
    eol = "\r\n";
  } else {
    const sample = state.sliceDoc(0, Math.min(state.doc.length, 2000));
    if (sample.includes("\r\n")) eol = "\r\n";
  }

  return { tabSize, insertSpaces, eol };
}

/**
 * Syncs CodeMirror state back onto Acode's EditorFile session proxy after dispatch.
 */
export function syncViewSession(view: EditorView): void {
  const file = getFileForView(view);
  if (file && (!file.type || file.type === "editor")) {
    file.session = view.state;
  }
}

export function getDocLine0(doc: Text, line0: number) {
  return doc.line(line0 + 1);
}
