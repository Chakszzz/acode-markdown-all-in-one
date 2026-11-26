import plugin from "../plugin.json";
import SlugifyMode from "./contract/SlugifyMode";

export interface MarkdownPluginSettings {
  "completion.enabled": boolean;
  "completion.respectVscodeSearchExclude": boolean;
  "completion.root": string;
  "italic.indicator": "*" | "_";
  "bold.indicator": "**" | "__";
  "katex.macros": Record<string, string>;
  "list.indentationSize": "adaptive" | "inherit";
  "list.toggle.candidate-markers": string[];
  "math.enabled": boolean;
  "orderedList.autoRenumber": boolean;
  "orderedList.marker": "one" | "ordered";
  "preview.autoShowPreviewToSide": boolean;
  "print.absoluteImgPath": boolean;
  "print.imgToBase64": boolean;
  "print.includeVscodeStylesheets": boolean;
  "print.onFileSave": boolean;
  "print.pureHtml": boolean;
  "print.theme": "light" | "dark";
  "print.validateUrls": boolean;
  "showActionButtons": boolean;
  "syntax.decorationFileSizeLimit": number;
  "tableFormatter.enabled": boolean;
  "tableFormatter.normalizeIndentation": boolean;
  "tableFormatter.delimiterRowNoPadding": boolean;
  "theming.decoration.renderCodeSpan": boolean;
  "theming.decoration.renderHardLineBreak": boolean;
  "theming.decoration.renderLink": boolean;
  "theming.decoration.renderParagraph": boolean;
  "theming.decoration.renderStrikethrough": boolean;
  "theming.decoration.renderTrailingSpace": boolean;
  "toc.levels": string;
  "toc.omittedFromToc": Record<string, string[]>;
  "toc.orderedList": boolean;
  "toc.plaintext": boolean;
  "toc.slugifyMode": SlugifyMode;
  "toc.unorderedList.marker": "-" | "*" | "+";
  "toc.updateOnSave": boolean;
  "extraLangIds": string[];
}

export type ConfigKey = keyof MarkdownPluginSettings;

export const DEFAULT_SETTINGS: Readonly<MarkdownPluginSettings> = Object.freeze({
  "completion.enabled": true,
  "completion.respectVscodeSearchExclude": true,
  "completion.root": "",
  "italic.indicator": "*",
  "bold.indicator": "**",
  "katex.macros": {},
  "list.indentationSize": "adaptive",
  "list.toggle.candidate-markers": ["-", "*", "+", "1.", "1)"],
  "math.enabled": true,
  "orderedList.autoRenumber": true,
  "orderedList.marker": "ordered",
  "preview.autoShowPreviewToSide": false,
  "print.absoluteImgPath": true,
  "print.imgToBase64": false,
  "print.includeVscodeStylesheets": true,
  "print.onFileSave": false,
  "print.pureHtml": false,
  "print.theme": "light",
  "print.validateUrls": true,
  "showActionButtons": false,
  "syntax.decorationFileSizeLimit": 50000,
  "tableFormatter.enabled": true,
  "tableFormatter.normalizeIndentation": false,
  "tableFormatter.delimiterRowNoPadding": false,
  "theming.decoration.renderCodeSpan": true,
  "theming.decoration.renderHardLineBreak": false,
  "theming.decoration.renderLink": false,
  "theming.decoration.renderParagraph": false,
  "theming.decoration.renderStrikethrough": true,
  "theming.decoration.renderTrailingSpace": false,
  "toc.levels": "1..6",
  "toc.omittedFromToc": {},
  "toc.orderedList": false,
  "toc.plaintext": false,
  "toc.slugifyMode": SlugifyMode.GitHub,
  "toc.unorderedList.marker": "-",
  "toc.updateOnSave": true,
  "extraLangIds": [],
});

type ConfigChangeListener = (key: ConfigKey, value: unknown) => void;

class ConfigManager {
  private memoryStore: MarkdownPluginSettings = {
    ...DEFAULT_SETTINGS,
    "katex.macros": {},
    "list.toggle.candidate-markers": [...DEFAULT_SETTINGS["list.toggle.candidate-markers"]],
    "toc.omittedFromToc": {},
    "extraLangIds": [],
  };

  private listeners = new Set<ConfigChangeListener>();

  private getAppSettings(): any | null {
    if (typeof window !== "undefined" && (window as any).acode) {
      try {
        return acode.require("settings");
      } catch {
        return null;
      }
    }
    return null;
  }

  public init(): void {
    const appSettings = this.getAppSettings();
    if (!appSettings) return;

    const existing = appSettings.value[plugin.id];
    if (!existing || typeof existing !== "object") {
      appSettings.value[plugin.id] = { ...this.memoryStore };
      appSettings.update(false);
    } else {
      let dirty = false;
      for (const [k, defVal] of Object.entries(DEFAULT_SETTINGS)) {
        if (!(k in existing)) {
          existing[k] = Array.isArray(defVal)
            ? [...defVal]
            : defVal && typeof defVal === "object"
              ? { ...defVal }
              : defVal;
          dirty = true;
        }
      }
      if (dirty) {
        appSettings.update(false);
      }
      this.memoryStore = { ...this.memoryStore, ...existing };
    }
  }

  public get<K extends ConfigKey>(key: K): MarkdownPluginSettings[K] {
    const appSettings = this.getAppSettings();
    const store = appSettings?.value?.[plugin.id];
    if (store && key in store) {
      return store[key] as MarkdownPluginSettings[K];
    }
    return this.memoryStore[key];
  }

  public set<K extends ConfigKey>(key: K, value: MarkdownPluginSettings[K], showToast = false): void {
    this.memoryStore[key] = value;
    const appSettings = this.getAppSettings();
    if (appSettings) {
      if (!appSettings.value[plugin.id]) {
        appSettings.value[plugin.id] = { ...this.memoryStore };
      }
      appSettings.value[plugin.id][key] = value;
      appSettings.update(showToast);
    }
    for (const listener of this.listeners) {
      try {
        listener(key, value);
      } catch (err) {
        console.error("[MarkdownAllInOne] Config listener error:", err);
      }
    }
  }

  public resetForTests(): void {
    this.memoryStore = {
      ...DEFAULT_SETTINGS,
      "katex.macros": {},
      "list.toggle.candidate-markers": [...DEFAULT_SETTINGS["list.toggle.candidate-markers"]],
      "toc.omittedFromToc": {},
      "extraLangIds": [],
    };
  }

  public onChange(listener: ConfigChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Builds the 100% Native Acode Plugin Settings specification passed to acode.setPluginInit().
   */
  public buildNativeSettingsUi() {
    const get = <K extends ConfigKey>(k: K) => this.get(k);

    const list = [
      // Editing & Formatting
      {
        key: "bold.indicator",
        text: "Bold Indicator",
        info: "Characters used to wrap bold text (** or __).",
        value: get("bold.indicator"),
        select: ["**", "__"],
        category: "Editing & Formatting",
      },
      {
        key: "italic.indicator",
        text: "Italic Indicator",
        info: "Character used to wrap italic text (* or _).",
        value: get("italic.indicator"),
        select: ["*", "_"],
        category: "Editing & Formatting",
      },
      {
        key: "math.enabled",
        text: "Enable Math Support (KaTeX)",
        info: "Enable KaTeX math rendering, completions, and math commands.",
        checkbox: get("math.enabled"),
        value: get("math.enabled"),
        category: "Editing & Formatting",
      },
      {
        key: "katex.macros",
        text: "KaTeX Macros (JSON)",
        info: 'Custom KaTeX macros as JSON object, e.g. {"\\\\R": "\\\\mathbb{R}"}',
        value: JSON.stringify(get("katex.macros")),
        prompt: "Enter KaTeX macros JSON object",
        promptType: "text",
        category: "Editing & Formatting",
      },
      {
        key: "showActionButtons",
        text: "Show Markdown Side Action Button",
        info: "Show native Acode SideButton for quick Markdown actions when editing Markdown.",
        checkbox: get("showActionButtons"),
        value: get("showActionButtons"),
        category: "Editing & Formatting",
      },
      {
        key: "extraLangIds",
        text: "Extra Markdown Extensions",
        info: "Comma-separated extra file extensions (e.g. rmd,qmd).",
        value: get("extraLangIds").join(","),
        prompt: "Extra extensions (comma-separated, e.g. rmd,qmd)",
        promptType: "text",
        category: "Editing & Formatting",
      },

      // Lists
      {
        key: "list.indentationSize",
        text: "List Indentation Size",
        info: "Adaptive aligns sublist with parent content; inherit uses editor tabSize.",
        value: get("list.indentationSize"),
        select: ["adaptive", "inherit"],
        category: "Lists",
      },
      {
        key: "orderedList.autoRenumber",
        text: "Auto Renumber Ordered Lists",
        info: "Automatically fix ordered list marker numbers when editing.",
        checkbox: get("orderedList.autoRenumber"),
        value: get("orderedList.autoRenumber"),
        category: "Lists",
      },
      {
        key: "orderedList.marker",
        text: "Ordered List Marker Mode",
        info: "Use sequential numbers (ordered) or always 1. (one).",
        value: get("orderedList.marker"),
        select: ["ordered", "one"],
        category: "Lists",
      },
      {
        key: "list.toggle.candidate-markers",
        text: "Candidate List Markers",
        info: "Comma-separated markers cycled by Toggle List (e.g. -,*,+,1.,1)).",
        value: get("list.toggle.candidate-markers").join(","),
        prompt: "Enter comma-separated markers (-,*,+,1.,1))",
        promptType: "text",
        category: "Lists",
      },

      // Table of Contents
      {
        key: "toc.levels",
        text: "TOC Heading Levels",
        info: "Range of heading levels included in TOC (format: x..y, e.g. 1..6).",
        value: get("toc.levels"),
        prompt: "Heading level range (1..6)",
        promptType: "text",
        promptOptions: {
          match: /^[1-6]\.\.[1-6]$/,
          required: true,
          placeholder: "1..6",
        },
        category: "Table of Contents",
      },
      {
        key: "toc.slugifyMode",
        text: "TOC Slugify Mode",
        info: "Method to generate heading anchor IDs for TOC, completion, and HTML export.",
        value: get("toc.slugifyMode"),
        select: [
          "github",
          "gitlab",
          "gitea",
          "vscode",
          "bitbucket-cloud",
          "azureDevops",
          "zola",
        ],
        category: "Table of Contents",
      },
      {
        key: "toc.unorderedList.marker",
        text: "TOC Unordered List Marker",
        info: "Bullet marker used for unordered TOC (-, *, or +).",
        value: get("toc.unorderedList.marker"),
        select: ["-", "*", "+"],
        category: "Table of Contents",
      },
      {
        key: "toc.orderedList",
        text: "TOC Ordered List",
        info: "Use numbered list (1., 2., ...) in generated TOC.",
        checkbox: get("toc.orderedList"),
        value: get("toc.orderedList"),
        category: "Table of Contents",
      },
      {
        key: "toc.plaintext",
        text: "TOC Plain Text Only",
        info: "Generate plain text TOC without Markdown links.",
        checkbox: get("toc.plaintext"),
        value: get("toc.plaintext"),
        category: "Table of Contents",
      },
      {
        key: "toc.updateOnSave",
        text: "Auto Update TOC on Save",
        info: "Automatically update existing Table of Contents when saving file.",
        checkbox: get("toc.updateOnSave"),
        value: get("toc.updateOnSave"),
        category: "Table of Contents",
      },
      {
        key: "toc.omittedFromToc",
        text: "Omitted Headings (JSON)",
        info: 'Headings omitted per file, e.g. {"README.md": ["# Introduction"]}',
        value: JSON.stringify(get("toc.omittedFromToc")),
        prompt: "Enter omittedFromToc JSON object",
        promptType: "text",
        category: "Table of Contents",
      },

      // Table Formatter
      {
        key: "tableFormatter.enabled",
        text: "Enable GFM Table Formatter",
        info: "Register Markdown All in One table formatter in Acode.",
        checkbox: get("tableFormatter.enabled"),
        value: get("tableFormatter.enabled"),
        category: "Table Formatter",
      },
      {
        key: "tableFormatter.normalizeIndentation",
        text: "Normalize Table Indentation",
        info: "Round table indentation to nearest multiple of editor tab size.",
        checkbox: get("tableFormatter.normalizeIndentation"),
        value: get("tableFormatter.normalizeIndentation"),
        category: "Table Formatter",
      },
      {
        key: "tableFormatter.delimiterRowNoPadding",
        text: "Delimiter Row No Padding",
        info: "Do not add outer space padding to table delimiter rows (|---|---|).",
        checkbox: get("tableFormatter.delimiterRowNoPadding"),
        value: get("tableFormatter.delimiterRowNoPadding"),
        category: "Table Formatter",
      },

      // Auto-Completion
      {
        key: "completion.enabled",
        text: "Enable Path & Anchor Completion",
        info: "Auto-complete file paths, image paths, heading anchors (#), and reference links.",
        checkbox: get("completion.enabled"),
        value: get("completion.enabled"),
        category: "Auto-Completion",
      },
      {
        key: "completion.root",
        text: "Completion Root Folder",
        info: "Subfolder relative to project root for rooted (/...) path completions.",
        value: get("completion.root"),
        prompt: "Relative root folder (leave empty for workspace root)",
        promptType: "text",
        category: "Auto-Completion",
      },

      // Syntax Decorations
      {
        key: "theming.decoration.renderCodeSpan",
        text: "Decorate Inline Code Spans",
        info: "Render subtle border & background around `inline code` spans.",
        checkbox: get("theming.decoration.renderCodeSpan"),
        value: get("theming.decoration.renderCodeSpan"),
        category: "Syntax Decorations",
      },
      {
        key: "theming.decoration.renderStrikethrough",
        text: "Decorate Strikethrough",
        info: "Render line-through text decoration on ~~strikethrough~~ spans.",
        checkbox: get("theming.decoration.renderStrikethrough"),
        value: get("theming.decoration.renderStrikethrough"),
        category: "Syntax Decorations",
      },
      {
        key: "theming.decoration.renderTrailingSpace",
        text: "Highlight Trailing Spaces",
        info: "Highlight trailing spaces at the end of lines.",
        checkbox: get("theming.decoration.renderTrailingSpace"),
        value: get("theming.decoration.renderTrailingSpace"),
        category: "Syntax Decorations",
      },
      {
        key: "theming.decoration.renderHardLineBreak",
        text: "Show Hard Line Break Symbol (↵)",
        info: "Show ↵ indicator at Markdown hard line breaks.",
        checkbox: get("theming.decoration.renderHardLineBreak"),
        value: get("theming.decoration.renderHardLineBreak"),
        category: "Syntax Decorations",
      },
      {
        key: "theming.decoration.renderLink",
        text: "Show Link Indicator Icon",
        info: "Show link indicator before inline Markdown links.",
        checkbox: get("theming.decoration.renderLink"),
        value: get("theming.decoration.renderLink"),
        category: "Syntax Decorations",
      },
      {
        key: "theming.decoration.renderParagraph",
        text: "Show Paragraph Pilcrow (¶)",
        info: "Show ¶ symbol at the end of Markdown paragraphs.",
        checkbox: get("theming.decoration.renderParagraph"),
        value: get("theming.decoration.renderParagraph"),
        category: "Syntax Decorations",
      },
      {
        key: "syntax.decorationFileSizeLimit",
        text: "Decoration File Size Limit (Bytes)",
        info: "Skip editor decorations for files larger than this byte limit.",
        value: get("syntax.decorationFileSizeLimit"),
        prompt: "Max file size in bytes",
        promptType: "number",
        category: "Syntax Decorations",
      },

      // Preview & Print to HTML
      {
        key: "preview.autoShowPreviewToSide",
        text: "Auto Open Native Preview",
        info: "Automatically open Acode's native Markdown preview when opening a Markdown file.",
        checkbox: get("preview.autoShowPreviewToSide"),
        value: get("preview.autoShowPreviewToSide"),
        category: "Preview & HTML Export",
      },
      {
        key: "print.onFileSave",
        text: "Export to HTML on Save",
        info: "Automatically export current Markdown file to HTML whenever saved.",
        checkbox: get("print.onFileSave"),
        value: get("print.onFileSave"),
        category: "Preview & HTML Export",
      },
      {
        key: "print.imgToBase64",
        text: "Embed Images as Base64",
        info: "Convert local images to inline base64 data URIs when exporting HTML.",
        checkbox: get("print.imgToBase64"),
        value: get("print.imgToBase64"),
        category: "Preview & HTML Export",
      },
      {
        key: "print.absoluteImgPath",
        text: "Convert Image Paths to Absolute",
        info: "Resolve relative image paths to full paths when exporting HTML.",
        checkbox: get("print.absoluteImgPath"),
        value: get("print.absoluteImgPath"),
        category: "Preview & HTML Export",
      },
      {
        key: "print.includeVscodeStylesheets",
        text: "Include Markdown & Highlight CSS",
        info: "Include clean Markdown & syntax highlight stylesheets in exported HTML.",
        checkbox: get("print.includeVscodeStylesheets"),
        value: get("print.includeVscodeStylesheets"),
        category: "Preview & HTML Export",
      },
      {
        key: "print.pureHtml",
        text: "Pure HTML Output (Body Only)",
        info: "Export raw rendered HTML body without <html>/<head> wrapper or CSS.",
        checkbox: get("print.pureHtml"),
        value: get("print.pureHtml"),
        category: "Preview & HTML Export",
      },
      {
        key: "print.theme",
        text: "Exported HTML Theme",
        info: "Color theme class for exported HTML.",
        value: get("print.theme"),
        select: ["light", "dark"],
        category: "Preview & HTML Export",
      },
      {
        key: "print.validateUrls",
        text: "Validate URLs on Export",
        info: "Enable markdown-it link validation when rendering HTML.",
        checkbox: get("print.validateUrls"),
        value: get("print.validateUrls"),
        category: "Preview & HTML Export",
      },
    ];

    return {
      list,
      cb: (key: string, rawValue: any) => {
        const typedKey = key as ConfigKey;
        if (typedKey === "katex.macros" || typedKey === "toc.omittedFromToc") {
          try {
            const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              this.set(typedKey, parsed as any, true);
            } else {
              this.notifyInvalidJson(typedKey);
            }
          } catch {
            this.notifyInvalidJson(typedKey);
          }
          return;
        }
        if (typedKey === "list.toggle.candidate-markers" || typedKey === "extraLangIds") {
          const arr = String(rawValue ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          this.set(typedKey, arr as any, true);
          return;
        }
        if (typedKey === "syntax.decorationFileSizeLimit") {
          const num = Number(rawValue);
          if (Number.isFinite(num) && num >= 0) {
            this.set(typedKey, num, true);
          }
          return;
        }
        this.set(typedKey, rawValue, true);
      },
    };
  }

  private notifyInvalidJson(key: string): void {
    try {
      const toast = acode.require("toast");
      toast(`Invalid JSON object for ${key}`, 3000);
    } catch {
      console.warn(`Invalid JSON object for ${key}`);
    }
  }
}

export const configManager = new ConfigManager();
