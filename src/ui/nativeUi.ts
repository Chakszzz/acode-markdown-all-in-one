import type { EditorView } from "@codemirror/view";
import {
  getActiveFile,
  getActiveView,
  getCM,
  getEditorManager,
  isActiveMarkdown,
  syncViewSession,
} from "../cm/runtime";
import { configManager } from "../config";
import {
  pasteCommand,
  styleByWrapping,
  toggleBold,
  toggleCodeBlock,
  toggleCodeSpan,
  toggleHeadingDown,
  toggleHeadingUp,
  toggleItalic,
  toggleList,
  toggleMath,
  toggleStrikethrough,
} from "../features/formatting";
import {
  checkTaskList,
  copyLineDownWithRenumber,
  copyLineUpWithRenumber,
  indentLinesInView,
  moveLineDownWithRenumber,
  moveLineUpWithRenumber,
  outdentLinesInView,
} from "../features/listEditing";
import {
  closeNativeMarkdownPreview,
  openNativeMarkdownPreview,
} from "../features/preview";
import {
  batchPrintToHtml,
  printCurrentDocumentToHtml,
} from "../features/print";
import { formatTablesInView } from "../features/tableFormatter";
import {
  addSectionNumbersInView,
  createTocInView,
  getAllRootHeadingsFromText,
  removeSectionNumbersInView,
  updateTocInView,
} from "../features/toc";
import type {
  AcodeCommandDescriptor,
  AcodeCommandsModule,
  AcodePaletteFn,
  AcodeSelectFn,
  AcodeSelectItem,
  AcodeSelectionMenu,
  AcodeSideButtonFactory,
  AcodeSideButtonInstance,
  AcodeSidebarApps,
} from "../types/acode-cm";

// Built-in Acode icon class from src/res/icons/style.css (.icon.markdown)
const ICON_NAME = "markdown";
const SIDEBAR_ID = "acode-md-all-in-one-outline";
const SELECTION_MENU_BRIDGE_KEY = "__acodeMdAllInOneSelectionMenuBridge__";

function runOnlyInMarkdown(
  fn: (view: EditorView) => boolean | void | Promise<unknown>,
) {
  return (passedView?: EditorView) => {
    if (!isActiveMarkdown()) return false;
    const view = passedView ?? getActiveView();
    if (!view) return false;
    return fn(view);
  };
}

export function jumpToEditorLine(lineIndex0: number): void {
  const view = getActiveView();
  if (!view) return;
  const cm = getCM();
  const targetLineNo = Math.max(
    1,
    Math.min(view.state.doc.lines, lineIndex0 + 1),
  );
  const line = view.state.doc.line(targetLineNo);

  view.dispatch({
    selection: cm.state.EditorSelection.cursor(line.from),
    effects: cm.view.EditorView.scrollIntoView(line.from, { y: "center" }),
  });
  syncViewSession(view);
  view.focus();
}

export function openGoToHeadingPalette(): void {
  if (typeof window === "undefined" || !(window as any).acode) return;

  const toast = acode.require("toast");
  const view = getActiveView();
  if (!view || !isActiveMarkdown()) {
    toast("Open a Markdown file to browse headings.", 2500);
    return;
  }

  const headings = getAllRootHeadingsFromText(view.state.doc.toString());
  if (headings.length === 0) {
    toast("No headings found in current Markdown document.", 2500);
    return;
  }

  const palette = acode.require("palette") as AcodePaletteFn;
  const entries = headings.map((h) => {
    const hashes = "#".repeat(h.level);
    const label = `${hashes} ${h.rawContent || "(empty)"}  :${h.lineIndex + 1}`;
    return { label, lineIndex0: h.lineIndex };
  });

  const labelToLine = new Map<string, number>();
  for (const e of entries) {
    labelToLine.set(e.label, e.lineIndex0);
  }

  palette(
    () => entries.map((e) => e.label),
    (picked: string) => {
      const line0 = labelToLine.get(picked);
      if (line0 !== undefined) {
        jumpToEditorLine(line0);
      }
    },
    "Go to Markdown heading...",
  );
}

export async function openNativeMarkdownActionsMenu(): Promise<void> {
  if (typeof window === "undefined" || !(window as any).acode) return;

  const toast = acode.require("toast");
  const view = getActiveView();
  if (!view || !isActiveMarkdown()) {
    toast("Markdown All in One actions require an active Markdown file.", 2500);
    return;
  }

  // Wait one macrotask so Android WebView finishes dispatching the tap that opened this dialog
  await new Promise((resolve) => setTimeout(resolve, 0));

  const select = acode.require("select") as AcodeSelectFn;
  const mainSel = view.state.selection.main;
  const savedRange = { from: mainSel.from, to: mainSel.to };
  const hasSelection = !mainSel.empty;

  // All icon classes below are verified built-in glyphs from Acode's src/res/icons/style.css
  const actions: Array<AcodeSelectItem & { run: () => void | Promise<unknown> }> = [
    {
      value: "bold",
      text: "Toggle Bold",
      subText: "Wrap or unwrap **bold** (Ctrl+B)",
      icon: "format_bold",
      run: () => toggleBold(view),
    },
    {
      value: "italic",
      text: "Toggle Italic",
      subText: "Wrap or unwrap *italic* (Ctrl+I)",
      icon: "text_format",
      run: () => toggleItalic(view),
    },
    {
      value: "strikethrough",
      text: "Toggle Strikethrough",
      subText: "Wrap or unwrap ~~strikethrough~~ (Alt+S)",
      icon: "format_underlined",
      run: () => toggleStrikethrough(view),
    },
    {
      value: "codespan",
      text: "Toggle Code Span",
      subText: "Wrap or unwrap `inline code`",
      icon: "code",
      run: () => toggleCodeSpan(view),
    },
    {
      value: "codeblock",
      text: "Toggle Code Block",
      subText: "Wrap selection in fenced ``` code block",
      icon: "document-code",
      run: () => toggleCodeBlock(view),
    },
    {
      value: "heading-up",
      text: "Increase Heading Level (#)",
      subText: "Promote line heading level (Ctrl+Shift+])",
      icon: "keyboard_arrow_up",
      run: () => toggleHeadingUp(view),
    },
    {
      value: "heading-down",
      text: "Decrease Heading Level",
      subText: "Demote line heading level (Ctrl+Shift+[)",
      icon: "keyboard_arrow_down",
      run: () => toggleHeadingDown(view),
    },
    {
      value: "list",
      text: "Cycle List Marker",
      subText: "Cycle -, *, +, 1., 1) on current line(s)",
      icon: "menu",
      run: () => toggleList(view),
    },
    {
      value: "task",
      text: "Toggle Task Checkbox",
      subText: "Check or uncheck - [ ] / - [x] (Alt+C)",
      icon: "check_circle_outline",
      run: () => checkTaskList(view),
    },
    {
      value: "math",
      text: "Cycle Math Environment",
      subText: "Cycle $...$, $$...$$, and multiline math (Ctrl+M)",
      icon: "all_inclusive",
      run: () => toggleMath(view, false),
    },
    {
      value: "paste-link",
      text: "Smart Paste URL as Link",
      subText: hasSelection
        ? "Wrap selected text with clipboard URL"
        : "Paste from clipboard",
      icon: "linkinsert_link",
      run: () => pasteCommand(view, savedRange),
    },
    {
      value: "format-tables",
      text: hasSelection ? "Format Selected Table(s)" : "Format All Tables",
      subText: "Align GFM tables (supports CJK & emoji)",
      icon: "apps",
      run: () => formatTablesInView(view, hasSelection),
    },
    {
      value: "toc-create",
      text: "Create Table of Contents",
      subText: "Insert generated TOC at cursor",
      icon: "notes",
      run: () => createTocInView(view),
    },
    {
      value: "toc-update",
      text: "Update Table of Contents",
      subText: "Refresh existing TOC in document",
      icon: "refresh",
      run: () => updateTocInView(view),
    },
    {
      value: "sec-add",
      text: "Add / Update Section Numbers",
      subText: "Number headings hierarchically (1., 1.1., ...)",
      icon: "add_box",
      run: () => addSectionNumbersInView(view),
    },
    {
      value: "sec-remove",
      text: "Remove Section Numbers",
      subText: "Strip hierarchical numbers from headings",
      icon: "remove_circle_outline",
      run: () => removeSectionNumbersInView(view),
    },
    {
      value: "goto-heading",
      text: "Go to Heading...",
      subText: "Jump to heading via native Palette",
      icon: "search",
      run: () => openGoToHeadingPalette(),
    },
    {
      value: "preview",
      text: "Open Native Markdown Preview",
      subText: "Preview with KaTeX, Alerts, Mermaid & Code Highlight",
      icon: "remove_red_eyevisibility",
      run: () => openNativeMarkdownPreview(),
    },
    {
      value: "print-html",
      text: "Export Current Document to HTML",
      subText: "Render standalone .html file alongside Markdown",
      icon: "save_alt",
      run: () => printCurrentDocumentToHtml(),
    },
    {
      value: "print-batch",
      text: "Batch Export Folder to HTML",
      subText: "Export all .md files in a workspace folder",
      icon: "folder-download",
      run: () => batchPrintToHtml(),
    },
  ];

  let picked: string | null = null;
  try {
    picked = await select("Markdown All in One", actions, true);
  } catch {
    picked = null;
  }

  if (!picked) return;
  const chosen = actions.find((a) => a.value === picked);
  if (chosen) {
    await chosen.run();
  }
}

export class NativeAcodeUiManager {
  private registeredCommands: string[] = [];
  private sideButton: AcodeSideButtonInstance | null = null;
  private outlineListEl: HTMLElement | null = null;
  private outlineContainer: HTMLElement | null = null;
  private outlineTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeConfig: (() => void) | null = null;

  private readonly onEditorUpdateBound = () => {
    this.syncSideButtonVisibility();
    this.scheduleOutlineRefresh();
  };

  public activate(): void {
    if (typeof window === "undefined" || !(window as any).acode) return;

    this.registerCommands();
    this.setupSelectionMenu();
    this.setupSideButton();
    this.setupOutlineSidebarApp();

    const em = getEditorManager();
    if (em) {
      em.on("switch-file", this.onEditorUpdateBound);
      em.on("file-loaded", this.onEditorUpdateBound);
      em.on("rename-file", this.onEditorUpdateBound);
      em.on("file-content-changed", this.onEditorUpdateBound);
    }

    this.unsubscribeConfig = configManager.onChange((key) => {
      if (key === "showActionButtons" || key === "extraLangIds") {
        this.syncSideButtonVisibility();
      }
    });

    this.syncSideButtonVisibility();
  }

  private registerCommands(): void {
    const commands = acode.require("commands") as unknown as AcodeCommandsModule;

    const descriptors: AcodeCommandDescriptor[] = [
      {
        name: "markdown.extension.actionsMenu",
        description: "Markdown: Quick Actions Menu",
        exec: () => openNativeMarkdownActionsMenu(),
      },
      {
        name: "markdown.extension.toc.create",
        description: "Markdown: Create Table of Contents",
        exec: runOnlyInMarkdown((v) => createTocInView(v)),
      },
      {
        name: "markdown.extension.toc.update",
        description: "Markdown: Update Table of Contents",
        exec: runOnlyInMarkdown((v) => updateTocInView(v)),
      },
      {
        name: "markdown.extension.toc.addSecNumbers",
        description: "Markdown: Add/Update Section Numbers",
        exec: runOnlyInMarkdown((v) => addSectionNumbersInView(v)),
      },
      {
        name: "markdown.extension.toc.removeSecNumbers",
        description: "Markdown: Remove Section Numbers",
        exec: runOnlyInMarkdown((v) => removeSectionNumbersInView(v)),
      },
      {
        name: "markdown.extension.gotoHeading",
        description: "Markdown: Go to Heading...",
        exec: () => openGoToHeadingPalette(),
      },
      {
        name: "markdown.extension.printToHtml",
        description: "Markdown: Print Current Document to HTML",
        exec: () => printCurrentDocumentToHtml(),
      },
      {
        name: "markdown.extension.printToHtmlBatch",
        description: "Markdown: Print Documents to HTML (Folder)",
        exec: () => batchPrintToHtml(),
      },
      {
        name: "markdown.extension.openPreview",
        description: "Markdown: Open Native Preview",
        exec: () => openNativeMarkdownPreview(),
      },
      {
        name: "markdown.extension.closePreview",
        description: "Markdown: Close Native Preview",
        exec: () => closeNativeMarkdownPreview(),
      },
      {
        name: "markdown.extension.formatTables",
        description: "Markdown: Format All Tables",
        exec: runOnlyInMarkdown((v) => formatTablesInView(v, false)),
      },
      {
        name: "markdown.extension.formatSelectedTable",
        description: "Markdown: Format Selected Table",
        exec: runOnlyInMarkdown((v) => formatTablesInView(v, true)),
      },
      {
        name: "markdown.extension.editing.toggleBold",
        description: "Markdown: Toggle Bold",
        bindKey: { win: "Ctrl-B", linux: "Ctrl-B", mac: "Command-B" },
        exec: runOnlyInMarkdown((v) => toggleBold(v)),
      },
      {
        name: "markdown.extension.editing.toggleItalic",
        description: "Markdown: Toggle Italic",
        bindKey: { win: "Ctrl-I", linux: "Ctrl-I", mac: "Command-I" },
        exec: runOnlyInMarkdown((v) => toggleItalic(v)),
      },
      {
        name: "markdown.extension.editing.toggleStrikethrough",
        description: "Markdown: Toggle Strikethrough",
        bindKey: { win: "Alt-S", linux: "Alt-S" },
        exec: runOnlyInMarkdown((v) => toggleStrikethrough(v)),
      },
      {
        name: "markdown.extension.editing.toggleCodeSpan",
        description: "Markdown: Toggle Code Span",
        exec: runOnlyInMarkdown((v) => toggleCodeSpan(v)),
      },
      {
        name: "markdown.extension.editing.toggleCodeBlock",
        description: "Markdown: Toggle Code Block",
        exec: runOnlyInMarkdown((v) => toggleCodeBlock(v)),
      },
      {
        name: "markdown.extension.editing.toggleHeadingUp",
        description: "Markdown: Toggle Heading Up",
        bindKey: {
          win: "Ctrl-Shift-]",
          linux: "Ctrl-Shift-]",
          mac: "Ctrl-Shift-]",
        },
        exec: runOnlyInMarkdown((v) => toggleHeadingUp(v)),
      },
      {
        name: "markdown.extension.editing.toggleHeadingDown",
        description: "Markdown: Toggle Heading Down",
        bindKey: {
          win: "Ctrl-Shift-[",
          linux: "Ctrl-Shift-[",
          mac: "Ctrl-Shift-[",
        },
        exec: runOnlyInMarkdown((v) => toggleHeadingDown(v)),
      },
      {
        name: "markdown.extension.editing.toggleMath",
        description: "Markdown: Toggle Math Environment",
        bindKey: { win: "Ctrl-M", linux: "Ctrl-M", mac: "Command-M" },
        exec: runOnlyInMarkdown((v) => toggleMath(v, false)),
      },
      {
        name: "markdown.extension.editing.toggleMathReverse",
        description: "Markdown: Toggle Math Environment (Reverse)",
        exec: runOnlyInMarkdown((v) => toggleMath(v, true)),
      },
      {
        name: "markdown.extension.editing.toggleList",
        description: "Markdown: Toggle List",
        exec: runOnlyInMarkdown((v) => toggleList(v)),
      },
      {
        name: "markdown.extension.checkTaskList",
        description: "Markdown: Toggle Task List",
        bindKey: { win: "Alt-C", linux: "Alt-C" },
        exec: runOnlyInMarkdown((v) => checkTaskList(v)),
      },
      {
        name: "markdown.extension.editing.paste",
        description: "Markdown: Smart Paste Link",
        bindKey: { win: "Ctrl-V", linux: "Ctrl-V", mac: "Command-V" },
        exec: (view) => {
          const targetView = view ?? getActiveView();
          if (!targetView) return false;
          if (!isActiveMarkdown()) {
            return (
              (commands.registry?.execute("paste", targetView) as boolean) ??
              false
            );
          }
          void pasteCommand(targetView).then((handled) => {
            if (!handled) {
              commands.registry?.execute("paste", targetView);
            }
          });
          return true;
        },
      },
      {
        name: "markdown.extension.editing._wrapBy",
        description: "Markdown: Wrap Selection By Pattern",
        exec: (view, args: any) => {
          if (!isActiveMarkdown()) return false;
          const before = String(args?.before ?? "**");
          const after = args?.after !== undefined ? String(args.after) : before;
          return styleByWrapping(view, before, after);
        },
      },
      {
        name: "markdown.extension.onIndentLines",
        description: "Markdown: Indent List Lines",
        exec: runOnlyInMarkdown((v) => indentLinesInView(v)),
      },
      {
        name: "markdown.extension.onOutdentLines",
        description: "Markdown: Outdent List Lines",
        exec: runOnlyInMarkdown((v) => outdentLinesInView(v)),
      },
      {
        name: "markdown.extension.onMoveLineUp",
        description: "Markdown: Move Line Up",
        exec: runOnlyInMarkdown((v) => moveLineUpWithRenumber(v)),
      },
      {
        name: "markdown.extension.onMoveLineDown",
        description: "Markdown: Move Line Down",
        exec: runOnlyInMarkdown((v) => moveLineDownWithRenumber(v)),
      },
      {
        name: "markdown.extension.onCopyLineUp",
        description: "Markdown: Copy Line Up",
        exec: runOnlyInMarkdown((v) => copyLineUpWithRenumber(v)),
      },
      {
        name: "markdown.extension.onCopyLineDown",
        description: "Markdown: Copy Line Down",
        exec: runOnlyInMarkdown((v) => copyLineDownWithRenumber(v)),
      },
    ];

    for (const desc of descriptors) {
      commands.addCommand(desc);
      this.registeredCommands.push(desc.name);
    }
  }

  private setupSelectionMenu(): void {
    const w = window as any;
    w[SELECTION_MENU_BRIDGE_KEY] = () => {
      void openNativeMarkdownActionsMenu();
    };

    if (!w.__acodeMdAllInOneSelectionAdded__) {
      const selectionMenu = acode.require("selectionMenu") as AcodeSelectionMenu;
      const iconSpan = document.createElement("span");
      iconSpan.className = `icon ${ICON_NAME}`;
      selectionMenu.add(
        () => {
          const handler = (window as any)[SELECTION_MENU_BRIDGE_KEY];
          if (typeof handler === "function") handler();
        },
        iconSpan,
        "all",
        false,
        { id: "markdown-all-in-one", label: "Markdown" },
      );
      w.__acodeMdAllInOneSelectionAdded__ = true;
    }
  }

  private setupSideButton(): void {
    try {
      const SideButton = acode.require("sideButton") as AcodeSideButtonFactory;
      this.sideButton = SideButton({
        text: "Markdown",
        icon: ICON_NAME,
        onclick: () => {
          void openNativeMarkdownActionsMenu();
        },
      });
    } catch {
      this.sideButton = null;
    }
  }

  private syncSideButtonVisibility(): void {
    if (!this.sideButton) return;
    if (configManager.get("showActionButtons") && isActiveMarkdown()) {
      this.sideButton.show();
    } else {
      this.sideButton.hide();
    }
  }

  /**
   * Registers a 100% Native Acode SideBar App using Acode's standard
   * `.header > .title` and `ul.list.scroll > li.tile` DOM structure.
   */
  private setupOutlineSidebarApp(): void {
    try {
      const sidebarApps = acode.require("sidebarApps") as AcodeSidebarApps;
      sidebarApps.add(
        ICON_NAME,
        SIDEBAR_ID,
        "Markdown Outline",
        (container: HTMLElement) => {
          this.outlineContainer = container;

          const header = document.createElement("div");
          header.className = "header";

          const title = document.createElement("div");
          title.className = "title";
          title.textContent = "Markdown Outline";

          const actionsBtn = document.createElement("button");
          actionsBtn.type = "button";
          actionsBtn.className = "icon-button";
          actionsBtn.title = "Markdown Actions";
          actionsBtn.setAttribute("aria-label", "Markdown Actions");
          const actionIcon = document.createElement("span");
          actionIcon.className = "icon more_vert";
          actionsBtn.appendChild(actionIcon);
          actionsBtn.onclick = () => {
            void openNativeMarkdownActionsMenu();
          };

          title.appendChild(actionsBtn);
          header.appendChild(title);

          const list = document.createElement("ul");
          list.className = "list scroll";
          list.style.overflowY = "auto";
          list.style.maxHeight = "calc(100% - 45px)";

          this.outlineListEl = list;
          container.appendChild(header);
          container.appendChild(list);

          this.renderOutlineItems();
        },
        false,
        () => {
          this.renderOutlineItems();
        },
      );
    } catch (err) {
      console.warn("[MarkdownAllInOne] Failed to register sidebar app:", err);
    }
  }

  private scheduleOutlineRefresh(): void {
    if (!this.outlineContainer?.isConnected) return;
    if (this.outlineTimer) clearTimeout(this.outlineTimer);
    this.outlineTimer = setTimeout(() => {
      this.outlineTimer = null;
      this.renderOutlineItems();
    }, 200);
  }

  private renderOutlineItems(): void {
    const list = this.outlineListEl;
    if (!list) return;
    list.innerHTML = "";

    const file = getActiveFile();
    const view = getActiveView();

    if (!file || !view || !isActiveMarkdown()) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "tile";
      const textSpan = document.createElement("span");
      textSpan.className = "text sub-text";
      textSpan.textContent = "Open a Markdown file to view its outline.";
      emptyLi.appendChild(textSpan);
      list.appendChild(emptyLi);
      return;
    }

    const headings = getAllRootHeadingsFromText(view.state.doc.toString());
    if (headings.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "tile";
      const textSpan = document.createElement("span");
      textSpan.className = "text sub-text";
      textSpan.textContent = "No headings in current document.";
      emptyLi.appendChild(textSpan);
      list.appendChild(emptyLi);
      return;
    }

    const minLevel = Math.min(...headings.map((h) => h.level));

    for (const h of headings) {
      const li = document.createElement("li");
      li.className = "tile";
      li.style.paddingLeft = `${12 + (h.level - minLevel) * 14}px`;

      const badge = document.createElement("span");
      badge.className = "sub-text";
      badge.style.marginRight = "8px";
      badge.textContent = `H${h.level}`;

      const textSpan = document.createElement("span");
      textSpan.className = "text";
      textSpan.textContent = h.rawContent || "(Untitled)";

      li.appendChild(badge);
      li.appendChild(textSpan);
      li.onclick = () => {
        jumpToEditorLine(h.lineIndex);
      };

      list.appendChild(li);
    }
  }

  public dispose(): void {
    if (this.outlineTimer) clearTimeout(this.outlineTimer);
    this.outlineTimer = null;

    this.unsubscribeConfig?.();
    this.unsubscribeConfig = null;

    const em = getEditorManager();
    if (em) {
      em.off("switch-file", this.onEditorUpdateBound);
      em.off("file-loaded", this.onEditorUpdateBound);
      em.off("rename-file", this.onEditorUpdateBound);
      em.off("file-content-changed", this.onEditorUpdateBound);
    }

    if (typeof window !== "undefined") {
      delete (window as any)[SELECTION_MENU_BRIDGE_KEY];
    }

    if (this.sideButton) {
      try {
        this.sideButton.hide();
      } catch {
        // Ignore
      }
      this.sideButton = null;
    }

    if (typeof window !== "undefined" && (window as any).acode) {
      try {
        const commands = acode.require("commands") as unknown as AcodeCommandsModule;
        for (const name of this.registeredCommands) {
          commands.removeCommand(name);
        }
      } catch {
        // Ignore
      }
      this.registeredCommands = [];

      try {
        const sidebarApps = acode.require("sidebarApps") as AcodeSidebarApps;
        sidebarApps.remove(SIDEBAR_ID);
      } catch {
        // Ignore
      }
    }
  }
}
