import type { Text } from "@codemirror/state";
import hljs from "highlight.js/lib/common";
import type { KatexOptions } from "katex";
import "katex/contrib/mhchem";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token";
import markdownItGithubAlerts from "markdown-it-github-alerts";
import { configManager } from "../config";
import { slugify } from "../util/slugify";

import markdownItKatex from "@neilsustc/markdown-it-katex";
import markdownItTaskLists from "markdown-it-task-lists";

export type { MarkdownIt, Token };

export interface ParsedMarkdownTokens {
  readonly env: Record<string, unknown>;
  readonly tokens: readonly Token[];
}

function normalizeHighlightLang(lang: string): string {
  switch (lang.toLowerCase()) {
    case "tsx":
    case "typescriptreact":
      return "jsx";
    case "json5":
    case "jsonc":
      return "json";
    case "c#":
    case "csharp":
      return "cs";
    default:
      return lang;
  }
}

export function extendMarkdownIt(md: MarkdownIt): MarkdownIt {
  md.use(markdownItTaskLists, { enabled: true });
  md.use(markdownItGithubAlerts, { matchCaseSensitive: false });

  if (configManager.get("math.enabled")) {
    const katexOptions: KatexOptions = { throwOnError: false };
    const rawMacros = configManager.get("katex.macros");
    if (rawMacros && Object.keys(rawMacros).length > 0) {
      katexOptions.macros = JSON.parse(JSON.stringify(rawMacros));
    }
    md.use(markdownItKatex, katexOptions);
  }

  return md;
}

class CommonMarkEngine {
  public readonly engine = new MarkdownIt("commonmark");
  private readonly docCache = new WeakMap<object, ParsedMarkdownTokens>();
  private lastTextKey = "";
  private lastTextTokens: ParsedMarkdownTokens | null = null;

  public parseDoc(doc: Text): ParsedMarkdownTokens {
    const cached = this.docCache.get(doc);
    if (cached) return cached;

    const env = Object.create(null);
    const tokens = this.engine.parse(doc.toString(), env);
    const parsed: ParsedMarkdownTokens = { env, tokens };
    this.docCache.set(doc, parsed);
    return parsed;
  }

  public parseText(text: string): ParsedMarkdownTokens {
    if (this.lastTextTokens && this.lastTextKey === text) {
      return this.lastTextTokens;
    }
    const env = Object.create(null);
    const tokens = this.engine.parse(text, env);
    const parsed: ParsedMarkdownTokens = { env, tokens };
    this.lastTextKey = text;
    this.lastTextTokens = parsed;
    return parsed;
  }
}

class FullMarkdownEngine {
  private engine: MarkdownIt | null = null;
  private docCache = new WeakMap<object, ParsedMarkdownTokens>();
  private slugCount = new Map<string, number>();

  constructor() {
    configManager.onChange((key) => {
      if (
        key === "math.enabled" ||
        key === "katex.macros" ||
        key === "print.validateUrls" ||
        key === "toc.slugifyMode"
      ) {
        this.invalidate();
      }
    });
  }

  public invalidate(): void {
    this.engine = null;
    this.docCache = new WeakMap<object, ParsedMarkdownTokens>();
  }

  public getEngine(): MarkdownIt {
    if (this.engine) return this.engine;

    const md = new MarkdownIt({
      html: true,
      linkify: true,
      highlight: (str: string, lang?: string) => {
        if (lang) {
          const normalized = normalizeHighlightLang(lang);
          if (hljs.getLanguage(normalized)) {
            try {
              return hljs.highlight(str, {
                language: normalized,
                ignoreIllegals: true,
              }).value;
            } catch {
              // Fallback to escaped default
            }
          }
        }
        return "";
      },
    });

    extendMarkdownIt(md);

    if (!configManager.get("print.validateUrls")) {
      md.validateLink = () => true;
    }

    this.addNamedHeaders(md);
    this.engine = md;
    return md;
  }

  public parseDoc(doc: Text): ParsedMarkdownTokens {
    const cached = this.docCache.get(doc);
    if (cached) return cached;

    const env = Object.create(null);
    const tokens = this.getEngine().parse(doc.toString(), env);
    const parsed: ParsedMarkdownTokens = { env, tokens };
    this.docCache.set(doc, parsed);
    return parsed;
  }

  public parseText(text: string): ParsedMarkdownTokens {
    const env = Object.create(null);
    const tokens = this.getEngine().parse(text, env);
    return { env, tokens };
  }

  public render(text: string, options?: { breaks?: boolean; linkify?: boolean }): string {
    const md = this.getEngine();
    md.set({
      breaks: options?.breaks ?? false,
      linkify: options?.linkify ?? true,
    });
    this.slugCount.clear();
    return md.render(text);
  }

  private addNamedHeaders(md: MarkdownIt): void {
    const originalHeadingOpen = md.renderer.rules.heading_open;

    md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
      const raw = tokens[idx + 1]?.content ?? "";
      let slug = slugify(raw, { env });

      const lastCount = this.slugCount.get(slug);
      if (lastCount !== undefined) {
        const next = lastCount + 1;
        this.slugCount.set(slug, next);
        slug += "-" + next;
      } else {
        this.slugCount.set(slug, 0);
      }

      tokens[idx].attrs = [...(tokens[idx].attrs || []), ["id", slug]];

      if (originalHeadingOpen) {
        return originalHeadingOpen(tokens, idx, options, env, self);
      }
      return self.renderToken(tokens, idx, options);
    };
  }
}

export const commonMarkEngine = new CommonMarkEngine();
export const mdEngine = new FullMarkdownEngine();
