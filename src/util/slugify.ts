import MarkdownIt from "markdown-it";
import unidecode from "unidecode";
import { configManager } from "../config";
import SlugifyMode from "../contract/SlugifyMode";

const commonMarkInlineParser = new MarkdownIt("commonmark");
const utf8Encoder = new TextEncoder();

/**
 * Definition of punctuation from GitHub and GitLab (ported from vscode-markdown).
 */
const Regexp_Github_Punctuation = /[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc}\- ]/gu;

const Regexp_Gitlab_Product_Suffix =
  /[ \t\r\n\f\v]*\**\((?:core|starter|premium|ultimate)(?:[ \t\r\n\f\v]+only)?\)\**/g;

/**
 * Converts a string of CommonMark inline structures to plain text
 * by removing Markdown syntax in it.
 */
export function mdInlineToPlainText(text: string, env: object = Object.create(null)): string {
  const parsed = commonMarkInlineParser.parseInline(text, env);
  const inlineTokens = parsed[0]?.children ?? [];

  return inlineTokens.reduce<string>((result, token) => {
    switch (token.type) {
      case "image":
      case "html_inline":
        return result;
      default:
        return result + token.content;
    }
  }, "");
}

/**
 * Pure TypeScript equivalent of Rust's `slug::slugify` used by `zola-slug`.
 * Uses `unidecode` (matching Rust `deunicode`) followed by lowercasing and
 * collapsing non-alphanumeric runs to single hyphens.
 */
export function zolaSlugify(input: string): string {
  const ascii = unidecode(input);
  let out = "";
  let prevDash = false;

  for (let i = 0; i < ascii.length; i++) {
    const code = ascii.charCodeAt(i);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;

    if (isDigit || isLower) {
      out += ascii[i];
      prevDash = false;
    } else if (isUpper) {
      out += String.fromCharCode(code + 32);
      prevDash = false;
    } else if (!prevDash && out.length > 0) {
      out += "-";
      prevDash = true;
    }
  }

  if (out.endsWith("-")) {
    out = out.slice(0, -1);
  }
  return out;
}

const Slugify_Methods: {
  readonly [mode in SlugifyMode]: (rawContent: string, env: object) => string;
} = {
  [SlugifyMode.AzureDevOps]: (slug: string): string => {
    slug = slug.trim().toLowerCase().replace(/\p{Zs}/gu, "-");

    if (/^\d/.test(slug)) {
      slug = Array.from(utf8Encoder.encode(slug), (b) => "%" + b.toString(16))
        .join("")
        .toUpperCase();
    } else {
      slug = encodeURIComponent(slug);
    }
    return slug;
  },

  [SlugifyMode.BitbucketCloud]: (slug: string, env: object): string => {
    return "markdown-header-" + Slugify_Methods.github(slug, env).replace(/-+/g, "-");
  },

  [SlugifyMode.Gitea]: (slug: string): string => {
    return slug
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/[^\p{L}\p{N}]+$/u, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .toLowerCase();
  },

  [SlugifyMode.GitHub]: (slug: string, env: object): string => {
    return mdInlineToPlainText(slug, env)
      .replace(Regexp_Github_Punctuation, "")
      .toLowerCase()
      .replace(/ /g, "-");
  },

  [SlugifyMode.GitLab]: (slug: string, env: object): string => {
    return mdInlineToPlainText(slug, env)
      .replace(/^[ \t\r\n\f\v]+/, "")
      .replace(/[ \t\r\n\f\v]+$/, "")
      .toLowerCase()
      .replace(Regexp_Gitlab_Product_Suffix, "")
      .replace(Regexp_Github_Punctuation, "")
      .replace(/ /g, "-")
      .replace(/-+/g, "-")
      .replace(/^(\d+)$/, "anchor-$1");
  },

  [SlugifyMode.VisualStudioCode]: (rawContent: string, env: object): string => {
    const parsed = commonMarkInlineParser.parseInline(rawContent, env);
    const children = parsed[0]?.children ?? [];
    return encodeURI(
      children
        .reduce<string>((result, token) => result + token.content, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(
          /[\]\[\!\'\#\$\%\&\(\)\*\+\,\.\/\:\;\<\=\>\?\@\\\^\_\{\|\}\~\`。，、；：？！…—·ˉ¨‘’“”々～‖∶＂＇｀｜〃〔〕〈〉《》「」『』．〖〗【】（）［］｛｝]/g,
          "",
        )
        .replace(/^\-+/, "")
        .replace(/\-+$/, ""),
    );
  },

  [SlugifyMode.Zola]: (rawContent: string, env: object): string => {
    return zolaSlugify(mdInlineToPlainText(rawContent, env));
  },
};

export function slugify(
  heading: string,
  options?: {
    env?: object;
    mode?: SlugifyMode;
  },
): string {
  const env = options?.env ?? Object.create(null);
  const mode = options?.mode ?? configManager.get("toc.slugifyMode");
  const fn = Slugify_Methods[mode] ?? Slugify_Methods[SlugifyMode.GitHub];
  return fn(heading, env);
}
