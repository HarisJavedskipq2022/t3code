import { useAtomValue } from "@effect/atom-react";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { TicketIcon } from "lucide-react";

import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { environmentServerConfigsAtom } from "../../state/server";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import { InlineButton } from "../ui/button";
import { openStartFromTicket } from "./StartFromTicketDialog";

/**
 * The environments with a Jira login, as one string so provider status pushes,
 * which replace every server config, do not re-render the buttons below.
 */
const jiraEnvironmentsAtom = Atom.make((get) =>
  [...get(environmentServerConfigsAtom)]
    .filter(([, config]) => {
      const jira = config?.settings.jira;
      return Boolean(jira?.siteUrl && jira.email && jira.apiToken);
    })
    .map(([environmentId]) => environmentId)
    .join("\u0000"),
);

function useJiraEnvironmentIds(): ReadonlyArray<string> {
  const joined = useAtomValue(jiraEnvironmentsAtom);
  return joined.length === 0 ? [] : joined.split("\u0000");
}

/** Next to New thread in the sidebar, once any environment has Jira connected. */
export function SidebarStartFromTicketButton() {
  const environments = useJiraEnvironmentIds();
  const { defaultProjectRef } = useHandleNewThread();
  if (environments.length === 0) return null;
  return (
    <SidebarHeaderIconButton
      label="Start from Jira ticket"
      onClick={() => openStartFromTicket(defaultProjectRef ?? null)}
    >
      <TicketIcon />
    </SidebarHeaderIconButton>
  );
}

/** Beside "or start without a project", for a project whose environment has Jira. */
export function DraftStartFromTicketLink({
  projectRef,
}: {
  readonly projectRef: ScopedProjectRef | null;
}) {
  const environments = useJiraEnvironmentIds();
  if (projectRef === null || !environments.includes(projectRef.environmentId)) return null;
  return (
    <InlineButton
      tone="muted"
      className="pointer-events-auto"
      onClick={() => openStartFromTicket(projectRef)}
    >
      or start from a Jira ticket
    </InlineButton>
  );
}
