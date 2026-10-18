import type { ProjectScript } from "@t3tools/contracts";
import { useState } from "react";

import { projectScriptServiceConflict } from "~/projectScripts";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

export interface ProjectScriptServiceInput {
  /** Marks the action as a long-running app service. Defaults to false. */
  service?: boolean;
  /** Base port for the service; the worktree offset is added at runtime. */
  servicePort?: number | null;
}

export const EMPTY_PROJECT_SCRIPT_SERVICE_INPUT = {
  service: false,
  servicePort: null,
} satisfies ProjectScriptServiceInput;

export function projectScriptServiceInput(script: ProjectScript) {
  return {
    service: script.service ?? false,
    servicePort: script.servicePort ?? null,
  } satisfies ProjectScriptServiceInput;
}

/** The action editor's app-service switch and base port. */
export function useProjectScriptServiceFields() {
  const [service, setService] = useState(false);
  const [servicePortInput, setServicePortInput] = useState("");

  const reset = (initial: ProjectScriptServiceInput) => {
    setService(initial.service ?? false);
    setServicePortInput(initial.servicePort == null ? "" : String(initial.servicePort));
  };

  /** The fields to save, or the message saying why they cannot be saved. */
  const parse = (roles: {
    runOnWorktreeCreate: boolean;
    runOnSettle: boolean;
  }): { service: boolean; servicePort: number | null } | string => {
    const serviceConflict = projectScriptServiceConflict({ service, ...roles });
    if (serviceConflict) return serviceConflict;
    const trimmedServicePort = servicePortInput.trim();
    if (!service || trimmedServicePort.length === 0) return { service, servicePort: null };
    const parsedServicePort = Number(trimmedServicePort);
    if (
      !Number.isInteger(parsedServicePort) ||
      parsedServicePort < 1 ||
      parsedServicePort > 65535
    ) {
      return "Base port must be a whole number between 1 and 65535.";
    }
    return { service, servicePort: parsedServicePort };
  };

  const controls = (
    <>
      <div className="space-y-1.5 rounded-md border border-border/70 px-3 py-2 dark:border-transparent dark:bg-white/[0.035]">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>App service</span>
          <Switch
            id="script-service"
            checked={service}
            onCheckedChange={(checked) => setService(Boolean(checked))}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Starts with the worktree's services in its own terminal, not as an ordinary action. T3
          Code adds this checkout's port offset to the base port and passes the result as{" "}
          <code>PORT</code> and <code>T3CODE_SERVICE_PORT</code>; the command must read one of them.
        </p>
      </div>
      {service ? (
        <div className="space-y-1.5">
          <Label htmlFor="script-service-port">Base port (optional)</Label>
          <Input
            id="script-service-port"
            inputMode="numeric"
            placeholder="3000"
            value={servicePortInput}
            onChange={(event) => setServicePortInput(event.target.value)}
          />
        </div>
      ) : null}
    </>
  );

  return { reset, parse, controls };
}
