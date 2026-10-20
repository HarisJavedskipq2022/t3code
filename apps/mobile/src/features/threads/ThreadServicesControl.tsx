import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import {
  AuthPreviewOperateScope,
  type EnvironmentId,
  type ThreadId,
  type WorktreeService,
  type WorktreeServiceControlInput,
  type WorktreeServicesSnapshot,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { terminalOutputText } from "@t3tools/client-runtime/state/terminal";
import { serviceLogText } from "@t3tools/client-runtime/state/worktreeServices";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { Sheet } from "../../components/ui/Sheet";
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { worktreeServicesEnvironment } from "../../state/worktreeServices";
import { terminalEnvironment } from "../../state/terminal";
import { previewEnvironment } from "../../state/preview";

interface Props {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  serverBrowser: boolean;
}

function Logs({
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
  return (
    <View className="rounded-xl bg-subtle p-3">
      {query.error || query.data?.error ? (
        <Text accessibilityRole="alert" className="text-danger">
          {query.error ?? query.data?.error}
        </Text>
      ) : null}
      <Text selectable className="font-mono text-xs text-foreground">
        {query.data
          ? serviceLogText(terminalOutputText(query.data.output)) || "No output yet."
          : "Loading logs…"}
      </Text>
    </View>
  );
}

export function ThreadServicesControl(props: Props) {
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
  const navigation = useNavigation();
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<WorktreeService | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    base: WorktreeServicesSnapshot | null;
    value: WorktreeServicesSnapshot;
  } | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const snapshot = result?.base === query.data ? result.value : query.data;
  const rows = snapshot?.services ?? [];
  const run = async (action: WorktreeServiceControlInput["action"], scriptId?: string) => {
    if (!canOperate || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const base = query.data;
    // `.catch` instead of try/finally, which React Compiler can't compile.
    const next = await control({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, action, ...(scriptId ? { scriptId } : {}) },
    }).catch(() => null);
    inFlight.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (next === null) {
      setError("Could not control app services.");
    } else if (next._tag === "Success") {
      setResult({ base, value: next.value });
      query.refresh();
    } else if (!isAtomCommandInterrupted(next)) {
      const failure = squashAtomCommandFailure(next);
      setError(failure instanceof Error ? failure.message : "Could not control app services.");
    }
  };
  if (query.isSuccess && rows.length === 0 && !query.error) return null;
  return (
    <View className="px-4 py-1">
      <ControlPill
        variant="pill"
        label={`App services${rows.length ? ` · ${rows.filter((row) => row.status === "running").length}/${rows.length} running` : ""}`}
        onPress={() => setOpen(true)}
      />
      {open ? (
        <Sheet
          title="App services"
          onClose={() => {
            setOpen(false);
            setLogs(null);
          }}
        >
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-4 p-4 pb-10"
          >
            <View className="flex-row flex-wrap gap-2">
              <ControlPill
                variant="primary"
                label="Start app"
                disabled={!canOperate || busy || !rows.some((row) => row.configured)}
                onPress={() => void run("start")}
              />
              <ControlPill
                variant="pill"
                label="Stop app"
                disabled={!canOperate || busy || !rows.some((row) => row.canStop)}
                onPress={() => void run("stop")}
              />
            </View>
            {!snapshot && !query.error ? (
              <Text className="text-foreground-muted">Loading services…</Text>
            ) : null}
            {query.error || error ? (
              <View>
                <Text accessibilityRole="alert" className="text-danger">
                  {error ?? query.error}
                </Text>
                <ControlPill variant="pill" label="Retry" onPress={query.refresh} />
              </View>
            ) : null}
            {snapshot && !snapshot.inspectionAvailable ? (
              <Text className="text-foreground-muted">
                Listening ports are currently unavailable.
              </Text>
            ) : null}
            {rows.map((row) => (
              <View key={row.scriptId} className="gap-2 rounded-2xl bg-subtle p-3">
                <Text className="font-t3-bold text-foreground">
                  {row.name} · {row.status}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {row.ports.length
                    ? `Listening: ${row.ports.join(", ")}`
                    : row.expectedPort !== null
                      ? `Expected port: ${row.expectedPort}`
                      : "No port configured"}
                  {!row.configured ? " · Removed from actions" : ""}
                  {row.exitCode !== null ? ` · Exit ${row.exitCode}` : ""}
                </Text>
                {row.error ? (
                  <Text accessibilityRole="alert" className="text-danger">
                    {row.error}
                  </Text>
                ) : null}
                <View className="flex-row flex-wrap gap-2">
                  <ControlPill
                    variant="pill"
                    label="Start"
                    accessibilityLabel={`Start ${row.name}`}
                    disabled={
                      !canOperate ||
                      busy ||
                      !row.configured ||
                      row.status === "running" ||
                      row.status === "starting" ||
                      row.status === "stopping"
                    }
                    onPress={() => void run("start", row.scriptId)}
                  />
                  <ControlPill
                    variant="pill"
                    label="Stop"
                    accessibilityLabel={`Stop ${row.name}`}
                    disabled={!canOperate || busy || !row.canStop}
                    onPress={() => void run("stop", row.scriptId)}
                  />
                  <ControlPill
                    variant="pill"
                    label="Restart"
                    accessibilityLabel={`Restart ${row.name}`}
                    disabled={!canOperate || busy || !row.configured}
                    onPress={() => void run("restart", row.scriptId)}
                  />
                  <ControlPill
                    variant="pill"
                    label="Logs"
                    accessibilityLabel={`Logs for ${row.name}`}
                    disabled={!row.terminal}
                    onPress={() => setLogs(logs?.scriptId === row.scriptId ? null : row)}
                  />
                  {row.urls.map((port) => (
                    <ControlPill
                      key={port.url}
                      variant="pill"
                      label={`Open :${port.port}`}
                      disabled={!canPreview || !props.serverBrowser}
                      onPress={() =>
                        void openPreview({
                          environmentId: props.environmentId,
                          input: { threadId: props.threadId, url: port.url, runtime: "server" },
                        }).then((opened) => {
                          if (!mounted.current) return;
                          if (opened._tag === "Success") {
                            setOpen(false);
                            setLogs(null);
                            navigation.navigate("ThreadBrowserPreview", {
                              environmentId: props.environmentId,
                              threadId: props.threadId,
                              tabId: opened.value.tabId,
                            });
                          } else if (!isAtomCommandInterrupted(opened))
                            setError("Could not open the service browser.");
                        })
                      }
                    />
                  ))}
                </View>
                {row.urls.length > 0 && !props.serverBrowser ? (
                  <Text className="text-xs text-foreground-muted">
                    Browser viewing is unavailable on this environment.
                  </Text>
                ) : null}
                {logs?.scriptId === row.scriptId ? (
                  <Logs
                    key={`${logs.terminal?.threadId}:${logs.terminal?.terminalId}`}
                    environmentId={props.environmentId}
                    service={logs}
                  />
                ) : null}
              </View>
            ))}
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}
