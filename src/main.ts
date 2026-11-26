import plugin from "../plugin.json";
import { CodeMirrorMarkdownHost } from "./cm/host";
import { configManager } from "./config";
import { extendMarkdownIt, mdEngine } from "./engine/markdownEngine";
import { AutoPreviewService } from "./features/preview";
import { PrintOnSaveWatcher } from "./features/print";
import { TableFormatterService } from "./features/tableFormatter";
import { TocSaveWatcher } from "./features/toc";
import { NativeAcodeUiManager } from "./ui/nativeUi";

class AcodeMarkdownAllInOnePlugin {
  public baseUrl = "";

  private cmHost = new CodeMirrorMarkdownHost();
  private uiManager = new NativeAcodeUiManager();
  private tableFormatter = new TableFormatterService();
  private tocSaveWatcher = new TocSaveWatcher();
  private printSaveWatcher = new PrintOnSaveWatcher();
  private autoPreview = new AutoPreviewService();

  public async init(): Promise<void> {
    if (
      typeof window !== "undefined" &&
      (window as any).editorManager &&
      !(window as any).editorManager.isCodeMirror
    ) {
      try {
        const alert = acode.require("alert");
        alert(
          "Markdown All in One",
          "This plugin requires Acode with CodeMirror 6 (versionCode 1008+).",
        );
      } catch {
        console.error("Markdown All in One requires CodeMirror 6 Acode.");
      }
      return;
    }

    configManager.init();
    this.cmHost.activate();
    this.tableFormatter.activate();
    this.tocSaveWatcher.activate();
    this.printSaveWatcher.activate();
    this.autoPreview.activate();
    this.uiManager.activate();

    // Expose Markdown-It extender module so other Acode plugins can reuse it if desired
    acode.define("markdown-all-in-one", {
      extendMarkdownIt,
      render: (md: string) => mdEngine.render(md),
    });
  }

  public destroy(): void {
    this.uiManager.dispose();
    this.autoPreview.dispose();
    this.printSaveWatcher.dispose();
    this.tocSaveWatcher.dispose();
    this.tableFormatter.dispose();
    this.cmHost.dispose();
  }
}

if (typeof window !== "undefined" && window.acode) {
  const instance = new AcodeMarkdownAllInOnePlugin();
  configManager.init();

  acode.setPluginInit(
    plugin.id,
    async (baseUrl: string) => {
      instance.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
      await instance.init();
    },
    configManager.buildNativeSettingsUi() as any,
  );

  acode.setPluginUnmount(plugin.id, () => {
    instance.destroy();
  });
}

export { AcodeMarkdownAllInOnePlugin };
