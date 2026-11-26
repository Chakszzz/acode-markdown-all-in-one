import type { ChangeSpec, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  getActiveFile,
  getActiveView,
  getCM,
  getEditorFormattingOptions,
  isMarkdownState,
  syncViewSession,
} from "../cm/runtime";
import { configManager } from "../config";
import { isCursorInMathOrFence, isLineInList } from "../util/contextCheck";

export type ListModifier = "ctrl" | "shift" | undefined;

function firstNonWhitespaceIndex(text: string): number {
  const m = text.match(/\S/);
  return m ? m.index! : text.length;
}

function isEmptyOrWhitespace(text: string): boolean {
  return text.trim().length === 0;
}

function getDocLinesArray(state: EditorState): string[] {
  const lines: string[] = [];
  for (let i = 1; i <= state.doc.lines; i++) {
    lines.push(state.doc.line(i).text);
  }
  return lines;
}

/**
 * Finds the 0-based line index of the next ordered list item starting from `line0`.
 */
export function findNextMarkerLineNumberLines(lines: readonly string[], startLine0: number): number {
  let line = Math.max(0, startLine0);
  while (line < lines.length) {
    const lineText = lines[line];
    if (lineText.startsWith("#")) {
      return -1;
    }
    if (/^\s*[0-9]+[.)] +/.test(lineText)) {
      return line;
    }
    line++;
  }
  return -1;
}

/**
 * Looks upward for the previous ordered list marker at the same indentation level.
 */
export function lookUpwardForMarkerLines(
  lines: readonly string[],
  line0: number,
  currentIndentation: number,
): number {
  let prevLine = line0;
  while (--prevLine >= 0) {
    const prevLineText = lines[prevLine].replace(/\t/g, "    ");
    let matches: RegExpExecArray | null;
    if ((matches = /^(\s*)(([0-9]+)[.)] +)/.exec(prevLineText)) !== null) {
      const prevLeadingSpace = matches[1];
      const prevMarker = matches[3];
      if (currentIndentation < prevLeadingSpace.length) {
        continue;
      } else if (
        currentIndentation >= prevLeadingSpace.length &&
        currentIndentation <= (prevLeadingSpace + prevMarker).length
      ) {
        return Number(prevMarker) + 1;
      } else if (currentIndentation > (prevLeadingSpace + prevMarker).length) {
        return 1;
      }
    } else if ((matches = /^(\s*)([-+*] +)/.exec(prevLineText)) !== null) {
      const prevLeadingSpace = matches[1];
      if (currentIndentation >= prevLeadingSpace.length) {
        break;
      }
    } else if ((matches = /^(\s*)\S/.exec(prevLineText)) !== null) {
      if (matches[1].length < 3) {
        break;
      }
    }
  }
  return 1;
}

/**
 * Pure computation of ordered list marker renumbering on an array of lines (mutates `lines` copy and returns line edits).
 */
export function computeFixMarkerLineEdits(
  initialLines: readonly string[],
  startLine0?: number,
): Array<{ line0: number; colFrom: number; colTo: number; insert: string }> {
  if (!configManager.get("orderedList.autoRenumber")) return [];
  if (configManager.get("orderedList.marker") === "one") return [];

  const lines = [...initialLines];
  const edits: Array<{ line0: number; colFrom: number; colTo: number; insert: string }> = [];

  let line =
    startLine0 !== undefined
      ? startLine0
      : findNextMarkerLineNumberLines(lines, 0);

  if (line < 0 || line >= lines.length) return [];

  if (!/^\s*[0-9]+[.)] +/.test(lines[line])) {
    line = findNextMarkerLineNumberLines(lines, line);
  }

  while (line >= 0 && line < lines.length) {
    const currentLineText = lines[line];
    const matches = /^(\s*)([0-9]+)([.)])( +)/.exec(currentLineText);
    if (!matches) break;

    const leadingSpace = matches[1];
    const marker = matches[2];
    const delimiter = matches[3];
    const trailingSpace = matches[4];
    const fixedMarker = lookUpwardForMarkerLines(
      lines,
      line,
      leadingSpace.replace(/\t/g, "    ").length,
    );
    const listIndent = marker.length + delimiter.length + trailingSpace.length;
    const fixedMarkerNumStr = String(fixedMarker);

    if (marker !== fixedMarkerNumStr) {
      const replacement =
        fixedMarkerNumStr +
        delimiter +
        " ".repeat(Math.max(1, listIndent - (fixedMarkerNumStr + delimiter).length));

      edits.push({
        line0: line,
        colFrom: leadingSpace.length,
        colTo: leadingSpace.length + listIndent,
        insert: replacement,
      });

      lines[line] =
        currentLineText.slice(0, leadingSpace.length) +
        replacement +
        currentLineText.slice(leadingSpace.length + listIndent);
    }

    let nextLine = line + 1;
    let foundNext = -1;
    while (nextLine < lines.length) {
      const nextLineText = lines[nextLine];
      if (/^\s*[0-9]+[.)] +/.test(nextLineText)) {
        foundNext = nextLine;
        break;
      } else if (
        isEmptyOrWhitespace(lines[nextLine - 1]) &&
        !nextLineText.startsWith("   ") &&
        !nextLineText.startsWith("\t")
      ) {
        break;
      } else {
        nextLine++;
      }
    }
    line = foundNext;
  }

  return edits;
}

export function fixMarkerInView(view: EditorView, startLine0?: number): boolean {
  const state = view.state;
  const selStartLine0 = state.doc.lineAt(state.selection.main.from).number - 1;
  const lines = getDocLinesArray(state);
  const targetLine0 =
    startLine0 !== undefined
      ? startLine0
      : findNextMarkerLineNumberLines(lines, selStartLine0);

  if (targetLine0 < 0) return false;

  const lineEdits = computeFixMarkerLineEdits(lines, targetLine0);
  if (lineEdits.length === 0) return false;

  const changes: ChangeSpec[] = lineEdits.map((e) => {
    const docLine = state.doc.line(e.line0 + 1);
    return {
      from: docLine.from + e.colFrom,
      to: docLine.from + e.colTo,
      insert: e.insert,
    };
  });

  view.dispatch({ changes });
  syncViewSession(view);
  return true;
}

function tryDetermineIndentationSize(
  lines: readonly string[],
  line0: number,
  currentIndentation: number,
): number | null {
  let l = line0;
  while (--l >= 0) {
    const lineText = lines[l];
    const matches = /^(\s*)(([-+*]|[0-9]+[.)]) +)(\[[ x]\] +)?/.exec(lineText);
    if (matches && matches[1].length <= currentIndentation) {
      return matches[2].length;
    }
  }
  return null;
}

export function indentLinesInView(view: EditorView): boolean {
  const state = view.state;
  const sel = state.selection.main;
  const startLine = state.doc.lineAt(sel.from);
  const endLine = state.doc.lineAt(sel.to);
  const startLine0 = startLine.number - 1;
  const endLine0 = endLine.number - 1;

  if (configManager.get("list.indentationSize") === "adaptive") {
    const lines = getDocLinesArray(state);
    const adaptiveSize = tryDetermineIndentationSize(
      lines,
      startLine0,
      firstNonWhitespaceIndex(startLine.text),
    );
    if (adaptiveSize !== null) {
      const changes: ChangeSpec[] = [];
      for (let i = startLine0; i <= endLine0; i++) {
        if (i === endLine0 && !sel.empty && sel.to === endLine.from) {
          break;
        }
        const ln = state.doc.line(i + 1);
        if (ln.text.length !== 0) {
          changes.push({ from: ln.from, insert: " ".repeat(adaptiveSize) });
        }
      }
      if (changes.length > 0) {
        view.dispatch({ changes });
      }
      fixMarkerInView(view);
      syncViewSession(view);
      return true;
    }
  }

  try {
    const cm = getCM();
    cm.commands.indentMore(view);
  } catch {
    const opts = getEditorFormattingOptions(state, getActiveFile());
    const indentStr = opts.insertSpaces ? " ".repeat(opts.tabSize) : "\t";
    const changes: ChangeSpec[] = [];
    for (let i = startLine0; i <= endLine0; i++) {
      if (i === endLine0 && !sel.empty && sel.to === endLine.from) break;
      const ln = state.doc.line(i + 1);
      if (ln.text.length !== 0) {
        changes.push({ from: ln.from, insert: indentStr });
      }
    }
    if (changes.length > 0) view.dispatch({ changes });
  }

  fixMarkerInView(view);
  syncViewSession(view);
  return true;
}

export function outdentLinesInView(view: EditorView): boolean {
  const state = view.state;
  const sel = state.selection.main;
  const startLine = state.doc.lineAt(sel.from);
  const endLine = state.doc.lineAt(sel.to);
  const startLine0 = startLine.number - 1;
  const endLine0 = endLine.number - 1;

  if (configManager.get("list.indentationSize") === "adaptive") {
    const lines = getDocLinesArray(state);
    const adaptiveSize = tryDetermineIndentationSize(
      lines,
      startLine0,
      firstNonWhitespaceIndex(startLine.text),
    );
    if (adaptiveSize !== null) {
      const changes: ChangeSpec[] = [];
      for (let i = startLine0; i <= endLine0; i++) {
        if (i === endLine0 && !sel.empty && sel.to === endLine.from) {
          break;
        }
        const ln = state.doc.line(i + 1);
        const maxOutdent = isEmptyOrWhitespace(ln.text)
          ? ln.text.length
          : firstNonWhitespaceIndex(ln.text);
        if (maxOutdent > 0) {
          changes.push({
            from: ln.from,
            to: ln.from + Math.min(adaptiveSize, maxOutdent),
            insert: "",
          });
        }
      }
      if (changes.length > 0) {
        view.dispatch({ changes });
      }
      fixMarkerInView(view);
      syncViewSession(view);
      return true;
    }
  }

  try {
    const cm = getCM();
    cm.commands.indentLess(view);
  } catch {
    const opts = getEditorFormattingOptions(state, getActiveFile());
    const changes: ChangeSpec[] = [];
    for (let i = startLine0; i <= endLine0; i++) {
      if (i === endLine0 && !sel.empty && sel.to === endLine.from) break;
      const ln = state.doc.line(i + 1);
      if (ln.text.startsWith("\t")) {
        changes.push({ from: ln.from, to: ln.from + 1, insert: "" });
      } else {
        const leadingSpaces = (ln.text.match(/^ +/)?.[0] || "").length;
        const removeCount = Math.min(opts.tabSize, leadingSpaces);
        if (removeCount > 0) {
          changes.push({ from: ln.from, to: ln.from + removeCount, insert: "" });
        }
      }
    }
    if (changes.length > 0) view.dispatch({ changes });
  }

  fixMarkerInView(view);
  syncViewSession(view);
  return true;
}

/**
 * Handles smart Enter / Ctrl+Enter / Shift+Enter inside Markdown lists and blockquotes.
 * Returns `true` when handled by Markdown All in One, or `false` to fall back to CM6's default Enter handler.
 */
export function handleMarkdownEnter(
  view: EditorView,
  modifiers?: ListModifier,
): boolean {
  const state = view.state;
  if (state.readOnly || !isMarkdownState(state)) return false;
  if (state.selection.ranges.length > 1) return false;

  const sel = state.selection.main;
  if (!sel.empty) return false;
  if (isCursorInMathOrFence(state, sel.head)) return false;

  if (modifiers === "shift") {
    return false;
  }

  const cm = getCM();
  const cursorOffset = sel.head;
  const line = state.doc.lineAt(cursorOffset);
  const line0 = line.number - 1;
  const cursorCol = cursorOffset - line.from;
  const textBeforeCursor = line.text.substring(0, cursorCol);
  const textAfterCursor = line.text.substring(cursorCol);

  let lineBreakOffset = cursorOffset;
  if (modifiers === "ctrl") {
    lineBreakOffset = line.to;
  }

  // Thematic break `<hr>` check (#785)
  const lineTextNoSpace = line.text.replace(/\s/g, "");
  if (
    lineTextNoSpace.length > 2 &&
    (lineTextNoSpace.replace(/-/g, "").length === 0 ||
      lineTextNoSpace.replace(/\*/g, "").length === 0)
  ) {
    return false;
  }

  // Empty list item: outdent or remove marker/checkbox
  if (
    /^([-+*]|[0-9]+[.)])( +\[[ x]\])?$/.test(textBeforeCursor.trim()) &&
    textAfterCursor.trim().length === 0
  ) {
    if (/^\s+([-+*]|[0-9]+[.)]) +(\[[ x]\] )?$/.test(textBeforeCursor)) {
      return outdentLinesInView(view);
    } else if (/^([-+*]|[0-9]+[.)]) $/.test(textBeforeCursor)) {
      view.dispatch({
        changes: { from: line.from, to: cursorOffset, insert: "" },
        scrollIntoView: true,
      });
      fixMarkerInView(view);
      syncViewSession(view);
      return true;
    } else if (/^([-+*]|[0-9]+[.)]) +(\[[ x]\] )$/.test(textBeforeCursor)) {
      view.dispatch({
        changes: { from: cursorOffset - 4, to: cursorOffset, insert: "" },
        scrollIntoView: true,
      });
      fixMarkerInView(view);
      syncViewSession(view);
      return true;
    }
    return false;
  }

  // Blockquotes (`> `)
  if (/^> /.test(textBeforeCursor)) {
    const isEmptyArrowLine = line.text.replace(/[ \t]+$/, "") === ">";
    if (isEmptyArrowLine) {
      if (line0 === 0) {
        view.dispatch({
          changes: { from: 0, to: cursorOffset, insert: "" },
          scrollIntoView: true,
        });
        syncViewSession(view);
        return true;
      } else {
        const prevLine = state.doc.line(line.number - 1);
        if (prevLine.text.replace(/[ \t]+$/, "") === ">") {
          view.dispatch({
            changes: { from: prevLine.from, to: cursorOffset, insert: "\n" },
            selection: cm.state.EditorSelection.cursor(prevLine.from + 1),
            scrollIntoView: true,
          });
          syncViewSession(view);
          return true;
        }
      }
    }

    const changes: ChangeSpec[] = [];
    let actualBreakOffset = lineBreakOffset;
    if (isEmptyArrowLine) {
      const startPos = line.from + line.text.trim().length;
      changes.push({ from: startPos, to: line.to, insert: "" });
      actualBreakOffset = startPos;
    }
    changes.push({ from: actualBreakOffset, insert: "\n> " });

    const newCursor = actualBreakOffset + 3;
    view.dispatch({
      changes,
      selection: cm.state.EditorSelection.cursor(newCursor),
      scrollIntoView: true,
    });
    syncViewSession(view);
    return true;
  }

  // Unordered list
  let matches: RegExpExecArray | null;
  if ((matches = /^((\s*[-+*] +)(\[[ x]\] +)?)/.exec(textBeforeCursor)) !== null) {
    const match0 = matches[0];
    const match1 = matches[1];
    const match2 = matches[2];
    const match3 = matches[3];

    if (match3 && match0 === textBeforeCursor && modifiers !== "ctrl") {
      // `- [x] |item1` -> `- [ ] \n- [x] |item1`
      const checkPos = line.from + match2.length + 1;
      const inserted = `\n${match1}`;
      view.dispatch({
        changes: [
          { from: checkPos, to: checkPos + 1, insert: " " },
          { from: lineBreakOffset, insert: inserted },
        ],
        selection: cm.state.EditorSelection.cursor(lineBreakOffset + inserted.length),
        scrollIntoView: true,
      });
    } else {
      const inserted = `\n${match1.replace("[x]", "[ ]")}`;
      view.dispatch({
        changes: { from: lineBreakOffset, insert: inserted },
        selection: cm.state.EditorSelection.cursor(lineBreakOffset + inserted.length),
        scrollIntoView: true,
      });
    }
    syncViewSession(view);
    return true;
  }

  // Ordered list
  if (
    (matches = /^(\s*)([0-9]+)([.)])( +)((\[[ x]\] +)?)/.exec(textBeforeCursor)) !==
    null
  ) {
    const markerMode = configManager.get("orderedList.marker");
    let marker = "1";
    const leadingSpace = matches[1];
    const previousMarker = matches[2];
    const delimiter = matches[3];
    let trailingSpace = matches[4];
    const gfmCheckbox = matches[5].replace("[x]", "[ ]");
    const textIndent = (previousMarker + delimiter + trailingSpace).length;

    if (markerMode === "ordered") {
      marker = String(Number(previousMarker) + 1);
    }
    trailingSpace = " ".repeat(
      Math.max(1, textIndent - (marker + delimiter).length),
    );

    const toBeAdded = leadingSpace + marker + delimiter + trailingSpace + gfmCheckbox;
    const inserted = `\n${toBeAdded}`;
    view.dispatch({
      changes: { from: lineBreakOffset, insert: inserted },
      selection: cm.state.EditorSelection.cursor(lineBreakOffset + inserted.length),
      scrollIntoView: true,
    });
    fixMarkerInView(view);
    syncViewSession(view);
    return true;
  }

  return false;
}

export function handleMarkdownTab(
  view: EditorView,
  modifiers?: "shift",
): boolean {
  const state = view.state;
  if (state.readOnly || !isMarkdownState(state)) return false;
  if (state.selection.ranges.length > 1) return false;

  const cm = getCM();
  // Do not hijack Tab when completion popup or active snippet field is open
  if (cm.autocomplete.completionStatus(state) === "active") return false;
  if (
    modifiers !== "shift" &&
    typeof cm.autocomplete.hasNextSnippetField === "function" &&
    cm.autocomplete.hasNextSnippetField(state)
  ) {
    return false;
  }
  if (
    modifiers === "shift" &&
    typeof cm.autocomplete.hasPrevSnippetField === "function" &&
    cm.autocomplete.hasPrevSnippetField(state)
  ) {
    return false;
  }

  const sel = state.selection.main;
  if (isCursorInMathOrFence(state, sel.from)) return false;

  const line = state.doc.lineAt(sel.from);
  if (!isLineInList(line.text)) return false;

  const match = /^\s*([-+*]|[0-9]+[.)]) +(\[[ x]\] +)?/.exec(line.text);
  const startCol = sel.from - line.from;
  if (
    match &&
    (modifiers === "shift" || !sel.empty || (sel.empty && startCol <= match[0].length))
  ) {
    if (modifiers === "shift") {
      return outdentLinesInView(view);
    }
    return indentLinesInView(view);
  }

  return false;
}

export function handleMarkdownBackspace(view: EditorView): boolean {
  const state = view.state;
  if (state.readOnly || !isMarkdownState(state)) return false;
  if (state.selection.ranges.length > 1) return false;

  const cm = getCM();
  if (cm.autocomplete.completionStatus(state) === "active") return false;

  const sel = state.selection.main;
  if (isCursorInMathOrFence(state, sel.head)) return false;

  if (!sel.empty) {
    const handled = cm.commands.deleteCharBackward(view);
    if (handled) {
      fixMarkerInView(view);
      syncViewSession(view);
    }
    return handled;
  }

  const line = state.doc.lineAt(sel.head);
  const col = sel.head - line.from;
  const textBeforeCursor = line.text.slice(0, col);

  if (/^\s+([-+*]|[0-9]+[.)]) $/.test(textBeforeCursor)) {
    return outdentLinesInView(view);
  } else if (/^([-+*]|[0-9]+[.)]) $/.test(textBeforeCursor)) {
    const spaces = " ".repeat(textBeforeCursor.length);
    view.dispatch({
      changes: { from: line.from, to: sel.head, insert: spaces },
      selection: cm.state.EditorSelection.cursor(line.from + spaces.length),
    });
    fixMarkerInView(view);
    syncViewSession(view);
    return true;
  } else if (/^\s*([-+*]|[0-9]+[.)]) +(\[[ x]\] )$/.test(textBeforeCursor)) {
    view.dispatch({
      changes: { from: sel.head - 4, to: sel.head, insert: "" },
    });
    fixMarkerInView(view);
    syncViewSession(view);
    return true;
  }

  return false;
}

export function checkTaskList(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;

  const state = targetView.state;
  const uncheckedRegex = /^(\s*([-+*]|[0-9]+[.)]) +\[) \]/;
  const checkedRegex = /^(\s*([-+*]|[0-9]+[.)]) +\[)x\]/;

  const toggleOffsets: number[] = [];
  let newState: boolean | undefined = undefined;

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    const isSingleLine = startLine === endLine;

    for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
      const line = state.doc.line(lineNo);
      if (!isSingleLine && (range.from === line.to || range.to === line.from)) {
        continue;
      }

      let matches: RegExpExecArray | null;
      if ((matches = uncheckedRegex.exec(line.text)) && newState !== false) {
        toggleOffsets.push(line.from + matches[1].length);
        newState = true;
      } else if ((matches = checkedRegex.exec(line.text)) && newState !== true) {
        toggleOffsets.push(line.from + matches[1].length);
        newState = false;
      }
    }
  }

  if (newState !== undefined && toggleOffsets.length > 0) {
    const newChar = newState ? "x" : " ";
    const uniqueOffsets = Array.from(new Set(toggleOffsets)).sort((a, b) => a - b);
    targetView.dispatch({
      changes: uniqueOffsets.map((pos) => ({
        from: pos,
        to: pos + 1,
        insert: newChar,
      })),
    });
    syncViewSession(targetView);
    return true;
  }
  return false;
}

export function moveLineUpWithRenumber(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;
  const cm = getCM();
  const ok = cm.commands.moveLineUp(targetView);
  if (ok) {
    fixMarkerInView(targetView);
    syncViewSession(targetView);
  }
  return ok;
}

export function moveLineDownWithRenumber(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;
  const cm = getCM();
  const ok = cm.commands.moveLineDown(targetView);
  if (ok) {
    const startLine0 = Math.max(
      0,
      targetView.state.doc.lineAt(targetView.state.selection.main.from).number - 2,
    );
    const lines = getDocLinesArray(targetView.state);
    const nextMarker = findNextMarkerLineNumberLines(lines, startLine0);
    if (nextMarker >= 0) {
      fixMarkerInView(targetView, nextMarker);
    }
    syncViewSession(targetView);
  }
  return ok;
}

export function copyLineUpWithRenumber(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;
  const cm = getCM();
  const ok = cm.commands.copyLineUp(targetView);
  if (ok) {
    fixMarkerInView(targetView);
    syncViewSession(targetView);
  }
  return ok;
}

export function copyLineDownWithRenumber(view?: EditorView | null): boolean {
  const targetView = view ?? getActiveView();
  if (!targetView || targetView.state.readOnly) return false;
  const cm = getCM();
  const ok = cm.commands.copyLineDown(targetView);
  if (ok) {
    fixMarkerInView(targetView);
    syncViewSession(targetView);
  }
  return ok;
}
