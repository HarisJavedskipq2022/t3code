import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Pressable } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { getComposerDraftSnapshot } from "../../state/use-composer-drafts";
import {
  runPromptEnhancement,
  undoPromptEnhancement,
  usePromptEnhancementStatus,
} from "./promptEnhancementStore";

/**
 * Rewrites the composer's draft into a structured agent prompt after reading the project's code
 * read-only, then offers Undo until the draft is edited.
 */
export function EnhancePromptButton(props: {
  readonly draftKey: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly disabled?: boolean;
  readonly size?: "regular" | "large";
}) {
  const { scale } = useAndroidControlSizing();
  const canEnhance = useAtomValue(
    serverEnvironment.promptEnhance.permissionAtom(props.environmentId),
  );
  const enhance = useAtomCommand(serverEnvironment.promptEnhance, { reportFailure: false });
  const status = usePromptEnhancementStatus(props.draftKey);
  if (!canEnhance) return null;

  const onPress = async () => {
    if (status === "undoable") {
      undoPromptEnhancement(props.draftKey);
      return;
    }
    const draft = getComposerDraftSnapshot(props.draftKey).text.trim();
    if (draft.length === 0) return;
    const outcome = await runPromptEnhancement({
      draftKey: props.draftKey,
      request: () =>
        enhance({
          environmentId: props.environmentId,
          input: { projectId: props.projectId, draft, readCode: true },
        }).then((result) => {
          if (result._tag === "Success") return result.value;
          if (isAtomCommandInterrupted(result)) return { error: "" };
          const failure = squashAtomCommandFailure(result);
          return {
            error: failure instanceof Error ? failure.message : "Could not enhance the prompt.",
          };
        }),
    });
    if (outcome.type === "failed" && outcome.detail.length > 0) {
      Dialog.alert("Couldn't enhance the prompt", outcome.detail);
    }
  };

  const running = status === "running";
  return (
    <Pressable
      accessibilityLabel={
        running ? "Enhancing prompt" : status === "undoable" ? "Undo enhance" : "Enhance prompt"
      }
      accessibilityHint={
        status === "idle" ? "Reads the project's code and rewrites the draft" : undefined
      }
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled || running, busy: running }}
      className="h-[44px] min-w-[44px] shrink-0 flex-row items-center justify-center gap-1 rounded-full px-1 active:opacity-70 disabled:opacity-50"
      disabled={props.disabled || running}
      onPress={() => void onPress()}
    >
      <SymbolView
        name={status === "undoable" ? "arrow.uturn.backward" : "sparkles"}
        size={Math.round((props.size === "large" ? 24 : 18) * scale)}
        weight="regular"
        tintColorClassName="accent-icon"
        type="monochrome"
      />
      {running ? <Text className="text-xs text-foreground-muted">Enhancing…</Text> : null}
    </Pressable>
  );
}
