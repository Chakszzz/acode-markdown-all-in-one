import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import {
  getAddedFolders,
  getCM,
  getFileForState,
  isMarkdownState,
} from "../cm/runtime";
import { configManager } from "../config";
import type { AcodeFsFactory, AcodeUrlModule } from "../types/acode-cm";
import { mathEnvCheckState } from "../util/contextCheck";
import * as katexFuncs from "../util/katex-funcs";
import { getAllTocEntriesFromText } from "./toc";

interface IReferenceDefinition {
  label: string;
  usageCount: number;
}

const RXlookbehind = String.raw`(?<=(^[>]? {0,3}\[[ \t\r\n\f\v]*))`;
const RXlinklabel = String.raw`(?<linklabel>([^\]]|(\\\]))*)`;
const RXlink = String.raw`(?<link>((<[^>]*>)|([^< \t\r\n\f\v]+)))`;
const RXlinktitle = String.raw`(?<title>[ \t\r\n\f\v]+(("([^"]|(\\"))*")|('([^']|(\\'))*')))?$)`;
const RXlookahead = String.raw`(?=(\]:[ \t\r\n\f\v]*` + RXlink + RXlinktitle + String.raw`)`;
const Link_Label_Pattern = new RegExp(RXlookbehind + RXlinklabel + RXlookahead, "mg");

const ALWAYS_EXCLUDED_DIRS = new Set([
  "node_modules",
  "bower_components",
  ".git",
  ".hg",
  ".svn",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "svg", "gif", "webp"]);

interface CachedWorkspaceList {
  rootUrl: string;
  timestamp: number;
  files: string[]; // relative forward-slash paths from rootUrl
}

let workspaceFilesCache: CachedWorkspaceList | null = null;
const CACHE_TTL_MS = 15000;

async function listFilesRecursively(
  fsFactory: AcodeFsFactory,
  urlMod: AcodeUrlModule,
  dirUrl: string,
  prefix: string,
  out: string[],
  maxDepth = 5,
  maxFiles = 800,
): Promise<void> {
  if (maxDepth < 0 || out.length >= maxFiles) return;
  try {
    const entries = await fsFactory(dirUrl).lsDir();
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const name = entry.name || urlMod.basename(entry.url) || "";
      if (!name) continue;

      if (entry.isDirectory) {
        if (ALWAYS_EXCLUDED_DIRS.has(name)) continue;
        await listFilesRecursively(
          fsFactory,
          urlMod,
          entry.url,
          prefix ? `${prefix}/${name}` : name,
          out,
          maxDepth - 1,
          maxFiles,
        );
      } else if (entry.isFile) {
        if (name.endsWith(".code-search")) continue;
        out.push(prefix ? `${prefix}/${name}` : name);
      }
    }
  } catch {
    // Ignore unreadable directories
  }
}

function computeRelativePosixPath(fromDir: string, toFile: string): string {
  const fromParts = fromDir
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  const toParts = toFile
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  const up = new Array(fromParts.length - common).fill("..");
  const down = toParts.slice(common);
  return [...up, ...down].join("/");
}

async function resolveWorkspaceFiles(fileUri: string | undefined): Promise<{
  workspaceRootUrl: string;
  docDirUrl: string;
  files: string[];
} | null> {
  if (typeof window === "undefined" || !(window as any).acode || !fileUri) {
    return null;
  }

  const fsFactory = acode.require("fs") as AcodeFsFactory;
  const urlMod = acode.require("url") as AcodeUrlModule;
  const docDirUrl = urlMod.dirname(fileUri);

  const folders = getAddedFolders();
  const matchedFolder = folders.find((f) =>
    fileUri.startsWith(f.url.replace(/\/+$/, "")),
  );
  let rootUrl = matchedFolder ? matchedFolder.url.replace(/\/+$/, "") : docDirUrl;

  const customRoot = configManager.get("completion.root")?.trim();
  if (customRoot) {
    const candidate = urlMod.join(rootUrl, customRoot);
    try {
      if (await fsFactory(candidate).exists()) {
        rootUrl = candidate.replace(/\/+$/, "");
      }
    } catch {
      // Ignore
    }
  }

  const now = Date.now();
  if (
    workspaceFilesCache &&
    workspaceFilesCache.rootUrl === rootUrl &&
    now - workspaceFilesCache.timestamp < CACHE_TTL_MS
  ) {
    return { workspaceRootUrl: rootUrl, docDirUrl, files: workspaceFilesCache.files };
  }

  const files: string[] = [];
  await listFilesRecursively(fsFactory, urlMod, rootUrl, "", files);
  workspaceFilesCache = { rootUrl, timestamp: now, files };
  return { workspaceRootUrl: rootUrl, docDirUrl, files };
}

function buildMathCompletions(): Completion[] {
  const cm = getCM();
  const { snippetCompletion } = cm.autocomplete;
  const items: Completion[] = [];

  // \cmd (0 args)
  const c1 = Array.from(
    new Set([
      ...katexFuncs.delimiters0,
      ...katexFuncs.delimeterSizing0,
      ...katexFuncs.greekLetters0,
      ...katexFuncs.otherLetters0,
      ...katexFuncs.spacing0,
      ...katexFuncs.verticalLayout0,
      ...katexFuncs.logicAndSetTheory0,
      ...katexFuncs.macros0,
      ...katexFuncs.bigOperators0,
      ...katexFuncs.binaryOperators0,
      ...katexFuncs.binomialCoefficients0,
      ...katexFuncs.fractions0,
      ...katexFuncs.mathOperators0,
      ...katexFuncs.relations0,
      ...katexFuncs.negatedRelations0,
      ...katexFuncs.arrows0,
      ...katexFuncs.font0,
      ...katexFuncs.size0,
      ...katexFuncs.style0,
      ...katexFuncs.symbolsAndPunctuation0,
      ...katexFuncs.debugging0,
    ]),
  );

  for (const cmd of c1) {
    items.push({
      label: "\\" + cmd,
      type: "function",
      apply: "\\" + cmd,
    });
  }

  // \cmd{${1}} (1 arg)
  const c2 = Array.from(
    new Set([
      ...katexFuncs.accents1,
      ...katexFuncs.annotation1,
      ...katexFuncs.verticalLayout1,
      ...katexFuncs.overlap1,
      ...katexFuncs.spacing1,
      ...katexFuncs.logicAndSetTheory1,
      ...katexFuncs.mathOperators1,
      ...katexFuncs.sqrt1,
      ...katexFuncs.extensibleArrows1,
      ...katexFuncs.font1,
      ...katexFuncs.braketNotation1,
      ...katexFuncs.classAssignment1,
    ]),
  );

  for (const cmd of c2) {
    if (typeof snippetCompletion === "function") {
      items.push(
        snippetCompletion(`\\${cmd}{\${1}}`, {
          label: "\\" + cmd,
          type: "function",
          detail: "{…}",
        }),
      );
    } else {
      items.push({
        label: "\\" + cmd,
        type: "function",
        apply: `\\${cmd}{}`,
      });
    }
  }

  // \cmd{${1}}{${2}} (2 args)
  const c3 = Array.from(
    new Set([
      ...katexFuncs.verticalLayout2,
      ...katexFuncs.binomialCoefficients2,
      ...katexFuncs.fractions2,
      ...katexFuncs.color2,
    ]),
  );

  for (const cmd of c3) {
    if (typeof snippetCompletion === "function") {
      items.push(
        snippetCompletion(`\\${cmd}{\${1}}{\${2}}`, {
          label: "\\" + cmd,
          type: "function",
          detail: "{…}{…}",
        }),
      );
    } else {
      items.push({
        label: "\\" + cmd,
        type: "function",
        apply: `\\${cmd}{}{}`,
      });
    }
  }

  // \begin{env}...\end{env}
  if (typeof snippetCompletion === "function") {
    for (const env of katexFuncs.envs) {
      items.push(
        snippetCompletion(`\\begin{${env}}\n\t\${1}\n\\end{${env}}`, {
          label: `\\begin{${env}}`,
          type: "keyword",
          detail: "KaTeX environment",
        }),
      );
    }
  }

  // Custom macros from settings
  const configMacros = configManager.get("katex.macros") || {};
  for (const [cmd, expansion] of Object.entries(configMacros)) {
    let numArgs = 0;
    for (let i = 1; i < 10; i++) {
      if (!String(expansion).includes(`#${i}`)) {
        numArgs = i - 1;
        break;
      }
    }
    const label = cmd.startsWith("\\") ? cmd : "\\" + cmd;
    if (numArgs > 0 && typeof snippetCompletion === "function") {
      const argsTemplate = [...Array(numArgs).keys()]
        .map((i) => `{\${${i + 1}}}`)
        .join("");
      items.push(
        snippetCompletion(`${label}${argsTemplate}`, {
          label,
          type: "function",
          detail: "Custom macro",
        }),
      );
    } else {
      items.push({
        label,
        type: "function",
        detail: "Custom macro",
        apply: label,
      });
    }
  }

  return items;
}

export function completeRefLinksFromText(
  docText: string,
  lineTextBefore: string,
  cursorOffset: number,
): CompletionResult | null {
  const refDefinitions = new Map<string, IReferenceDefinition>();

  Link_Label_Pattern.lastIndex = 0;
  for (const match of docText.matchAll(Link_Label_Pattern)) {
    const label = match[0]
      .replace(/^[ \t\r\n\f\v]+/, "")
      .replace(/[ \t\r\n\f\v]+$/, "");
    const normalized = label.toUpperCase();
    if (!refDefinitions.has(normalized)) {
      refDefinitions.set(normalized, { label, usageCount: 0 });
    }
  }

  if (refDefinitions.size === 0) return null;

  for (const crtLine of docText.split(/\r?\n/)) {
    const pattern = /\[([^\[\]]+?)\](?![(:\[])/g;
    for (const match of crtLine.matchAll(pattern)) {
      const record = refDefinitions.get(match[1].toUpperCase());
      if (record) record.usageCount++;
    }
  }

  const openBracketIdx = lineTextBefore.lastIndexOf("[");
  if (openBracketIdx < 0) return null;
  const typedLen = lineTextBefore.length - (openBracketIdx + 1);
  const from = cursorOffset - typedLen;

  const options: Completion[] = Array.from(refDefinitions.values()).map((ref) => ({
    label: ref.label,
    type: "variable",
    detail: ref.usageCount === 1 ? "1 usage" : `${ref.usageCount} usages`,
    boost: ref.usageCount === 0 ? 10 : 0,
  }));

  return {
    from,
    options,
    validFor: /^[^\[\]]*$/,
  };
}

export function completeHeadingLinksFromText(
  docText: string,
  lineTextBefore: string,
  lineTextAfter: string,
  cursorOffset: number,
  fileUri?: string,
  filename?: string,
): CompletionResult | null {
  const hashIndexInBefore = lineTextBefore.lastIndexOf("#");
  if (hashIndexInBefore < 0) return null;

  const isLinkRefDefinition = /^>? {0,3}\[[^\[\]]+?\]\:[ \t\f\v]*#[^#]*$/.test(
    lineTextBefore,
  );

  const from = cursorOffset - (lineTextBefore.length - hashIndexInBefore);
  let to = cursorOffset;
  let addClosingParen = false;

  if (/^([^\) ]+\s*|^\s*)\)/.test(lineTextAfter)) {
    to = cursorOffset + lineTextAfter.indexOf(")");
  } else {
    const trailingMatch = lineTextAfter.match(/^\S+/);
    if (trailingMatch) {
      to = cursorOffset + trailingMatch[0].length;
    }
    if (!isLinkRefDefinition) {
      addClosingParen = true;
    }
  }

  const toc = getAllTocEntriesFromText(docText, {
    respectMagicCommentOmit: false,
    respectProjectLevelOmit: false,
    fileUri,
    filename,
  });

  if (toc.length === 0) return null;

  const options: Completion[] = toc.map((heading) => {
    const label = "#" + heading.slug;
    return {
      label,
      type: "text",
      detail: heading.rawContent,
      apply: addClosingParen ? label + ")" : label,
    };
  });

  return {
    from,
    to,
    options,
  };
}

export function createMarkdownCompletionExtension() {
  const cm = getCM();
  let cachedMathItems: Completion[] | null = null;
  let cachedMacroJson = "";

  const getMathItems = (): Completion[] => {
    const macroJson = JSON.stringify(configManager.get("katex.macros") || {});
    if (!cachedMathItems || cachedMacroJson !== macroJson) {
      cachedMathItems = buildMathCompletions();
      cachedMacroJson = macroJson;
    }
    return cachedMathItems;
  };

  configManager.onChange((key) => {
    if (key === "katex.macros" || key === "math.enabled") {
      cachedMathItems = null;
    }
  });

  const completionSource = async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const { state, pos } = context;
    if (!isMarkdownState(state)) return null;

    const line = state.doc.lineAt(pos);
    const col = pos - line.from;
    const lineTextBefore = line.text.slice(0, col);
    const lineTextAfter = line.text.slice(col);

    // 1. KaTeX Math completions (`\cmd`)
    if (configManager.get("math.enabled")) {
      const slashMatch = lineTextBefore.match(/(\\+)([a-zA-Z]*)$/);
      if (slashMatch && slashMatch[1].length % 2 === 1) {
        const slashPos = pos - slashMatch[2].length;
        if (mathEnvCheckState(state, slashPos) !== "") {
          return {
            from: slashPos - 1,
            options: getMathItems(),
            validFor: /^\\[a-zA-Z]*$/,
          };
        }
      }
    }

    // 2. Reference link labels `[ref`
    if (/\[[^\[\]]*$/.test(lineTextBefore)) {
      const res = completeRefLinksFromText(
        state.doc.toString(),
        lineTextBefore,
        pos,
      );
      if (res) return res;
    }

    if (!configManager.get("completion.enabled")) {
      return null;
    }

    const file = getFileForState(state);

    // 3. Links to headings `[text](#...` or `[ref]: #...`
    if (
      /\[[^\[\]]*?\]\(#[^#\)]*$/.test(lineTextBefore) ||
      /^>? {0,3}\[[^\[\]]+?\]\:[ \t\f\v]*#[^#]*$/.test(lineTextBefore)
    ) {
      return completeHeadingLinksFromText(
        state.doc.toString(),
        lineTextBefore,
        lineTextAfter,
        pos,
        file?.uri,
        file?.filename,
      );
    }

    // 4. Image paths `![](...` or `<img src="...`
    const isImgMarkdown = /!\[[^\]]*?\]\([^\)]*$/.test(lineTextBefore);
    const isImgHtml = /<img [^>]*src="[^"]*$/.test(lineTextBefore);
    if (isImgMarkdown || isImgHtml) {
      const typedDir = isImgMarkdown
        ? lineTextBefore.slice(lineTextBefore.lastIndexOf("](") + 2)
        : lineTextBefore.slice(lineTextBefore.lastIndexOf('="') + 2);

      const ws = await resolveWorkspaceFiles(file?.uri);
      if (!ws) return null;

      const isRooted = typedDir.startsWith("/");
      const baseDir = isRooted
        ? ws.workspaceRootUrl
        : ws.docDirUrl;

      const options: Completion[] = [];
      for (const relFromRoot of ws.files) {
        const ext = relFromRoot.split(".").pop()?.toLowerCase() || "";
        if (!IMAGE_EXTENSIONS.has(ext)) continue;

        const fullTarget = ws.workspaceRootUrl + "/" + relFromRoot;
        const relLabel = computeRelativePosixPath(baseDir, fullTarget).replace(
          / /g,
          "%20",
        );
        if (isRooted && relLabel.startsWith("..")) continue;

        options.push({
          label: isRooted ? "/" + relLabel : relLabel,
          type: "text",
          detail: "Image",
        });
      }

      return {
        from: pos - typedDir.length,
        options,
      };
    }

    // 5. General file paths `[text](...` or `[ref]: ...`
    if (/\[[^\[\]]*?\](?:(?:\([^\)]*)|(?:\:[ \t\f\v]*\S*))$/.test(lineTextBefore)) {
      const m = lineTextBefore.match(/(?<=((?:\]\()|(?:\]\:))[ \t\f\v]*)\S*$/);
      if (!m) return null;
      const typedDir = m[0];
      if (typedDir.startsWith("http://") || typedDir.startsWith("https://")) {
        return null;
      }

      const ws = await resolveWorkspaceFiles(file?.uri);
      if (!ws) return null;

      const isRooted = typedDir.startsWith("/");
      const baseDir = isRooted ? ws.workspaceRootUrl : ws.docDirUrl;

      const options: Completion[] = [];
      for (const relFromRoot of ws.files) {
        const fullTarget = ws.workspaceRootUrl + "/" + relFromRoot;
        const relLabel = computeRelativePosixPath(baseDir, fullTarget).replace(
          / /g,
          "%20",
        );
        if (isRooted && relLabel.startsWith("..")) continue;

        options.push({
          label: isRooted ? "/" + relLabel : relLabel,
          type: "text",
          detail: "File",
        });
      }

      return {
        from: pos - typedDir.length,
        options,
      };
    }

    return null;
  };

  return cm.state.EditorState.languageData.of(() => [
    { autocomplete: completionSource },
  ]);
}
