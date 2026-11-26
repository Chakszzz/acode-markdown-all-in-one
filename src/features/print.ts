import { encodeHTML } from "entities";
import githubBaseCss from "markdown-it-github-alerts/styles/github-base.css";
import githubDarkCss from "markdown-it-github-alerts/styles/github-colors-dark-media.css";
import githubLightCss from "markdown-it-github-alerts/styles/github-colors-light.css";
import {
  getActiveFile,
  getActiveView,
  getAddedFolders,
  getEditorManager,
  isMarkdownFile,
} from "../cm/runtime";
import { configManager } from "../config";
import { mdEngine } from "../engine/markdownEngine";
import type {
  AcodeEditorFile,
  AcodeFsFactory,
  AcodeLoaderModule,
  AcodeSelectFn,
  AcodeUrlModule,
} from "../types/acode-cm";

const CHECKBOX_CSS = `.task-list-item {
    list-style-type: none;
}
.task-list-item-checkbox {
    margin-left: -20px;
    vertical-align: middle;
    pointer-events: none;
}`;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function extractMarkdownTitle(docText: string): string | undefined {
  const firstNewline = docText.search(/\r?\n/);
  const firstLine = firstNewline === -1 ? docText : docText.slice(0, firstNewline);

  const commentMatch = /^<!-- title:(.*?)-->/.exec(firstLine);
  let title = commentMatch ? commentMatch[1].trim() : undefined;

  if (!title) {
    const headingLine = docText
      .split(/\n|\r/g)
      .find((lineText) => lineText.startsWith("#") && /^#{1,6} /.test(lineText));
    if (headingLine) {
      title = headingLine
        .replace(/<!--(.*?)-->/g, "")
        .trim()
        .replace(/^#+/, "")
        .replace(/#+$/, "")
        .trim();
    }
  }
  return title || undefined;
}

export function rewriteMdLinksToHtml(body: string): string {
  const hrefRegex = /(<a[^>]+href=")([^"]+)("[^>]*>)/g;
  return body.replace(hrefRegex, (full, g1: string, g2: string, g3: string) => {
    if (
      (g2.endsWith(".md") || g2.includes(".md#")) &&
      !(g2.includes("github.com") && g2.includes("blob"))
    ) {
      return `${g1}${g2.replace(/\.md$/, ".html").replace(/\.md#/, ".html#")}${g3}`;
    }
    return full;
  });
}

function buildStylesBlock(hasMath: boolean, includeBaseStyles: boolean): string {
  const katexCss =
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css">';
  const copyTeXCss =
    '<link href="https://cdn.jsdelivr.net/npm/katex-copytex@latest/dist/katex-copytex.min.css" rel="stylesheet" type="text/css">';
  const markdownCss =
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/Microsoft/vscode/extensions/markdown-language-features/media/markdown.css">';
  const highlightCss =
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/Microsoft/vscode/extensions/markdown-language-features/media/highlight.css">';

  let codeHighlightInline = "";
  if (typeof window !== "undefined" && (window as any).acode) {
    try {
      const ch = acode.require("codeHighlight") as any;
      const styles = ch?.getStyles?.();
      if (styles) {
        codeHighlightInline = `<style>\n${styles}\n</style>`;
      }
    } catch {
      // Optional
    }
  }

  return `${hasMath ? katexCss + "\n" + copyTeXCss : ""}
${includeBaseStyles ? markdownCss + "\n" + highlightCss + "\n" + codeHighlightInline : ""}
<style>
${CHECKBOX_CSS}
${githubLightCss}
${githubDarkCss}
${githubBaseCss}
</style>`;
}

export async function renderDocumentToExportHtml(
  docText: string,
  docUri?: string,
): Promise<string> {
  const title = extractMarkdownTitle(docText);
  let body = mdEngine.render(docText);

  const imgToBase64 = configManager.get("print.imgToBase64");
  const absImgPath = configManager.get("print.absoluteImgPath");
  const imgTagRegex = /(<img[^>]+src=")([^"]+)("[^>]*>)/g;

  if (
    (imgToBase64 || absImgPath) &&
    docUri &&
    typeof window !== "undefined" &&
    (window as any).acode
  ) {
    const fsFactory = acode.require("fs") as AcodeFsFactory;
    const urlMod = acode.require("url") as AcodeUrlModule;
    const docDir = urlMod.dirname(docUri);

    const matches = Array.from(body.matchAll(imgTagRegex));
    for (const m of matches) {
      const fullTag = m[0];
      const p1 = m[1];
      const src = m[2];
      const p3 = m[3];

      if (
        src.startsWith("http://") ||
        src.startsWith("https://") ||
        src.startsWith("data:")
      ) {
        continue;
      }

      const decodedSrc = src.replace(/%20/g, " ");
      const resolvedUrl = decodedSrc.startsWith("/")
        ? decodedSrc
        : urlMod.join(docDir, decodedSrc);

      if (imgToBase64) {
        try {
          let ext = urlMod.extname(resolvedUrl).replace(/^\./, "").toLowerCase();
          if (ext === "jpg") ext = "jpeg";
          else if (ext === "svg") ext = "svg+xml";

          const rawData = await fsFactory(resolvedUrl).readFile();
          const b64 =
            typeof rawData === "string"
              ? btoa(rawData)
              : arrayBufferToBase64(rawData);
          const newTag = `${p1}data:image/${ext || "png"};base64,${b64}${p3}`;
          body = body.replace(fullTag, newTag);
          continue;
        } catch {
          try {
            const toast = acode.require("toast");
            toast(`Unable to embed image: ${src}`, 2500);
          } catch {
            // Ignore
          }
        }
      }

      if (absImgPath) {
        const fileHref = resolvedUrl.startsWith("file://")
          ? resolvedUrl
          : `file:///${resolvedUrl.replace(/^\/+/, "")}`;
        body = body.replace(fullTag, `${p1}${fileHref}${p3}`);
      }
    }
  }

  body = rewriteMdLinksToHtml(body);

  if (configManager.get("print.pureHtml")) {
    return body;
  }

  const hasMath = docText.includes("$");
  const includeStyles = configManager.get("print.includeVscodeStylesheets");
  const themeKind = configManager.get("print.theme");
  const themeClass =
    themeKind === "light"
      ? "vscode-light"
      : themeKind === "dark"
        ? "vscode-dark"
        : "";

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title ? encodeHTML(title) : ""}</title>
    ${buildStylesBlock(hasMath, includeStyles)}
</head>
<body class="vscode-body ${themeClass}">
    ${body}
    ${hasMath ? '<script async src="https://cdn.jsdelivr.net/npm/katex-copytex@latest/dist/katex-copytex.min.js"></script>' : ""}
</body>
</html>`;
}

async function ensureDirRecursive(
  fsFactory: AcodeFsFactory,
  urlMod: AcodeUrlModule,
  baseDirUrl: string,
  relSubPath: string,
): Promise<string> {
  const parts = relSubPath
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  let currentUrl = baseDirUrl.replace(/\/+$/, "");

  for (const part of parts) {
    const nextUrl = urlMod.join(currentUrl, part);
    try {
      const exists = await fsFactory(nextUrl).exists();
      if (!exists) {
        await fsFactory(currentUrl).createDirectory(part);
      }
    } catch {
      try {
        await fsFactory(currentUrl).createDirectory(part);
      } catch {
        // Already exists or cannot create
      }
    }
    currentUrl = nextUrl;
  }

  return currentUrl;
}

async function writeHtmlFile(
  fsFactory: AcodeFsFactory,
  urlMod: AcodeUrlModule,
  dirUrl: string,
  htmlFilename: string,
  htmlContent: string,
): Promise<string> {
  const targetUrl = urlMod.join(dirUrl, htmlFilename);
  let exists = false;
  try {
    exists = await fsFactory(targetUrl).exists();
  } catch {
    exists = false;
  }

  if (exists) {
    await fsFactory(targetUrl).writeFile(htmlContent);
  } else {
    await fsFactory(dirUrl).createFile(htmlFilename, htmlContent);
  }
  return targetUrl;
}

export async function printCurrentDocumentToHtml(): Promise<void> {
  if (typeof window === "undefined" || !(window as any).acode) return;

  const toast = acode.require("toast");
  const loader = acode.require("loader");
  const fsFactory = acode.require("fs") as unknown as AcodeFsFactory;
  const urlMod = acode.require("url") as unknown as AcodeUrlModule;

  const file = getActiveFile();
  const view = getActiveView();

  if (!file || !view || !isMarkdownFile(file)) {
    toast("No active Markdown file to export.", 3000);
    return;
  }

  if (!file.uri) {
    toast("Please save the Markdown file before exporting to HTML.", 3000);
    return;
  }

  if (file.isUnsaved && file.save) {
    try {
      await file.save();
    } catch {
      // Continue with current editor state
    }
  }

  const baseName = file.filename || urlMod.basename(file.uri) || "document.md";
  const htmlFilename = baseName.replace(/\.\w+$/, ".html").endsWith(".html")
    ? baseName.replace(/\.\w+$/, ".html")
    : `${baseName}.html`;

  loader.showTitleLoader();

  try {
    const html = await renderDocumentToExportHtml(
      view.state.doc.toString(),
      file.uri,
    );
    const outDir = urlMod.dirname(file.uri);
    await writeHtmlFile(fsFactory, urlMod, outDir, htmlFilename, html);
    toast(`Exported ${htmlFilename}`, 2500);
  } catch (err: any) {
    const alert = acode.require("alert");
    alert("Export Failed", String(err?.message || err));
  } finally {
    loader.removeTitleLoader();
  }
}

async function collectMarkdownFiles(
  fsFactory: AcodeFsFactory,
  urlMod: AcodeUrlModule,
  dirUrl: string,
  relDir: string,
  results: Array<{ fileUrl: string; relDir: string; filename: string }>,
): Promise<void> {
  const entries = await fsFactory(dirUrl).lsDir();
  for (const entry of entries) {
    const name = entry.name || urlMod.basename(entry.url) || "";
    if (!name) continue;

    if (entry.isDirectory) {
      if (
        name === "node_modules" ||
        name === ".git" ||
        name === "bower_components" ||
        name === "out"
      ) {
        continue;
      }
      await collectMarkdownFiles(
        fsFactory,
        urlMod,
        entry.url,
        relDir ? `${relDir}/${name}` : name,
        results,
      );
    } else if (entry.isFile && /\.md$/i.test(name)) {
      results.push({ fileUrl: entry.url, relDir, filename: name });
    }
  }
}

export async function batchPrintToHtml(): Promise<void> {
  if (typeof window === "undefined" || !(window as any).acode) return;

  const select = acode.require("select") as unknown as AcodeSelectFn;
  const prompt = acode.require("prompt");
  const toast = acode.require("toast");
  const loader = acode.require("loader");
  const fsFactory = acode.require("fs") as unknown as AcodeFsFactory;
  const urlMod = acode.require("url") as unknown as AcodeUrlModule;

  const folders = getAddedFolders();
  let sourceFolderUrl = "";

  if (folders.length === 1) {
    sourceFolderUrl = folders[0].url;
  } else if (folders.length > 1) {
    try {
      sourceFolderUrl = await select(
        "Select Source Folder",
        folders.map((f) => ({
          value: f.url,
          text: f.title,
          fileIcon: { name: f.title, kind: "folder" as const },
        })),
        true,
      );
    } catch {
      return;
    }
  } else {
    try {
      const fileBrowser = acode.require("fileBrowser");
      const picked = await fileBrowser("folder", "Select Source Folder");
      sourceFolderUrl = picked?.url || "";
    } catch {
      return;
    }
  }

  if (!sourceFolderUrl) return;

  const outFolderName = await prompt("Output folder name (relative to source)", "out", "text", {
    required: true,
    placeholder: "out",
  });
  if (!outFolderName) return;

  let cancelled = false;
  loader.create("Batch Exporting HTML", "Scanning Markdown files...", {
    timeout: 120000,
    callback: () => {
      cancelled = true;
      toast("Batch export cancelled.", 3000);
    },
  });

  try {
    const mdFiles: Array<{ fileUrl: string; relDir: string; filename: string }> = [];
    await collectMarkdownFiles(fsFactory, urlMod, sourceFolderUrl, "", mdFiles);

    if (cancelled) return;
    if (mdFiles.length === 0) {
      toast("No .md files found in selected folder.", 3000);
      return;
    }

    const outBaseUrl = await ensureDirRecursive(
      fsFactory,
      urlMod,
      sourceFolderUrl,
      String(outFolderName).trim(),
    );

    let count = 0;
    for (const item of mdFiles) {
      if (cancelled) return;
      count++;
      const rawContent = await fsFactory(item.fileUrl).readFile("utf-8");
      const text =
        typeof rawContent === "string"
          ? rawContent
          : new TextDecoder("utf-8").decode(rawContent);

      const html = await renderDocumentToExportHtml(text, item.fileUrl);
      const targetDir = item.relDir
        ? await ensureDirRecursive(fsFactory, urlMod, outBaseUrl, item.relDir)
        : outBaseUrl;
      const htmlName = item.filename.replace(/\.md$/i, ".html");
      await writeHtmlFile(fsFactory, urlMod, targetDir, htmlName, html);
    }

    toast(`Exported ${mdFiles.length} Markdown file(s) to ${outFolderName}/`, 3500);
  } catch (err: any) {
    const alert = acode.require("alert");
    alert("Batch Export Failed", String(err?.message || err));
  } finally {
    loader.destroy();
  }
}

export class PrintOnSaveWatcher {
  private onSaveBound = this.onSave.bind(this);

  public activate(): void {
    getEditorManager()?.on("save-file", this.onSaveBound);
  }

  private onSave(file?: AcodeEditorFile): void {
    if (!configManager.get("print.onFileSave")) return;
    const target = file ?? getActiveFile();
    if (!isMarkdownFile(target)) return;
    if (target !== getActiveFile()) return;
    void printCurrentDocumentToHtml();
  }

  public dispose(): void {
    getEditorManager()?.off("save-file", this.onSaveBound);
  }
}
