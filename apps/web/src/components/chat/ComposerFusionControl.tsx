import {
  type EnvironmentId,
  MAX_FUSION_ROLES,
  type ModelSelection,
  type OrchestrationV2FusionRole,
  type OrchestrationV2ThreadFusion,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { CombineIcon, PlusIcon, XIcon } from "lucide-react";
import { memo, useState } from "react";

import type { ProviderInstanceEntry } from "~/providerInstances";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
import { addFusionRole, fusionModelOwner, fusionRoleNameProblem } from "./fusionRoles.logic";
import { TraitsPicker } from "./TraitsPicker";

type ModelOptionsByInstance = Parameters<typeof ProviderModelPicker>[0]["modelOptionsByInstance"];

interface SidekickPickerProps {
  environmentId: EnvironmentId;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ModelOptionsByInstance;
  planModeEnabled: boolean;
  disabled: boolean;
}

/** Model and effort for one sidekick. Wraps rather than overflowing: the popup clips past its edge. */
function SidekickModelPicker(
  props: SidekickPickerProps & {
    sidekick: ModelSelection;
    ariaLabel: string;
    onChange: (next: ModelSelection) => void;
  },
) {
  const { sidekick } = props;
  const entry = props.instanceEntries.find((item) => item.instanceId === sidekick.instanceId);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <ProviderModelPicker
        environmentId={props.environmentId}
        disabled={props.disabled}
        activeInstanceId={sidekick.instanceId}
        model={sidekick.model}
        lockedProvider={null}
        instanceEntries={props.instanceEntries}
        modelOptionsByInstance={props.modelOptionsByInstance}
        size="sm"
        triggerAriaLabel={props.ariaLabel}
        onInstanceModelChange={(instanceId: ProviderInstanceId, model: string) =>
          props.onChange(createModelSelection(instanceId, model))
        }
      />
      {entry ? (
        <TraitsPicker
          provider={entry.driverKind}
          models={entry.models}
          model={sidekick.model}
          prompt=""
          onPromptChange={() => {}}
          modelOptions={sidekick.options ?? []}
          allowPromptInjectedEffort={false}
          planModeEnabled={props.planModeEnabled}
          size="sm"
          disabled={props.disabled}
          onModelOptionsChange={(options) =>
            props.onChange(createModelSelection(sidekick.instanceId, sidekick.model, options))
          }
        />
      ) : null}
    </div>
  );
}

/**
 * A text field that keeps its draft while focused and commits on blur or
 * Enter; a commit that changes nothing leaves the saved value showing.
 */
function CommitOnBlurInput(props: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  disabled: boolean;
  commit: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft !== null && draft !== props.value) props.commit(draft);
    setDraft(null);
  };
  return (
    <Input
      size="compact"
      value={draft ?? props.value}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      disabled={props.disabled}
      onFocus={() => setDraft(props.value)}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

/**
 * Fusion in one composer control: a toggle while off, and while on a pill
 * naming the default sidekick whose panel holds every sidekick's model, effort,
 * role, and the way out.
 */
export const ComposerFusionControl = memo(function ComposerFusionControl(props: {
  environmentId: EnvironmentId;
  fusion: OrchestrationV2ThreadFusion | null;
  /** Offered when Fusion is turned on. */
  defaultFusion: OrchestrationV2ThreadFusion;
  /** The server routes steps to named role sidekicks. */
  rolesSupported: boolean;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ModelOptionsByInstance;
  planModeEnabled: boolean;
  size: ComposerControlSize;
  disabled: boolean;
  onFusionChange: (fusion: OrchestrationV2ThreadFusion | null) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const { fusion } = props;

  if (fusion === null) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerControl
              size={props.size}
              aria-pressed={false}
              disabled={props.disabled}
              aria-label="Turn on Fusion"
              onClick={() =>
                props.onFusionChange(
                  props.rolesSupported
                    ? props.defaultFusion
                    : { sidekick: props.defaultFusion.sidekick },
                )
              }
            />
          }
        >
          <ComposerControlIcon icon={CombineIcon} size={props.size} />
          <span data-composer-control-label className="sr-only sm:not-sr-only">
            Fusion
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">
          Fusion: this model leads and sidekick models write the code
        </TooltipPopup>
      </Tooltip>
    );
  }

  const { sidekick } = fusion;
  const roles = fusion.roles ?? [];
  const modelName = (selection: ModelSelection) => {
    const option = props.modelOptionsByInstance
      .get(selection.instanceId)
      ?.find((item) => item.slug === selection.model);
    return option ? getTriggerDisplayModelName(option) : selection.model;
  };
  const sidekickName = modelName(sidekick);
  const pillLabel = roles.length === 0 ? sidekickName : `${sidekickName} +${roles.length}`;
  const pickerProps: SidekickPickerProps = {
    environmentId: props.environmentId,
    instanceEntries: props.instanceEntries,
    modelOptionsByInstance: props.modelOptionsByInstance,
    planModeEnabled: props.planModeEnabled,
    disabled: props.disabled,
  };
  const change = (next: OrchestrationV2ThreadFusion) => {
    setNote(null);
    props.onFusionChange(next);
  };
  const setRoles = (next: ReadonlyArray<OrchestrationV2FusionRole>) =>
    change(next.length === 0 ? { sidekick } : { sidekick, roles: next });
  const updateRole = (index: number, patch: Partial<OrchestrationV2FusionRole>) =>
    setRoles(roles.map((role, at) => (at === index ? { ...role, ...patch } : role)));
  // Each sidekick thread is recognised by its model, so two sidekicks can't share one.
  const pickModel = (roleIndex: number | null, next: ModelSelection, apply: () => void) => {
    const owner = fusionModelOwner(fusion, next, roleIndex);
    if (owner === null) apply();
    else setNote(`${modelName(next)} already runs ${owner}. Each sidekick needs its own model.`);
  };
  const candidateModels = function* (): Generator<ModelSelection> {
    const entries = [...props.instanceEntries]
      .filter((entry) => entry.isAvailable)
      .sort(
        (a, b) =>
          Number(b.instanceId === sidekick.instanceId) -
          Number(a.instanceId === sidekick.instanceId),
      );
    for (const entry of entries) {
      for (const option of props.modelOptionsByInstance.get(entry.instanceId) ?? []) {
        yield createModelSelection(entry.instanceId, option.slug);
      }
    }
  };
  const addRole = () => {
    const next = addFusionRole(fusion, candidateModels());
    if (next === null) setNote("Every available model already runs a sidekick.");
    else change(next);
  };

  return (
    <Popover onOpenChange={(open) => (open ? null : setNote(null))}>
      <PopoverTrigger
        render={
          <ComposerControl
            size={props.size}
            aria-pressed
            disabled={props.disabled}
            aria-label={
              roles.length === 0
                ? `Fusion on, sidekick ${sidekickName}`
                : `Fusion on, sidekick ${sidekickName} and ${roles.length} more`
            }
          />
        }
      >
        <ComposerControlIcon icon={CombineIcon} size={props.size} />
        {/* not-sr-only resets wrapping, so the inner span does the truncating. */}
        <span data-composer-control-label className="sr-only sm:not-sr-only">
          <span className="block max-w-32 truncate">{pillLabel}</span>
        </span>
        <ComposerControlChevron size={props.size} />
      </PopoverTrigger>
      <PopoverPopup
        side="top"
        align="start"
        width={roles.length === 0 ? "md" : "lg"}
        padding="compact"
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">Fusion</p>
            <p className="text-xs text-muted-foreground">
              {props.rolesSupported
                ? "The thread's model leads and reviews. Sidekicks write the code, each in one ongoing sub-thread. The lead sends each step to the sidekick whose role fits it."
                : "The thread's model leads and reviews. The sidekick writes the code in one ongoing sub-thread."}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {roles.length === 0 ? "Sidekick" : "Default sidekick · steps no role fits"}
            </p>
            <SidekickModelPicker
              {...pickerProps}
              sidekick={sidekick}
              ariaLabel="Fusion sidekick model"
              onChange={(next) =>
                pickModel(null, next, () => change({ ...fusion, sidekick: next }))
              }
            />
          </div>
          {roles.map((role, index) => (
            // Unique per lineup: no two sidekicks share a model.
            <div
              key={`${role.sidekick.instanceId}/${role.sidekick.model}`}
              className="flex flex-col gap-1 border-t pt-3"
            >
              <div className="flex min-w-0 items-center gap-1">
                <CommitOnBlurInput
                  value={role.name}
                  placeholder="Role name"
                  ariaLabel={`Name of sidekick ${index + 1}`}
                  disabled={props.disabled}
                  commit={(name) => {
                    const problem = fusionRoleNameProblem(fusion, name, index);
                    if (problem === null) updateRole(index, { name: name.trim() });
                    else setNote(problem);
                  }}
                />
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove the ${role.name} sidekick`}
                  disabled={props.disabled}
                  onClick={() => setRoles(roles.filter((_, at) => at !== index))}
                >
                  <XIcon />
                </Button>
              </div>
              <CommitOnBlurInput
                value={role.useFor}
                placeholder="Use for, e.g. React components and CSS"
                ariaLabel={`What the ${role.name} sidekick is for`}
                disabled={props.disabled}
                commit={(useFor) => updateRole(index, { useFor: useFor.trim().slice(0, 300) })}
              />
              <SidekickModelPicker
                {...pickerProps}
                sidekick={role.sidekick}
                ariaLabel={`Model of the ${role.name} sidekick`}
                onChange={(next) =>
                  pickModel(index, next, () => updateRole(index, { sidekick: next }))
                }
              />
            </div>
          ))}
          {note === null ? null : (
            <p role="status" className="text-xs text-destructive">
              {note}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1">
            {props.rolesSupported && roles.length < MAX_FUSION_ROLES ? (
              <Button size="xs" variant="outline" disabled={props.disabled} onClick={addRole}>
                <PlusIcon />
                Add sidekick
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" onClick={() => props.onFusionChange(null)}>
              Turn off Fusion
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
});
