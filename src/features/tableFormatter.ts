import type { ChangeSpec, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import GraphemeSplitter from "grapheme-splitter";
import plugin from "../../plugin.json";
import {
  getActiveFile,
  getActiveView,
  getEditorFormattingOptions,
  isMarkdownFile,
  syncViewSession,
} from "../cm/runtime";
import { configManager } from "../config";

const splitter = new GraphemeSplitter();

export interface DetectedTable {
  text: string;
  from: number;
  to: number;
}

const enum ColumnAlignment {
  None,
  Left,
  Center,
  Right,
}

export interface TableFormatOptions {
  tabSize: number;
  eol: "\n" | "\r\n";
  normalizeIndentation?: boolean;
  delimiterRowNoPadding?: boolean;
}

const doubleWidthRegex =
  /\p{Extended_Pictographic}|[\u3000-\u9fff\uac00-\ud7af\uff01-\uff60]/gu;

export function detectTablesInText(text: string): DetectedTable[] {
  const lineBreak = String.raw`\r?\n`;
  const contentLine = String.raw`\|?.*\|.*\|?`;

  const leftSideHyphenComponent = String.raw`(?:\|? *:?-+:? *\|)`;
  const middleHyphenComponent = String.raw`(?: *:?-+:? *\|)*`;
  const rightSideHyphenComponent = String.raw`(?: *:?-+:? *\|?)`;
  const multiColumnHyphenLine =
    leftSideHyphenComponent + middleHyphenComponent + rightSideHyphenComponent;

  const singleColumnHyphenLine = String.raw`(?:\| *:?-+:? *\|)`;
  const hyphenLine = String.raw`[ \t]*(?:${multiColumnHyphenLine}|${singleColumnHyphenLine})[ \t]*`;

  const tableRegex = new RegExp(
    contentLine + lineBreak + hyphenLine + "(?:" + lineBreak + contentLine + ")*",
    "g",
  );

  return Array.from(text.matchAll(tableRegex), (item): DetectedTable => ({
    text: item[0],
    from: item.index!,
    to: item.index! + item[0].length,
  }));
}

function getTableIndentation(
  text: string,
  tabSize: number,
  doNormalize: boolean,
): string {
  const indentRegex = /^(\s*)\S/u;
  const match = text.match(indentRegex);
  const spacesInFirstLine = match?.[1].length ?? 0;
  const tabStops = Math.round(spacesInFirstLine / tabSize);
  return doNormalize
    ? " ".repeat(tabSize * tabStops)
    : " ".repeat(spacesInFirstLine);
}

function alignText(text: string, align: ColumnAlignment, length: number): string {
  if (align === ColumnAlignment.Center && length > text.length) {
    return (
      " ".repeat(Math.floor((length - text.length) / 2)) +
      text +
      " ".repeat(length)
    ).slice(0, length);
  } else if (align === ColumnAlignment.Right) {
    return (" ".repeat(length) + text).slice(-length);
  } else {
    return (text + " ".repeat(length)).slice(0, length);
  }
}

export function formatSingleTable(
  rawTableText: string,
  options: TableFormatOptions,
): string {
  const text = rawTableText.normalize();
  const delimiterRowIndex = 1;
  const delimiterRowNoPadding =
    options.delimiterRowNoPadding ??
    configManager.get("tableFormatter.delimiterRowNoPadding");
  const normalizeIndentation =
    options.normalizeIndentation ??
    configManager.get("tableFormatter.normalizeIndentation");
  const indentation = getTableIndentation(
    text,
    options.tabSize,
    normalizeIndentation,
  );

  const rowsNoIndentPattern = /^\s*(\S.*)$/gum;
  const rows: string[] = Array.from(text.matchAll(rowsNoIndentPattern), (match) =>
    match[1].trim(),
  );

  const colWidth: number[] = [];
  const colAlign: ColumnAlignment[] = [];
  const fieldRegExp = /((\\\||[^\|])*)\|/gu;

  const lines = rows.map((row, iRow) => {
    if (row.startsWith("|")) {
      row = row.slice(1);
    }
    if (!row.endsWith("|")) {
      row = row + "|";
    }

    const values: string[] = [];
    let iCol = 0;
    for (const field of row.matchAll(fieldRegExp)) {
      const cell = field[1].trim();
      values.push(cell);

      if (iRow === delimiterRowIndex) {
        continue;
      }

      const graphemeCount = splitter.countGraphemes(cell);
      const doubleWidthChars = cell.match(doubleWidthRegex);
      const width = graphemeCount + (doubleWidthChars?.length ?? 0);
      colWidth[iCol] = Math.max(colWidth[iCol] || 0, width);

      iCol++;
    }
    return values;
  });

  if (!lines[delimiterRowIndex]) {
    return rawTableText;
  }

  lines[delimiterRowIndex] = lines[delimiterRowIndex].map((cell, iCol) => {
    const currentWidth = colWidth[iCol] || 0;
    if (/:-+:/.test(cell)) {
      colAlign[iCol] = ColumnAlignment.Center;
      colWidth[iCol] = Math.max(currentWidth, delimiterRowNoPadding ? 5 - 2 : 5);
      const specWidth = delimiterRowNoPadding ? colWidth[iCol] + 2 : colWidth[iCol];
      return ":" + "-".repeat(specWidth - 2) + ":";
    } else if (/:-+/.test(cell)) {
      colAlign[iCol] = ColumnAlignment.Left;
      colWidth[iCol] = Math.max(currentWidth, delimiterRowNoPadding ? 4 - 2 : 4);
      const specWidth = delimiterRowNoPadding ? colWidth[iCol] + 2 : colWidth[iCol];
      return ":" + "-".repeat(specWidth - 1);
    } else if (/-+:/.test(cell)) {
      colAlign[iCol] = ColumnAlignment.Right;
      colWidth[iCol] = Math.max(currentWidth, delimiterRowNoPadding ? 4 - 2 : 4);
      const specWidth = delimiterRowNoPadding ? colWidth[iCol] + 2 : colWidth[iCol];
      return "-".repeat(specWidth - 1) + ":";
    } else {
      colAlign[iCol] = ColumnAlignment.None;
      colWidth[iCol] = Math.max(currentWidth, delimiterRowNoPadding ? 3 - 2 : 3);
      const specWidth = delimiterRowNoPadding ? colWidth[iCol] + 2 : colWidth[iCol];
      return "-".repeat(specWidth);
    }
  });

  return lines
    .map((row, iRow) => {
      if (iRow === delimiterRowIndex && delimiterRowNoPadding) {
        return indentation + "|" + row.join("|") + "|";
      }

      const cells = row.map((cell, iCol) => {
        const visualWidth = colWidth[iCol] ?? 3;
        let jsLength = splitter
          .splitGraphemes(cell + " ".repeat(visualWidth))
          .slice(0, visualWidth)
          .join("").length;

        jsLength -= cell.match(doubleWidthRegex)?.length ?? 0;

        return alignText(cell, colAlign[iCol] ?? ColumnAlignment.None, jsLength);
      });
      return indentation + "| " + cells.join(" | ") + " |";
    })
    .join(options.eol);
}

export function formatMarkdownTablesInText(
  docText: string,
  options: TableFormatOptions,
  range?: { from: number; to: number },
): { formattedText: string; changes: ChangeSpec[] } {
  const tables = detectTablesInText(docText);
  if (tables.length === 0) {
    return { formattedText: docText, changes: [] };
  }

  const targetTables = range
    ? tables.filter((t) => !(t.to < range.from || t.from > range.to))
    : tables;

  const changes: ChangeSpec[] = [];
  let result = docText;
  let delta = 0;

  for (const table of targetTables) {
    const formatted = formatSingleTable(table.text, options);
    if (formatted !== table.text) {
      changes.push({ from: table.from, to: table.to, insert: formatted });
      result =
        result.slice(0, table.from + delta) +
        formatted +
        result.slice(table.to + delta);
      delta += formatted.length - (table.to - table.from);
    }
  }

  return { formattedText: result, changes };
}

export function formatTablesInView(view?: EditorView | null, selectionOnly = false): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView) return false;

  const file = getActiveFile();
  const state: EditorState = targetView.state;
  const opts = getEditorFormattingOptions(state, file);
  const sel = state.selection.main;
  const range = selectionOnly && !sel.empty ? { from: sel.from, to: sel.to } : undefined;

  const { changes } = formatMarkdownTablesInText(
    state.doc.toString(),
    { tabSize: opts.tabSize, eol: opts.eol },
    range,
  );

  if (changes.length > 0) {
    targetView.dispatch({ changes });
    syncViewSession(targetView);
    return true;
  }
  return false;
}

export class TableFormatterService {
  private isRegistered = false;
  private unsubscribeConfig: (() => void) | null = null;

  public activate(): void {
    this.syncRegistration();
    this.unsubscribeConfig = configManager.onChange((key) => {
      if (key === "tableFormatter.enabled" || key === "extraLangIds") {
        this.syncRegistration();
      }
    });
  }

  public syncRegistration(): void {
    if (typeof window === "undefined" || !(window as any).acode) return;

    if (this.isRegistered) {
      try {
        acode.unregisterFormatter(plugin.id);
      } catch {
        // Ignore
      }
      this.isRegistered = false;
    }

    if (configManager.get("tableFormatter.enabled")) {
      const extra = (configManager.get("extraLangIds") || []).map((e) =>
        e.trim().toLowerCase().replace(/^\./, ""),
      );
      const extensions = Array.from(
        new Set(["md", "markdown", "mdown", "mkd", "rmd", "qmd", ...extra]),
      ).filter(Boolean);

      acode.registerFormatter(
        plugin.id,
        extensions,
        async () => {
          const file = getActiveFile();
          if (file && !isMarkdownFile(file)) return;
          formatTablesInView(getActiveView(), false);
        },
        "Markdown All in One (Tables)",
      );
      this.isRegistered = true;
    }
  }

  public dispose(): void {
    this.unsubscribeConfig?.();
    this.unsubscribeConfig = null;
    if (this.isRegistered && typeof window !== "undefined" && (window as any).acode) {
      try {
        acode.unregisterFormatter(plugin.id);
      } catch {
        // Ignore
      }
      this.isRegistered = false;
    }
  }
}
