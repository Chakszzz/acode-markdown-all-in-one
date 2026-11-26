import type { ChangeSpec, EditorState, SelectionRange, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getActiveView, getCM, isMarkdownState, syncViewSession } from "../cm/runtime";
import { configManager } from "../config";
import { fixMarkerInView } from "./listEditing";

/**
 * Markdown word pattern from vscode-markdown/src/extension.ts:
 * Allows `*`, `_`, `~~`, `` ` `` around words so toggleBold/toggleItalic without selection
 * unwraps styled words seamlessly.
 */
const MARKDOWN_WORD_REGEX =
  /([*_]{1,2}|~~|`+)?[\p{Alphabetic}\p{Number}\p{Nonspacing_Mark}]+(_+[\p{Alphabetic}\p{Number}\p{Nonspacing_Mark}]+)*\1/gu;

function createLinkRegex(): RegExp {
  const ul = "\\u00a1-\\uffff";
  const ipv4_re =
    "(?:25[0-5]|2[0-4]\\d|[0-1]?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|[0-1]?\\d?\\d)){3}";
  const ipv6_re = "\\[[0-9a-f:\\.]+\\]";
  const hostname_re =
    "[a-z" + ul + "0-9](?:[a-z" + ul + "0-9-]{0,61}[a-z" + ul + "0-9])?";
  const domain_re = "(?:\\.(?!-)[a-z" + ul + "0-9-]{1,63}(?<!-))*";
  const tld_re =
    "\\.(?!-)(?:[a-z" + ul + "-]{2,63}|xn--[a-z0-9]{1,59})(?<!-)\\.?";
  const host_re = "(" + hostname_re + domain_re + tld_re + "|localhost)";
  const pattern =
    "^(?:[a-z0-9\\.\\-\\+]*)://" +
    "(?:[^\\s:@/]+(?::[^\\s:@/]*)?@)?" +
    "(?:" +
    ipv4_re +
    "|" +
    ipv6_re +
    "|" +
    host_re +
    ")" +
    "(?::\\d{2,5})?" +
    "(?:[/?#][^\\s]*)?" +
    "$";

  return new RegExp(pattern, "i");
}

const singleLinkRegex: RegExp = createLinkRegex();

export function isSingleLink(text: string): boolean {
  return singleLinkRegex.test(text);
}

export function getMarkdownWordRangeAt(
  lineText: string,
  col: number,
): { fromCol: number; toCol: number } | null {
  MARKDOWN_WORD_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_WORD_REGEX.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (col >= start && col <= end) {
      return { fromCol: start, toCol: end };
    }
  }
  return null;
}

function isWrapped(text: string, startPattern: string, endPattern: string): boolean {
  return (
    text.length >= startPattern.length + endPattern.length &&
    text.startsWith(startPattern) &&
    text.endsWith(endPattern)
  );
}

function getCursorContext(
  lineText: string,
  col: number,
  startPattern: string,
  endPattern: string,
): string {
  const startCol = Math.max(0, col - startPattern.length);
  const endCol = Math.min(lineText.length, col + endPattern.length);
  const leftText = lineText.slice(startCol, col);
  const rightText = lineText.slice(col, endCol);

  if (rightText === endPattern) {
    if (leftText === startPattern) {
      return `${startPattern}|${endPattern}`;
    }
    return `${startPattern}text|${endPattern}`;
  }
  return "|";
}

export function styleByWrapping(
  view: EditorView | null | undefined,
  startPattern: string,
  endPattern = startPattern,
): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;

  const cm = getCM();
  const state = targetView.state;
  const ranges = state.selection.ranges;
  const changes: ChangeSpec[] = [];
  const newSelections: SelectionRange[] = [];

  let cumulativeOffsetDelta = 0;
  const ptnLength = startPattern.length + endPattern.length;

  for (const sel of ranges) {
    const cursorOffset = sel.head;
    const line = state.doc.lineAt(cursorOffset);
    const cursorCol = cursorOffset - line.from;

    if (sel.empty) {
      const ctx = getCursorContext(line.text, cursorCol, startPattern, endPattern);

      if (
        startPattern === endPattern &&
        ["**", "*", "__", "_"].includes(startPattern) &&
        ctx === `${startPattern}text|${endPattern}`
      ) {
        // Jump out of closing marker: `**text|**` -> `**text**|`
        const nextCursor = cursorOffset + cumulativeOffsetDelta + endPattern.length;
        newSelections.push(cm.state.EditorSelection.cursor(nextCursor));
        continue;
      } else if (ctx === `${startPattern}|${endPattern}`) {
        // Empty wrapped `**|**` -> `|`
        const from = cursorOffset - startPattern.length;
        const to = cursorOffset + endPattern.length;
        changes.push({ from, to, insert: "" });
        const nextCursor = from + cumulativeOffsetDelta;
        cumulativeOffsetDelta -= ptnLength;
        newSelections.push(cm.state.EditorSelection.cursor(nextCursor));
        continue;
      } else {
        let replaceFrom = cursorOffset;
        let replaceTo = cursorOffset;

        const wordRange = getMarkdownWordRangeAt(line.text, cursorCol);
        if (wordRange) {
          replaceFrom = line.from + wordRange.fromCol;
          replaceTo = line.from + wordRange.toCol;
        }

        // Special case: toggle strikethrough in task list / bullet list
        if (
          startPattern === "~~" &&
          /^\s*[\*\+\-] (\[[ x]\] )? */.test(line.text)
        ) {
          const prefixLen = line.text.match(/^\s*[\*\+\-] (\[[ x]\] )? */)![0]
            .length;
          replaceFrom = line.from + prefixLen;
          replaceTo = line.to;
        }

        const text = state.sliceDoc(replaceFrom, replaceTo);
        const rangeIsEmpty = replaceFrom === replaceTo;

        if (isWrapped(text, startPattern, endPattern)) {
          const inner = text.slice(
            startPattern.length,
            text.length - endPattern.length,
          );
          changes.push({ from: replaceFrom, to: replaceTo, insert: inner });

          let nextCursor: number;
          if (!rangeIsEmpty) {
            if (cursorOffset === replaceTo) {
              nextCursor = cursorOffset + cumulativeOffsetDelta - ptnLength;
            } else if (cursorOffset <= replaceFrom + startPattern.length) {
              nextCursor = replaceFrom + cumulativeOffsetDelta;
            } else {
              nextCursor = cursorOffset + cumulativeOffsetDelta - startPattern.length;
            }
          } else {
            nextCursor = cursorOffset + cumulativeOffsetDelta;
          }
          cumulativeOffsetDelta -= ptnLength;
          newSelections.push(cm.state.EditorSelection.cursor(nextCursor));
        } else {
          const wrapped = startPattern + text + endPattern;
          changes.push({ from: replaceFrom, to: replaceTo, insert: wrapped });

          let nextCursor: number;
          if (!rangeIsEmpty) {
            if (cursorOffset === replaceTo) {
              nextCursor = cursorOffset + cumulativeOffsetDelta + ptnLength;
            } else {
              nextCursor = cursorOffset + cumulativeOffsetDelta + startPattern.length;
            }
          } else {
            nextCursor = cursorOffset + cumulativeOffsetDelta + startPattern.length;
          }
          cumulativeOffsetDelta += ptnLength;
          newSelections.push(cm.state.EditorSelection.cursor(nextCursor));
        }
      }
    } else {
      // Non-empty selection
      const text = state.sliceDoc(sel.from, sel.to);
      if (isWrapped(text, startPattern, endPattern)) {
        const inner = text.slice(
          startPattern.length,
          text.length - endPattern.length,
        );
        changes.push({ from: sel.from, to: sel.to, insert: inner });
        const nextFrom = sel.from + cumulativeOffsetDelta;
        const nextTo = sel.to + cumulativeOffsetDelta - ptnLength;
        cumulativeOffsetDelta -= ptnLength;
        newSelections.push(cm.state.EditorSelection.range(nextFrom, nextTo));
      } else {
        const wrapped = startPattern + text + endPattern;
        changes.push({ from: sel.from, to: sel.to, insert: wrapped });
        const nextFrom = sel.from + cumulativeOffsetDelta;
        const nextTo = sel.to + cumulativeOffsetDelta + ptnLength;
        cumulativeOffsetDelta += ptnLength;
        newSelections.push(cm.state.EditorSelection.range(nextFrom, nextTo));
      }
    }
  }

  targetView.dispatch({
    changes,
    selection: cm.state.EditorSelection.create(newSelections),
  });
  syncViewSession(targetView);
  return true;
}

export function toggleBold(view?: EditorView | null): boolean {
  const indicator = configManager.get("bold.indicator") || "**";
  return styleByWrapping(view, indicator);
}

export function toggleItalic(view?: EditorView | null): boolean {
  const indicator = configManager.get("italic.indicator") || "*";
  return styleByWrapping(view, indicator);
}

export function toggleCodeSpan(view?: EditorView | null): boolean {
  return styleByWrapping(view, "`");
}

export function toggleStrikethrough(view?: EditorView | null): boolean {
  return styleByWrapping(view, "~~");
}

export function toggleCodeBlock(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;

  const cm = getCM();
  const state = targetView.state;
  const sel = state.selection.main;
  const selectedText = state.sliceDoc(sel.from, sel.to);
  const replacement = "```\n" + selectedText + "\n```";
  const cursorTarget = sel.from + 3; // right after opening ``` so user can type language id

  targetView.dispatch({
    changes: { from: sel.from, to: sel.to, insert: replacement },
    selection: cm.state.EditorSelection.cursor(cursorTarget),
  });
  syncViewSession(targetView);
  return true;
}

export function toggleHeadingUp(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;

  const line = targetView.state.doc.lineAt(targetView.state.selection.main.head);
  if (!line.text.startsWith("#")) {
    targetView.dispatch({ changes: { from: line.from, insert: "# " } });
    syncViewSession(targetView);
    return true;
  } else if (!line.text.startsWith("######")) {
    targetView.dispatch({ changes: { from: line.from, insert: "#" } });
    syncViewSession(targetView);
    return true;
  }
  return false;
}

export function toggleHeadingDown(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;

  const line = targetView.state.doc.lineAt(targetView.state.selection.main.head);
  if (line.text.startsWith("# ")) {
    targetView.dispatch({
      changes: { from: line.from, to: line.from + 2, insert: "" },
    });
    syncViewSession(targetView);
    return true;
  } else if (line.text.startsWith("#")) {
    targetView.dispatch({
      changes: { from: line.from, to: line.from + 1, insert: "" },
    });
    syncViewSession(targetView);
    return true;
  }
  return false;
}

const enum MathBlockState {
  NONE,
  INLINE,
  SINGLE_DISPLAYED,
  MULTI_DISPLAYED,
}

const mathTransTable = [
  MathBlockState.NONE,
  MathBlockState.INLINE,
  MathBlockState.MULTI_DISPLAYED,
  MathBlockState.SINGLE_DISPLAYED,
];

const reverseMathTransTable = [...mathTransTable].reverse();

function detectMathBlockState(state: EditorState, cursorOffset: number): MathBlockState {
  const line = state.doc.lineAt(cursorOffset);
  const col = cursorOffset - line.from;

  if (getCursorContext(line.text, col, "$", "$") === "$|$") {
    return MathBlockState.INLINE;
  }
  if (getCursorContext(line.text, col, "$$ ", " $$") === "$$ | $$") {
    return MathBlockState.SINGLE_DISPLAYED;
  }
  if (
    line.text === "" &&
    line.number > 1 &&
    state.doc.line(line.number - 1).text.endsWith("$$") &&
    line.number < state.doc.lines &&
    state.doc.line(line.number + 1).text.startsWith("$$")
  ) {
    return MathBlockState.MULTI_DISPLAYED;
  }
  return MathBlockState.NONE;
}

export function toggleMath(view?: EditorView | null, reverse = false): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;

  const state = targetView.state;
  const sel = state.selection.main;
  if (!sel.empty) return false;

  const cm = getCM();
  const table = reverse ? reverseMathTransTable : mathTransTable;
  const oldState = detectMathBlockState(state, sel.head);
  const idx = table.indexOf(oldState);
  const nextState = table[(idx + 1) % table.length];

  const line = state.doc.lineAt(sel.head);
  let delFrom = sel.head;
  let delTo = sel.head;

  switch (oldState) {
    case MathBlockState.NONE:
      break;
    case MathBlockState.INLINE:
      delFrom = sel.head - 1;
      delTo = sel.head + 1;
      break;
    case MathBlockState.SINGLE_DISPLAYED:
      delFrom = sel.head - 3;
      delTo = sel.head + 3;
      break;
    case MathBlockState.MULTI_DISPLAYED: {
      const prevLine = state.doc.line(line.number - 1);
      const nextLine = state.doc.line(line.number + 1);
      delFrom = prevLine.to - 2;
      delTo = nextLine.from + 2;
      break;
    }
  }

  let insertText = "";
  let cursorOffsetInInsert = 0;
  switch (nextState) {
    case MathBlockState.NONE:
      insertText = "";
      cursorOffsetInInsert = 0;
      break;
    case MathBlockState.INLINE:
      insertText = "$$";
      cursorOffsetInInsert = 1;
      break;
    case MathBlockState.SINGLE_DISPLAYED:
      insertText = "$$  $$";
      cursorOffsetInInsert = 3;
      break;
    case MathBlockState.MULTI_DISPLAYED:
      insertText = "$$\n\n$$";
      cursorOffsetInInsert = 3;
      break;
  }

  targetView.dispatch({
    changes: { from: delFrom, to: delTo, insert: insertText },
    selection: cm.state.EditorSelection.cursor(delFrom + cursorOffsetInInsert),
  });
  syncViewSession(targetView);
  return true;
}

const enum ListMarker {
  EMPTY = "",
  DASH = "- ",
  STAR = "* ",
  PLUS = "+ ",
  NUM = "1. ",
  NUM_PAREN = "1) ",
}

const simpleListMarkers = [ListMarker.DASH, ListMarker.STAR, ListMarker.PLUS];
const defaultListMarkers = [
  ListMarker.DASH,
  ListMarker.STAR,
  ListMarker.PLUS,
  ListMarker.NUM,
  ListMarker.NUM_PAREN,
];
const listMarkerNumRegex = /^\d+\. /;
const listMarkerNumParenRegex = /^\d+\) /;

function toListMarker(raw: string): ListMarker {
  switch (raw) {
    case "- ":
      return ListMarker.DASH;
    case "* ":
      return ListMarker.STAR;
    case "+ ":
      return ListMarker.PLUS;
    case "1. ":
      return ListMarker.NUM;
    case "1) ":
      return ListMarker.NUM_PAREN;
    default:
      return ListMarker.EMPTY;
  }
}

function getCurrentListStart(lineTextContent: string): ListMarker {
  if (lineTextContent.startsWith(ListMarker.DASH)) return ListMarker.DASH;
  if (lineTextContent.startsWith(ListMarker.STAR)) return ListMarker.STAR;
  if (lineTextContent.startsWith(ListMarker.PLUS)) return ListMarker.PLUS;
  if (listMarkerNumRegex.test(lineTextContent)) return ListMarker.NUM;
  if (listMarkerNumParenRegex.test(lineTextContent)) return ListMarker.NUM_PAREN;
  return ListMarker.EMPTY;
}

function getMarkerEndCharacter(currentMarker: ListMarker, lineText: string): number {
  const indentation =
    lineText.trim().length === 0 ? lineText.length : lineText.indexOf(lineText.trim());
  const content = lineText.slice(indentation);

  let endChar = indentation;
  if (simpleListMarkers.includes(currentMarker)) {
    endChar += 2;
  } else if (listMarkerNumRegex.test(content)) {
    const digits = /^(\d+)\./.exec(lineText.trim())![1].length;
    endChar += digits + 2;
  } else if (listMarkerNumParenRegex.test(content)) {
    const digits = /^(\d+)\)/.exec(lineText.trim())![1].length;
    endChar += digits + 2;
  }
  return endChar;
}

function getCandidateMarkers(): ListMarker[] {
  const cfg = configManager.get("list.toggle.candidate-markers");
  if (!Array.isArray(cfg) || cfg.length === 0) {
    return [...defaultListMarkers, ListMarker.EMPTY];
  }
  const mapped = cfg
    .map((e) => toListMarker(e.trim() + " "))
    .filter((e) => defaultListMarkers.includes(e));
  mapped.push(ListMarker.EMPTY);
  return mapped;
}

function getNextListMarker(current: ListMarker): ListMarker {
  const candidates = getCandidateMarkers();
  const idx = candidates.indexOf(current);
  if (idx >= 0 && idx < candidates.length - 1) {
    return candidates[idx + 1];
  }
  return candidates[0];
}

export function toggleList(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;

  const state = targetView.state;
  const lineNumbers = new Set<number>();

  for (const sel of state.selection.ranges) {
    if (sel.empty) {
      lineNumbers.add(state.doc.lineAt(sel.head).number);
    } else {
      const startL = state.doc.lineAt(sel.from).number;
      const endL = state.doc.lineAt(sel.to).number;
      for (let l = startL; l <= endL; l++) {
        lineNumbers.add(l);
      }
    }
  }

  const changes: ChangeSpec[] = [];
  const sortedLines = Array.from(lineNumbers).sort((a, b) => a - b);

  for (const lineNo of sortedLines) {
    const line = state.doc.line(lineNo);
    const lineText = line.text;
    const indentation =
      lineText.trim().length === 0
        ? lineText.length
        : lineText.indexOf(lineText.trim());
    const content = lineText.slice(indentation);
    const currentMarker = getCurrentListStart(content);
    const nextMarker = getNextListMarker(currentMarker);
    const endChar = getMarkerEndCharacter(currentMarker, lineText);

    changes.push({
      from: line.from + indentation,
      to: line.from + endChar,
      insert: nextMarker,
    });
  }

  if (changes.length > 0) {
    targetView.dispatch({ changes });
    fixMarkerInView(targetView);
    syncViewSession(targetView);
    return true;
  }
  return false;
}

async function readClipboardText(): Promise<string> {
  const w = typeof window !== "undefined" ? (window as any) : null;
  if (w?.cordova?.plugins?.clipboard?.paste) {
    return new Promise<string>((resolve) => {
      w.cordova.plugins.clipboard.paste(
        (text: string) => resolve(text || ""),
        () => resolve(""),
      );
    });
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * CodeMirror 6 transactionFilter that intercepts pastes from ANY source in Acode:
 * - Acode's native pasteCommand on older builds (`changeByRange` with NO userEvent)
 * - Acode's native pasteCommand on newer builds (`replaceSelection` + `userEvent: "input.paste"`)
 * - Android soft-keyboard clipboard strip (`input.type` / `input.paste`)
 * - Hardware keyboard Ctrl+V / Cmd+V
 */
export function createSmartPasteTransactionFilter() {
  const cm = getCM();
  return cm.state.EditorState.transactionFilter.of((tr: Transaction) => {
    if (!tr.docChanged) return tr;
    if (tr.isUserEvent("input.paste.smartlink")) return tr;
    if (
      tr.isUserEvent("undo") ||
      tr.isUserEvent("redo") ||
      tr.isUserEvent("delete") ||
      tr.isUserEvent("move")
    ) {
      return tr;
    }

    const userEvent = tr.annotation(cm.state.Transaction.userEvent);
    if (
      userEvent !== undefined &&
      !tr.isUserEvent("input.paste") &&
      !tr.isUserEvent("input.type")
    ) {
      return tr;
    }

    const startState = tr.startState;
    if (startState.readOnly || !isMarkdownState(startState)) return tr;
    if (startState.selection.ranges.length !== 1) return tr;

    const sel = startState.selection.main;
    if (sel.empty) return tr;

    const startLine = startState.doc.lineAt(sel.from).number;
    const endLine = startState.doc.lineAt(sel.to).number;
    if (startLine !== endLine) return tr;

    const selectedText = startState.sliceDoc(sel.from, sel.to);
    if (isSingleLink(selectedText)) return tr;

    let changeCount = 0;
    let matchedFrom = -1;
    let matchedTo = -1;
    let insertedText = "";

    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changeCount++;
      matchedFrom = fromA;
      matchedTo = toA;
      insertedText = inserted.toString();
    });

    if (changeCount !== 1 || matchedFrom !== sel.from || matchedTo !== sel.to) {
      return tr;
    }

    const trimmedUrl = insertedText.trim();
    if (!isSingleLink(trimmedUrl)) {
      return tr;
    }

    const wrapped = `[${selectedText}](${trimmedUrl})`;
    const cursorPos = sel.from + 1 + selectedText.length;

    return {
      changes: { from: sel.from, to: sel.to, insert: wrapped },
      selection: cm.state.EditorSelection.cursor(cursorPos),
      scrollIntoView: true,
      userEvent: "input.paste.smartlink",
    };
  });
}

/**
 * Synchronous smart-paste helper used by CM6's DOM `paste` event handler
 * and explicit Smart Paste command.
 */
export function trySmartPasteLink(
  view: EditorView,
  rawClipboardText: string,
  explicitRange?: { from: number; to: number },
): boolean {
  const state = view.state;
  if (state.readOnly) return false;
  if (!explicitRange && state.selection.ranges.length !== 1) return false;

  const from = explicitRange ? explicitRange.from : state.selection.main.from;
  const to = explicitRange ? explicitRange.to : state.selection.main.to;
  if (from === to) return false;

  const startLine = state.doc.lineAt(from).number;
  const endLine = state.doc.lineAt(to).number;
  if (startLine !== endLine) return false;

  const selectedText = state.sliceDoc(from, to);
  if (isSingleLink(selectedText)) return false;

  const trimmedClip = rawClipboardText.trim();
  if (!isSingleLink(trimmedClip)) return false;

  const cm = getCM();
  const insert = `[${selectedText}](${trimmedClip})`;
  const cursorInsideBracket = from + 1 + selectedText.length;

  view.dispatch({
    changes: { from, to, insert },
    selection: cm.state.EditorSelection.cursor(cursorInsideBracket),
    userEvent: "input.paste.smartlink",
  });
  syncViewSession(view);
  return true;
}

export async function pasteCommand(
  view?: EditorView | null,
  explicitRange?: { from: number; to: number },
): Promise<boolean> {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;

  // Snapshot selection before async clipboard read
  const mainSel = targetView.state.selection.main;
  const savedRange = explicitRange ?? { from: mainSel.from, to: mainSel.to };

  const clip = await readClipboardText();
  if (!clip) return false;

  if (trySmartPasteLink(targetView, clip, savedRange)) {
    return true;
  }

  const cm = getCM();
  targetView.dispatch({
    changes: { from: savedRange.from, to: savedRange.to, insert: clip },
    selection: cm.state.EditorSelection.cursor(savedRange.from + clip.length),
    userEvent: "input.paste.smartlink",
  });
  syncViewSession(targetView);
  return true;
}
