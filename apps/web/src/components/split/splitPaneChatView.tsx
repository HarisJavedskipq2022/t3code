import type { EnvironmentId, ResolvedKeybindingsConfig, ThreadId } from "@t3tools/contracts";
import type { ComponentProps } from "react";

import { resolveShortcutCommand, type ShortcutMatchContext } from "../../keybindings";
import { ThreadDetailsPanel } from "../chat/ThreadDetailsPanel";
import { SplitPaneHeader, type SplitPaneEmbedding } from "./SplitPaneHeader";
import { type SplitPane, splitPaneShortcutOwnership } from "./splitViewStore";

export type { SplitPaneEmbedding } from "./SplitPaneHeader";
export { splitPaneHasKeyboard, splitPaneTakesEvent, useSplitPaneRole } from "./splitViewStore";

/*
 * Everything ChatView takes from the split view, in one import. Each wrapper takes
 * the upstream element's place so ChatView keeps its own markup and carries only call sites.
 */

/** ChatView's header, or the pane's own header when the view is the split's second pane. */
export function SplitAwareChatHeader({
  splitPane,
  environmentId,
  threadId,
  ...headerProps
}: ComponentProps<"header"> & {
  splitPane: SplitPaneEmbedding | undefined;
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  if (splitPane !== undefined) {
    return <SplitPaneHeader environmentId={environmentId} threadId={threadId} pane={splitPane} />;
  }
  return <header {...headerProps} />;
}

/** A side chat leaves the thread panel, and the shortcuts it registers, to the host thread. */
export function HostThreadDetailsPanel({
  embedded,
  ...panelProps
}: ComponentProps<typeof ThreadDetailsPanel> & { embedded: boolean }) {
  return embedded ? null : <ThreadDetailsPanel {...panelProps} />;
}

/** `useChatShortcuts` ownership for a chat view's pane of a split; empty without one. */
export function splitPaneChatShortcuts(
  role: SplitPane | null,
  keybindings: ResolvedKeybindingsConfig,
  getShortcutContext: (target: EventTarget | null) => Partial<ShortcutMatchContext>,
) {
  return splitPaneShortcutOwnership(role, (event) =>
    resolveShortcutCommand(event, keybindings, { context: getShortcutContext(event.target) }),
  );
}
