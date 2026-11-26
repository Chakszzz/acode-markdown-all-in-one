import type { EditorState, Text } from "@codemirror/state";
import { commonMarkEngine } from "../engine/markdownEngine";

export const Regexp_Fenced_Code_Block =
  /^ {0,3}(?<fence>(?<char>[`~])\k<char>{2,})[^`\r\n]*$[^]*?^ {0,3}\k<fence>\k<char>* *$/gm;

/**
 * Checks whether a zero-based line index is inside a fenced code block.
 */
export function isInFencedCodeBlockDoc(doc: Text, lineIndex0: number): boolean {
  const { tokens } = commonMarkEngine.parseDoc(doc);
  for (const token of tokens) {
    if (
      token.type === "fence" &&
      token.tag === "code" &&
      token.map &&
      token.map[0] <= lineIndex0 &&
      lineIndex0 < token.map[1]
    ) {
      return true;
    }
  }
  return false;
}

export function isInFencedCodeBlockText(text: string, lineIndex0: number): boolean {
  const { tokens } = commonMarkEngine.parseText(text);
  for (const token of tokens) {
    if (
      token.type === "fence" &&
      token.tag === "code" &&
      token.map &&
      token.map[0] <= lineIndex0 &&
      lineIndex0 < token.map[1]
    ) {
      return true;
    }
  }
  return false;
}

export function mathEnvCheckText(
  docText: string,
  offset: number,
  lineText: string,
  col: number,
): "display" | "inline" | "" {
  const lineTextBefore = lineText.substring(0, col);
  const lineTextAfter = lineText.substring(col);

  if (
    /(?:^|[^\$])\$(?:[^ \$].*)??\\\w*$/.test(lineTextBefore) &&
    lineTextAfter.includes("$")
  ) {
    return "inline";
  }

  // Also check general inline math `$...$` when cursor is not specifically after `\`
  const unescapedDollarsBefore = (lineTextBefore.match(/(?<!\\)\$/g) || []).length;
  const unescapedDollarsAfter = (lineTextAfter.match(/(?<!\\)\$/g) || []).length;
  if (
    unescapedDollarsBefore % 2 === 1 &&
    unescapedDollarsAfter >= 1 &&
    !lineTextBefore.includes("$$") &&
    !lineTextAfter.includes("$$")
  ) {
    return "inline";
  }

  const textBefore = docText.substring(0, offset);
  const textAfter = docText.substring(offset);
  const matches = textBefore.match(/\$\$/g);
  if (matches !== null && matches.length % 2 !== 0 && textAfter.includes("$$")) {
    return "display";
  }

  return "";
}

export function mathEnvCheckState(state: EditorState, pos: number): "display" | "inline" | "" {
  const line = state.doc.lineAt(pos);
  const col = pos - line.from;
  return mathEnvCheckText(state.doc.toString(), pos, line.text, col);
}

export function isLineInList(lineText: string): boolean {
  return /^\s*(?:[-+*]|[0-9]+[.)]) +/.test(lineText);
}

export function isCursorInMathOrFence(state: EditorState, pos = state.selection.main.head): boolean {
  const line = state.doc.lineAt(pos);
  const lineIndex0 = line.number - 1;
  if (isInFencedCodeBlockDoc(state.doc, lineIndex0)) return true;
  if (mathEnvCheckState(state, pos) !== "") return true;
  return false;
}
