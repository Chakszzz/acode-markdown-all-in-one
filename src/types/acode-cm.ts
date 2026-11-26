import type * as CMAutocomplete from "@codemirror/autocomplete";
import type * as CMCommands from "@codemirror/commands";
import type * as CMLanguage from "@codemirror/language";
import type * as CMState from "@codemirror/state";
import type * as CMView from "@codemirror/view";
import type * as LezerCommon from "@lezer/common";
import type * as LezerHighlight from "@lezer/highlight";

export interface AcodeCodeMirrorNamespace {
  autocomplete: typeof CMAutocomplete;
  commands: typeof CMCommands;
  language: typeof CMLanguage;
  state: typeof CMState;
  view: typeof CMView;
  lezer: typeof LezerHighlight & {
    common: typeof LezerCommon;
    highlight: typeof LezerHighlight;
  };
  highlight?: AcodeCodeHighlight;
}

export interface AcodeCodeHighlight {
  HIGHLIGHT_CLASS: string;
  highlightCodeBlock(code: string, language?: string): Promise<string>;
  highlight(code: string, language?: string): Promise<string>;
  highlightLine(text: string, uri: string, symbolName?: string): Promise<string>;
  applyStyles(target: Node | ShadowRoot): void;
  getStyles(): string;
  getStyleSheet(): CSSStyleSheet | null;
  clearCache(): void;
}

export interface AcodeCommandDescriptor {
  name: string;
  description?: string;
  bindKey?: string | { win?: string; linux?: string; mac?: string };
  exec: (view?: CMView.EditorView, args?: unknown) => boolean | void | Promise<unknown>;
}

export interface AcodeCommandsModule {
  addCommand(descriptor: AcodeCommandDescriptor): void;
  removeCommand(name: string): void;
  registry?: {
    add(descriptor: AcodeCommandDescriptor): void;
    remove(name: string): void;
    execute(name: string, view?: CMView.EditorView, args?: unknown): unknown;
    list(): AcodeCommandDescriptor[];
  };
}

export interface AcodeSelectItem {
  value?: string;
  text: string;
  subText?: string;
  icon?: string;
  letters?: string;
  fileIcon?: { name: string; kind?: "file" | "folder" };
  disabled?: boolean;
  checkbox?: boolean;
  tailElement?: HTMLElement;
  ontailclick?: (event: Event) => void;
  className?: string;
  title?: string;
}

export interface AcodeSelectOptions {
  hideOnSelect?: boolean;
  default?: string;
  textTransform?: boolean;
  className?: string;
  onCancel?: () => void;
  onHide?: () => void;
}

export type AcodeSelectFn = (
  title: string,
  items: Array<string | AcodeSelectItem>,
  options?: AcodeSelectOptions | boolean,
) => Promise<string>;

export type AcodePaletteFn = (
  getList: () => Array<string | [string, string] | { value: string; text: string }> | Promise<Array<string | [string, string]>>,
  onSelect: (value: string) => void,
  placeholder?: string,
  onRemove?: () => void,
) => void;

export interface AcodeSideButtonInstance {
  show(): void;
  hide(): void;
}

export type AcodeSideButtonFactory = (options: {
  text: string;
  icon?: string;
  onclick: () => void;
  backgroundColor?: string;
  textColor?: string;
}) => AcodeSideButtonInstance;

export interface AcodeSidebarApps {
  add(
    icon: string,
    id: string,
    title: string,
    initFunction: (container: HTMLElement) => void,
    prepend?: boolean,
    onSelected?: (container: HTMLElement) => void,
  ): void;
  get(id: string): HTMLElement | null;
  remove(id: string): void;
}

export interface AcodeSelectionMenu {
  add(
    onclick: () => void,
    text: string | HTMLElement,
    mode?: "selected" | "all",
    readOnly?: boolean,
    options?: { id?: string; label?: string },
  ): void;
  exec?(command: string): void;
}

export interface AcodeLoaderInstance {
  show(): void;
  hide(): void;
  destroy(): void;
  setTitle?(title: string): void;
  setMessage?(message: string): void;
}

export interface AcodeLoaderModule {
  create(title: string, message?: string): AcodeLoaderInstance;
  showTitleLoader?(): void;
  removeTitleLoader?(): void;
}

export interface AcodeFsStat {
  name: string;
  url: string;
  isFile: boolean;
  isDirectory: boolean;
  size?: number;
  mime?: string;
}

export interface AcodeFsInstance {
  lsDir(): Promise<AcodeFsStat[]>;
  readFile(encoding?: "utf-8" | "utf8" | "base64"): Promise<string | ArrayBuffer>;
  writeFile(content: string | ArrayBuffer, encoding?: string): Promise<void>;
  createFile(name: string, data?: string): Promise<string>;
  createDirectory(name: string): Promise<string>;
  exists(): Promise<boolean>;
  stat(): Promise<AcodeFsStat>;
}

export type AcodeFsFactory = (url: string) => AcodeFsInstance;

export interface AcodeUrlModule {
  join(...parts: string[]): string;
  dirname(url: string): string;
  basename(url: string): string | null;
  extname(url: string): string;
  pathname(url: string): string | null;
}

export interface AcodeEditorPane {
  id?: string;
  editor?: CMView.EditorView;
  activeFile?: AcodeEditorFile | null;
}

export interface AcodeEditorFile {
  id: string;
  filename: string;
  name?: string;
  uri?: string;
  location?: string;
  type?: string;
  eol?: "windows" | "unix";
  readOnly?: boolean;
  editable?: boolean;
  isUnsaved?: boolean;
  session?: any;
  run?: () => void;
  runFile?: () => void;
  save?: () => Promise<void>;
  makeActive?: () => void;
  on?: (event: string, cb: (...args: any[]) => void) => void;
  off?: (event: string, cb: (...args: any[]) => void) => void;
}

export interface AcodeEditorManager {
  editor: CMView.EditorView;
  isCodeMirror?: boolean;
  activeFile: AcodeEditorFile | null;
  files: AcodeEditorFile[];
  panes?: AcodeEditorPane[];
  activePane?: AcodeEditorPane | null;
  on(event: string | readonly string[], listener: (...args: any[]) => void): void;
  off(event: string | readonly string[], listener: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
  getFile(test: string, type: "uri" | "id" | "name"): AcodeEditorFile | null;
  switchFile(id: string): void;
  splitPaneRight?(): Promise<AcodeEditorPane | null>;
}

export interface AcodeAddedFolder {
  url: string;
  title: string;
}
