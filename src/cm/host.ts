import type { Compartment, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  getCM,
  getEditorManager,
  isMarkdownState,
  syncViewSession,
} from "./runtime";
import { configManager } from "../config";
import { createMarkdownCompletionExtension } from "../features/completion";
import { createMarkdownDecorationsExtension } from "../features/decorations";
import {
  createSmartPasteTransactionFilter,
  trySmartPasteLink,
} from "../features/formatting";
import {
  handleMarkdownBackspace,
  handleMarkdownEnter,
  handleMarkdownTab,
} from "../features/listEditing";
import { createTocCodeLensExtension } from "../features/toc";

const EDITOR_EVENTS = [
  "switch-file",
  "file-loaded",
  "new-file",
  "rename-file",
  "update",
  "file-content-changed",
  "editor-state-changed",
  "update:read-only",
] as const;

const INTERACTION_EVENTS = [
  "focusin",
  "pointerdown",
  "beforeinput",
  "keydown",
] as const;
const RECONCILE_DELAYS = [0, 50, 250] as const;

interface ManagedCompartment {
  name: string;
  compartment: Compartment;
  build: () => Extension;
  extension: Extension;
}

/**
 * Manages CodeMirror 6 extensions across all Acode editor panes using isolated
 * Compartments so core editing (lists, smart paste) can never be blocked if
 * optional visual decorations encounter renderer differences (e.g. CanvasView).
 */
export class CodeMirrorMarkdownHost {
  private managed: ManagedCompartment[] = [];
  private destroyed = false;
  private installedViews = new Set<EditorView>();
  private reconcileTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private unsubscribeConfig: (() => void) | null = null;

  private readonly onEditorEventBound = (candidate?: any) =>
    this.scheduleReconcile(candidate);
  private readonly onInteractionBound = (event: Event) =>
    this.onInteraction(event);

  public activate(): void {
    const cm = getCM();

    const buildCore = (): Extension => {
      const { Prec } = cm.state;
      const { EditorView: CMEditorView, keymap } = cm.view;

      const listKeymap = Prec.high(
        keymap.of([
          {
            key: "Enter",
            run: (view) => handleMarkdownEnter(view),
          },
          {
            key: "Mod-Enter",
            run: (view) => handleMarkdownEnter(view, "ctrl"),
          },
          {
            key: "Shift-Enter",
            run: (view) => handleMarkdownEnter(view, "shift"),
          },
          {
            key: "Tab",
            run: (view) => handleMarkdownTab(view),
          },
          {
            key: "Shift-Tab",
            run: (view) => handleMarkdownTab(view, "shift"),
          },
          {
            key: "Backspace",
            run: (view) => handleMarkdownBackspace(view),
          },
        ]),
      );

      const smartPasteDomHandler = CMEditorView.domEventHandlers({
        paste(event: ClipboardEvent, view: EditorView) {
          if (!isMarkdownState(view.state)) return false;
          const clipText = event.clipboardData?.getData("text/plain");
          if (clipText && trySmartPasteLink(view, clipText)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
      });

      return [listKeymap, createSmartPasteTransactionFilter(), smartPasteDomHandler];
    };

    const buildCompletion = (): Extension => createMarkdownCompletionExtension();

    const buildDecorations = (): Extension => [
      createMarkdownDecorationsExtension(),
      createTocCodeLensExtension(),
    ];

    this.managed = [
      {
        name: "core",
        compartment: new cm.state.Compartment(),
        build: buildCore,
        extension: buildCore(),
      },
      {
        name: "completion",
        compartment: new cm.state.Compartment(),
        build: buildCompletion,
        extension: buildCompletion(),
      },
      {
        name: "decorations",
        compartment: new cm.state.Compartment(),
        build: buildDecorations,
        extension: buildDecorations(),
      },
    ];

    const em = getEditorManager();
    if (em) {
      for (const evt of EDITOR_EVENTS) {
        try {
          em.on(evt, this.onEditorEventBound);
        } catch {
          // Ignore unsupported event names on older builds
        }
      }
    }

    if (typeof document !== "undefined") {
      for (const evt of INTERACTION_EVENTS) {
        document.addEventListener(evt, this.onInteractionBound, true);
      }
    }

    this.unsubscribeConfig = configManager.onChange((key) => {
      if (
        key.startsWith("theming.decoration.") ||
        key === "syntax.decorationFileSizeLimit" ||
        key === "extraLangIds" ||
        key === "toc.slugifyMode" ||
        key === "toc.levels"
      ) {
        this.reconfigureDecorations();
      }
    });

    this.reconcileEditors();
  }

  private getVisibleEditors(): EditorView[] {
    const em = getEditorManager();
    if (!em) return [];
    const views: EditorView[] = [];
    for (const pane of em.panes || []) {
      if (pane?.editor) views.push(pane.editor);
    }
    if (em.editor) views.push(em.editor);
    return Array.from(new Set(views));
  }

  private getViewForEvent(event: Event): EditorView | null {
    const path =
      typeof event.composedPath === "function"
        ? event.composedPath()
        : [event.target];
    for (const view of this.getVisibleEditors()) {
      for (const el of path) {
        if (
          el &&
          (el === view.dom ||
            el === view.contentDOM ||
            (typeof (el as Node).nodeType === "number" &&
              view.dom?.contains(el as Node)))
        ) {
          return view;
        }
      }
    }
    return null;
  }

  private onInteraction(event: Event): void {
    const view = this.getViewForEvent(event);
    if (view) {
      this.installInEditor(view);
    }
  }

  public scheduleReconcile(candidate?: any): void {
    this.reconcileEditors(candidate);
    for (const ms of RECONCILE_DELAYS) {
      const existing = this.reconcileTimers.get(ms);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.reconcileTimers.delete(ms);
        if (!this.destroyed) {
          this.reconcileEditors();
        }
      }, ms);
      this.reconcileTimers.set(ms, timer);
    }
  }

  public reconcileEditors(candidate?: any): void {
    if (candidate?.state && candidate?.dispatch) {
      this.installInEditor(candidate as EditorView);
    }
    for (const view of this.getVisibleEditors()) {
      this.installInEditor(view);
    }
  }

  public installInEditor(view: EditorView): boolean {
    if (!view?.state) return false;
    const cm = getCM();
    let changed = false;

    for (const entry of this.managed) {
      if (entry.compartment.get(view.state) !== undefined) continue;
      try {
        view.dispatch({
          effects: cm.state.StateEffect.appendConfig.of(
            entry.compartment.of(entry.extension),
          ),
        });
        changed = true;
      } catch (err) {
        console.warn(
          `[MarkdownAllInOne] Failed to install CM6 compartment "${entry.name}":`,
          err,
        );
      }
    }

    this.installedViews.add(view);
    if (changed) {
      syncViewSession(view);
    }
    return changed;
  }

  public reconfigureDecorations(): void {
    const decorEntry = this.managed.find((m) => m.name === "decorations");
    if (!decorEntry) return;
    decorEntry.extension = decorEntry.build();

    const views = new Set([...this.installedViews, ...this.getVisibleEditors()]);
    for (const view of views) {
      if (!view?.state || decorEntry.compartment.get(view.state) === undefined) {
        continue;
      }
      try {
        view.dispatch({
          effects: decorEntry.compartment.reconfigure(decorEntry.extension),
        });
        syncViewSession(view);
      } catch {
        // Ignore destroyed split-pane views
      }
    }
  }

  public dispose(): void {
    this.destroyed = true;
    for (const timer of this.reconcileTimers.values()) {
      clearTimeout(timer);
    }
    this.reconcileTimers.clear();
    this.unsubscribeConfig?.();
    this.unsubscribeConfig = null;

    const em = getEditorManager();
    if (em) {
      for (const evt of EDITOR_EVENTS) {
        try {
          em.off(evt, this.onEditorEventBound);
        } catch {
          // Ignore
        }
      }
    }

    if (typeof document !== "undefined") {
      for (const evt of INTERACTION_EVENTS) {
        document.removeEventListener(evt, this.onInteractionBound, true);
      }
    }

    const views = new Set([...this.installedViews, ...this.getVisibleEditors()]);
    for (const view of views) {
      if (!view?.state) continue;
      const effects = this.managed
        .filter((e) => e.compartment.get(view.state) !== undefined)
        .map((e) => e.compartment.reconfigure([]));
      if (effects.length === 0) continue;
      try {
        view.dispatch({ effects });
        syncViewSession(view);
      } catch {
        // View may already be destroyed
      }
    }
    this.installedViews.clear();

    for (const file of em?.files || []) {
      if (file?.type && file.type !== "editor") continue;
      const rawState = file?.session?.__rawState || file?.session;
      if (!rawState || typeof rawState.update !== "function") continue;
      const effects = this.managed
        .filter((e) => e.compartment.get(rawState) !== undefined)
        .map((e) => e.compartment.reconfigure([]));
      if (effects.length === 0) continue;
      try {
        file.session = rawState.update({ effects }).state;
      } catch {
        // Ignore
      }
    }
  }
}
