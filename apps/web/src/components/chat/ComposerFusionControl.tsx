import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationV2ThreadFusion,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { CombineIcon } from "lucide-react";
import { memo } from "react";

import type { ProviderInstanceEntry } from "~/providerInstances";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlIcon,
  type ComposerControlSize,
} from "./ComposerControl";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { getTriggerDisplayModelName } from "./providerIconUtils";
import { TraitsPicker } from "./TraitsPicker";

type ModelOptionsByInstance = Parameters<typeof ProviderModelPicker>[0]["modelOptionsByInstance"];

/**
 * Fusion in one composer control: a toggle while off, and while on a pill
 * naming the sidekick whose panel holds its model, effort, and the way out.
 */
export const ComposerFusionControl = memo(function ComposerFusionControl(props: {
  environmentId: EnvironmentId;
  fusion: OrchestrationV2ThreadFusion | null;
  /** Offered as the sidekick when Fusion is turned on. */
  defaultSidekick: ModelSelection;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ModelOptionsByInstance;
  planModeEnabled: boolean;
  size: ComposerControlSize;
  disabled: boolean;
  onFusionChange: (fusion: OrchestrationV2ThreadFusion | null) => void;
}) {
  const sidekick = props.fusion?.sidekick ?? null;

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
              onClick={() => props.onFusionChange({ sidekick: props.defaultSidekick })}
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

  const sidekickEntry = props.instanceEntries.find(
    (entry) => entry.instanceId === sidekick.instanceId,
  );
  const sidekickOption = props.modelOptionsByInstance
    .get(sidekick.instanceId)
    ?.find((option) => option.slug === sidekick.model);
  const sidekickName = sidekickOption ? getTriggerDisplayModelName(sidekickOption) : sidekick.model;
  const setSidekick = (next: ModelSelection) => props.onFusionChange({ sidekick: next });

  return (
    <Popover>
      <PopoverTrigger
        render={
          <ComposerControl
            size={props.size}
            aria-pressed
            disabled={props.disabled}
            aria-label={`Fusion on, sidekick ${sidekickName}`}
          />
        }
      >
        <ComposerControlIcon icon={CombineIcon} size={props.size} />
        {/* not-sr-only resets wrapping, so the inner span does the truncating. */}
        <span data-composer-control-label className="sr-only sm:not-sr-only">
          <span className="block max-w-32 truncate">{sidekickName}</span>
        </span>
        <ComposerControlChevron size={props.size} />
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" width="sm" padding="compact">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">Fusion</p>
            <p className="text-xs text-muted-foreground">
              The thread&apos;s model leads and reviews. The sidekick writes the code in one ongoing
              sub-thread.
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <ProviderModelPicker
              environmentId={props.environmentId}
              compact
              disabled={props.disabled}
              activeInstanceId={sidekick.instanceId}
              model={sidekick.model}
              lockedProvider={null}
              instanceEntries={props.instanceEntries}
              modelOptionsByInstance={props.modelOptionsByInstance}
              size="sm"
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
                size="sm"
                disabled={props.disabled}
                onModelOptionsChange={(options) =>
                  setSidekick(createModelSelection(sidekick.instanceId, sidekick.model, options))
                }
              />
            ) : null}
          </div>
          <Button
            size="xs"
            variant="ghost"
            className="self-start"
            onClick={() => props.onFusionChange(null)}
          >
            Turn off Fusion
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
});
