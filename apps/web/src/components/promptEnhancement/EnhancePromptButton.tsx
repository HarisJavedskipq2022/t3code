import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { SparklesIcon, Undo2Icon } from "lucide-react";
import { useEffect, useRef } from "react";

import type { ComposerThreadTarget } from "../../composerDraftStore";
import { shortcutLabelForCommand } from "../../keybindings";
import { formatEnvironmentQueryError } from "../../state/query";
import { primaryServerKeybindingsAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useStableCallback } from "../../hooks/useStableCallback";
import { registerCommands } from "../../shortcuts/dispatcher";
import { composerTakesShortcut } from "../chat/composerEventScope";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  readComposerPrompt,
  runPromptEnhancement,
  undoPromptEnhancement,
  usePromptEnhancementStatus,
} from "./promptEnhancementStore";

const paletteHandlers: Array<() => void> = [];

/** The command palette's Enhance prompt: the newest mounted composer that can enhance. */
export function enhanceActiveComposerPrompt(): boolean {
  const handler = paletteHandlers.at(-1);
  handler?.();
  return handler !== undefined;
}

/**
 * Rewrites the composer's draft into a structured agent prompt after reading the project's code
 * read-only, then offers Undo until the draft is edited.
 */
export function EnhancePromptButton({
  target,
  environmentId,
  projectId,
  hasPrompt,
}: {
  readonly target: ComposerThreadTarget;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly hasPrompt: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const canEnhance = useAtomValue(serverEnvironment.promptEnhance.permissionAtom(environmentId));
  const enhance = useAtomCommand(serverEnvironment.promptEnhance, { reportFailure: false });
  const status = usePromptEnhancementStatus(target);
  const shortcutLabel = shortcutLabelForCommand(
    useAtomValue(primaryServerKeybindingsAtom),
    "composer.enhancePrompt",
  );
  const available = canEnhance && projectId !== null;

  const run = useStableCallback(async () => {
    if (!available || projectId === null || status === "running") return;
    if (status === "undoable") {
      undoPromptEnhancement(target);
      return;
    }
    const draft = readComposerPrompt(target).trim();
    if (draft.length === 0) return;
    const outcome = await runPromptEnhancement({
      target,
      request: () =>
        enhance({ environmentId, input: { projectId, draft, readCode: true } }).then((result) =>
          result._tag === "Success"
            ? result.value
            : { error: formatEnvironmentQueryError(result.cause) },
        ),
    });
    if (outcome?.type === "failed") {
      toastManager.add({
        type: "error",
        title: "Could not enhance the prompt",
        description: outcome.detail,
      });
    } else if (outcome?.type === "applied" && !outcome.readCode) {
      toastManager.add({
        type: "info",
        title: "Enhanced without reading the code",
        description:
          "Your text generation model can't read the project read-only. Claude and Codex can.",
      });
    }
  });

  // oxlint-disable-next-line t3code/react-effect-budget -- Register this composer's keyboard and palette entry points while it is mounted.
  useEffect(() => {
    if (!available) return;
    const handler = () => void run();
    paletteHandlers.push(handler);
    const unregister = registerCommands(
      {
        "composer.enhancePrompt": () => {
          handler();
        },
      },
      {
        capture: true,
        when: (event) =>
          composerTakesShortcut(event.target, buttonRef.current?.closest("form") ?? null),
      },
    );
    return () => {
      unregister();
      const index = paletteHandlers.lastIndexOf(handler);
      if (index !== -1) paletteHandlers.splice(index, 1);
    };
  }, [available, run]);

  if (!available) return null;
  const label =
    status === "running"
      ? "Enhancing… (reading the code)"
      : status === "undoable"
        ? "Undo enhance"
        : "Enhance prompt";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={buttonRef}
            type="button"
            variant="ghost"
            size={status === "running" ? "xs" : "icon-sm"}
            disabled={status === "running" || (status === "idle" && !hasPrompt)}
            aria-busy={status === "running"}
            aria-label={label}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void run()}
          />
        }
      >
        {status === "undoable" ? <Undo2Icon /> : <SparklesIcon />}
        {status === "running" ? <span>Enhancing…</span> : null}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {status === "idle"
          ? `Enhance prompt: reads the project's code and rewrites the draft${shortcutLabel ? ` (${shortcutLabel})` : ""}`
          : label}
      </TooltipPopup>
    </Tooltip>
  );
}
