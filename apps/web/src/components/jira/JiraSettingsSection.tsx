import { AuthProvidersManageScope, type JiraSettingsPatch } from "@t3tools/contracts";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { formatEnvironmentQueryError } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SecretInput } from "../settings/SecretInput";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import { searchableSetting } from "../settings/settingsSearch";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { useScopedSettings } from "../settings/useScopedSettings";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Switch } from "../ui/switch";

type ConnectionCheck =
  | { readonly state: "idle" }
  | { readonly state: "checking" }
  | { readonly state: "ok"; readonly name: string }
  | { readonly state: "failed"; readonly detail: string };

/**
 * One Jira Cloud login per environment. The token is stored on that server and
 * only its presence comes back, so each field saves on its own when it loses focus.
 */
export function JiraSettingsSection() {
  const { environment } = useSettingsScope();
  const connected =
    environment?.connection.phase === "connected" && environment.serverConfig !== null;
  const environmentId = connected ? environment.environmentId : null;
  const jira = useScopedSettings((settings) => settings.jira);
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const testConnection = useAtomCommand(serverEnvironment.jiraTestConnection, {
    reportFailure: false,
  });
  const [check, setCheck] = useState<ConnectionCheck>({ state: "idle" });
  const readOnly = environmentId === null || !canManage;
  const tokenConfigured = jira.apiToken !== "";
  const configured = jira.siteUrl !== "" && jira.email !== "" && tokenConfigured;

  const save = (patch: JiraSettingsPatch) => {
    setCheck({ state: "idle" });
    updateSettings({ jira: patch });
  };

  const runCheck = async () => {
    if (environmentId === null) return;
    setCheck({ state: "checking" });
    const result = await testConnection({ environmentId, input: {} });
    setCheck(
      result._tag === "Success"
        ? { state: "ok", name: result.value.displayName }
        : { state: "failed", detail: formatEnvironmentQueryError(result.cause) },
    );
  };

  return (
    <SettingsSection
      {...searchableSetting("jira")}
      headerAction={
        configured ? (
          <Button
            size="xs"
            variant="outline"
            disabled={environmentId === null || check.state === "checking"}
            onClick={() => void runCheck()}
          >
            {check.state === "checking" ? "Checking…" : "Test connection"}
          </Button>
        ) : null
      }
    >
      <SettingsRow
        title="Site"
        description="Your Jira Cloud address, such as yourteam.atlassian.net."
        status={
          check.state === "ok" ? (
            <span className="text-success-foreground">Connected as {check.name}</span>
          ) : check.state === "failed" ? (
            <span className="text-destructive-foreground">{check.detail}</span>
          ) : null
        }
        control={
          <DraftInput
            aria-label="Jira site"
            className="w-56"
            placeholder="yourteam.atlassian.net"
            value={jira.siteUrl}
            disabled={readOnly}
            onCommit={(siteUrl) => save({ siteUrl })}
          />
        }
      />
      <SettingsRow
        title="Email"
        description="The Atlassian account the API token belongs to."
        control={
          <DraftInput
            aria-label="Jira email"
            className="w-56"
            type="email"
            placeholder="you@company.com"
            value={jira.email}
            disabled={readOnly}
            onCommit={(email) => save({ email })}
          />
        }
      />
      <SettingsRow
        title="API token"
        description="Create one at id.atlassian.com under Security → API tokens. It stays on this server."
        control={
          <SecretInput
            aria-label="Jira API token"
            className="w-56"
            configured={tokenConfigured}
            value=""
            disabled={readOnly}
            onCommit={(apiToken) => save({ apiToken })}
          />
        }
      />
      <SettingsRow
        title="Comment the pull request on the ticket"
        description="When a ticket's thread opens its first pull request, post the link on the ticket."
        control={
          <Switch
            aria-label="Comment the pull request on the ticket"
            checked={jira.commentOnPullRequest}
            disabled={readOnly}
            onCheckedChange={(checked) => save({ commentOnPullRequest: Boolean(checked) })}
          />
        }
      />
      <SettingsRow
        title="When the pull request opens, move to"
        description="A status name from your workflow, such as In Review. Leave empty to keep the status."
        control={
          <DraftInput
            aria-label="Status when the pull request opens"
            className="w-40"
            placeholder="In Review"
            value={jira.openedTransition}
            disabled={readOnly}
            onCommit={(openedTransition) => save({ openedTransition })}
          />
        }
      />
      <SettingsRow
        title="When the pull request merges, move to"
        description="Leave empty to keep the status."
        control={
          <DraftInput
            aria-label="Status when the pull request merges"
            className="w-40"
            placeholder="Done"
            value={jira.mergedTransition}
            disabled={readOnly}
            onCommit={(mergedTransition) => save({ mergedTransition })}
          />
        }
      />
      {configured && !readOnly ? (
        <SettingsRow
          title="Disconnect Jira"
          description="Deletes the API token from this server. Linked tickets stay on their threads."
          control={
            <Button
              size="xs"
              variant="ghost"
              onClick={() => save({ siteUrl: "", email: "", apiToken: "" })}
            >
              Disconnect
            </Button>
          }
        />
      ) : null}
    </SettingsSection>
  );
}
