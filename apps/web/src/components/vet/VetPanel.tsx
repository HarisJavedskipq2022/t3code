import { useAtomValue } from "@effect/atom-react";
import type {
  ScopedThreadRef,
  VetFinding,
  VetFindingStatus,
  VetReviewer,
  VetRun,
} from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleSlashIcon,
  FileCodeIcon,
  Gavel,
  HourglassIcon,
  RotateCcwIcon,
  SendIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { type ComponentProps, useLayoutEffect, useRef, useState } from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useDiffPanelStore } from "~/diffPanelStore";
import { cn } from "~/lib/utils";
import { inferReviewCommentFenceLanguage } from "~/reviewCommentContext";
import { useRightPanelStore } from "~/rightPanelStore";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { vetEnvironment } from "~/state/vet";

import type { DiffLineNote } from "../diffs/AnnotatableCodeView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";

const REVIEWERS: ReadonlyArray<{ value: VetReviewer; label: string; hint: string }> = [
  { value: "codex", label: "Codex", hint: "GPT through the Codex CLI. The default." },
  { value: "claude", label: "Claude", hint: "vet on Claude. Use when Codex wrote the code." },
  { value: "grok", label: "Grok", hint: "Grok through the Cursor CLI. Slowest." },
];

function severityVariant(severity: number) {
  return severity >= 4 ? "error" : severity === 3 ? "warning" : "info";
}

const SEVERITY_LABELS = ["Nit", "Low", "Medium", "High", "Critical"] as const;

/** Severity runs 1 (nit) to 5 (critical); the server clamps it to that range. */
function severityLabel(severity: number) {
  return SEVERITY_LABELS[severity - 1] ?? "Medium";
}

function reviewerLabel(reviewer: VetReviewer) {
  return REVIEWERS.find((entry) => entry.value === reviewer)?.label ?? reviewer;
}

/** The thread's latest vet review, pushed by the server as it changes. */
function useVetSnapshot(threadRef: ScopedThreadRef | null) {
  return useEnvironmentQuery(
    threadRef
      ? vetEnvironment.live({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
}

/** Null when the command succeeded or was interrupted; otherwise what to tell the user. */
function commandError(result: AtomCommandResult<unknown, unknown>, fallback: string) {
  if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
  const failure = squashAtomCommandFailure(result);
  return failure instanceof Error && failure.message ? failure.message : fallback;
}

/** A textarea focused once it mounts; autoFocus loses to the focus the opening click keeps. */
function FocusedTextarea(props: ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return <Textarea {...props} ref={ref} />;
}

interface VetFindingActions {
  readonly canOperate: boolean;
  /** Resolves false when the verdict was not saved; `error` then says why. */
  readonly setStatus: (
    finding: VetFinding,
    status: VetFindingStatus,
    note?: string,
  ) => Promise<boolean>;
  readonly error: string | null;
  readonly clearError: () => void;
  readonly sendToAgent: (finding: VetFinding) => void;
  readonly openInDiff: ((finding: VetFinding) => void) | null;
}

/** Verdicts go to the server; "send to agent" drops the finding into the thread's composer. */
function useVetFindingActions(input: {
  threadRef: ScopedThreadRef;
  run: VetRun | null;
  composerDraftTarget: ScopedThreadRef | DraftId;
  openInDiff: boolean;
}): VetFindingActions {
  const { threadRef, run, composerDraftTarget } = input;
  const canOperate = useAtomValue(
    vetEnvironment.updateFinding.permissionAtom(threadRef.environmentId),
  );
  const updateFinding = useAtomCommand(vetEnvironment.updateFinding);
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const [error, setError] = useState<string | null>(null);

  const setStatus = async (finding: VetFinding, status: VetFindingStatus, note?: string) => {
    if (!run) return false;
    setError(null);
    const result = await updateFinding({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        runId: run.id,
        findingId: finding.id,
        status,
        ...(note === undefined ? {} : { note }),
      },
    });
    const failure = commandError(result, "Could not save the verdict.");
    setError(failure);
    return failure === null;
  };

  const sendToAgent = (finding: VetFinding) => {
    const line = finding.line ?? 1;
    addReviewComment(composerDraftTarget, {
      id: `vet:${finding.id}`,
      sectionId: "vet",
      sectionTitle: "Vet finding",
      filePath: finding.filePath ?? "change",
      startIndex: line - 1,
      endIndex: line - 1,
      rangeLabel: finding.line === null ? "" : `L${finding.line}`,
      text: `Vet finding (${finding.issueCode}, severity ${finding.severity}/5, confidence ${Math.round(finding.confidence * 100)}%): ${finding.description}\n\nCheck this against the code first. Fix it only if it holds, and say so if it does not.`,
      diff: "",
      fenceLanguage: inferReviewCommentFenceLanguage(finding.filePath ?? ""),
    });
    if (finding.status === "open") void setStatus(finding, "confirmed");
  };

  const openInDiff = (finding: VetFinding) => {
    if (!finding.filePath) return;
    useDiffPanelStore.getState().revealBranchLine(threadRef, finding.filePath, finding.line);
    useRightPanelStore.getState().open(threadRef, "diff");
  };

  return {
    canOperate,
    setStatus,
    error,
    clearError: () => setError(null),
    sendToAgent,
    openInDiff: input.openInDiff ? openInDiff : null,
  };
}

/** One finding with its verdict controls; shared by the Vet panel and inline diff notes. */
function VetFindingCard({
  finding,
  actions,
  inline = false,
}: {
  finding: VetFinding;
  actions: VetFindingActions;
  inline?: boolean;
}) {
  const [dismissing, setDismissing] = useState(false);
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(false);
  const long = finding.description.length > 280;
  const location = finding.filePath
    ? `${finding.filePath}${finding.line === null ? "" : `:${finding.line}`}`
    : null;

  return (
    <article
      data-vet-finding={finding.id}
      className={cn(
        "flex flex-col gap-1.5 text-xs",
        inline
          ? "border-s-2 border-warning/60 bg-warning/[0.045] px-3 py-2 font-sans text-foreground"
          : "rounded-md border border-border/60 bg-card px-2.5 py-2",
        finding.status === "dismissed" && "opacity-70",
      )}
    >
      <header className="flex min-w-0 items-center gap-1.5">
        {inline ? <Gavel aria-hidden className="size-3 shrink-0 text-muted-foreground" /> : null}
        <Badge variant={severityVariant(finding.severity)} size="sm">
          {severityLabel(finding.severity)}
        </Badge>
        <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
          {finding.issueCode}
        </span>
        <span className="ms-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
          {Math.round(finding.confidence * 100)}% sure
        </span>
        {finding.status === "confirmed" ? (
          <Badge variant="success" size="sm">
            Confirmed
          </Badge>
        ) : finding.status === "dismissed" ? (
          <Badge variant="outline" size="sm">
            Dismissed
          </Badge>
        ) : null}
      </header>
      {location && !inline ? (
        actions.openInDiff ? (
          <button
            type="button"
            className="flex min-w-0 cursor-pointer items-center gap-1 self-start font-mono text-2xs text-muted-foreground hover:text-foreground hover:underline"
            aria-label={`Show ${location} in the diff`}
            onClick={() => actions.openInDiff?.(finding)}
          >
            <FileCodeIcon aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{location}</span>
          </button>
        ) : (
          <span className="truncate font-mono text-2xs text-muted-foreground">{location}</span>
        )
      ) : null}
      <p
        className={cn(
          "whitespace-pre-wrap break-words leading-relaxed text-foreground/90",
          long && !expanded && "line-clamp-5",
        )}
      >
        {finding.description}
      </p>
      {long ? (
        <button
          type="button"
          className="cursor-pointer self-start text-2xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
      {finding.status === "dismissed" && finding.note ? (
        <p className="text-2xs text-muted-foreground">Dismissed: {finding.note}</p>
      ) : null}
      {dismissing ? (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void actions.setStatus(finding, "dismissed", note).then((saved) => {
              if (!saved) return;
              setDismissing(false);
              setNote("");
            });
          }}
        >
          <FocusedTextarea
            size="sm"
            maxLength={500}
            value={note}
            placeholder="Why is this wrong? (optional)"
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDismissing(false);
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                event.currentTarget.form?.requestSubmit();
            }}
          />
          <div className="flex justify-end gap-1">
            <Button type="button" size="xs" variant="ghost" onClick={() => setDismissing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="xs" variant="secondary">
              Dismiss
            </Button>
          </div>
        </form>
      ) : actions.canOperate ? (
        <div className="flex flex-wrap items-center gap-1">
          {finding.status === "open" ? (
            <>
              <Button size="xs" variant="ghost" onClick={() => actions.sendToAgent(finding)}>
                <SendIcon className="size-3" />
                Send to agent
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => actions.setStatus(finding, "confirmed")}
              >
                <CheckIcon className="size-3" />
                Confirm
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setDismissing(true)}>
                <XIcon className="size-3" />
                Dismiss
              </Button>
            </>
          ) : (
            <>
              {finding.status === "confirmed" ? (
                <Button size="xs" variant="ghost" onClick={() => actions.sendToAgent(finding)}>
                  <SendIcon className="size-3" />
                  Send to agent
                </Button>
              ) : null}
              <Button size="xs" variant="ghost" onClick={() => actions.setStatus(finding, "open")}>
                <RotateCcwIcon className="size-3" />
                Reopen
              </Button>
            </>
          )}
        </div>
      ) : null}
      {inline && actions.error ? (
        <p role="alert" className="text-2xs text-destructive-foreground">
          {actions.error}
        </p>
      ) : null}
    </article>
  );
}

function VetInlineFinding(props: {
  threadRef: ScopedThreadRef;
  run: VetRun;
  finding: VetFinding;
  composerDraftTarget: ScopedThreadRef | DraftId;
}) {
  const actions = useVetFindingActions({ ...props, openInDiff: false });
  return <VetFindingCard finding={props.finding} actions={actions} inline />;
}

const EMPTY_LINE_NOTES: ReadonlyArray<DiffLineNote> = [];

/** Open and confirmed findings of the thread's latest review, pinned under their lines. */
export function useVetLineNotes(
  threadRef: ScopedThreadRef | null,
  composerDraftTarget: ScopedThreadRef | DraftId,
): ReadonlyArray<DiffLineNote> {
  const run = useVetSnapshot(threadRef).data?.run ?? null;
  if (!threadRef || !run) return EMPTY_LINE_NOTES;
  return run.findings.flatMap((finding): DiffLineNote[] =>
    finding.filePath && finding.line !== null && finding.status !== "dismissed"
      ? [
          {
            id: `vet:${finding.id}`,
            filePath: finding.filePath,
            line: finding.line,
            version: finding.status,
            render: () => (
              <VetInlineFinding
                threadRef={threadRef}
                run={run}
                finding={finding}
                composerDraftTarget={composerDraftTarget}
              />
            ),
          },
        ]
      : [],
  );
}

function FindingGroup({
  title,
  findings,
  actions,
  defaultExpanded,
  tone,
}: {
  title: string;
  findings: ReadonlyArray<VetFinding>;
  actions: VetFindingActions;
  defaultExpanded: boolean;
  tone: "accent" | "muted";
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (findings.length === 0) return null;
  return (
    <section className="flex flex-col">
      <CollapsibleSectionHeader
        variant="panel"
        tone={tone}
        expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {title} · {findings.length}
      </CollapsibleSectionHeader>
      {expanded ? (
        <div className="flex flex-col gap-1.5 px-1.5 pb-2">
          {findings.map((finding) => (
            <VetFindingCard key={finding.id} finding={finding} actions={actions} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** A clock time rather than "2m ago", which would go stale without a repainting timer. */
function formatRunTime(iso: string) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(
    [],
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}

function RunStatusLine({ run }: { run: VetRun }) {
  const reviewer = reviewerLabel(run.reviewer);
  const when = formatRunTime(run.finishedAt ?? run.startedAt);
  switch (run.status) {
    case "running":
      return (
        <span className="flex items-center gap-1.5">
          <HourglassIcon aria-hidden className="size-3.5 text-muted-foreground" />
          {reviewer} is reviewing · since {when} · usually 5–15 min
        </span>
      );
    case "clean":
      return (
        <span className="flex items-center gap-1.5">
          <ShieldCheckIcon aria-hidden className="size-3.5 text-success-foreground" />
          No issues · {reviewer} · {when}
        </span>
      );
    case "issues": {
      const open = run.findings.filter((finding) => finding.status === "open").length;
      return (
        <span className="flex items-center gap-1.5">
          <Gavel aria-hidden className="size-3.5 text-muted-foreground" />
          {run.findings.length} {run.findings.length === 1 ? "finding" : "findings"} · {open} open ·{" "}
          {reviewer} · {when}
        </span>
      );
    }
    case "failed":
      return (
        <span className="flex items-center gap-1.5 text-destructive-foreground">
          <XIcon aria-hidden className="size-3.5" />
          Review failed · {reviewer} · {when}
        </span>
      );
    case "cancelled":
      return (
        <span className="flex items-center gap-1.5">
          <CircleSlashIcon aria-hidden className="size-3.5 text-muted-foreground" />
          Cancelled · {reviewer} · {when}
        </span>
      );
  }
}

/** The Vet surface: run a review of the thread's branch and record a verdict on each finding. */
export function VetPanel({
  threadRef,
  composerDraftTarget,
}: {
  threadRef: ScopedThreadRef;
  composerDraftTarget: ScopedThreadRef | DraftId;
}) {
  const query = useVetSnapshot(threadRef);
  const snapshot = query.data;
  const run = snapshot?.run ?? null;
  const running = run?.status === "running";
  const actions = useVetFindingActions({ threadRef, run, composerDraftTarget, openInDiff: true });
  const canRun = useAtomValue(vetEnvironment.run.permissionAtom(threadRef.environmentId));
  const start = useAtomCommand(vetEnvironment.run);
  const cancel = useAtomCommand(vetEnvironment.cancel);
  const [reviewer, setReviewer] = useState<VetReviewer>("codex");
  const [goal, setGoal] = useState("");
  const [editingGoal, setEditingGoal] = useState(false);
  const [showGoal, setShowGoal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commandFailure, setCommandFailure] = useState<string | null>(null);
  const available = snapshot?.available ?? true;

  const runReview = async () => {
    setBusy(true);
    setCommandFailure(null);
    try {
      const result = await start({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          reviewer,
          ...(goal.trim() ? { goal: goal.trim() } : {}),
        },
      });
      if (result._tag === "Success") setEditingGoal(false);
      setCommandFailure(commandError(result, "Could not start the review."));
    } finally {
      setBusy(false);
    }
  };
  const cancelReview = async () => {
    setBusy(true);
    setCommandFailure(null);
    try {
      const result = await cancel({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      setCommandFailure(commandError(result, "Could not stop the review."));
    } finally {
      setBusy(false);
    }
  };

  const failure = commandFailure ?? actions.error ?? query.error ?? null;
  const notices = (
    <>
      {!available && snapshot ? (
        <p className="border-b border-border/60 px-2.5 py-2 text-2xs text-muted-foreground">
          Vet isn't installed on this environment, so new reviews can't start. It runs{" "}
          <code className="break-all font-mono">{snapshot.scriptPath}</code>; install the vet skill
          there, or set <code className="font-mono">T3CODE_VET_SCRIPT</code> and restart the server.
        </p>
      ) : null}
      {failure ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-border/60 bg-destructive/[0.06] px-2.5 py-2 text-2xs text-destructive-foreground"
        >
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{failure}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            className="shrink-0 cursor-pointer opacity-70 hover:opacity-100"
            onClick={() => {
              setCommandFailure(null);
              actions.clearError();
            }}
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ) : null}
    </>
  );

  const controls = (
    <div className="flex items-center gap-1">
      {running ? (
        <Button
          size="xs"
          variant="outline"
          disabled={!canRun || busy}
          onClick={() => void cancelReview()}
        >
          Stop review
        </Button>
      ) : (
        <>
          <Menu>
            <MenuTrigger
              render={
                <Button size="xs" variant="ghost" disabled={!canRun}>
                  {reviewerLabel(reviewer)}
                  <ChevronDownIcon className="size-3" />
                </Button>
              }
            />
            <MenuPopup align="end">
              <MenuRadioGroup
                value={reviewer}
                onValueChange={(value) => setReviewer(value as VetReviewer)}
              >
                {REVIEWERS.map((entry) => (
                  <MenuRadioItem key={entry.value} value={entry.value} closeOnClick>
                    <span className="flex flex-col">
                      <span>{entry.label}</span>
                      <span className="text-2xs text-muted-foreground">{entry.hint}</span>
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
          <Button
            size="xs"
            variant="ghost"
            disabled={!canRun}
            onClick={() => setEditingGoal((value) => !value)}
          >
            Goal
          </Button>
          <Button
            size="xs"
            variant="default"
            disabled={!canRun || busy || !snapshot || !available}
            onClick={() => void runReview()}
          >
            <Gavel className="size-3" />
            {run ? "Run again" : "Run review"}
          </Button>
        </>
      )}
    </div>
  );

  const goalEditor =
    editingGoal && !running ? (
      <div className="flex flex-col gap-1 border-b border-border/60 px-2.5 py-2">
        <FocusedTextarea
          size="sm"
          maxLength={8000}
          value={goal}
          placeholder="What must the change do, and not do? Defaults to this thread's first message."
          onChange={(event) => setGoal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void runReview();
          }}
        />
        <p className="text-2xs text-muted-foreground">
          The reviewer also reads this thread's conversation and the branch diff, uncommitted edits
          included.
        </p>
      </div>
    ) : null;

  if (!run) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {notices}
        {goalEditor}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Gavel aria-hidden className="size-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">No vet review yet</p>
          <p className="max-w-64 text-xs text-muted-foreground">
            A different model judges this thread's branch against its goal and conversation. Reviews
            take 5 to 15 minutes and keep running if you close this panel.
          </p>
          {controls}
        </div>
      </div>
    );
  }

  const open = run.findings.filter((finding) => finding.status === "open");
  const confirmed = run.findings.filter((finding) => finding.status === "confirmed");
  const dismissed = run.findings.filter((finding) => finding.status === "dismissed");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-1.5 border-b border-border/60 px-2.5 py-2">
        <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
          <div className="min-w-0 truncate">
            <RunStatusLine run={run} />
          </div>
          {controls}
        </div>
        <button
          type="button"
          className="flex min-w-0 cursor-pointer items-start gap-1 text-left text-2xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowGoal((value) => !value)}
          aria-expanded={showGoal}
        >
          <span className="shrink-0 font-medium">Goal</span>
          <span
            className={cn("min-w-0", showGoal ? "whitespace-pre-wrap break-words" : "truncate")}
          >
            {run.goal}
          </span>
        </button>
      </header>
      {notices}
      {goalEditor}
      {run.status === "failed" && run.error ? (
        <p
          role="alert"
          className="whitespace-pre-wrap break-words border-b border-border/60 bg-destructive/[0.06] px-2.5 py-2 font-mono text-2xs text-destructive-foreground"
        >
          {run.error}
        </p>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        {running ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            Findings appear here when the review finishes. You can keep working meanwhile.
          </p>
        ) : run.findings.length === 0 && run.status !== "clean" ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            {run.status === "cancelled"
              ? "This review was stopped before it finished. Run it again when you're ready."
              : "This review didn't finish, so it has no findings."}
          </p>
        ) : run.status === "clean" ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <ShieldCheckIcon aria-hidden className="size-6 text-success-foreground" />
            <p className="text-sm font-medium">No issues found</p>
            <p className="max-w-64 text-xs text-muted-foreground">
              The reviewer is a judge, not a proof. A clean review means it found nothing above its
              confidence threshold.
            </p>
          </div>
        ) : (
          <div className="flex flex-col p-1.5">
            <FindingGroup
              title="Open"
              tone="accent"
              findings={open}
              actions={actions}
              defaultExpanded
            />
            <FindingGroup
              title="Confirmed"
              tone="muted"
              findings={confirmed}
              actions={actions}
              defaultExpanded
            />
            <FindingGroup
              title="Dismissed"
              tone="muted"
              findings={dismissed}
              actions={actions}
              defaultExpanded={false}
            />
          </div>
        )}
      </ScrollArea>
      {run.belowThreshold ? (
        <footer className="border-t border-border/60 px-2.5 py-1.5 text-2xs text-muted-foreground">
          {run.belowThreshold} more {run.belowThreshold === 1 ? "finding was" : "findings were"}{" "}
          below the confidence threshold.
        </footer>
      ) : null}
    </div>
  );
}
