# Changelog

## 1.0.1
- Intercepted Acode's native `Ctrl-V` / `Command-V` command and selection-menu `Paste` dispatch so Smart Paste URL wrapping (`[text](url)`) works across hardware keyboards, QuickTools, and touch selection.
- Updated all quick action menu, sidebar, and button icons to use verified Acode built-in icons so every icon renders properly.
- Isolated CodeMirror 6 compartments (`core`, `completion`, `decorations`) and added Markdown syntax-mode detection for unsaved tabs.

## 1.0.0
- Initial full CodeMirror 6 release of Markdown All in One for Acode (`minVersionCode: 1008`).
- Added quick formatting actions, keyboard shortcuts, math environment cycling, and smart URL paste.
- Added smart list & blockquote editing (`Enter`, `Tab`, `Shift-Tab`, `Backspace`, task-list toggle, auto-renumbering).
- Added Table of Contents creation, auto-update on save, hierarchical section numbers, 7 slugify modes, inline TOC status indicator, native Palette heading search, and native SideBar Outline.
- Added GFM Table Formatter with CJK & Emoji visual width alignment registered in Acode's Formatter settings.
- Added CodeMirror 6 autocompletion for KaTeX math commands/macros, heading anchors, reference links, and workspace file/image paths.
- Added CodeMirror 6 syntax decorations (code spans, strikethrough, trailing spaces, hard line breaks, links, paragraphs).
- Added single-file and batch-folder HTML export with KaTeX (`mhchem`), GitHub Alerts, task lists, syntax highlighting, and Base64 image embedding.
- Built 100% with native Acode UI components.
