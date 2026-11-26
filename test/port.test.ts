import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import * as autocomplete from "@codemirror/autocomplete";
import * as commands from "@codemirror/commands";
import * as language from "@codemirror/language";
import * as state from "@codemirror/state";
import * as view from "@codemirror/view";
import * as lezerCommon from "@lezer/common";
import * as lezerHighlight from "@lezer/highlight";

// Inject real CodeMirror 6 modules into test runtime
(globalThis as any).__TEST_CM__ = {
  autocomplete,
  commands,
  language,
  state,
  view,
  lezer: Object.assign({}, lezerHighlight, {
    common: lezerCommon,
    highlight: lezerHighlight,
  }),
};

import { configManager } from "../src/config";
import SlugifyMode from "../src/contract/SlugifyMode";
import {
  completeHeadingLinksFromText,
  completeRefLinksFromText,
  createMarkdownCompletionExtension,
} from "../src/features/completion";
import {
  createSmartPasteTransactionFilter,
  isSingleLink,
  toggleBold,
  toggleCodeBlock,
  toggleCodeSpan,
  toggleHeadingDown,
  toggleHeadingUp,
  toggleItalic,
  toggleList,
  toggleMath,
  toggleStrikethrough,
  trySmartPasteLink,
} from "../src/features/formatting";
import {
  checkTaskList,
  handleMarkdownBackspace,
  handleMarkdownEnter,
  handleMarkdownTab,
} from "../src/features/listEditing";
import {
  extractMarkdownTitle,
  renderDocumentToExportHtml,
  rewriteMdLinksToHtml,
} from "../src/features/print";
import { formatMarkdownTablesInText } from "../src/features/tableFormatter";
import {
  addSectionNumbersInView,
  createTocInView,
  generateTocText,
  removeSectionNumbersInView,
  updateTocInView,
} from "../src/features/toc";
import { slugify } from "../src/util/slugify";

/**
 * Lightweight headless CodeMirror 6 EditorView harness backed by real `EditorState.update(...)`.
 */
function createTestView(
  lines: string[],
  selStart: [number, number],
  selEnd: [number, number] = selStart,
  extensions: state.Extension[] = [],
): view.EditorView & { getLines(): string[]; getCursorLineCol(): [number, number]; getRangeLineCol(): [[number, number], [number, number]] } {
  const docText = lines.join("\n");
  let currentState = state.EditorState.create({
    doc: docText,
    extensions,
  });

  const toOffset = (st: state.EditorState, [line0, col]: [number, number]) => {
    const ln = st.doc.line(line0 + 1);
    return ln.from + col;
  };

  const anchor = toOffset(currentState, selStart);
  const head = toOffset(currentState, selEnd);
  currentState = currentState.update({
    selection: state.EditorSelection.range(anchor, head),
  }).state;

  const mockView: any = {
    get state() {
      return currentState;
    },
    dispatch(...specs: state.TransactionSpec[]) {
      const tr = currentState.update(...specs);
      currentState = tr.state;
    },
    focus() {},
    get visibleRanges() {
      return [{ from: 0, to: currentState.doc.length }];
    },
    getLines() {
      return currentState.doc.toString().split("\n");
    },
    getCursorLineCol(): [number, number] {
      const pos = currentState.selection.main.head;
      const ln = currentState.doc.lineAt(pos);
      return [ln.number - 1, pos - ln.from];
    },
    getRangeLineCol(): [[number, number], [number, number]] {
      const main = currentState.selection.main;
      const startLn = currentState.doc.lineAt(main.from);
      const endLn = currentState.doc.lineAt(main.to);
      return [
        [startLn.number - 1, main.from - startLn.from],
        [endLn.number - 1, main.to - endLn.from],
      ];
    },
  };

  return mockView;
}

beforeEach(() => {
  configManager.resetForTests();
});

describe("1. Slugify (All 7 Modes including pure-TS Zola)", () => {
  const cases: Readonly<Record<SlugifyMode, ReadonlyArray<readonly [string, string]>>> = {
    [SlugifyMode.AzureDevOps]: [
      [
        "A !\"#$%&'()*+,-./:;<=>?@[\\\\]^_`{|}~",
        "a-!%22%23%24%25%26'()*%2B%2C-.%2F%3A%3B%3C%3D%3E%3F%40%5B%5C%5C%5D%5E_%60%7B%7C%7D~",
      ],
      ["W\u{0020}\u{00A0}\u{2003}\u{202F}\u{205F}\u{3000}\u{1680}S", "w-------s"],
      [
        "1\u{0020}\u{007F}\u{0080}\u{07FF}\u{0800}\u{FFFF}\u{10000}\u{10FFFF}2",
        "%31%2D%7F%C2%80%DF%BF%E0%A0%80%EF%BF%BF%F0%90%80%80%F4%8F%BF%BF%32",
      ],
      ["1. Hi, there!!!", "%31%2E%2D%68%69%2C%2D%74%68%65%72%65%21%21%21"],
      ["Design & Process", "design-%26-process"],
    ],
    [SlugifyMode.BitbucketCloud]: [
      ["Hello World!", "markdown-header-hello-world"],
      ["foo   bar", "markdown-header-foo-bar"],
    ],
    [SlugifyMode.GitHub]: [
      ["foo _italic_ bar", "foo-italic-bar"],
      ["foo_foo_bar", "foo_foo_bar"],
      ["`a.b` c", "ab-c"],
      ["Via [remark-cli][]", "via-remark-cli"],
      ["1. not a list", "1-not-a-list"],
      ["1) not a list", "1-not-a-list"],
      ['foo & < >  "foo"', "foo---foo"],
      ["$\\LaTeX equations$", "latex-equations"],
      ["Секция 1.1", "секция-11"],
      ["Section 中文", "section-中文"],
    ],
    [SlugifyMode.GitLab]: [
      ["foo _italic_ bar", "foo-italic-bar"],
      ["foo_foo_bar", "foo_foo_bar"],
      ["`a.b` c", "ab-c"],
      ["A  +  B", "a-b"],
      ['foo & < >  "foo"', "foo-foo"],
      ["1", "anchor-1"],
      ["Секция 1.1", "секция-11"],
    ],
    [SlugifyMode.Gitea]: [
      ["foo _italic_ bar", "foo-italic-bar"],
      ["foo_foo_bar", "foo-foo-bar"],
      ["`a.b` c", "a-b-c"],
      [":checkered_flag: with emoji shortname", "checkered-flag-with-emoji-shortname"],
      ["Секция 1.1", "секция-1-1"],
    ],
    [SlugifyMode.VisualStudioCode]: [
      ["foo _italic_ bar", "foo-italic-bar"],
      ["`a.b` c", "ab-c"],
      ["Via [remark-cli][]", "via-remark-cli"],
      ["1. not a list", "1-not-a-list"],
    ],
    [SlugifyMode.Zola]: [
      [
        "this is some example [text](https://www.url.com) haha [fun](http://another.example)",
        "this-is-some-example-text-haha-fun",
      ],
      [
        "Check out this [link](http://example.com) and this [another one](https://another.com)!",
        "check-out-this-link-and-this-another-one",
      ],
      ["No links here!", "no-links-here"],
      [
        "[Edge cases](https://edge.com) lead to [interesting](http://test.com?query=example) results. 大時代",
        "edge-cases-lead-to-interesting-results-da-shi-dai",
      ],
      ["にでも長所と短所がある", "nidemochang-suo-toduan-suo-gaaru"],
      [
        "命来犯天写最大巡祭視死乃読",
        "ming-lai-fan-tian-xie-zui-da-xun-ji-shi-si-nai-du",
      ],
      [
        "국무위원은 국무총리의 제청으로 대통령이 임명한다",
        "gugmuwiweoneun-gugmucongriyi-jeceongeuro-daetongryeongi-immyeonghanda",
      ],
    ],
  };

  for (const [mode, modeCases] of Object.entries(cases) as Array<[SlugifyMode, ReadonlyArray<readonly [string, string]>]>) {
    for (const [raw, expected] of modeCases) {
      it(`[${mode}] ${raw} -> ${expected}`, () => {
        assert.equal(slugify(raw, { mode }), expected);
      });
    }
  }
});

describe("2. Formatting & Smart Paste (formatting.ts)", () => {
  it("toggles bold across all cursor & selection positions", () => {
    // `text |` -> `text **|**`
    let v = createTestView(["text "], [0, 5]);
    toggleBold(v);
    assert.deepEqual(v.getLines(), ["text ****"]);
    assert.deepEqual(v.getCursorLineCol(), [0, 7]);

    // `text **|**` -> `text |`
    toggleBold(v);
    assert.deepEqual(v.getLines(), ["text "]);
    assert.deepEqual(v.getCursorLineCol(), [0, 5]);

    // `**text|**` -> `**text**|`
    v = createTestView(["**text**"], [0, 6]);
    toggleBold(v);
    assert.deepEqual(v.getLines(), ["**text**"]);
    assert.deepEqual(v.getCursorLineCol(), [0, 8]);

    // `**text**|` -> `text|`
    toggleBold(v);
    assert.deepEqual(v.getLines(), ["text"]);
    assert.deepEqual(v.getCursorLineCol(), [0, 4]);

    // `te|xt` -> `**te|xt**` -> `te|xt`
    v = createTestView(["text"], [0, 2]);
    toggleBold(v);
    assert.deepEqual(v.getLines(), ["**text**"]);
    assert.deepEqual(v.getCursorLineCol(), [0, 4]);
    toggleBold(v);
    assert.deepEqual(v.getLines(), ["text"]);
    assert.deepEqual(v.getCursorLineCol(), [0, 2]);

    // Selection on & off
    v = createTestView(["text"], [0, 0], [0, 4]);
    toggleBold(v);
    assert.deepEqual(v.getLines(), ["**text**"]);
    assert.deepEqual(v.getRangeLineCol(), [[0, 0], [0, 8]]);
    toggleBold(v);
    assert.deepEqual(v.getLines(), ["text"]);
    assert.deepEqual(v.getRangeLineCol(), [[0, 0], [0, 4]]);
  });

  it("supports custom bold `__` and italic `_` indicators", () => {
    configManager.set("bold.indicator", "__");
    configManager.set("italic.indicator", "_");

    const v1 = createTestView(["hello"], [0, 0], [0, 5]);
    toggleBold(v1);
    assert.deepEqual(v1.getLines(), ["__hello__"]);

    const v2 = createTestView(["world"], [0, 0], [0, 5]);
    toggleItalic(v2);
    assert.deepEqual(v2.getLines(), ["_world_"]);
  });

  it("toggles strikethrough on plain words, bullet lists, and task lists", () => {
    const v1 = createTestView(["- [ ] buy milk"], [0, 14]);
    toggleStrikethrough(v1);
    assert.deepEqual(v1.getLines(), ["- [ ] ~~buy milk~~"]);
    assert.deepEqual(v1.getCursorLineCol(), [0, 18]);
  });

  it("toggles code span, code block, and heading up/down", () => {
    const v = createTestView(["Title"], [0, 2]);
    toggleHeadingUp(v);
    assert.deepEqual(v.getLines(), ["# Title"]);
    toggleHeadingUp(v);
    assert.deepEqual(v.getLines(), ["## Title"]);
    toggleHeadingDown(v);
    assert.deepEqual(v.getLines(), ["# Title"]);
    toggleHeadingDown(v);
    assert.deepEqual(v.getLines(), ["Title"]);

    const vc = createTestView(["const x = 1;"], [0, 0], [0, 12]);
    toggleCodeSpan(vc);
    assert.deepEqual(vc.getLines(), ["`const x = 1;`"]);

    const vb = createTestView(["console.log(1);"], [0, 0], [0, 15]);
    toggleCodeBlock(vb);
    assert.deepEqual(vb.getLines(), ["```", "console.log(1);", "```"]);
  });

  it("cycles math block states (NONE -> $ -> multiline $$ -> single $$ -> NONE)", () => {
    const v = createTestView([""], [0, 0]);
    toggleMath(v);
    assert.deepEqual(v.getLines(), ["$$"]);
    assert.deepEqual(v.getCursorLineCol(), [0, 1]);

    toggleMath(v);
    assert.deepEqual(v.getLines(), ["$$", "", "$$"]);
    assert.deepEqual(v.getCursorLineCol(), [1, 0]);

    toggleMath(v);
    assert.deepEqual(v.getLines(), ["$$  $$"]);
    assert.deepEqual(v.getCursorLineCol(), [0, 3]);

    toggleMath(v);
    assert.deepEqual(v.getLines(), [""]);
    assert.deepEqual(v.getCursorLineCol(), [0, 0]);
  });

  it("cycles list markers and smart-pastes URLs onto selected text", () => {
    const vl = createTestView(["item"], [0, 2]);
    toggleList(vl);
    assert.deepEqual(vl.getLines(), ["- item"]);
    toggleList(vl);
    assert.deepEqual(vl.getLines(), ["* item"]);

    assert.equal(isSingleLink("https://acode.app/docs?x=1#top"), true);
    assert.equal(isSingleLink("not a link"), false);

    const vp = createTestView(["Acode Docs"], [0, 0], [0, 10]);
    const handled = trySmartPasteLink(vp, "https://docs.acode.app");
    assert.equal(handled, true);
    assert.deepEqual(vp.getLines(), ["[Acode Docs](https://docs.acode.app)"]);
    assert.deepEqual(vp.getCursorLineCol(), [0, 11]);
  });

  it("intercepts Acode native Paste button (replaceSelection + input.paste) and Gboard paste via transactionFilter", () => {
    const ext = createSmartPasteTransactionFilter();

    // 1. Exact Acode commandRegistry.js pasteCommand dispatch (newer Acode):
    //    view.dispatch(view.state.replaceSelection(url), { userEvent: "input.paste" })
    const vAcode = createTestView(["Klik kata tebal ini"], [0, 5], [0, 15], [ext]);
    vAcode.dispatch(
      vAcode.state.replaceSelection("https://acode.app"),
      { userEvent: "input.paste" },
    );
    assert.deepEqual(vAcode.getLines(), ["Klik [kata tebal](https://acode.app) ini"]);
    assert.deepEqual(vAcode.getCursorLineCol(), [0, 16]);

    // 1b. Exact Acode commandRegistry.js pasteCommand dispatch (released Acode before commit 672750c):
    //     view.dispatch(view.state.changeByRange(...)) with NO userEvent!
    const vAcodeLegacyPaste = createTestView(["Klik kata tebal ini"], [0, 5], [0, 15], [ext]);
    const clipUrl = "https://acode.app";
    vAcodeLegacyPaste.dispatch(
      vAcodeLegacyPaste.state.changeByRange((range) => ({
        changes: { from: range.from, to: range.to, insert: clipUrl },
        range: state.EditorSelection.cursor(range.from + clipUrl.length),
      })),
    );
    assert.deepEqual(vAcodeLegacyPaste.getLines(), [
      "Klik [kata tebal](https://acode.app) ini",
    ]);
    assert.deepEqual(vAcodeLegacyPaste.getCursorLineCol(), [0, 16]);

    // 2. Android soft keyboard clipboard chip (`input.type`)
    const vGboard = createTestView(["lihat docs"], [0, 6], [0, 10], [ext]);
    vGboard.dispatch({
      changes: { from: 6, to: 10, insert: "https://github.com/yzhang-gh/vscode-markdown" },
      userEvent: "input.type",
    });
    assert.deepEqual(vGboard.getLines(), [
      "lihat [docs](https://github.com/yzhang-gh/vscode-markdown)",
    ]);

    // 3. Normal non-URL paste replaces selected text normally
    const vNormal = createTestView(["old text"], [0, 0], [0, 3], [ext]);
    vNormal.dispatch(
      vNormal.state.replaceSelection("new"),
      { userEvent: "input.paste" },
    );
    assert.deepEqual(vNormal.getLines(), ["new text"]);

    // 4. Pasting URL over an already-URL selection replaces it instead of double-wrapping
    const vUrlOverUrl = createTestView(["https://old.example.com"], [0, 0], [0, 23], [ext]);
    vUrlOverUrl.dispatch(
      vUrlOverUrl.state.replaceSelection("https://new.example.com"),
      { userEvent: "input.paste" },
    );
    assert.deepEqual(vUrlOverUrl.getLines(), ["https://new.example.com"]);
  });
});

describe("3. Smart List & Blockquote Editing (listEditing.ts)", () => {
  it("continues and exits blockquotes accurately", () => {
    const v = createTestView(["> item1"], [0, 7]);
    assert.equal(handleMarkdownEnter(v), true);
    assert.deepEqual(v.getLines(), ["> item1", "> "]);
    assert.deepEqual(v.getCursorLineCol(), [1, 2]);

    assert.equal(handleMarkdownEnter(v), true);
    assert.deepEqual(v.getLines(), ["> item1", ">", "> "]);
    assert.deepEqual(v.getCursorLineCol(), [2, 2]);

    assert.equal(handleMarkdownEnter(v), true);
    assert.deepEqual(v.getLines(), ["> item1", "", ""]);
    assert.deepEqual(v.getCursorLineCol(), [2, 0]);
  });

  it("continues ordered & task lists, unchecks new task items, and exits empty items", () => {
    const v = createTestView(["- [x] first task"], [0, 16]);
    assert.equal(handleMarkdownEnter(v), true);
    assert.deepEqual(v.getLines(), ["- [x] first task", "- [ ] "]);

    // Pressing Enter on empty `- [ ] ` removes checkbox first (`- `), then removes `- `
    assert.equal(handleMarkdownEnter(v), true);
    assert.deepEqual(v.getLines(), ["- [x] first task", "- "]);
    assert.equal(handleMarkdownEnter(v), true);
    assert.deepEqual(v.getLines(), ["- [x] first task", ""]);

    // Ordered list auto-increment & renumbering
    const vo = createTestView(["1. alpha", "2. gamma"], [0, 8]);
    assert.equal(handleMarkdownEnter(vo), true);
    assert.deepEqual(vo.getLines(), ["1. alpha", "2. ", "3. gamma"]);
  });

  it("handles adaptive Tab/Shift-Tab indentation, Backspace, and checkTaskList", () => {
    const v = createTestView(["1. first", "2. second", "3. third"], [1, 3]);
    assert.equal(handleMarkdownTab(v), true);
    assert.deepEqual(v.getLines(), ["1. first", "   1. second", "2. third"]);

    assert.equal(handleMarkdownTab(v, "shift"), true);
    assert.deepEqual(v.getLines(), ["1. first", "2. second", "3. third"]);

    const vt = createTestView(["- [ ] one", "- [ ] two"], [0, 0], [1, 9]);
    assert.equal(checkTaskList(vt), true);
    assert.deepEqual(vt.getLines(), ["- [x] one", "- [x] two"]);

    const vb = createTestView(["- [x] "], [0, 6]);
    assert.equal(handleMarkdownBackspace(vb), true);
    assert.deepEqual(vb.getLines(), ["- "]);
  });
});

describe("4. GFM Table Formatter (tableFormatter.ts)", () => {
  it("formats tables with alignment, CJK, and emoji double-width graphemes", () => {
    const raw = [
      "| Name | Align | Score |",
      "| :--- | :---: | ---: |",
      "| Alice | 中文 | 10 |",
      "| Bob | 🚀 | 200 |",
    ].join("\n");

    const { formattedText } = formatMarkdownTablesInText(raw, {
      tabSize: 2,
      eol: "\n",
    });

    assert.equal(
      formattedText,
      [
        "| Name  | Align | Score |",
        "| :---- | :---: | ----: |",
        "| Alice | 中文  |    10 |",
        "| Bob   |  🚀   |   200 |",
      ].join("\n"),
    );
  });
});

describe("5. Table of Contents & Section Numbers (toc.ts)", () => {
  it("creates, detects, updates TOC, omits magic comments, and manages section numbers", () => {
    const md = [
      "# Title <!-- omit in toc -->",
      "",
      "## Getting Started",
      "### Installation",
      "## Usage & API",
      "```bash",
      "# Not a heading inside code fence",
      "```",
    ].join("\n");

    const toc = generateTocText(md, {
      tabSize: 2,
      insertSpaces: true,
      eol: "\n",
    });

    assert.equal(
      toc,
      [
        "- [Getting Started](#getting-started)",
        "  - [Installation](#installation)",
        "- [Usage \\& API](#usage--api)",
        "",
      ].join("\n"),
    );

    const v = createTestView(
      ["# Doc", "", "- [Real Heading](#real-heading)", "", "## Real Heading", "### Child"],
      [0, 0],
    );
    configManager.set("toc.levels", "2..6");
    assert.equal(updateTocInView(v), true);
    assert.deepEqual(v.getLines(), [
      "# Doc",
      "",
      "- [Real Heading](#real-heading)",
      "  - [Child](#child)",
      "",
      "## Real Heading",
      "### Child",
    ]);

    assert.equal(addSectionNumbersInView(v), true);
    assert.equal(v.getLines()[5], "## 1. Real Heading");
    assert.equal(v.getLines()[6], "### 1.1. Child");

    assert.equal(removeSectionNumbersInView(v), true);
    assert.equal(v.getLines()[5], "## Real Heading");
    assert.equal(v.getLines()[6], "### Child");

    const vCreate = createTestView(["", "## Alpha"], [0, 0]);
    assert.equal(createTocInView(vCreate), true);
    assert.match(vCreate.state.doc.toString(), /\[Alpha\]\(#alpha\)/);
  });
});

describe("6. CodeMirror 6 Completions (completion.ts)", () => {
  it("completes KaTeX commands inside math environments and ignores non-math text", async () => {
    const ext = createMarkdownCompletionExtension();
    const inMath = createTestView(["Euler $\\alp$"], [0, 11], [0, 11], [ext]);
    const sources = inMath.state.languageDataAt<autocomplete.CompletionSource>(
      "autocomplete",
      inMath.state.selection.main.head,
    );
    assert.equal(sources.length, 1);

    const ctx = new autocomplete.CompletionContext(
      inMath.state,
      inMath.state.selection.main.head,
      false,
    );
    const res = await sources[0](ctx);
    assert.ok(res);
    assert.ok(res.options.some((o) => o.label === "\\alpha"));

    const outsideMath = createTestView(["Plain \\alp"], [0, 10], [0, 10], [ext]);
    const ctxOut = new autocomplete.CompletionContext(
      outsideMath.state,
      outsideMath.state.selection.main.head,
      false,
    );
    const resOut = await sources[0](ctxOut);
    assert.equal(resOut, null);
  });

  it("completes reference link labels and heading anchors", () => {
    const doc = [
      "# Intro Section",
      "See [",
      "",
      "[acode]: https://acode.app",
      "[unused]: https://example.com",
      "Already used [acode] once.",
    ].join("\n");

    const refRes = completeRefLinksFromText(doc, "See [", 21);
    assert.ok(refRes);
    assert.equal(refRes.options.length, 2);
    const unusedOpt = refRes.options.find((o) => o.label === "unused");
    const acodeOpt = refRes.options.find((o) => o.label === "acode");
    assert.equal(unusedOpt?.detail, "0 usages");
    assert.equal(acodeOpt?.detail, "1 usage");

    const headRes = completeHeadingLinksFromText(
      doc,
      "Jump to [Intro](#",
      "",
      30,
    );
    assert.ok(headRes);
    assert.equal(headRes.options[0].label, "#intro-section");
    assert.equal(headRes.options[0].apply, "#intro-section)");
  });
});

describe("7. Print / HTML Export with KaTeX, mhchem, GitHub Alerts & Task Lists (print.ts)", () => {
  it("renders full HTML document with math, chemistry, alerts, task lists, and .md->.html links", async () => {
    const md = [
      "<!-- title: Custom Doc Title -->",
      "# Main Heading",
      "- [x] Completed item",
      "> [!NOTE]",
      "> Alert content",
      "",
      "Inline math $E = mc^2$ and chemistry $\\ce{H2O}$.",
      "",
      "Read [Guide](guide.md#setup) and [Repo](https://github.com/o/r/blob/main/README.md).",
    ].join("\n");

    assert.equal(extractMarkdownTitle(md), "Custom Doc Title");
    assert.equal(
      rewriteMdLinksToHtml('<a href="guide.md#setup">G</a> <a href="https://github.com/o/r/blob/main/README.md">R</a>'),
      '<a href="guide.html#setup">G</a> <a href="https://github.com/o/r/blob/main/README.md">R</a>',
    );

    const html = await renderDocumentToExportHtml(md);
    assert.match(html, /<title>Custom Doc Title<\/title>/);
    assert.match(html, /id="main-heading"/);
    assert.match(html, /task-list-item-checkbox/);
    assert.match(html, /markdown-alert-note/);
    assert.match(html, /class="katex"/);
    assert.match(html, /href="guide\.html#setup"/);
  });
});
