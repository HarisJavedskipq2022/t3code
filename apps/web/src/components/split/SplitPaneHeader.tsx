import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import { ArrowLeftRightIcon, Maximize2Icon, XIcon } from "lucide-react";

import { shortcutLabelForCommand } from "../../keybindings";
import { cn } from "../../lib/utils";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useProjects, useQuietThreadShell } from "../../state/entities";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { type SplitPane, useSplitPaneOfThread } from "./splitViewStore";

/** What the second pane's chat view needs from the split around it. */
export interface SplitPaneEmbedding {
  readonly onSwap: () => void;
  readonly onOpenAsMain: () => void;
  readonly onClose: () => void;
}

// Each pane keeps one color everywhere it shows: its frame and its sidebar row.
export const SPLIT_PANE_COLOR: Record<SplitPane, { border: string; background: string }> = {
  primary: { border: "border-sky-500", background: "bg-sky-500" },
  secondary: { border: "border-violet-500", background: "bg-violet-500" },
};

export function SplitPaneHeader(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  pane: SplitPaneEmbedding | undefined;
}) {
  const { pane } = props;
  const thread = useQuietThreadShell(scopeThreadRef(props.environmentId, props.threadId));
  const project =
    useProjects().find(
      (candidate) =>
        candidate.environmentId === props.environmentId && candidate.id === thread?.projectId,
    ) ?? null;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const closeShortcut = shortcutLabelForCommand(keybindings, "chat.split.toggle");
  const actions = pane
    ? [
        { label: "Swap panes", icon: ArrowLeftRightIcon, run: pane.onSwap, shortcut: null },
        {
          label: "Open as main thread",
          icon: Maximize2Icon,
          run: pane.onOpenAsMain,
          shortcut: null,
        },
        { label: "Close split view", icon: XIcon, run: pane.onClose, shortcut: closeShortcut },
      ]
    : [];
  return (
    <header
      data-chat-header
      className="flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 bg-background pr-2 pl-4 wco:pr-(--workspace-native-controls-inset)"
    >
      {project ? <ProjectFavicon project={project} className="size-4 shrink-0" /> : null}
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm">
        {project ? <span className="shrink-0 text-muted-foreground">{project.title}</span> : null}
        {project ? <span className="shrink-0 text-muted-foreground/50">/</span> : null}
        <span className="min-w-0 truncate font-medium text-foreground">
          {thread?.title ?? "Thread"}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {actions.map((action) => (
          <Tooltip key={action.label}>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={action.label}
                  onClick={action.run}
                />
              }
            >
              <action.icon />
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
            </TooltipPopup>
          </Tooltip>
        ))}
      </div>
    </header>
  );
}

/** The colored edge on a sidebar row whose thread is open in a split pane. */
export function SplitPaneRowMarker(props: { threadKey: string; isRouteThread: boolean }) {
  const pane = useSplitPaneOfThread(props.threadKey, props.isRouteThread);
  if (pane === null) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-2 left-0 z-20 w-0.5 rounded-full",
        SPLIT_PANE_COLOR[pane].background,
      )}
    />
  );
}
