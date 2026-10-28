import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import {
  linkedTicketOf,
  ticketBranchName,
  ticketPrompt,
} from "@t3tools/client-runtime/jira-ticket-draft";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { JiraError, type JiraIssueSummary } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, View, type TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SearchField } from "../../components/ui/SearchField";
import { Toolbar } from "../../components/ui/Toolbar";
import { cn } from "../../lib/cn";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useNativeMailSearchToolbar } from "../../native/use-native-mail-search-toolbar";
import { serverEnvironment } from "../../state/server";
import { getComposerDraftSnapshot, setComposerDraftText } from "../../state/use-composer-drafts";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  createNativeMailSearchToolbarItem,
  NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET,
} from "../layout/native-mail-search-toolbar";
import { useNewTaskFlow } from "../threads/new-task-flow-provider";
import { mergeTicketPrompt, setTicketDraft } from "./ticketDrafts";
import { runPromptEnhancement } from "../promptEnhancement/promptEnhancementStore";

const SEARCH_DELAY_MS = 250;
const TITLE = "Jira ticket";
const SEARCH_PLACEHOLDER = "SHP-4158 or search your tickets";

const isJiraError = Schema.is(JiraError);

function failureText(failure: unknown, fallback: string): string {
  return failure instanceof Error && failure.message ? failure.message : fallback;
}

type SearchResult =
  | { readonly state: "done"; readonly issues: ReadonlyArray<JiraIssueSummary> }
  | { readonly state: "failed"; readonly detail: string; readonly notConfigured: boolean };

/**
 * Lists the environment's Jira tickets for the new-task draft. Picking one fills the draft the
 * way web's ticket dialog does: a worktree on the ticket's branch, the ticket as the message, and
 * the ticket linked to the thread once it is sent.
 */
export function StartFromTicketRouteScreen() {
  const flow = useNewTaskFlow();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const searchRef = useRef<TextInputInstance>(null);
  const usesNativeMailSearchToolbar = useNativeMailSearchToolbar();
  const environmentId = flow.selectedProject?.environmentId ?? null;
  const canSearch = useAtomValue(serverEnvironment.jiraSearchIssues.permissionAtom(environmentId));
  const searchIssues = useAtomCommand(serverEnvironment.jiraSearchIssues, {
    reportFailure: false,
  });
  const getIssue = useAtomCommand(serverEnvironment.jiraGetIssue, { reportFailure: false });
  const enhancePrompt = useAtomCommand(serverEnvironment.jiraEnhanceTicketPrompt, {
    reportFailure: false,
  });
  const [query, setQuery] = useState("");
  // Results remember the search they answer, so a newer query reads as loading.
  const [answered, setAnswered] = useState<{
    readonly request: string;
    readonly result: SearchResult;
  } | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const mounted = useRef(true);
  // oxlint-disable-next-line t3code/react-effect-budget -- Track unmount so a slow ticket fetch does not update a closed screen.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const request = `${environmentId}\u0000${query.trim()}`;
  const search = answered?.request === request ? answered.result : null;

  // oxlint-disable-next-line t3code/react-effect-budget -- Debounce the Jira search for the typed query and drop answers to stale ones.
  useEffect(() => {
    if (environmentId === null || !canSearch) return;
    let cancelled = false;
    const trimmed = query.trim();
    const timer = setTimeout(
      () => {
        void searchIssues({ environmentId, input: { query: trimmed } }).then((result) => {
          if (cancelled || isAtomCommandInterrupted(result)) return;
          const failure = result._tag === "Success" ? null : squashAtomCommandFailure(result);
          setAnswered({
            request,
            result:
              result._tag === "Success"
                ? { state: "done", issues: result.value.issues }
                : {
                    state: "failed",
                    detail: failureText(failure, "Could not search Jira."),
                    notConfigured: isJiraError(failure) && failure.reason === "notConfigured",
                  },
          });
        });
      },
      trimmed.length === 0 ? 0 : SEARCH_DELAY_MS,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canSearch, environmentId, query, request, searchIssues]);

  const openTicket = async (issue: JiraIssueSummary) => {
    const draftKey = flow.draftKey;
    const projectId = flow.selectedProject?.id;
    if (environmentId === null || !projectId || draftKey === null || openingKey !== null) return;
    void Haptics.selectionAsync();
    setOpeningKey(issue.key);
    const detail = await getIssue({ environmentId, input: { key: issue.key } });
    if (!mounted.current) return;
    setOpeningKey(null);
    if (detail._tag !== "Success") {
      if (!isAtomCommandInterrupted(detail))
        Dialog.alert(
          "Couldn't open the ticket",
          failureText(squashAtomCommandFailure(detail), "Try again."),
        );
      return;
    }
    // A ticket gets its own branch, which only a new worktree can take.
    if (flow.canChooseWorkspace && flow.workspaceMode !== "worktree") {
      flow.setWorkspaceMode("worktree");
    }
    setTicketDraft(draftKey, {
      ticket: linkedTicketOf(detail.value),
      branch: ticketBranchName(detail.value),
    });
    const template = ticketPrompt(detail.value);
    const filled = mergeTicketPrompt(getComposerDraftSnapshot(draftKey).text, template);
    setComposerDraftText(draftKey, filled);
    navigation.goBack();
    // The plain template is already a good draft, so a failed rewrite stays quiet.
    void runPromptEnhancement({
      draftKey,
      replace: template,
      request: () =>
        enhancePrompt({ environmentId, input: { key: issue.key, projectId } }).then((result) =>
          result._tag === "Success" ? result.value : { error: "" },
        ),
    });
  };

  const status = ((): { readonly text: string; readonly loading: boolean } | null => {
    if (!canSearch) return { text: "You don't have access to search Jira here.", loading: false };
    if (search === null) return { text: "Searching…", loading: true };
    if (search.state === "failed")
      return {
        text: search.notConfigured
          ? "Jira isn't connected on this environment. Connect it in Settings → Integrations → Jira on desktop or web."
          : search.detail,
        loading: false,
      };
    if (search.issues.length === 0)
      return {
        text:
          query.trim().length === 0 ? "No open tickets are assigned to you." : "No tickets match.",
        loading: false,
      };
    return null;
  })();
  const issues = search?.state === "done" ? search.issues : [];

  const content = (
    <ScrollView
      className="flex-1 bg-sheet android:bg-sheet-solid"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        flexGrow: 1,
        gap: 8,
        paddingBottom: usesNativeMailSearchToolbar
          ? NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET + 16
          : Math.max(insets.bottom, 16) + 16,
        paddingHorizontal: 16,
        paddingTop: 16,
      }}
    >
      <Text className="px-1 text-xs text-foreground-muted">
        {query.trim().length === 0 ? "Assigned to you · open" : "Matching tickets"}
      </Text>
      {status ? (
        <View className="flex-1 items-center justify-center gap-3 px-4 py-8">
          {status.loading ? <AppActivityIndicator /> : null}
          <Text
            accessibilityLiveRegion="polite"
            className="text-center text-sm text-foreground-muted"
          >
            {status.text}
          </Text>
        </View>
      ) : (
        <View
          className={cn(
            "overflow-hidden bg-grouped-card",
            Platform.OS === "android" ? "rounded-[28px]" : "rounded-2xl",
          )}
        >
          {issues.map((issue, index) => (
            <Pressable
              key={issue.key}
              accessibilityRole="button"
              accessibilityLabel={`${issue.key}, ${issue.title}, ${issue.status}`}
              accessibilityHint="Fills the new task with this ticket"
              accessibilityState={{ busy: openingKey === issue.key }}
              disabled={openingKey !== null}
              onPress={() => void openTicket(issue)}
              className={cn(
                "min-h-14 flex-row items-center gap-3 bg-grouped-card px-4 py-3 active:bg-subtle",
                index < issues.length - 1 && "border-b border-border-subtle",
              )}
              style={{ opacity: openingKey !== null && openingKey !== issue.key ? 0.45 : 1 }}
            >
              <SymbolView
                name={issue.isBug ? "exclamationmark.circle" : "ticket"}
                size={17}
                tintColorClassName={issue.isBug ? "accent-danger-foreground" : "accent-icon-muted"}
                type="monochrome"
              />
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
                  {issue.title || issue.key}
                </Text>
                <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                  {issue.key} · {issue.status}
                </Text>
              </View>
              {openingKey === issue.key ? <AppActivityIndicator /> : null}
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );

  if (Platform.OS === "android") {
    return (
      <View className="flex-1 bg-sheet" collapsable={false}>
        <NativeStackScreenOptions options={{ headerShown: false }} />
        <AndroidScreenHeader title={TITLE} hideBottomBorder onBack={() => navigation.goBack()} />
        <View className="bg-header px-4 pb-3 pt-1">
          <SearchField
            inputRef={searchRef}
            autoFocus={false}
            accessibilityLabel="Search tickets"
            clearAccessibilityLabel="Clear ticket search"
            onChangeText={setQuery}
            placeholder={SEARCH_PLACEHOLDER}
            value={query}
          />
        </View>
        <ScreenContent>{content}</ScreenContent>
      </View>
    );
  }

  return (
    <>
      <NativeStackScreenOptions
        options={{
          headerShown: true,
          title: TITLE,
          unstable_headerToolbarItems: usesNativeMailSearchToolbar
            ? () => [
                createNativeMailSearchToolbarItem({
                  onSearchTextChange: setQuery,
                  placeholder: SEARCH_PLACEHOLDER,
                  searchTextChangeId: "new-task-jira-search-text",
                  showsSearchDismissButton: true,
                }),
              ]
            : undefined,
          headerSearchBarOptions: usesNativeMailSearchToolbar
            ? undefined
            : {
                allowToolbarIntegration: true,
                autoCapitalize: "none",
                hideNavigationBar: false,
                obscureBackground: false,
                placeholder: SEARCH_PLACEHOLDER,
                onChangeText: (event) => setQuery(event.nativeEvent.text),
                onCancelButtonPress: () => setQuery(""),
              },
        }}
      />
      {usesNativeMailSearchToolbar ? null : (
        <Toolbar placement="bottom">
          <Toolbar.SearchBarSlot />
        </Toolbar>
      )}
      {content}
    </>
  );
}
