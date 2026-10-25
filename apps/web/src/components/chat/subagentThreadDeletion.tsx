import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  isParentThreadRelationship,
  type ThreadRelationshipWalkRow,
} from "@t3tools/client-runtime/state/thread-relationships";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { LoaderCircleIcon, Trash2Icon } from "lucide-react";

import { useThreadActions } from "../../hooks/useThreadActions";
import type { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { readThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { ThreadDetailsControl } from "./ThreadDetailsControl";

/**
 * Subagent threads have no sidebar row, so a stopped one is deleted from its parent's panel,
 * and a deleted child's row leaves the panel with it. Shares the panel's busy row so a delete
 * and a stop never run at once.
 */
export function useSubagentThreadDeletion(input: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  archived: ReturnType<typeof useArchivedThreadSnapshots>;
  stoppingId: string | null;
  setStoppingId: (id: string | null) => void;
}) {
  const { environmentId, stoppingId, setStoppingId } = input;
  const { confirmAndDeleteThread } = useThreadActions();
  const canOperateThreads = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const archivedShells = input.archived.snapshots.find(
    (entry) => entry.environmentId === environmentId,
  )?.snapshot.threads;
  // A thread with neither a live nor an archived shell was deleted, but only once the
  // archive has loaded. A refresh keeps the previous snapshot, so it does not reopen this.
  const absentThreadsAreDeleted = archivedShells !== undefined && input.archived.error === null;

  const hideDeleted = (
    rows: ReadonlyArray<ThreadRelationshipWalkRow>,
    graph: { readonly nodes: ReadonlyMap<ThreadId, { readonly missing: boolean }> },
  ) =>
    absentThreadsAreDeleted
      ? rows.filter(
          (row) =>
            // The parent's task record outlives a deleted child thread; the row should not.
            !(
              row.edge.kind === "subagent" &&
              !isParentThreadRelationship(row.edge, input.threadId) &&
              graph.nodes.get(row.threadId)?.missing
            ),
        )
      : rows;

  // Only a stopped child: a running one is still doing its parent's work.
  const canDelete = (
    agent: { readonly origin: string; readonly status: string } | null | undefined,
    hasThread: boolean,
  ) =>
    canOperateThreads &&
    agent?.origin === "app_owned" &&
    hasThread &&
    ["failed", "cancelled", "interrupted"].includes(agent.status);

  const deleteThread = async (childThreadId: ThreadId) => {
    if (stoppingId !== null) return;
    setStoppingId(childThreadId);
    const childRef = scopeThreadRef(environmentId, childThreadId);
    const result = await confirmAndDeleteThread(childRef);
    setStoppingId(null);
    // With the thread already gone, the failure was worktree cleanup, which deleteThread reports.
    if (
      result._tag === "Failure" &&
      !isAtomCommandInterrupted(result) &&
      readThreadShell(childRef) !== null
    ) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Failed to delete thread",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };

  const button = (row: { show: boolean; threadId: ThreadId; threadTitle: string }) =>
    row.show ? (
      <div className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                size="icon-xs"
                variant="ghost"
                part="icon"
                tone="destructive"
                aria-label={`Delete thread ${row.threadTitle}`}
                disabled={stoppingId !== null}
                onClick={() => void deleteThread(row.threadId)}
              />
            }
          >
            {stoppingId === row.threadId ? (
              <LoaderCircleIcon aria-hidden className="size-3 animate-spin" />
            ) : (
              <Trash2Icon aria-hidden className="size-3" />
            )}
          </TooltipTrigger>
          <TooltipPopup side="left">Delete thread</TooltipPopup>
        </Tooltip>
      </div>
    ) : null;

  return { hideDeleted, canDelete, button };
}
