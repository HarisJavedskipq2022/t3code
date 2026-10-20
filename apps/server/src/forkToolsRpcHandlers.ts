import { ForkToolsRpcGroup, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as WorktreeServices from "./project/WorktreeServices.ts";
import * as VetService from "./vet/VetService.ts";

/** Vet and app-service RPCs, built apart from the core group; see ForkToolsRpcGroup. */
export const layerForkToolsRpcHandlers = ForkToolsRpcGroup.toLayer(
  Effect.gen(function* () {
    const vet = yield* VetService.VetService;
    const worktreeServices = yield* WorktreeServices.WorktreeServices;
    return ForkToolsRpcGroup.of({
      [WS_METHODS.vetWatch]: (input) => vet.watch(input),
      [WS_METHODS.vetRun]: (input) => vet.run(input),
      [WS_METHODS.vetCancel]: (input) => vet.cancel(input),
      [WS_METHODS.vetUpdateFinding]: (input) => vet.updateFinding(input),
      [WS_METHODS.worktreeServicesWatch]: (input) => worktreeServices.watch(input),
      [WS_METHODS.worktreeServicesControl]: (input) => worktreeServices.control(input),
    });
  }),
);
