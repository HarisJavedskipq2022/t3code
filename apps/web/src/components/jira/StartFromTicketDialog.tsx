import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { JiraError, type JiraIssueSummary, type ScopedProjectRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { formatEnvironmentQueryError } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { TicketTypeMark } from "./TicketTypeMark";
import { linkedTicketOf, ticketBranchName, ticketPrompt } from "./ticketDraft.logic";
import { useTicketDraftStore } from "./ticketDraftStore";

const SEARCH_DELAY_MS = 250;

const useStartFromTicketDialog = create<{
  readonly open: boolean;
  readonly projectRef: ScopedProjectRef | null;
}>(() => ({ open: false, projectRef: null }));

export function openStartFromTicket(projectRef: ScopedProjectRef | null) {
  useStartFromTicketDialog.setState({ open: true, projectRef });
}

function closeStartFromTicket() {
  useStartFromTicketDialog.setState({ open: false });
}

const isJiraError = Schema.is(JiraError);
const isJiraNotConfigured = (error: unknown) =>
  isJiraError(error) && error.reason === "notConfigured";

const projectKey = (ref: ScopedProjectRef) => `${ref.environmentId}\u0000${ref.projectId}`;

type SearchResult =
  | { readonly state: "done"; readonly issues: ReadonlyArray<JiraIssueSummary> }
  | {
      readonly state: "failed";
      readonly detail: string;
      readonly notConfigured: boolean;
    };
type SearchState = { readonly state: "loading" } | SearchResult;

export function StartFromTicketDialogHost() {
  const open = useStartFromTicketDialog((state) => state.open);
  const initialProject = useStartFromTicketDialog((state) => state.projectRef);
  if (!open) return null;
  return <StartFromTicketDialog initialProject={initialProject} />;
}

function StartFromTicketDialog({
  initialProject,
}: {
  readonly initialProject: ScopedProjectRef | null;
}) {
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const { scratchWorkspaceRootFor } = useScratchProject();
  // Ticket work needs a Git checkout for its branch, which scratch folders are not.
  const projects = useProjects().filter(
    (project) => !isScratchProject(project, scratchWorkspaceRootFor(project.environmentId)),
  );
  const searchIssues = useAtomCommand(serverEnvironment.jiraSearchIssues, {
    reportFailure: false,
  });
  const getIssue = useAtomCommand(serverEnvironment.jiraGetIssue, { reportFailure: false });
  const [selectedProjectKey, setSelectedProjectKey] = useState(() => {
    const preferred = initialProject ?? projects[0];
    return preferred
      ? projectKey(
          "projectId" in preferred
            ? preferred
            : scopeProjectRef(preferred.environmentId, preferred.id),
        )
      : null;
  });
  const project =
    projects.find(
      (candidate) =>
        projectKey(scopeProjectRef(candidate.environmentId, candidate.id)) === selectedProjectKey,
    ) ?? null;
  const environmentId = project?.environmentId ?? null;
  const [query, setQuery] = useState("");
  // Results remember the search they answer, so a newer query reads as loading.
  const [answered, setAnswered] = useState<{
    readonly request: string;
    readonly result: SearchResult;
  } | null>(null);
  const request = `${environmentId}\u0000${query}`;
  const search: SearchState =
    answered !== null && answered.request === request ? answered.result : { state: "loading" };
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [opening, setOpening] = useState<{ readonly error: string | null; readonly busy: boolean }>(
    { error: null, busy: false },
  );

  useEffect(() => {
    if (environmentId === null) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void searchIssues({ environmentId, input: { query } }).then((result) => {
          if (cancelled) return;
          setAnswered({
            request,
            result:
              result._tag === "Success"
                ? { state: "done", issues: result.value.issues }
                : {
                    state: "failed",
                    detail: formatEnvironmentQueryError(result.cause),
                    notConfigured: isJiraNotConfigured(Cause.squash(result.cause)),
                  },
          });
        });
      },
      query.length === 0 ? 0 : SEARCH_DELAY_MS,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [environmentId, query, request, searchIssues]);

  const issues = search.state === "done" ? search.issues : [];
  const selected =
    issues.find((issue) => issue.key === selectedKey) ?? (issues.length === 1 ? issues[0]! : null);

  const openDraft = async (issue: JiraIssueSummary) => {
    if (project === null || environmentId === null) return;
    setOpening({ error: null, busy: true });
    const detail = await getIssue({ environmentId, input: { key: issue.key } });
    if (detail._tag !== "Success") {
      setOpening({ error: formatEnvironmentQueryError(detail.cause), busy: false });
      return;
    }
    const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
      envMode: "worktree",
    });
    if (opened === null) {
      setOpening({ error: null, busy: false });
      return;
    }
    useTicketDraftStore.getState().setDraft(opened.threadId, {
      ticket: linkedTicketOf(detail.value),
      branch: ticketBranchName(detail.value),
    });
    useComposerDraftStore.getState().setPrompt(opened.draftId, ticketPrompt(detail.value));
    closeStartFromTicket();
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : closeStartFromTicket())}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Start from Jira ticket</DialogTitle>
          <DialogDescription>
            Opens a new worktree draft on the ticket's branch, with the ticket as its first message.
            Read it before you send.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-3">
            <div>
              <Input
                autoFocus
                aria-label="Search tickets"
                placeholder="SHP-4158 or search your tickets"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedKey(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && selected && !opening.busy) {
                    event.preventDefault();
                    void openDraft(selected);
                  }
                }}
              />
            </div>
            <div className="min-h-40" role="listbox" aria-label="Tickets">
              <p className="mb-1 px-1 text-xs text-muted-foreground">
                {query.trim().length === 0 ? "Assigned to you · open" : "Matching tickets"}
              </p>
              {search.state === "loading" ? (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">Searching…</p>
              ) : search.state === "failed" ? (
                <div className="flex flex-col items-center gap-2 px-1 py-6 text-center text-sm text-muted-foreground">
                  <span>{search.detail}</span>
                  {search.notConfigured ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        closeStartFromTicket();
                        void navigate({ to: "/settings/integrations" });
                      }}
                    >
                      Open Jira settings
                    </Button>
                  ) : null}
                </div>
              ) : issues.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                  {query.trim().length === 0
                    ? "No open tickets are assigned to you."
                    : "No tickets match."}
                </p>
              ) : (
                <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                  {issues.map((issue) => (
                    <button
                      key={issue.key}
                      type="button"
                      role="option"
                      aria-selected={selected?.key === issue.key}
                      onClick={() => setSelectedKey(issue.key)}
                      onDoubleClick={() => void openDraft(issue)}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        selected?.key === issue.key && "bg-accent",
                      )}
                    >
                      <TicketTypeMark isBug={issue.isBug} />
                      <span className="shrink-0 font-medium">{issue.key}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {issue.title}
                      </span>
                      <span className="shrink-0 rounded-sm bg-muted px-1.5 text-xs text-muted-foreground">
                        {issue.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t pt-3 text-sm">
              <span className="text-muted-foreground">Project</span>
              <Select
                value={selectedProjectKey}
                onValueChange={(value) => setSelectedProjectKey(value)}
              >
                <SelectTrigger size="sm" aria-label="Project">
                  <SelectValue>{() => project?.title ?? "Pick a project"}</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {projects.map((candidate) => {
                    const key = projectKey(scopeProjectRef(candidate.environmentId, candidate.id));
                    return (
                      <SelectItem key={key} value={key}>
                        {candidate.title}
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
              <span className="text-muted-foreground">Branch</span>
              <span className="truncate font-mono text-xs">
                {selected ? ticketBranchName(selected) : "Pick a ticket"}
              </span>
            </div>
            {opening.error ? (
              <p className="text-sm text-destructive-foreground">{opening.error}</p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={closeStartFromTicket}>
            Cancel
          </Button>
          <Button
            disabled={selected === null || project === null || opening.busy}
            onClick={() => (selected ? void openDraft(selected) : undefined)}
          >
            {opening.busy ? "Opening…" : "Open draft"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
