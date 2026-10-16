import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createVetEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    live: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:vet:watch",
      tag: WS_METHODS.vetWatch,
    }),
    run: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:vet:run",
      tag: WS_METHODS.vetRun,
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:vet:cancel",
      tag: WS_METHODS.vetCancel,
    }),
    updateFinding: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:vet:update-finding",
      tag: WS_METHODS.vetUpdateFinding,
    }),
  };
}
