import type { ChangeSpec, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import * as stringSimilarity from "string-similarity";
import {
  getActiveFile,
  getActiveView,
  getAddedFolders,
  getCM,
  getEditorFormattingOptions,
  getEditorManager,
  isMarkdownFile,
  isMarkdownState,
  syncViewSession,
} from "../cm/runtime";
import { configManager } from "../config";
import type * as MarkdownSpec from "../contract/MarkdownSpec";
import type SlugifyMode from "../contract/SlugifyMode";
import { commonMarkEngine, mdEngine, type Token } from "../engine/markdownEngine";
import { Regexp_Fenced_Code_Block } from "../util/contextCheck";
import { slugify } from "../util/slugify";

export interface IHeadingBase {
  level: MarkdownSpec.MarkdownHeadingLevel;
  rawContent: string;
  lineIndex: number;
  canInToc: boolean;
}

export interface IHeading extends IHeadingBase {
  visibleText: string;
  slug: string;
}

export interface TocFormattingContext {
  tabSize: number;
  insertSpaces: boolean;
  eol: "\n" | "\r\n";
  fileUri?: string;
  filename?: string;
}

export interface TocRangeLine {
  startLine0: number;
  endLine0: number;
}

function getEffectiveTocSettings(ctx: TocFormattingContext) {
  const levelsStr = configManager.get("toc.levels") || "1..6";
  let startDepth = 1;
  let endDepth = 6;
  const m = levelsStr.match(/^([1-6])\.\.([1-6])$/);
  if (m) {
    startDepth = Number(m[1]);
    endDepth = Number(m[2]);
  }

  const orderedList = configManager.get("toc.orderedList");
  const listMarker = configManager.get("toc.unorderedList.marker") || "-";
  const plaintext = configManager.get("toc.plaintext");
  const updateOnSave = configManager.get("toc.updateOnSave");
  const orderedListMarkerIsOne = configManager.get("orderedList.marker") === "one";

  let tabSize = ctx.tabSize || 2;
  if (configManager.get("list.indentationSize") === "adaptive") {
    tabSize = orderedList ? 3 : 2;
  }
  const tab = ctx.insertSpaces ? " ".repeat(tabSize) : "\t";

  return {
    startDepth,
    endDepth,
    orderedList,
    listMarker,
    plaintext,
    updateOnSave,
    orderedListMarkerIsOne,
    tab,
    eol: ctx.eol,
  };
}

function getProjectExcludedHeadings(
  fileUri?: string,
  filename?: string,
): Array<{ level: number; text: string }> {
  const configObj = configManager.get("toc.omittedFromToc");
  if (!configObj || typeof configObj !== "object") {
    return [];
  }

  const omittedHeadings: string[] = [];
  const folders = getAddedFolders();
  const normalizedUri = (fileUri || "").replace(/\\/g, "/");
  const normalizedName = (filename || "").replace(/\\/g, "/");

  for (const [cfgPath, headings] of Object.entries(configObj)) {
    if (!Array.isArray(headings)) continue;
    const cleanCfgPath = cfgPath.replace(/\\/g, "/").replace(/^\.\//, "");

    let matched = false;
    if (normalizedName && cleanCfgPath === normalizedName) {
      matched = true;
    } else if (normalizedUri && normalizedUri.endsWith("/" + cleanCfgPath)) {
      matched = true;
    } else {
      for (const folder of folders) {
        const joined =
          folder.url.replace(/\/+$/, "") + "/" + cleanCfgPath.replace(/^\/+/, "");
        if (joined === normalizedUri) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      omittedHeadings.push(...headings);
    }
  }

  return omittedHeadings
    .map((heading) => {
      const matches = heading.match(/^ {0,3}(#{1,6})[ \t]+(.*)$/);
      if (!matches) return { level: -1, text: "" };
      return { level: matches[1].length, text: matches[2] };
    })
    .filter((h) => h.level >= 1);
}

export function createLinkText(raw: string, env: object = Object.create(null)): string {
  const parsed = commonMarkEngine.engine.parseInline(raw, env);
  const inlineTokens: Token[] = parsed[0]?.children ?? [];

  return inlineTokens.reduce<string>((result, token) => {
    switch (token.type) {
      case "text":
        return result + token.content.replace(/[&*<>\[\\\]_`]/g, "\\$&");
      case "code_inline":
        return result + token.markup + token.content + token.markup;
      case "strong_open":
      case "strong_close":
      case "em_open":
      case "em_close":
        return result + token.markup;
      case "link_open":
      case "link_close":
      case "image":
      case "html_inline":
        return result;
      case "softbreak":
      case "hardbreak":
        return result + " ";
      default:
        return result + token.content;
    }
  }, "");
}

export function getAllRootHeadingsFromText(
  docText: string,
  options?: {
    respectMagicCommentOmit?: boolean;
    respectProjectLevelOmit?: boolean;
    fileUri?: string;
    filename?: string;
  },
): IHeadingBase[] {
  const respectMagicCommentOmit = options?.respectMagicCommentOmit ?? false;
  const respectProjectLevelOmit = options?.respectProjectLevelOmit ?? false;
  const replacer = (foundStr: string) => foundStr.replace(/[^\r\n]/g, "");

  const lines: string[] = docText
    .replace(/^---.+?(?:\r?\n)---(?=[ \t]*\r?\n)/s, replacer)
    .replace(/^\t+/gm, (match: string) => "    ".repeat(match.length))
    .replace(
      /^( {0,3})<!--([^]*?)-->.*$/gm,
      (match: string, leading: string, content: string) => {
        if (leading.length === 0 && /omit (in|from) toc/.test(content)) {
          return match;
        }
        return replacer(match);
      },
    )
    .replace(Regexp_Fenced_Code_Block, replacer)
    .split(/\r?\n/g);

  lines.forEach((lineText, i, arr) => {
    if (
      i < arr.length - 1 &&
      /^ {0,3}(?:=+|-+)[ \t]*$/.test(arr[i + 1]) &&
      /^ {0,3}[^ \t\f\v]/.test(lineText) &&
      !/^ {0,3}#{1,6}(?: |\t|$)/.test(lineText) &&
      !/^ {0,3}(?:[*+-]|\d{1,9}(?:\.|\)))(?: |\t|$)/.test(lineText) &&
      !/^ {0,3}>/.test(lineText) &&
      !/^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/.test(
        lineText,
      )
    ) {
      arr[i] = (arr[i + 1].includes("=") ? "# " : "## ") + lineText;
      arr[i + 1] = "";
    }
    arr[i] = arr[i].replace(/[ \t]+$/, "");
  });

  const projectOmitted = respectProjectLevelOmit
    ? getProjectExcludedHeadings(options?.fileUri, options?.filename)
    : [];

  let ignoredDepthBound: MarkdownSpec.MarkdownHeadingLevel | undefined = undefined;
  const toc: IHeadingBase[] = [];

  for (let i = 0; i < lines.length; i++) {
    const crtLineText = lines[i];
    if (!/^ {0,3}#{1,6}(?: |\t|$)/.test(crtLineText)) {
      continue;
    }

    const matches = /^ {0,3}(#{1,6})(.*)$/.exec(crtLineText)!;
    const entry: IHeadingBase = {
      level: matches[1].length as MarkdownSpec.MarkdownHeadingLevel,
      rawContent: matches[2].replace(/^[ \t]+/, "").replace(/[ \t]+#+[ \t]*$/, ""),
      lineIndex: i,
      canInToc: true,
    };

    if (
      respectMagicCommentOmit &&
      entry.canInToc &&
      ((i > 0 && /^<!-- omit (in|from) toc -->$/.test(lines[i - 1])) ||
        /<!-- omit (in|from) toc -->$/.test(crtLineText))
    ) {
      entry.canInToc = false;
    }

    if (respectProjectLevelOmit && entry.canInToc) {
      if (ignoredDepthBound !== undefined && entry.level > ignoredDepthBound) {
        entry.canInToc = false;
      }
      if (entry.canInToc) {
        if (
          projectOmitted.some(
            ({ level, text }) => level === entry.level && text === entry.rawContent,
          )
        ) {
          entry.canInToc = false;
          ignoredDepthBound = entry.level;
        } else {
          ignoredDepthBound = undefined;
        }
      }
    }

    toc.push(entry);
  }

  return toc;
}

export function getAllTocEntriesFromText(
  docText: string,
  options?: {
    respectMagicCommentOmit?: boolean;
    respectProjectLevelOmit?: boolean;
    slugifyMode?: SlugifyMode;
    fileUri?: string;
    filename?: string;
  },
): IHeading[] {
  const rootHeadings = getAllRootHeadingsFromText(docText, options);
  const { env } = commonMarkEngine.parseText(docText);
  const mode = options?.slugifyMode ?? configManager.get("toc.slugifyMode");

  const anchorOccurrences = new Map<string, number>();
  const getSlug = (rawContent: string): string => {
    let s = slugify(rawContent, { env, mode });
    const count = anchorOccurrences.get(s);
    if (count === undefined) {
      anchorOccurrences.set(s, 0);
    } else {
      const next = count + 1;
      anchorOccurrences.set(s, next);
      s += "-" + next.toString();
    }
    return s;
  };

  return rootHeadings.map((heading) => ({
    level: heading.level,
    rawContent: heading.rawContent,
    lineIndex: heading.lineIndex,
    canInToc: heading.canInToc,
    visibleText: createLinkText(heading.rawContent, env),
    slug: getSlug(heading.rawContent),
  }));
}

export function generateTocText(docText: string, ctx: TocFormattingContext): string {
  const cfg = getEffectiveTocSettings(ctx);
  const tocEntries = getAllTocEntriesFromText(docText, {
    respectMagicCommentOmit: true,
    respectProjectLevelOmit: true,
    fileUri: ctx.fileUri,
    filename: ctx.filename,
  }).filter(
    (i) => i.canInToc && i.level >= cfg.startDepth && i.level <= cfg.endDepth,
  );

  if (tocEntries.length === 0) return "";

  const startDepth = Math.max(
    cfg.startDepth,
    Math.min(...tocEntries.map((h) => h.level)),
  );
  const orderCounter: number[] = new Array(cfg.endDepth - startDepth + 1).fill(0);
  const rows: string[] = [];

  for (const entry of tocEntries) {
    const relativeLevel = entry.level - startDepth;
    const currHeadingOrder = ++orderCounter[relativeLevel];
    let indentationFix = "";

    if (cfg.orderedList) {
      const shift = orderCounter
        .slice(0, relativeLevel)
        .map((c) => String(c).length - 1)
        .reduce((a, b) => a + b, 0);
      indentationFix = " ".repeat(shift);
    }

    const row = [
      cfg.tab.repeat(relativeLevel) + indentationFix,
      (cfg.orderedList
        ? (cfg.orderedListMarkerIsOne ? "1" : currHeadingOrder) + "."
        : cfg.listMarker) + " ",
      cfg.plaintext ? entry.visibleText : `[${entry.visibleText}](#${entry.slug})`,
    ].join("");

    rows.push(row);

    if (cfg.orderedList) {
      orderCounter.fill(0, relativeLevel + 1);
    }
  }

  while (rows.length > 0 && /^[ \t]/.test(rows[0])) {
    rows.shift();
  }
  rows.push("");
  return rows.join(cfg.eol);
}

function commonPrefixLength(s1: string, s2: string): number {
  const minLength = Math.min(s1.length, s2.length);
  for (let i = 0; i < minLength; i++) {
    if (s1[i] !== s2[i]) return i;
  }
  return minLength;
}

function ratioOfCommonPrefix(s1: string, s2: string): number {
  const minLength = Math.min(s1.length, s2.length);
  const maxLength = Math.max(s1.length, s2.length);
  if (maxLength === 0) return 0;

  const prefixLength = commonPrefixLength(s1, s2);
  if (prefixLength < minLength) {
    return prefixLength / minLength;
  }
  return minLength / maxLength;
}

export function detectTocRangesInText(
  docText: string,
  ctx: TocFormattingContext,
): { ranges: TocRangeLine[]; newTocText: string } {
  const docTokens = mdEngine.parseText(docText).tokens;
  const rawLines = docText.split(/\r?\n/);

  const candidateLists: Array<[number, number, number]> = [];
  docTokens.forEach((token, index) => {
    if (
      token.level === 0 &&
      token.map &&
      (token.type === "bullet_list_open" ||
        (token.type === "ordered_list_open" && token.attrGet("start") === null))
    ) {
      candidateLists.push([token.map[0], token.map[1], index]);
    }
  });

  const newTocText = generateTocText(docText, ctx);
  if (!newTocText) {
    return { ranges: [], newTocText: "" };
  }

  const plaintext = configManager.get("toc.plaintext");
  const ranges: TocRangeLine[] = [];

  for (const [beginLineIndex, rawEndLineIndex, opTokenIndex] of candidateLists) {
    let endLineIndex = rawEndLineIndex;

    if (beginLineIndex > 0 && rawLines[beginLineIndex - 1] === "<!-- no toc -->") {
      continue;
    }

    const firstItemContent = docTokens[opTokenIndex + 3];
    if (!firstItemContent || firstItemContent.type !== "inline") {
      continue;
    }

    const tokens = firstItemContent.children ?? [];
    if (plaintext) {
      if (tokens.some((t) => t.type.startsWith("link_"))) {
        continue;
      }
    } else {
      if (
        tokens.length === 0 ||
        tokens[0].type !== "link_open" ||
        !tokens[0].attrGet("href")?.startsWith("#") ||
        tokens.findIndex((t) => t.type === "link_close") !== tokens.length - 1
      ) {
        continue;
      }
    }

    while (endLineIndex > beginLineIndex && (rawLines[endLineIndex - 1] ?? "").trim() === "") {
      endLineIndex--;
    }

    const listText =
      rawLines.slice(beginLineIndex, endLineIndex).join(ctx.eol) + ctx.eol;

    if (
      ratioOfCommonPrefix(newTocText, listText) +
        stringSimilarity.compareTwoStrings(newTocText, listText) >
      0.5
    ) {
      ranges.push({ startLine0: beginLineIndex, endLine0: endLineIndex });
    }
  }

  return { ranges, newTocText };
}

function getTocRangeOffsets(state: EditorState, r: TocRangeLine): { from: number; to: number } {
  const from = state.doc.line(r.startLine0 + 1).from;
  // In VS Code Range(beginLine, 0, endLine, 0) includes the trailing newline of endLine - 1 if endLine < lineCount
  const to =
    r.endLine0 < state.doc.lines
      ? state.doc.line(r.endLine0 + 1).from
      : state.doc.length;
  return { from, to };
}

function buildContextFromView(view: EditorView): TocFormattingContext {
  const file = getActiveFile();
  const fmt = getEditorFormattingOptions(view.state, file);
  return {
    ...fmt,
    fileUri: file?.uri,
    filename: file?.filename,
  };
}

export function createTocInView(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;

  const ctx = buildContextFromView(targetView);
  const tocText = generateTocText(targetView.state.doc.toString(), ctx);
  if (!tocText) return false;

  const sel = targetView.state.selection.main;
  const cm = getCM();
  targetView.dispatch({
    changes: { from: sel.from, to: sel.to, insert: tocText },
    selection: cm.state.EditorSelection.cursor(sel.from + tocText.length),
  });
  syncViewSession(targetView);
  return true;
}

export function updateTocInView(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;

  const state = targetView.state;
  const ctx = buildContextFromView(targetView);
  const { ranges, newTocText } = detectTocRangesInText(state.doc.toString(), ctx);
  if (ranges.length === 0) return false;

  const changes: ChangeSpec[] = [];
  for (const r of ranges) {
    const { from, to } = getTocRangeOffsets(state, r);
    const oldTocRaw = state.sliceDoc(from, to);
    const oldTocNormalized = oldTocRaw.replace(/\r?\n|\r/g, ctx.eol);

    const targetInsert =
      to === state.doc.length && !oldTocRaw.endsWith("\n")
        ? newTocText.replace(/\r?\n$/, "")
        : newTocText;

    if (oldTocNormalized !== newTocText) {
      changes.push({ from, to, insert: targetInsert });
    }
  }

  if (changes.length > 0) {
    targetView.dispatch({ changes });
    syncViewSession(targetView);
    return true;
  }
  return false;
}

export function computeSectionNumberLineChanges(
  docText: string,
  add: boolean,
  options?: { fileUri?: string; filename?: string },
): Array<{ lineIndex0: number; newLineText: string }> {
  const rawLines = docText.split(/\r?\n/);

  if (add) {
    const levelsStr = configManager.get("toc.levels") || "1..6";
    let cfgStart = 1;
    let cfgEnd = 6;
    const m = levelsStr.match(/^([1-6])\.\.([1-6])$/);
    if (m) {
      cfgStart = Number(m[1]);
      cfgEnd = Number(m[2]);
    }

    const headings = getAllRootHeadingsFromText(docText, {
      respectMagicCommentOmit: true,
      respectProjectLevelOmit: true,
      fileUri: options?.fileUri,
      filename: options?.filename,
    }).filter((i) => i.canInToc && i.level >= cfgStart && i.level <= cfgEnd);

    if (headings.length === 0) return [];

    const startDepth = Math.max(
      cfgStart,
      Math.min(...headings.map((h) => h.level)),
    );
    const secNumbers = [0, 0, 0, 0, 0, 0];
    const updates: Array<{ lineIndex0: number; newLineText: string }> = [];

    for (const entry of headings) {
      const level = entry.level;
      const lineNum = entry.lineIndex;
      secNumbers[level - 1] += 1;
      secNumbers.fill(0, level);

      const secNumStr = [...Array(level - startDepth + 1).keys()]
        .map((num) => `${secNumbers[num + startDepth - 1]}.`)
        .join("");

      const lineText = rawLines[lineNum] ?? "";
      const newText = lineText.includes("#")
        ? lineText.replace(
            /^(\s{0,3}#+ +)((?:\d{1,9}\.)* )?(.*)/,
            (_, g1, _g2, g3) => `${g1}${secNumStr} ${g3}`,
          )
        : lineText.replace(
            /^(\s{0,3})((?:\d{1,9}\.)* )?(.*)/,
            (_, g1, _g2, g3) => `${g1}${secNumStr} ${g3}`,
          );

      if (newText !== lineText) {
        updates.push({ lineIndex0: lineNum, newLineText: newText });
      }
    }
    return updates;
  } else {
    const headings = getAllRootHeadingsFromText(docText, {
      respectMagicCommentOmit: false,
      respectProjectLevelOmit: false,
    });
    const updates: Array<{ lineIndex0: number; newLineText: string }> = [];

    for (const entry of headings) {
      const lineNum = entry.lineIndex;
      const lineText = rawLines[lineNum] ?? "";
      const newText = lineText.includes("#")
        ? lineText.replace(
            /^(\s{0,3}#+ +)((?:\d{1,9}\.)* )?(.*)/,
            (_, g1, _g2, g3) => `${g1}${g3}`,
          )
        : lineText.replace(
            /^(\s{0,3})((?:\d{1,9}\.)* )?(.*)/,
            (_, g1, _g2, g3) => `${g1}${g3}`,
          );
      if (newText !== lineText) {
        updates.push({ lineIndex0: lineNum, newLineText: newText });
      }
    }
    return updates;
  }
}

export function addSectionNumbersInView(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;

  const file = getActiveFile();
  const updates = computeSectionNumberLineChanges(targetView.state.doc.toString(), true, {
    fileUri: file?.uri,
    filename: file?.filename,
  });
  if (updates.length === 0) return false;

  const changes: ChangeSpec[] = updates.map((u) => {
    const ln = targetView.state.doc.line(u.lineIndex0 + 1);
    return { from: ln.from, to: ln.to, insert: u.newLineText };
  });

  targetView.dispatch({ changes });
  syncViewSession(targetView);
  return true;
}

export function removeSectionNumbersInView(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;

  const updates = computeSectionNumberLineChanges(targetView.state.doc.toString(), false);
  if (updates.length === 0) return false;

  const changes: ChangeSpec[] = updates.map((u) => {
    const ln = targetView.state.doc.line(u.lineIndex0 + 1);
    return { from: ln.from, to: ln.to, insert: u.newLineText };
  });

  targetView.dispatch({ changes });
  syncViewSession(targetView);
  return true;
}

/**
 * CodeMirror 6 equivalent of VS Code's TocCodeLensProvider:
 * Displays a subtle inline CodeLens status line above detected TOC blocks
 * ("Table of Contents (up to date)" or "Table of Contents (out of date — tap to update)").
 */
export function createTocCodeLensExtension() {
  const cm = getCM();
  const { Decoration, ViewPlugin, WidgetType } = cm.view;

  class TocStatusWidget extends WidgetType {
    constructor(private readonly upToDate: boolean) {
      super();
    }

    eq(other: TocStatusWidget): boolean {
      return this.upToDate === other.upToDate;
    }

    toDOM(view: EditorView): HTMLElement {
      const span = document.createElement("div");
      span.className = "cm-md-toc-codelens";
      span.textContent = this.upToDate
        ? "Table of Contents (up to date)"
        : "Table of Contents (out of date — tap to update)";
      if (!this.upToDate) {
        span.style.cursor = "pointer";
        span.style.textDecoration = "underline";
        span.addEventListener("mousedown", (e) => {
          e.preventDefault();
          updateTocInView(view);
        });
      }
      return span;
    }

    ignoreEvent(): boolean {
      return false;
    }
  }

  function buildDecos(view: EditorView) {
    const state = view.state;
    if (!isMarkdownState(state)) return Decoration.none;
    if (state.doc.length > configManager.get("syntax.decorationFileSizeLimit")) {
      return Decoration.none;
    }

    const ctx = buildContextFromView(view);
    const { ranges, newTocText } = detectTocRangesInText(state.doc.toString(), ctx);
    if (ranges.length === 0) return Decoration.none;

    const builder = new cm.state.RangeSetBuilder<ReturnType<typeof Decoration.widget>>();
    for (const r of ranges) {
      const { from, to } = getTocRangeOffsets(state, r);
      const oldToc = state.sliceDoc(from, to).replace(/\r?\n|\r/g, ctx.eol);
      const upToDate = oldToc === newTocText;
      builder.add(
        from,
        from,
        Decoration.widget({
          widget: new TocStatusWidget(upToDate),
          block: false,
          side: -1,
        }),
      );
    }
    return builder.finish();
  }

  return ViewPlugin.fromClass(
    class {
      decorations: ReturnType<typeof buildDecos>;
      private timer: ReturnType<typeof setTimeout> | null = null;

      constructor(view: EditorView) {
        this.decorations = buildDecos(view);
      }

      update(update: any) {
        if (update.docChanged) {
          this.decorations = this.decorations.map(update.changes);
          if (this.timer) clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            this.timer = null;
            this.decorations = buildDecos(update.view);
            update.view.dispatch({});
          }, 350);
        }
      }

      destroy() {
        if (this.timer) clearTimeout(this.timer);
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

export class TocSaveWatcher {
  private savingGuard = false;
  private onSaveBound = this.onSaveFile.bind(this);

  public activate(): void {
    const em = getEditorManager();
    em?.on("save-file", this.onSaveBound);
  }

  private async onSaveFile(file?: any): Promise<void> {
    if (this.savingGuard) return;
    if (!configManager.get("toc.updateOnSave")) return;

    const targetFile = file ?? getActiveFile();
    if (!isMarkdownFile(targetFile)) return;
    if (targetFile !== getActiveFile()) return;

    const view = getActiveView();
    if (!view || view.state.readOnly) return;

    const updated = updateTocInView(view);
    if (updated && targetFile?.save) {
      try {
        this.savingGuard = true;
        await targetFile.save();
      } catch {
        // Ignore save re-entry errors
      } finally {
        this.savingGuard = false;
      }
    }
  }

  public dispose(): void {
    const em = getEditorManager();
    em?.off("save-file", this.onSaveBound);
  }
}
