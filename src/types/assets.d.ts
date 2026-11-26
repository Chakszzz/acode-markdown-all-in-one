declare module "*.css" {
  const cssText: string;
  export default cssText;
}

declare module "@neilsustc/markdown-it-katex" {
  import type MarkdownIt from "markdown-it";
  const plugin: (md: MarkdownIt, options?: Record<string, unknown>) => void;
  export default plugin;
}

declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";
  const plugin: (md: MarkdownIt, options?: Record<string, unknown>) => void;
  export default plugin;
}

declare module "unidecode" {
  function unidecode(str: string): string;
  export default unidecode;
}
