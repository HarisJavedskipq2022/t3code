import { useAtomValue } from "@effect/atom-react";
import {
  AuthPreviewOperateScope,
  type EnvironmentId,
  type ThreadId,
  type WorktreeService,
  type WorktreeServicesSnapshot,
  type WorktreeServiceControlInput,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { terminalOutputText } from "@t3tools/client-runtime/state/terminal";
import { serviceLogText } from "@t3tools/client-runtime/state/worktreeServices";
import { useRef, useState } from "react";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { worktreeServicesEnvironment } from "../../state/worktreeServices";
import { terminalEnvironment } from "../../state/terminal";
import { previewEnvironment } from "../../state/preview";
import { openDiscoveredPort } from "../preview/openDiscoveredPort";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from "../ui/dialog";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

interface Props {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}

function ServiceLogs({
  environmentId,
  service,
}: {
  environmentId: EnvironmentId;
  service: WorktreeService;
}) {
  const query = useEnvironmentQuery(
    service.terminal
      ? terminalEnvironment.observe({ environmentId, input: service.terminal })
      : null,
  );
  const error = query.error ?? query.data?.error;
  return (
    <div className="min-w-0">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
        {query.data
          ? serviceLogText(terminalOutputText(query.data.output)) || "No output yet."
          : "Loading logs…"}
      </pre>
    </div>
  );
}

/** Own local mutations and log subscriptions for exactly one thread target. */
export function ThreadServicesPanel(props: Props) {
  return <Services key={`${props.environmentId}:${props.threadId}`} {...props} />;
}

function Services(props: Props) {
  const query = useEnvironmentQuery(
    worktreeServicesEnvironment.live({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  );
  const canOperate = useAtomValue(
    worktreeServicesEnvironment.control.permissionAtom(props.environmentId),
  );
  const canPreview = useEnvironmentScope(props.environmentId, AuthPreviewOperateScope);
  const control = useAtomCommand(worktreeServicesEnvironment.control, { reportFailure: false });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const [result, setResult] = useState<{
    base: WorktreeServicesSnapshot | null;
    value: WorktreeServicesSnapshot;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<WorktreeService | null>(null);
  const inFlight = useRef(false);
  const snapshot = result?.base === query.data ? result.value : query.data;
  const rows = snapshot?.services ?? [];
  const run = async (action: WorktreeServiceControlInput["action"], scriptId?: string) => {
    if (!canOperate || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const base = query.data;
    const next = await control({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, action, ...(scriptId ? { scriptId } : {}) },
    });
    inFlight.current = false;
    setBusy(false);
    if (next._tag === "Success") {
      setResult({ base, value: next.value });
      query.refresh();
    } else if (!isAtomCommandInterrupted(next)) {
      const failure = squashAtomCommandFailure(next);
      setError(failure instanceof Error ? failure.message : "Could not control app services.");
    }
  };
  if (query.isSuccess && rows.length === 0 && !query.error) return null;
  return (
    <ThreadDetailsSection
      headingId="thread-services-heading"
      title="App services"
      actions={
        <>
          <ThreadDetailsControl
            part="meta"
            disabled={!canOperate || busy || !rows.some((row) => row.configured)}
            onClick={() => void run("start")}
          >
            Start app
          </ThreadDetailsControl>
          <ThreadDetailsControl
            part="meta"
            disabled={!canOperate || busy || !rows.some((row) => row.canStop)}
            onClick={() => void run("stop")}
          >
            Stop app
          </ThreadDetailsControl>
        </>
      }
    >
      {!snapshot && !query.error ? (
        <p className="px-1.5 text-xs text-muted-foreground">Loading services…</p>
      ) : null}
      {query.error || error ? (
        <div role="alert" className="px-1.5 text-xs text-destructive">
          {error ?? query.error}
          <Button variant="ghost" size="xs" onClick={query.refresh}>
            Retry
          </Button>
        </div>
      ) : null}
      {snapshot && !snapshot.inspectionAvailable ? (
        <p className="px-1.5 text-xs text-muted-foreground">
          Listening ports are currently unavailable.
        </p>
      ) : null}
      <ul className="space-y-3 px-1.5">
        {rows.map((row) => (
          <li key={row.scriptId} className="min-w-0 space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium">{row.name}</span>
              <span className="text-xs text-muted-foreground">{row.status}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {row.ports.length
                ? `Listening: ${row.ports.join(", ")}`
                : row.expectedPort !== null
                  ? `Expected port: ${row.expectedPort}`
                  : "No port configured"}
              {!row.configured ? " · Removed from actions" : ""}
              {row.exitCode !== null ? ` · Exit ${row.exitCode}` : ""}
            </p>
            {row.error ? (
              <p role="alert" className="text-xs text-destructive">
                {row.error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1">
              <ThreadDetailsControl
                part="meta"
                aria-label={`Start ${row.name}`}
                disabled={
                  !canOperate ||
                  busy ||
                  !row.configured ||
                  row.status === "running" ||
                  row.status === "starting" ||
                  row.status === "stopping"
                }
                onClick={() => void run("start", row.scriptId)}
              >
                Start
              </ThreadDetailsControl>
              <ThreadDetailsControl
                part="meta"
                aria-label={`Stop ${row.name}`}
                disabled={!canOperate || busy || !row.canStop}
                onClick={() => void run("stop", row.scriptId)}
              >
                Stop
              </ThreadDetailsControl>
              <ThreadDetailsControl
                part="meta"
                aria-label={`Restart ${row.name}`}
                disabled={!canOperate || busy || !row.configured}
                onClick={() => void run("restart", row.scriptId)}
              >
                Restart
              </ThreadDetailsControl>
              <ThreadDetailsControl
                part="meta"
                aria-label={`Logs for ${row.name}`}
                disabled={!row.terminal}
                onClick={() => setLogs(row)}
              >
                Logs
              </ThreadDetailsControl>
              {row.urls.map((port) => (
                <ThreadDetailsControl
                  key={port.url}
                  part="meta"
                  disabled={!canPreview}
                  onClick={() =>
                    void openDiscoveredPort({ threadRef: props, port, openPreview }).then(
                      (opened) => {
                        if (opened._tag === "Failure" && !isAtomCommandInterrupted(opened))
                          setError("Could not open the service in the browser.");
                      },
                    )
                  }
                >
                  Open :{port.port}
                </ThreadDetailsControl>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <Dialog
        open={logs !== null}
        onOpenChange={(open) => {
          if (!open) setLogs(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{logs?.name} logs</DialogTitle>
          </DialogHeader>
          {logs ? (
            <ServiceLogs
              key={`${logs.terminal?.threadId}:${logs.terminal?.terminalId}`}
              environmentId={props.environmentId}
              service={logs}
            />
          ) : null}
        </DialogPopup>
      </Dialog>
    </ThreadDetailsSection>
  );
}
