import type { EditorView } from "@codemirror/view";
import { getCM, isMarkdownState } from "../cm/runtime";
import { configManager } from "../config";
import { commonMarkEngine, mdEngine } from "../engine/markdownEngine";

interface PendingDeco {
  from: number;
  to: number;
  deco: any;
}

/**
 * CodeMirror 6 syntax decorations ported from vscode-markdown/src/theming:
 * - CodeSpan (`theming.decoration.renderCodeSpan`)
 * - Strikethrough (`theming.decoration.renderStrikethrough`)
 * - TrailingSpace (`theming.decoration.renderTrailingSpace`)
 * - HardLineBreak (`theming.decoration.renderHardLineBreak`)
 * - Link (`theming.decoration.renderLink`)
 * - Paragraph (`theming.decoration.renderParagraph`)
 */
export function createMarkdownDecorationsExtension() {
  const cm = getCM();
  const { Decoration, EditorView: CMEditorView, ViewPlugin, WidgetType } = cm.view;

  class SymbolMarkWidget extends WidgetType {
    constructor(private readonly symbol: string) {
      super();
    }

    eq(other: SymbolMarkWidget): boolean {
      return this.symbol === other.symbol;
    }

    toDOM(): HTMLElement {
      const span = document.createElement("span");
      span.className = "cm-md-formatting-mark";
      span.textContent = this.symbol;
      return span;
    }
  }

  const codeSpanMark = Decoration.mark({ class: "cm-md-codespan" });
  const strikethroughMark = Decoration.mark({ class: "cm-md-strikethrough" });
  const trailingSpaceMark = Decoration.mark({ class: "cm-md-trailingspace" });

  const hardBreakWidget = Decoration.widget({
    widget: new SymbolMarkWidget("↵"),
    side: 1,
  });
  const linkWidget = Decoration.widget({
    widget: new SymbolMarkWidget("\u{1F517}\u{FE0E}"),
    side: -1,
  });
  const paragraphWidget = Decoration.widget({
    widget: new SymbolMarkWidget("¶"),
    side: 1,
  });

  function computeDecorations(view: EditorView) {
    const state = view.state;
    if (!isMarkdownState(state)) return Decoration.none;

    const limit = configManager.get("syntax.decorationFileSizeLimit");
    if (state.doc.length > limit) return Decoration.none;

    const renderCodeSpan = configManager.get("theming.decoration.renderCodeSpan");
    const renderStrikethrough = configManager.get(
      "theming.decoration.renderStrikethrough",
    );
    const renderTrailingSpace = configManager.get(
      "theming.decoration.renderTrailingSpace",
    );
    const renderHardLineBreak = configManager.get(
      "theming.decoration.renderHardLineBreak",
    );
    const renderLink = configManager.get("theming.decoration.renderLink");
    const renderParagraph = configManager.get("theming.decoration.renderParagraph");

    if (
      !renderCodeSpan &&
      !renderStrikethrough &&
      !renderTrailingSpace &&
      !renderHardLineBreak &&
      !renderLink &&
      !renderParagraph
    ) {
      return Decoration.none;
    }

    const items: PendingDeco[] = [];
    const docText = state.doc.toString();

    if (renderCodeSpan || renderStrikethrough || renderParagraph) {
      const { tokens } = mdEngine.parseDoc(state.doc);

      if (renderParagraph) {
        for (const t of tokens) {
          if (t.type === "paragraph_open" && t.map && t.map[1] >= 1) {
            const lineNo = Math.min(state.doc.lines, t.map[1]);
            const pos = state.doc.line(lineNo).to;
            items.push({ from: pos, to: pos, deco: paragraphWidget });
          }
        }
      }

      const inlineTokens = tokens.filter((t) => t.type === "inline" && t.map);

      if (renderCodeSpan) {
        for (const { content, children, map } of inlineTokens) {
          if (!children || !map) continue;
          const mapStartLine = Math.min(state.doc.lines, map[0] + 1);
          let initOffset = state.doc.line(mapStartLine).from;
          const foundIdx = docText.indexOf(content, initOffset);
          if (foundIdx > initOffset) initOffset = foundIdx;

          let beginOffset = initOffset;
          let endOffset = initOffset;

          for (const t of children) {
            if (t.type === "html_inline") continue;
            if (t.type !== "code_inline") {
              beginOffset += t.content.length;
              continue;
            }

            let codeSpanText = t.markup + t.content + t.markup;
            let cursor = docText.indexOf(codeSpanText, beginOffset);
            if (cursor === -1) {
              codeSpanText = t.markup + " " + t.content + " " + t.markup;
              cursor = docText.indexOf(codeSpanText, beginOffset);
            }

            if (cursor !== -1) {
              beginOffset = cursor;
              endOffset = beginOffset + codeSpanText.length;
            } else {
              const markupPos = docText.indexOf(t.markup, beginOffset);
              if (markupPos === -1) continue;
              beginOffset = markupPos;
              const searchPos = beginOffset + t.markup.length;
              const closePos = docText.indexOf(t.markup, searchPos);
              if (closePos === -1) continue;
              endOffset = closePos + t.markup.length;
            }

            if (beginOffset >= 0 && endOffset > beginOffset && endOffset <= state.doc.length) {
              items.push({ from: beginOffset, to: endOffset, deco: codeSpanMark });
              beginOffset = endOffset;
            }
          }
        }
      }

      if (renderStrikethrough) {
        const strikeRegex =
          /(?<![~\\])~~[^~\p{Zs}\t\r\n\f].*?(?<![~\p{Zs}\t\r\n\f])~~(?!~)/gu;
        for (const { map } of inlineTokens) {
          if (!map) continue;
          const startLine = Math.min(state.doc.lines, map[0] + 1);
          const endLine = Math.min(state.doc.lines, Math.max(startLine, map[1]));
          const sliceFrom = state.doc.line(startLine).from;
          const sliceTo = state.doc.line(endLine).to;
          const sliceText = docText.slice(sliceFrom, sliceTo);

          for (const m of sliceText.matchAll(strikeRegex)) {
            const from = sliceFrom + m.index!;
            const to = from + m[0].length;
            items.push({ from, to, deco: strikethroughMark });
          }
        }
      }
    }

    if (renderHardLineBreak) {
      const { tokens } = commonMarkEngine.parseDoc(state.doc);
      for (const { children, map } of tokens) {
        if (!children || !map) continue;
        let lineIndex0 = map[0];
        for (const t of children) {
          if (t.type === "softbreak") {
            lineIndex0++;
          } else if (t.type === "hardbreak") {
            const lineNo = Math.min(state.doc.lines, lineIndex0 + 1);
            const pos = state.doc.line(lineNo).to;
            items.push({ from: pos, to: pos, deco: hardBreakWidget });
            lineIndex0++;
          }
        }
      }
    }

    if (renderLink) {
      for (const m of docText.matchAll(/(?<!!)\[(?:[^\[\]\r\n]*?)\]\(.*?\)/g)) {
        const pos = m.index!;
        items.push({ from: pos, to: pos, deco: linkWidget });
      }
    }

    if (renderTrailingSpace) {
      for (const { from, to } of view.visibleRanges || []) {
        const startLine = state.doc.lineAt(from).number;
        const endLine = state.doc.lineAt(to).number;
        for (let l = startLine; l <= endLine; l++) {
          const ln = state.doc.line(l);
          const m = ln.text.match(/ +$/);
          if (m) {
            items.push({
              from: ln.to - m[0].length,
              to: ln.to,
              deco: trailingSpaceMark,
            });
          }
        }
      }
    }

    if (items.length === 0) return Decoration.none;

    items.sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      return a.to - b.to;
    });

    return Decoration.set(
      items.map((it) => it.deco.range(it.from, it.to)),
      true,
    );
  }

  const pluginExtension = ViewPlugin.fromClass(
    class {
      decorations: any;

      constructor(view: EditorView) {
        this.decorations = computeDecorations(view);
      }

      update(update: any) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = computeDecorations(update.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );

  const themeExtension = CMEditorView.baseTheme({
    ".cm-md-codespan": {
      border: "1px solid rgba(127, 127, 127, 0.35)",
      borderRadius: "3px",
      backgroundColor: "rgba(127, 127, 127, 0.08)",
    },
    ".cm-md-strikethrough": {
      textDecoration: "line-through",
    },
    ".cm-md-trailingspace": {
      backgroundColor: "rgba(255, 100, 100, 0.22)",
    },
    ".cm-md-formatting-mark": {
      opacity: "0.45",
      pointerEvents: "none",
      userSelect: "none",
      fontSize: "0.9em",
    },
    ".cm-md-toc-codelens": {
      opacity: "0.6",
      fontSize: "0.82em",
      lineHeight: "1.4",
      userSelect: "none",
      paddingBottom: "2px",
    },
  });

  return [pluginExtension, themeExtension];
}
