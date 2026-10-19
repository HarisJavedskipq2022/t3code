import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import "./splitView.css";
import { ComposerHandleContext, useComposerHandleContext } from "../../composerHandleContext";
import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../../hooks/useLocalStorage";
import { useResizeDrag } from "../../hooks/useResizeDrag";
import { resolveShortcutCommand } from "../../keybindings";
import { cn } from "../../lib/utils";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { observeResize } from "../../lib/observeResize";
import { useQuietThreadShell, useThreadShells } from "../../state/entities";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useEnvironmentShellStatus } from "../../state/shell";
import { buildThreadRouteParams, isThreadRouteSnapshotAuthoritative } from "../../threadRoutes";
import ChatView from "../ChatView";
import type { ChatComposerHandle } from "../chat/ChatComposer";
import { SPLIT_PANE_COLOR, type SplitPaneEmbedding } from "./SplitPaneHeader";
import {
  resolveSplitOpenTarget,
  type SplitPane,
  useSplitSecondaryRef,
  useSplitViewStore,
} from "./splitViewStore";

// Below this each pane's composer overflows.
const SPLIT_PANE_MIN_WIDTH = 360;
const SPLIT_WIDTH_STORAGE_KEY = "t3code:chat-split-width";
const SPLIT_WIDTH_PROPERTY = "--split-width";

/**
 * Lays the route thread out beside a second thread. The primary pane is always
 * wrapped, split or not, so opening and closing the split never remounts it.
 */
export function SplitChatLayout(props: {
  primaryThreadRef: ScopedThreadRef | null;
  children: ReactNode;
}) {
  const { primaryThreadRef } = props;
  const navigate = useNavigate();
  const primaryThreadKey = primaryThreadRef ? scopedThreadKey(primaryThreadRef) : null;
  const secondaryRef = useSplitSecondaryRef();
  const secondaryKey = secondaryRef ? scopedThreadKey(secondaryRef) : null;
  const focusedPane = useSplitViewStore((state) => state.focusedPane);
  const visible = useSplitViewStore((state) => state.visible);
  const openSecondary = useSplitViewStore((state) => state.openSecondary);
  const closeSecondary = useSplitViewStore((state) => state.closeSecondary);
  const focusPane = useSplitViewStore((state) => state.focusPane);
  const setVisible = useSplitViewStore((state) => state.setVisible);
  useSecondaryThreadLifecycle({ primaryThreadRef, secondaryRef });
  const rowRef = useRef<HTMLDivElement>(null);

  // The split only shows when both panes fit.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => setVisible(row.clientWidth >= SPLIT_PANE_MIN_WIDTH * 2);
    measure();
    return observeResize(row, measure);
  }, [setVisible]);

  const showSplit =
    visible && secondaryRef !== null && secondaryKey !== null && secondaryKey !== primaryThreadKey;
  const { storedWidth, dividerHandlers, resetWidth } = useSplitWidth(rowRef);
  const primaryComposerRef = useComposerHandleContext();
  const secondaryComposerRef = useRef<ChatComposerHandle | null>(null);
  useSplitShortcuts({ primaryThreadKey, showSplit, primaryComposerRef, secondaryComposerRef });

  const navigateToThread = (ref: ScopedThreadRef) =>
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  const embedding: SplitPaneEmbedding | null = secondaryRef
    ? {
        onSwap: () => {
          if (primaryThreadRef) openSecondary(primaryThreadRef, { focus: false });
          focusPane("primary");
          navigateToThread(secondaryRef);
        },
        onOpenAsMain: () => {
          closeSecondary();
          navigateToThread(secondaryRef);
        },
        onClose: closeSecondary,
      }
    : null;

  const paneProps = (pane: SplitPane) => {
    const takeKeyboard = () => {
      if (showSplit) focusPane(pane);
    };
    return {
      "data-split-pane": pane,
      ...(showSplit ? { "data-split-shown": "" } : {}),
      ...(showSplit && focusedPane !== pane ? { "data-split-pane-unfocused": "" } : {}),
      onPointerDownCapture: takeKeyboard,
      onFocusCapture: takeKeyboard,
    };
  };

  return (
    <div
      ref={rowRef}
      className="relative flex min-h-0 min-w-0 flex-1"
      style={
        {
          "--split-base-controls-right": "var(--workspace-controls-right, 0px)",
          ...(storedWidth === null ? {} : { [SPLIT_WIDTH_PROPERTY]: `${storedWidth}px` }),
        } as CSSProperties
      }
    >
      <div
        {...paneProps("primary")}
        className="relative flex min-h-0 min-w-0 flex-1"
        style={
          showSplit
            ? ({
                // The route thread's panel controls are fixed to the window's top
                // right; keep them over this pane instead of the second one.
                "--workspace-controls-right": `calc(var(--split-base-controls-right) + ${SPLIT_PANE_WIDTH_CSS})`,
              } as CSSProperties)
            : undefined
        }
      >
        {props.children}
        {showSplit ? <SplitPaneFrame pane="primary" focused={focusedPane === "primary"} /> : null}
      </div>
      {showSplit && embedding ? (
        <div
          {...paneProps("secondary")}
          className="relative flex min-h-0 shrink-0 border-l border-border"
          style={{ width: SPLIT_PANE_WIDTH_CSS }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize split view"
            className="group absolute inset-y-0 -left-1 z-40 w-2 cursor-col-resize select-none"
            onDoubleClick={resetWidth}
            {...dividerHandlers}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-border group-active:bg-primary/60"
            />
          </div>
          <ComposerHandleContext value={secondaryComposerRef}>
            <ChatView
              key={secondaryKey}
              environmentId={secondaryRef.environmentId}
              threadId={secondaryRef.threadId}
              routeKind="server"
              splitPane={embedding}
            />
          </ComposerHandleContext>
          <SplitPaneFrame pane="secondary" focused={focusedPane === "secondary"} />
        </div>
      ) : null}
    </div>
  );
}

const SPLIT_PANE_WIDTH_CSS = `clamp(${SPLIT_PANE_MIN_WIDTH}px, var(${SPLIT_WIDTH_PROPERTY}, 50%), calc(100% - ${SPLIT_PANE_MIN_WIDTH}px))`;

function SplitPaneFrame(props: { pane: SplitPane; focused: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-30 border-2 transition-opacity duration-150",
        SPLIT_PANE_COLOR[props.pane].border,
        props.focused ? "opacity-90" : "opacity-25",
      )}
    />
  );
}

const SplitWidthSchema = Schema.Finite;

/** The second pane's width in px, or null for an even split. */
function useSplitWidth(rowRef: React.RefObject<HTMLDivElement | null>) {
  const [storedWidth, setStoredWidth] = useState<number | null>(() => {
    try {
      return getLocalStorageItem(SPLIT_WIDTH_STORAGE_KEY, SplitWidthSchema);
    } catch {
      return null;
    }
  });
  const { refresh: _refresh, ...dividerHandlers } = useResizeDrag<HTMLElement>((event) => {
    const row = rowRef.current;
    const pane = event.currentTarget.parentElement;
    if (!row || !pane) return null;
    const clamp = (value: number) =>
      Math.max(
        SPLIT_PANE_MIN_WIDTH,
        Math.min(row.clientWidth - SPLIT_PANE_MIN_WIDTH, Math.round(value)),
      );
    return {
      width: pane.getBoundingClientRect().width,
      edge: "left",
      resize(value) {
        const width = clamp(value);
        row.style.setProperty(SPLIT_WIDTH_PROPERTY, `${width}px`);
        return width;
      },
      finish(width, moved) {
        if (!moved) return;
        setStoredWidth(width);
        try {
          setLocalStorageItem(SPLIT_WIDTH_STORAGE_KEY, width, SplitWidthSchema);
        } catch {
          // A width that can't persist still applies for this session.
        }
      },
      cleanup(committed) {
        if (committed) return;
        if (storedWidth === null) row.style.removeProperty(SPLIT_WIDTH_PROPERTY);
        else row.style.setProperty(SPLIT_WIDTH_PROPERTY, `${storedWidth}px`);
      },
    };
  });
  const resetWidth = () => {
    rowRef.current?.style.removeProperty(SPLIT_WIDTH_PROPERTY);
    setStoredWidth(null);
    removeLocalStorageItem(SPLIT_WIDTH_STORAGE_KEY);
  };
  return { storedWidth, dividerHandlers, resetWidth };
}

/**
 * Keeps the second pane pointing at a real thread: it closes when its thread is
 * gone, and when the route moves onto it the two panes swap.
 */
function useSecondaryThreadLifecycle(input: {
  primaryThreadRef: ScopedThreadRef | null;
  secondaryRef: ScopedThreadRef | null;
}) {
  const { primaryThreadRef, secondaryRef } = input;
  const closeSecondary = useSplitViewStore((state) => state.closeSecondary);
  const openSecondary = useSplitViewStore((state) => state.openSecondary);
  const secondaryShell = useQuietThreadShell(secondaryRef);
  const shellStatus = useEnvironmentShellStatus(secondaryRef?.environmentId ?? null);
  const secondaryGone =
    secondaryRef !== null &&
    isThreadRouteSnapshotAuthoritative(shellStatus) &&
    (secondaryShell === null || secondaryShell.deletedAt != null);
  useEffect(() => {
    if (secondaryGone) closeSecondary();
  }, [closeSecondary, secondaryGone]);

  const primaryKey = primaryThreadRef ? scopedThreadKey(primaryThreadRef) : null;
  const secondaryKey = secondaryRef ? scopedThreadKey(secondaryRef) : null;
  const previousPrimary = useRef<ScopedThreadRef | null>(null);
  useEffect(() => {
    const previous = previousPrimary.current;
    if (
      primaryKey !== null &&
      primaryKey === secondaryKey &&
      previous !== null &&
      scopedThreadKey(previous) !== primaryKey
    ) {
      openSecondary(previous, { focus: false });
    }
    previousPrimary.current = primaryThreadRef;
  }, [openSecondary, primaryKey, primaryThreadRef, secondaryKey]);
}

/** ⌘\ opens or closes the split, ⌥⌘\ moves the keyboard to the other pane. */
function useSplitShortcuts(input: {
  primaryThreadKey: string | null;
  showSplit: boolean;
  primaryComposerRef: React.RefObject<ChatComposerHandle | null> | null;
  secondaryComposerRef: React.RefObject<ChatComposerHandle | null>;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const threads = useThreadShells();
  const latest = useRef(input);
  const latestThreads = useRef(threads);
  useLayoutEffect(() => {
    latest.current = input;
    latestThreads.current = threads;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused() },
      });
      if (command !== "chat.split.toggle" && command !== "chat.split.focusOther") return;
      const { primaryThreadKey, showSplit, primaryComposerRef, secondaryComposerRef } =
        latest.current;
      const store = useSplitViewStore.getState();
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (command === "chat.split.focusOther") {
        if (!showSplit) return;
        const next: SplitPane = store.focusedPane === "primary" ? "secondary" : "primary";
        store.focusPane(next);
        (next === "primary" ? primaryComposerRef : secondaryComposerRef)?.current?.focusAtEnd();
        return;
      }
      if (store.secondaryThreadKey !== null) {
        store.closeSecondary();
        primaryComposerRef?.current?.focusAtEnd();
        return;
      }
      if (primaryThreadKey === null) return;
      const targetKey = resolveSplitOpenTarget({
        primaryThreadKey,
        lastSecondaryThreadKey: store.lastSecondaryThreadKey,
        candidates: latestThreads.current
          .filter((thread) => thread.archivedAt === null)
          .map((thread) => ({
            key: scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
            updatedAt: thread.updatedAt,
          })),
      });
      const target = latestThreads.current.find(
        (thread) =>
          scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }) ===
          targetKey,
      );
      if (target) store.openSecondary({ environmentId: target.environmentId, threadId: target.id });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);
}
