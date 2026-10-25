import { useNavigation } from "@react-navigation/native";
import { isJiraConfigured } from "@t3tools/client-runtime/jira-ticket-draft";
import type { EnvironmentId } from "@t3tools/contracts";
import { Keyboard } from "react-native";

import { ComposerInlineControl } from "../../components/ComposerToolbar";
import { useEnvironmentServerConfig } from "../../state/entities";

/** Under the new-task headline, for a project whose environment has Jira connected. */
export function StartFromTicketLink(props: {
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
}) {
  const navigation = useNavigation();
  const configured = isJiraConfigured(
    useEnvironmentServerConfig(props.environmentId)?.settings.jira,
  );
  if (!configured) return null;
  return (
    <ComposerInlineControl
      accessibilityHint="Lists your Jira tickets to start this task from"
      chevronDirection="right"
      disabled={props.disabled}
      icon="ticket"
      label="Start from a Jira ticket"
      maxWidth={260}
      onPress={() => {
        Keyboard.dismiss();
        navigation.navigate("NewTaskJira");
      }}
    />
  );
}
