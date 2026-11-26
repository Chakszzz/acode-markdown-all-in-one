# Markdown All in One for Acode <!-- omit in toc -->

All you need to write Markdown in **Acode** (touch-friendly quick actions, keyboard shortcuts, table of contents, document outline, smart list editing, table formatter, math, auto-completion, and HTML export).

***Note***: Designed for **Acode with CodeMirror 6** (`minVersionCode: 1008`) using **100% native Acode UI** components (Selection Menu, Command Palette, SideBar Outline, Side Button, Native Settings, and Acode's built-in Markdown Preview). All features automatically activate when editing Markdown files (`.md`, `.markdown`, `.mdown`, `.mkd`, etc., or any file set to Markdown syntax mode).

**Table of Contents**

- [Features](#features)
  - [Quick Actions & Keyboard Shortcuts](#quick-actions--keyboard-shortcuts)
  - [Table of Contents & Outline](#table-of-contents--outline)
  - [List & Blockquote Editing](#list--blockquote-editing)
  - [Print Markdown to HTML](#print-markdown-to-html)
  - [GitHub Flavored Markdown](#github-flavored-markdown)
  - [Math](#math)
  - [Auto Completions](#auto-completions)
  - [Others](#others)
- [Available Commands](#available-commands)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Supported Settings](#supported-settings)
- [FAQ](#faq)
  - [Q: Why aren't shortcuts or Markdown actions working in my current tab?](#q-why-arent-shortcuts-or-markdown-actions-working-in-my-current-tab)
  - [Q: How does Smart Paste Link work on mobile / touch?](#q-how-does-smart-paste-link-work-on-mobile--touch)
  - [Q: Which Markdown syntax is supported?](#q-which-markdown-syntax-is-supported)
  - [Q: Syntax decorations do not show on a very large Markdown file](#q-syntax-decorations-do-not-show-on-a-very-large-markdown-file)
- [Installation](#installation)
- [Changelog](#changelog)
- [Credits & License](#credits--license)

## Features

### Quick Actions & Keyboard Shortcuts

Whether you edit with touch on mobile or with a hardware keyboard, every formatting and document action is accessible natively inside Acode:

- **Selection Menu (Touch):** Long-press or select text in the editor and tap the **Markdown (`M↓`)** icon in Acode's selection menu to open the full native action picker (*Toggle Bold*, *Toggle Italic*, *Create TOC*, *Format Tables*, *Smart Paste*, *Export HTML*, etc.).
- **Command Palette:** Open **Menu (`⋮`) → Command Palette** and search **`Markdown:`** to run any command directly.
- **SideBar Outline Menu:** Tap the **`⋮`** button in the **Markdown Outline** sidebar header to jump straight into Markdown actions.
- **Optional Side Button:** Enable **Show Markdown Side Action Button** in plugin settings to keep a floating native `SideButton` visible whenever a Markdown file is active.
- **Hardware / QuickTools Keybindings:** Standard shortcuts like <kbd>Ctrl</kbd> + <kbd>B</kbd>, <kbd>Ctrl</kbd> + <kbd>I</kbd>, <kbd>Ctrl</kbd> + <kbd>M</kbd>, and <kbd>Alt</kbd> + <kbd>C</kbd> work out of the box (see the full [keyboard shortcuts](#keyboard-shortcuts) table below).

### Table of Contents & Outline

- Run **"Markdown: Create Table of Contents"** from the Command Palette or the Selection Menu to insert a generated table of contents at the cursor.

- Existing TOCs are **automatically updated on save** by default. You can disable this via `toc.updateOnSave` in plugin settings.

- **Indentation** (`tabs` vs `spaces`) automatically follows your active Acode editor settings (`softTab` and `tabSize`), combined with the `list.indentationSize` scheme (`adaptive` or `inherit`).

- **Inline TOC Status Indicator:** Whenever a TOC block is detected in your document, a subtle status indicator shows whether it is `up to date` or `out of date` — tap it to update immediately.

- **SideBar Markdown Outline & Quick Jump:** Open the **Markdown Outline** tab in Acode's left sidebar to browse all headings (`H1`–`H6`) and tap any heading to scroll directly to it, or run **"Markdown: Go to Heading..."** to search headings via Acode's native Palette.

- To make TOC links compatible with **GitHub**, **GitLab**, **Gitea**, **VS Code**, **Bitbucket Cloud**, **Azure DevOps**, or **Zola**, set `toc.slugifyMode` in plugin settings.

- Three ways to **control which headings appear** in the TOC:

  <details>
  <summary>Click to expand</summary>

  1. Add `<!-- omit from toc -->` (or `<!-- omit in toc -->`) at the end of a heading, or on the line immediately above it, to exclude it from the TOC.

  2. Configure the `toc.levels` setting (for example `2..6` to skip `#` H1 titles).

  3. Configure the `toc.omittedFromToc` JSON setting in **Settings → Plugins → Markdown All in One** to exclude specific headings and their subheadings per file:

     ```json
     {
       "README.md": [
         "# Introduction",
         "## Also omitted"
       ]
     }
     ```

     ***Note***:
     - Setext headings (underlined with `===` or `---`) can also be omitted by listing their `# ` and `## ` equivalents.
     - Keep heading names unique within the same document when omitting by name.

  </details>

- Easily add, update, or remove **hierarchical section numbering** (`1.`, `1.1.`, `1.2.`, ...) across all headings via **Add/Update Section Numbers** and **Remove Section Numbers**.

- *If a regular Markdown list is mistakenly detected as a TOC, add `<!-- no toc -->` on the line right above that list.*

### List & Blockquote Editing

- **Smart <kbd>Enter</kbd>:** Automatically continues bullet lists (`-`, `*`, `+`), ordered lists (`1.`, `1)`), task lists (`- [ ]`), and blockquotes (`> `).
  - Pressing <kbd>Enter</kbd> on an empty sub-list item outdents it; pressing <kbd>Enter</kbd> on an empty top-level list item cleanly removes the marker or checkbox.
  - Pressing <kbd>Ctrl</kbd> + <kbd>Enter</kbd> inserts the next list item even when the cursor is in the middle of a line; <kbd>Shift</kbd> + <kbd>Enter</kbd> inserts a plain newline.
- **Smart <kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd>:** Indents or outdents list items using CommonMark-aligned adaptive spacing (configurable via `list.indentationSize`) and automatically renumbers ordered lists.
- **Smart <kbd>Backspace</kbd>:** Cleanly strips task checkboxes (`- [ ] `) and empty list markers step by step.
- **Auto-Renumbering:** Keeps sequential ordered list numbers consistent as you insert, delete, indent, move, or copy list lines (controlled by `orderedList.autoRenumber` and `orderedList.marker`).
- **Task List Toggle:** Toggle `- [ ]` ↔ `- [x]` across one or multiple selected lines with **Toggle Task List** (<kbd>Alt</kbd> + <kbd>C</kbd>).

***Note***: By default, list indentation adapts to each parent marker's width (e.g., 2 spaces under `- `, 3 spaces under `1. `, 4 spaces under `10. `). Switch `list.indentationSize` to `inherit` if you prefer Acode's fixed `tabSize`.

### Print Markdown to HTML

- Run **"Markdown: Print Current Document to HTML"** to export the active Markdown file as a standalone `.html` file in the same folder, or **"Markdown: Print Documents to HTML (Folder)"** to batch-export an entire workspace folder.
- Enable **Export to HTML on Save** (`print.onFileSave`) to automatically regenerate HTML whenever you save.
- Rendered HTML includes full support for:
  - **KaTeX math & `mhchem` chemistry formulas**
  - **GFM Task Lists** and **GitHub Alerts** (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`)
  - **Syntax-highlighted code blocks** and light/dark themes (`print.theme`)
- Use `<!-- title: Your Title -->` on the first line to customize the HTML `<title>` (otherwise the first heading is used).
- Relative `.md` links are automatically converted to `.html` links.
- Enable `print.imgToBase64` to embed local images directly inside the HTML file as `data:` URIs for easy sharing.

### GitHub Flavored Markdown

- **GFM Table Formatter:**
  - Integrates directly with Acode's native **Settings → Formatter** (`Markdown All in One (Tables)`) for `.md`, `.markdown`, `.mdown`, `.mkd`, `.rmd`, and `.qmd` files.
  - Also available anytime from the Selection Menu or Command Palette (**Format All Tables** / **Format Selected Table**).
  - Properly aligns columns containing **CJK characters and Emoji** using visual grapheme width calculation, preserving `:---`, `:---:`, and `---:` alignments.
- **Task Lists & GitHub Alerts:** Supported in both editing shortcuts and HTML export.

### Math

- Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>M</kbd> (or choose **Cycle Math Environment**) to cycle an empty cursor through:
  1. Inline math (`$|$`)
  2. Multi-line display math (`$$\n|\n$$`)
  3. Single-line display math (`$$ | $$`)
  4. Plain text
- Supports KaTeX math auto-completion and custom user-defined macros (`katex.macros`).

### Auto Completions

Powered natively by CodeMirror 6 autocompletion (disabled automatically outside Markdown files):

- **Math Functions (`\`):** Suggests hundreds of KaTeX commands, environments (`\begin{...}`), and your custom `katex.macros` when typing `\` inside `$...$` or `$$...$$`.
- **Heading Anchors (`#`):** Suggests `#heading-slug` targets when typing links such as `[section](#`.
- **Reference Links (`[`):** Suggests defined `[label]: url` reference links in the current document along with usage counts.
- **File & Image Paths (`(`, `/`):** Suggests workspace files and images relative to the current file (or relative to `completion.root` when typing `/...`).

### Others

- **Smart Paste Link:** Select text on a single line and paste an `http://` or `https://` URL (via <kbd>Ctrl</kbd> + <kbd>V</kbd>, Acode's Selection Menu **Paste**, or **Smart Paste URL as Link**) to automatically wrap it as `[selected text](url)`.
  - If the selection is already a URL or nothing is selected, normal paste is preserved.
- **Editor Syntax Decorations:** Lightweight CodeMirror 6 decorations for inline `` `code spans` ``, `~~strikethrough~~`, trailing spaces, hard line breaks (`↵`), inline links, and paragraphs (`¶`) — each independently toggleable in settings.
- **Native Preview Integration:** Run **Open Native Markdown Preview** or enable `preview.autoShowPreviewToSide` to launch Acode's built-in Markdown preview automatically when opening `.md` files.

## Available Commands

All commands are available in Acode's **Command Palette** and the **Markdown Quick Actions Menu**:

- `Markdown: Quick Actions Menu`
- `Markdown: Create Table of Contents`
- `Markdown: Update Table of Contents`
- `Markdown: Add/Update Section Numbers`
- `Markdown: Remove Section Numbers`
- `Markdown: Go to Heading...`
- `Markdown: Toggle Bold`
- `Markdown: Toggle Italic`
- `Markdown: Toggle Strikethrough`
- `Markdown: Toggle Code Span`
- `Markdown: Toggle Code Block`
- `Markdown: Toggle Heading Up`
- `Markdown: Toggle Heading Down`
- `Markdown: Toggle Math Environment`
- `Markdown: Toggle Math Environment (Reverse)`
- `Markdown: Toggle List` (cycles `-`, `*`, `+`, `1.`, `1)` per `list.toggle.candidate-markers`)
- `Markdown: Toggle Task List`
- `Markdown: Smart Paste Link`
- `Markdown: Format All Tables`
- `Markdown: Format Selected Table`
- `Markdown: Print Current Document to HTML`
- `Markdown: Print Documents to HTML (Folder)`
- `Markdown: Open Native Preview`
- `Markdown: Close Native Preview`
- `Markdown: Indent List Lines` / `Outdent List Lines`
- `Markdown: Move Line Up` / `Move Line Down`
- `Markdown: Copy Line Up` / `Copy Line Down`

## Keyboard Shortcuts

All shortcuts below work with external keyboards (and Acode QuickTools modifiers) when editing Markdown, and every action is also available via touch in the **Selection Menu (`M↓`)**.

<details>
<summary>Table</summary>

| Key | Command |
| --- | --- |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>B</kbd> | Toggle Bold |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>I</kbd> | Toggle Italic |
| <kbd>Alt</kbd> + <kbd>S</kbd> | Toggle Strikethrough<sup>1</sup> |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>]</kbd> | Toggle Heading Up (`#`) |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>[</kbd> | Toggle Heading Down |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>M</kbd> | Toggle Math Environment |
| <kbd>Alt</kbd> + <kbd>C</kbd> | Toggle Task List (`[ ]` / `[x]`) |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>V</kbd> | Smart Paste URL as Link (when text is selected) |
| <kbd>Enter</kbd> / <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Smart List & Blockquote continuation |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Adaptive List Indent / Outdent + Renumber |
| <kbd>Backspace</kbd> | Smart List & Task Checkbox deletion |

<sup>1. If the cursor is on a list/task item without selection, strikethrough wraps the item text automatically.</sup>

</details>

## Supported Settings

Configure everything directly inside Acode under **Settings → Plugins → Markdown All in One**.

<details>
<summary>Table</summary>

| Key | Default | Description |
| --- | --- | --- |
| `bold.indicator` | `**` | Use `**` or `__` to wrap bold text |
| `italic.indicator` | `*` | Use `*` or `_` to wrap italic text |
| `math.enabled` | `true` | Enable KaTeX math support, completions, and math commands |
| `katex.macros` | `{}` | Custom KaTeX macros JSON object (e.g. `{"\\R": "\\mathbb{R}"}`) |
| `showActionButtons` | `false` | Show native `SideButton` for quick Markdown actions when editing Markdown |
| `extraLangIds` | `[]` | Extra comma-separated file extensions treated as Markdown (e.g. `rmd,qmd`) |
| `list.indentationSize` | `adaptive` | `adaptive` aligns sublists with parent content; `inherit` uses editor `tabSize` |
| `orderedList.autoRenumber` | `true` | Automatically fix ordered list numbers while editing |
| `orderedList.marker` | `ordered` | Use sequential numbers (`ordered`) or always `1.` (`one`) |
| `list.toggle.candidate-markers` | `["-", "*", "+", "1.", "1)"]` | Markers cycled by Toggle List |
| `toc.levels` | `1..6` | Range of heading levels included in the TOC (`x..y`) |
| `toc.slugifyMode` | `github` | Slugify mode (`github`, `gitlab`, `gitea`, `vscode`, `bitbucket-cloud`, `azureDevops`, `zola`) |
| `toc.unorderedList.marker` | `-` | Bullet marker used in unordered TOC (`-`, `*`, or `+`) |
| `toc.orderedList` | `false` | Use ordered list (`1.`, `2.`, ...) in generated TOC |
| `toc.plaintext` | `false` | Generate plain text TOC without links |
| `toc.updateOnSave` | `true` | Automatically update existing TOC when saving file |
| `toc.omittedFromToc` | `{}` | JSON map of headings to omit per file (e.g. `{"README.md": ["# Intro"]}`) |
| `tableFormatter.enabled` | `true` | Register GFM table formatter in Acode Formatter settings |
| `tableFormatter.normalizeIndentation` | `false` | Round table indentation to nearest multiple of editor `tabSize` |
| `tableFormatter.delimiterRowNoPadding` | `false` | Omit outer spaces in table delimiter row (`\|---\|---\|`) |
| `completion.enabled` | `true` | Enable file path, image path, and `#heading` anchor auto-completion |
| `completion.root` | `""` | Subfolder relative to workspace root used when path starts with `/` |
| `theming.decoration.renderCodeSpan` | `true` | Render subtle border & background around inline `` `code` `` spans |
| `theming.decoration.renderStrikethrough` | `true` | Render line-through decoration on `~~strikethrough~~` |
| `theming.decoration.renderTrailingSpace` | `false` | Highlight trailing spaces at the end of lines |
| `theming.decoration.renderHardLineBreak` | `false` | Show `↵` indicator at Markdown hard line breaks |
| `theming.decoration.renderLink` | `false` | Show link indicator before inline Markdown links |
| `theming.decoration.renderParagraph` | `false` | Show `¶` symbol at the end of paragraphs |
| `syntax.decorationFileSizeLimit` | `50000` | Skip syntax decorations on files larger than this byte limit |
| `preview.autoShowPreviewToSide` | `false` | Automatically open Acode's native Markdown preview when opening `.md` files |
| `print.onFileSave` | `false` | Export current Markdown document to HTML automatically on save |
| `print.imgToBase64` | `false` | Embed local images as base64 data URIs when exporting HTML |
| `print.absoluteImgPath` | `true` | Convert relative image paths to absolute paths when exporting HTML |
| `print.includeVscodeStylesheets` | `true` | Include Markdown & syntax highlight stylesheets in exported HTML |
| `print.pureHtml` | `false` | Export raw rendered HTML body only without wrapper or CSS |
| `print.theme` | `light` | Theme class applied to exported HTML (`light` or `dark`) |
| `print.validateUrls` | `true` | Enable link validation when exporting HTML |

</details>

## FAQ

#### Q: Why aren't shortcuts or Markdown actions working in my current tab?

- Make sure your file has a Markdown extension (such as `.md` or `.markdown`, or an extension added to `extraLangIds`) or has its syntax mode switched to Markdown.
- This plugin targets **Acode with CodeMirror 6** (`versionCode >= 1008`). Legacy Ace-editor builds of Acode are not supported.

#### Q: How does Smart Paste Link work on mobile / touch?

- Copy a valid URL starting with a protocol (for example `https://docs.acode.app`), select a word or phrase on a single line, and either:
  - Tap **Paste** in Acode's selection menu,
  - Press <kbd>Ctrl</kbd> + <kbd>V</kbd>, or
  - Open the **Markdown (`M↓`)** selection menu item and tap **Smart Paste URL as Link**.
- When nothing is selected, or if the clipboard does not contain a URL, normal paste runs as usual.

#### Q: Which Markdown syntax is supported?

- **CommonMark**
- **GitHub Flavored Markdown:** Tables, strikethrough (`~~text~~`), task lists (`- [ ]` / `- [x]`), and GitHub Alerts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`)
- **Math & Chemistry:** KaTeX inline (`$...$`), display (`$$...$$`), and `mhchem` (`\ce{...}`)
- **YAML Front Matter** (ignored automatically during TOC generation)

#### Q: Syntax decorations do not show on a very large Markdown file

- To keep scrolling and typing smooth on mobile devices, decorations are skipped once a file exceeds `syntax.decorationFileSizeLimit` (default `50000` bytes). Increase or adjust this value in plugin settings if needed.

## Installation

1. Install **Markdown All in One** from Acode's Plugin Store, **or**
2. Download `plugin.zip` from Releases and install it in Acode via **Settings → Plugins → `+` → Local**.

## Changelog

See [changelogs.md](changelogs.md) for release notes.

## Credits & License

Adapted for Acode from the open-source *Markdown All in One* extension by Yu Zhang and contributors.
Licensed under the [MIT License](LICENSE).
