import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationV2ThreadFusion,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { CombineIcon, XIcon } from "lucide-react";
import { memo } from "react";

import type { ProviderInstanceEntry } from "~/providerInstances";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { TraitsPicker } from "./TraitsPicker";

/**
 * Fusion toggle and sidekick picker. The thread's own model leads; the sidekick
 * chosen here writes the code in one persistent child thread.
 */
export const ComposerFusionControl = memo(function ComposerFusionControl(props: {
  environmentId: EnvironmentId;
  fusion: OrchestrationV2ThreadFusion | null;
  /** Offered as the sidekick when Fusion is turned on. */
  defaultSidekick: ModelSelection;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: Parameters<typeof ProviderModelPicker>[0]["modelOptionsByInstance"];
  planModeEnabled: boolean;
  size: ComposerControlSize;
  disabled: boolean;
  onFusionChange: (fusion: OrchestrationV2ThreadFusion | null) => void;
}) {
  const sidekick = props.fusion?.sidekick ?? null;
  const sidekickEntry =
    sidekick === null
      ? undefined
      : props.instanceEntries.find((entry) => entry.instanceId === sidekick.instanceId);
  const setSidekick = (next: ModelSelection) => props.onFusionChange({ sidekick: next });

  if (sidekick === null) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerControl
              size={props.size}
              aria-pressed={false}
              disabled={props.disabled}
              aria-label="Turn on Fusion"
              onClick={() => setSidekick(props.defaultSidekick)}
            />
          }
        >
          <ComposerControlIcon icon={CombineIcon} size={props.size} />
          <span data-composer-control-label className="sr-only sm:not-sr-only">
            Fusion
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">
          Fusion: this model leads and a sidekick model writes the code
        </TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerControl
              size={props.size}
              aria-pressed
              disabled={props.disabled}
              aria-label="Turn off Fusion"
              onClick={() => props.onFusionChange(null)}
            />
          }
        >
          <ComposerControlIcon icon={CombineIcon} size={props.size} />
          <span data-composer-control-label className="sr-only sm:not-sr-only">
            Fusion
          </span>
          <XIcon aria-hidden className="size-3 opacity-60" />
        </TooltipTrigger>
        <TooltipPopup side="top">Fusion is on. Click to turn it off.</TooltipPopup>
      </Tooltip>
      <ProviderModelPicker
        environmentId={props.environmentId}
        compact
        isComposerOwned
        disabled={props.disabled}
        activeInstanceId={sidekick.instanceId}
        model={sidekick.model}
        lockedProvider={null}
        instanceEntries={props.instanceEntries}
        modelOptionsByInstance={props.modelOptionsByInstance}
        size={props.size}
        triggerAriaLabel="Fusion sidekick model"
        onInstanceModelChange={(instanceId: ProviderInstanceId, model: string) =>
          setSidekick(createModelSelection(instanceId, model))
        }
      />
      {sidekickEntry ? (
        <TraitsPicker
          provider={sidekickEntry.driverKind}
          models={sidekickEntry.models}
          model={sidekick.model}
          prompt=""
          onPromptChange={() => {}}
          modelOptions={sidekick.options ?? []}
          allowPromptInjectedEffort={false}
          planModeEnabled={props.planModeEnabled}
          isComposerOwned
          size={props.size}
          disabled={props.disabled}
          onModelOptionsChange={(options) =>
            setSidekick(createModelSelection(sidekick.instanceId, sidekick.model, options))
          }
        />
      ) : null}
    </span>
  );
});
