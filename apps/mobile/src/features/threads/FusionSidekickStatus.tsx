import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  fusionSidekickNeedsItems,
  presentFusionSidekick,
  resolveFusionSidekickActivity,
} from "@t3tools/client-runtime/state/fusion-sidekick";
import {
  resolveThreadWorkingStartedAt,
  threadRuntimeIsActive,
} from "@t3tools/client-runtime/state/models";
import {
  AuthOrchestrationOperateScope,
  type OrchestrationV2Subagent,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { Atom } from "effect/reactivity";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ControlPill } from "../../components/ui/ControlPill";
import { cn } from "../../lib/cn";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadVisibleTurnItems } from "../../state/use-thread-detail";
import { useVisibleSecondClock } from "./use-visible-second-clock";

const NO_SIDEKICK_ATOM = Atom.make<OrchestrationV2Subagent | null>(null).pipe(
  Atom.withLabel("mobile-fusion-sidekick:none"),
);

/**
 * A Fusion lead's sidekick above the composer: its step, and whether it is blocked or may be
 * stuck. Tapping opens the sidekick's thread, where its approval or question waits.
 */
export function FusionSidekickStatus(props: {
  /** Null until the thread exists on the server. */
  readonly threadRef: ScopedThreadRef | null;
  readonly contentMaxWidth: number | undefined;
}) {
  const { threadRef } = props;
  const navigation = useNavigation();
  const sidekick = useAtomValue(
    threadRef === null ? NO_SIDEKICK_ATOM : environmentThreadDetails.fusionSidekickAtom(threadRef),
  );
  const lead = useThreadShell(threadRef);
  const childThreadId = sidekick?.childThreadId ?? null;
  const childRef =
    threadRef === null || childThreadId === null
      ? null
      : scopeThreadRef(threadRef.environmentId, childThreadId);
  const child = useThreadShell(childRef);
  const activity = resolveFusionSidekickActivity({
    sidekick,
    child,
    leadWorking: threadRuntimeIsActive(lead?.runtime),
    leadActivityStartedAt: lead?.runtime?.activityStartedAt ?? null,
  });
  // Only a working or blocked sidekick's thread is read, and only while the lead is on screen.
  const items = useThreadVisibleTurnItems({
    environmentId: fusionSidekickNeedsItems(activity) ? (childRef?.environmentId ?? null) : null,
    threadId: fusionSidekickNeedsItems(activity) ? childThreadId : null,
  });
  const working = activity?.kind === "working";
  const nowMs = useVisibleSecondClock(working);
  const canStop = useEnvironmentScope(
    threadRef?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, "stop fusion sidekick");

  if (activity === null || threadRef === null) return null;
  const view = presentFusionSidekick({ activity, items, nowMs });
  const startedAt = working && child ? resolveThreadWorkingStartedAt(child) : null;
  const elapsed = startedAt === null ? null : formatDuration(nowMs - Date.parse(startedAt));
  const openSidekick = () =>
    // Push, not navigate: navigate reuses this Thread route, so back would skip the lead.
    navigation.dispatch(
      StackActions.push("Thread", {
        environmentId: String(threadRef.environmentId),
        threadId: String(activity.childThreadId),
      }),
    );

  return (
    <View
      className="self-center px-3 pb-1.5"
      style={{ width: "100%", maxWidth: props.contentMaxWidth }}
    >
      <View
        className={cn(
          "flex-row items-center gap-2 rounded-[20px] border py-2 pe-2 ps-3",
          view.warning ? "border-warning-border bg-warning" : "border-border-subtle bg-card-alt",
        )}
      >
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${view.title}. ${view.description}`}
          accessibilityHint={`${view.openLabel} in its thread`}
          onPress={openSidekick}
          className="min-w-0 flex-1 flex-row items-center gap-2.5 active:opacity-70"
        >
          <SymbolView
            name={view.warning ? "exclamationmark.triangle" : "person.2"}
            size={16}
            tintColorClassName={view.warning ? "accent-warning-foreground" : "accent-icon-muted"}
          />
          <View className="min-w-0 flex-1 gap-0.5">
            <View className="min-w-0 flex-row items-center gap-1.5">
              <Text
                numberOfLines={1}
                className={cn(
                  "min-w-0 shrink font-t3-bold text-sm",
                  view.warning ? "text-warning-foreground" : "text-foreground",
                )}
              >
                {view.title}
              </Text>
              {elapsed === null ? null : (
                <Text
                  className="shrink-0 font-sans text-xs text-foreground-secondary"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {elapsed}
                </Text>
              )}
            </View>
            <Text numberOfLines={1} className="font-sans text-xs text-foreground-secondary">
              {view.description}
            </Text>
          </View>
          <SymbolView name="chevron.right" size={12} tintColorClassName="accent-chevron" />
        </Pressable>
        {view.stalled && canStop ? (
          <ControlPill
            variant="pill"
            label="Stop"
            accessibilityLabel="Stop sidekick"
            onPress={() =>
              void interruptTurn({
                environmentId: threadRef.environmentId,
                input: { threadId: activity.childThreadId },
              })
            }
          />
        ) : null}
      </View>
    </View>
  );
}
