import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { KeybindingCommand, ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { chatViewOf, isInsideComposerFloatingLayer } from "../chat/composerEventScope";

export type SplitPane = "primary" | "secondary";

interface SplitViewState {
  /** The thread shown beside the route thread, or null when the split is closed. */
  readonly secondaryThreadKey: string | null;
  /** The last thread shown there, so reopening the split brings it back. */
  readonly lastSecondaryThreadKey: string | null;
  readonly focusedPane: SplitPane;
  /** False while the window is too narrow to show both panes. */
  readonly visible: boolean;
  readonly openSecondary: (ref: ScopedThreadRef, options?: { readonly focus?: boolean }) => void;
  readonly closeSecondary: () => void;
  readonly focusPane: (pane: SplitPane) => void;
  readonly setVisible: (visible: boolean) => void;
}

export const useSplitViewStore = create<SplitViewState>()(
  persist(
    (set) => ({
      secondaryThreadKey: null,
      lastSecondaryThreadKey: null,
      focusedPane: "primary",
      visible: false,
      openSecondary: (ref, options) => {
        const key = scopedThreadKey(ref);
        set((state) => ({
          secondaryThreadKey: key,
          lastSecondaryThreadKey: key,
          focusedPane: options?.focus === false ? state.focusedPane : "secondary",
        }));
      },
      closeSecondary: () => set({ secondaryThreadKey: null, focusedPane: "primary" }),
      focusPane: (pane) => set({ focusedPane: pane }),
      setVisible: (visible) =>
        set((state) => ({
          visible,
          focusedPane: visible ? state.focusedPane : "primary",
        })),
    }),
    {
      name: "t3code:split-view:v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        secondaryThreadKey: state.secondaryThreadKey,
        lastSecondaryThreadKey: state.lastSecondaryThreadKey,
      }),
    },
  ),
);

export function useSplitSecondaryRef(): ScopedThreadRef | null {
  const key = useSplitViewStore((state) => state.secondaryThreadKey);
  return key === null ? null : parseScopedThreadKey(key);
}

/** Which pane a split is showing a thread in, while both panes are on screen. */
export function useSplitPaneOfThread(threadKey: string, isRouteThread: boolean): SplitPane | null {
  return useSplitViewStore((state) => {
    if (!state.visible || state.secondaryThreadKey === null) return null;
    if (state.secondaryThreadKey === threadKey) return "secondary";
    return isRouteThread ? "primary" : null;
  });
}

/**
 * The pane a key or paste belongs to: the one holding the event's target, the
 * one whose composer menu is open, or else the one last clicked.
 */
export function splitPaneOf(target: EventTarget | null): SplitPane {
  if (isInsideComposerFloatingLayer(target)) {
    return chatViewOf(target) === null ? "primary" : "secondary";
  }
  const pane =
    target instanceof Element
      ? target.closest("[data-split-pane]")?.getAttribute("data-split-pane")
      : null;
  return pane === "primary" || pane === "secondary"
    ? pane
    : useSplitViewStore.getState().focusedPane;
}

/** The split role of a chat view, or null when it is the only one on screen. */
export function useSplitPaneRole(embedded: boolean): SplitPane | null {
  const splitShown = useSplitViewStore(
    (state) => state.visible && state.secondaryThreadKey !== null,
  );
  if (embedded) return "secondary";
  return splitShown ? "primary" : null;
}

/** Whether a window-level key or paste is this pane's to handle; always true without a split. */
export function splitPaneTakesEvent(event: Event, role: SplitPane | null): boolean {
  return role === null || splitPaneOf(event.target) === role;
}

/**
 * The thread to open when the split is toggled on: the last split thread if it
 * still exists, otherwise the most recently updated other thread.
 */
export function resolveSplitOpenTarget(input: {
  readonly primaryThreadKey: string;
  readonly lastSecondaryThreadKey: string | null;
  readonly candidates: readonly { readonly key: string; readonly updatedAt: string }[];
}): string | null {
  const { primaryThreadKey, lastSecondaryThreadKey, candidates } = input;
  if (
    lastSecondaryThreadKey !== null &&
    lastSecondaryThreadKey !== primaryThreadKey &&
    candidates.some((candidate) => candidate.key === lastSecondaryThreadKey)
  ) {
    return lastSecondaryThreadKey;
  }
  let latest: { readonly key: string; readonly updatedAt: string } | null = null;
  for (const candidate of candidates) {
    if (candidate.key === primaryThreadKey) continue;
    if (latest === null || candidate.updatedAt > latest.updatedAt) latest = candidate;
  }
  return latest?.key ?? null;
}

/** The keys a focused split pane runs itself; panel, terminal and diff keys act on the main pane. */
const SPLIT_PANE_OWN_COMMANDS: ReadonlySet<KeybindingCommand> = new Set([
  "thread.stop",
  "modelPicker.toggle",
  "composer.effort",
  "composer.increaseEffort",
  "composer.decreaseEffort",
  "composer.mode",
  "thread.steerQueuedMessage",
  "thread.editQueuedMessage",
]);

/** `useChatShortcuts` ownership for one pane of a split; empty without one. */
export function splitPaneShortcutOwnership(
  role: SplitPane | null,
  resolveCommand: (event: KeyboardEvent) => KeybindingCommand | null,
): {
  readonly claimsEvent?: (event: KeyboardEvent) => boolean;
  readonly runsCommand?: (command: KeybindingCommand) => boolean;
} {
  if (role === null) return {};
  if (role === "secondary") {
    return {
      claimsEvent: (event) => splitPaneOf(event.target) === "secondary",
      runsCommand: (command) => SPLIT_PANE_OWN_COMMANDS.has(command),
    };
  }
  return {
    claimsEvent: (event) => {
      if (splitPaneOf(event.target) === "primary") return true;
      const command = resolveCommand(event);
      return command !== null && !SPLIT_PANE_OWN_COMMANDS.has(command);
    },
  };
}

/**
 * A sidebar click while the second pane has the keyboard opens the thread
 * there. False when the route should take it as usual.
 */
export function openInFocusedSplitPane(
  threadRef: ScopedThreadRef,
  routeThreadKey: string | null,
): boolean {
  const state = useSplitViewStore.getState();
  if (!state.visible || state.secondaryThreadKey === null || state.focusedPane !== "secondary") {
    return false;
  }
  if (scopedThreadKey(threadRef) === routeThreadKey) state.focusPane("primary");
  else state.openSecondary(threadRef);
  return true;
}

/** Opens a thread beside the route thread; the route thread itself stays put. */
export function openThreadInSplit(threadRef: ScopedThreadRef, routeThreadKey: string | null) {
  if (scopedThreadKey(threadRef) === routeThreadKey) return;
  useSplitViewStore.getState().openSecondary(threadRef);
}

/** Whether a chat view may take keyboard focus on its own; always true without a split. */
export function splitPaneHasKeyboard(embedded: boolean): boolean {
  const state = useSplitViewStore.getState();
  if (embedded) return state.focusedPane === "secondary";
  const splitShown = state.visible && state.secondaryThreadKey !== null;
  return !splitShown || state.focusedPane === "primary";
}
