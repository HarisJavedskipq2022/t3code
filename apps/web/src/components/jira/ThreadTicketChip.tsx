import type {
  EnvironmentId,
  JiraTransition,
  ScopedThreadRef,
  ThreadId,
  ThreadLinkedTicket,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ArrowRightIcon, ChevronDownIcon, ExternalLinkIcon, UnlinkIcon } from "lucide-react";
import { useState } from "react";

import { readLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { formatEnvironmentQueryError } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { ComposerControl } from "../chat/ComposerControl";
import { useComposerMenuProps } from "../chat/composerEventScope";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TicketTypeMark } from "./TicketTypeMark";
import { useTicketDraft } from "./ticketDraftStore";
import { usePromptEnhancementStatus } from "../promptEnhancement/promptEnhancementStore";

type Transitions =
  | { readonly state: "idle" | "loading" }
  | {
      readonly state: "done";
      readonly status: string;
      readonly transitions: readonly JiraTransition[];
    }
  | { readonly state: "failed"; readonly detail: string };

function openTicket(url: string) {
  const api = readLocalApi();
  if (api) void api.shell.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

/** A sidebar row is one big link, so its chip only names the ticket. */
export function SidebarTicketChip({ ticket }: { readonly ticket: ThreadLinkedTicket }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border/70 px-1 text-3xs leading-4 text-muted-foreground" />
        }
      >
        <TicketTypeMark isBug={ticket.isBug === true} className="size-2" />
        {ticket.key}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {ticket.title ? `${ticket.key}: ${ticket.title}` : ticket.key}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * The ticket in the branch toolbar. A draft shows the branch it will start on;
 * a thread's menu moves the ticket through its workflow.
 */
export function ToolbarTicketChip({
  environmentId,
  ticket,
  threadRef,
  pendingBranch,
  enhancing = false,
  side = "top",
}: {
  readonly environmentId: EnvironmentId;
  readonly ticket: ThreadLinkedTicket;
  /** Null for a draft, which has nothing on the server to unlink yet. */
  readonly threadRef: ScopedThreadRef | null;
  readonly pendingBranch?: string | undefined;
  /** The draft's prompt is being rewritten and will be replaced unless edited first. */
  readonly enhancing?: boolean;
  readonly side?: "top" | "bottom";
}) {
  const menuProps = useComposerMenuProps();
  const getIssue = useAtomCommand(serverEnvironment.jiraGetIssue, { reportFailure: false });
  const listTransitions = useAtomCommand(serverEnvironment.jiraListTransitions, {
    reportFailure: false,
  });
  const transitionIssue = useAtomCommand(serverEnvironment.jiraTransitionIssue, {
    reportFailure: false,
  });
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, "unlink ticket");
  const [transitions, setTransitions] = useState<Transitions>({ state: "idle" });

  const load = async () => {
    setTransitions({ state: "loading" });
    const input = { key: ticket.key };
    const [issue, available] = await Promise.all([
      getIssue({ environmentId, input }),
      listTransitions({ environmentId, input }),
    ]);
    if (issue._tag !== "Success" || available._tag !== "Success") {
      const failed = issue._tag !== "Success" ? issue : available;
      setTransitions({
        state: "failed",
        detail: failed._tag === "Failure" ? formatEnvironmentQueryError(failed.cause) : "",
      });
      return;
    }
    setTransitions({
      state: "done",
      status: issue.value.status,
      transitions: available.value.transitions,
    });
  };

  const move = async (transition: JiraTransition) => {
    const result = await transitionIssue({
      environmentId,
      input: { key: ticket.key, transitionId: transition.id },
    });
    if (result._tag === "Success") {
      const status = result.value.status;
      setTransitions((current) => (current.state === "done" ? { ...current, status } : current));
    }
    toastManager.add(
      result._tag === "Success"
        ? { type: "success", title: `Moved ${ticket.key} to ${result.value.status}` }
        : {
            type: "error",
            title: `Could not move ${ticket.key}`,
            description: formatEnvironmentQueryError(result.cause),
          },
    );
  };

  return (
    <Menu
      onOpenChange={(open) => {
        if (open && threadRef !== null) void load();
      }}
    >
      <MenuTrigger
        render={<ComposerControl size="xs" />}
        className="min-w-0 shrink-0"
        aria-label={`Ticket ${ticket.key}`}
      >
        <TicketTypeMark isBug={ticket.isBug === true} />
        <span className="font-medium">{ticket.key}</span>
        {transitions.state === "done" ? (
          <span className="text-muted-foreground">· {transitions.status}</span>
        ) : null}
        {enhancing ? <span className="text-muted-foreground">· Enhancing prompt…</span> : null}
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden />
      </MenuTrigger>
      <MenuPopup align="end" side={side} className="w-72" {...menuProps}>
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{ticket.key}</p>
          {ticket.title ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">{ticket.title}</p>
          ) : null}
          {pendingBranch ? (
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              New branch {pendingBranch}
            </p>
          ) : null}
          {enhancing ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Rewriting the prompt with your text generation model. Edit it to keep this version.
            </p>
          ) : null}
        </div>
        {threadRef !== null ? (
          <MenuGroup>
            <MenuGroupLabel>Move to</MenuGroupLabel>
            {transitions.state === "done" ? (
              transitions.transitions.length === 0 ? (
                <MenuItem disabled>No moves from {transitions.status}</MenuItem>
              ) : (
                transitions.transitions.map((transition) => (
                  <MenuItem key={transition.id} onClick={() => void move(transition)}>
                    <ArrowRightIcon aria-hidden className="size-3.5 text-muted-foreground" />
                    {transition.toStatus || transition.name}
                  </MenuItem>
                ))
              )
            ) : (
              <MenuItem disabled>
                <span
                  className={cn(transitions.state === "failed" && "text-destructive-foreground")}
                >
                  {transitions.state === "failed" ? transitions.detail : "Loading…"}
                </span>
              </MenuItem>
            )}
          </MenuGroup>
        ) : null}
        <MenuSeparator />
        <MenuItem onClick={() => openTicket(ticket.url)}>
          <ExternalLinkIcon aria-hidden className="size-3.5 text-muted-foreground" />
          Open in Jira
        </MenuItem>
        {threadRef !== null ? (
          <MenuItem
            onClick={() =>
              void updateMetadata({
                environmentId,
                input: { threadId: threadRef.threadId, linkedTicket: null },
              })
            }
          >
            <UnlinkIcon aria-hidden className="size-3.5 text-muted-foreground" />
            Unlink ticket
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

/** The thread's ticket, or for a draft opened from a ticket, the one it will carry. */
export function BranchToolbarTicket({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const threadRef = scopeThreadRef(environmentId, threadId);
  const serverTicket = useQuietThreadShell(threadRef)?.linkedTicket ?? null;
  const draft = useTicketDraft(threadId);
  const enhancing = usePromptEnhancementStatus(threadRef) === "running";
  if (serverTicket) {
    return (
      <ToolbarTicketChip
        environmentId={environmentId}
        ticket={serverTicket}
        threadRef={threadRef}
      />
    );
  }
  if (draft) {
    return (
      <ToolbarTicketChip
        environmentId={environmentId}
        ticket={draft.ticket}
        threadRef={null}
        pendingBranch={draft.branch}
        enhancing={enhancing}
      />
    );
  }
  return null;
}

/** A thread's ticket beside its title, where existing threads show no branch toolbar. */
export function HeaderTicketChip({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const ticket = useQuietThreadShell(threadRef)?.linkedTicket ?? null;
  if (ticket === null) return null;
  return (
    <ToolbarTicketChip
      environmentId={threadRef.environmentId}
      ticket={ticket}
      threadRef={threadRef}
      side="bottom"
    />
  );
}
