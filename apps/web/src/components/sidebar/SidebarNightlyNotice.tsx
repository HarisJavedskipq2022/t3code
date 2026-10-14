import { useAtomValue } from "@effect/atom-react";
import type { DesktopForkSyncResult } from "@t3tools/contracts";
import { CircleDashedIcon, DownloadIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { readLocalApi } from "../../localApi";
import { primaryServerConfigAtom } from "../../state/server";
import {
  fetchUpstreamReleaseTags,
  newerUpstreamNightly,
  UPSTREAM_RELEASE_TAG_URL,
} from "../../upstreamNightly";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DISMISSED_TAG_KEY = "t3code:fork-nightly-dismissed";

function readDismissedTag(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_TAG_KEY);
  } catch {
    return null;
  }
}

type SyncState = "idle" | "syncing" | DesktopForkSyncResult;

const SYNC_LOG = "~/.t3code-fork/sync.log";

/**
 * Fork-only: says when upstream has published a nightly this build has not
 * synced to yet. On a fork desktop build it also runs scripts/fork-sync.sh,
 * which merges, tests and builds it, then restarts into the new build.
 */
export function SidebarNightlyNotice() {
  const serverVersion = useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;
  const [tags, setTags] = useState<ReadonlyArray<string>>([]);
  const [dismissedTag, setDismissedTag] = useState(readDismissedTag);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;

  useEffect(() => {
    const controller = new AbortController();
    const check = () => {
      void fetchUpstreamReleaseTags(controller.signal).then(setTags);
    };
    check();
    const intervalId = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, []);

  const tag = serverVersion === null ? null : newerUpstreamNightly(serverVersion, tags);
  if (tag === null || tag === dismissedTag) return null;

  const label = tag.replace(/^v[\d.]+-nightly\./, "");
  const runForkSync = bridge?.runForkSync;
  const sync = runForkSync
    ? () => {
        setSyncState("syncing");
        void runForkSync().then(setSyncState, () => setSyncState("failed"));
      }
    : null;
  const download = <DownloadIcon className="size-3.5 shrink-0" />;
  const warning = <TriangleAlertIcon className="size-3.5 shrink-0 text-warning" />;
  const presentation = {
    idle: {
      icon: download,
      title: `Nightly ${label} is out`,
      hint: sync
        ? "Open the release notes."
        : "Open the release notes. Run “Sync with nightly” in the t3code project to build it.",
    },
    syncing: {
      icon: <CircleDashedIcon className="fork-working-spin size-3.5 shrink-0 text-primary" />,
      title: `Syncing nightly ${label}…`,
      hint: `Merging, testing and building. Progress is in ${SYNC_LOG}.`,
    },
    built: { icon: download, title: `Nightly ${label} is built`, hint: "Restart to install it." },
    failed: {
      icon: warning,
      title: "Nightly sync failed",
      hint: `See ${SYNC_LOG}. The fork branch is unchanged.`,
    },
    unavailable: {
      icon: warning,
      title: "Nightly sync failed",
      hint: "This build cannot find scripts/fork-sync.sh.",
    },
  }[syncState];
  const action =
    syncState === "built"
      ? { label: "Restart", run: () => void bridge?.quitToInstallForkSync?.() }
      : sync && (syncState === "idle" || syncState === "failed")
        ? { label: syncState === "failed" ? "Retry" : "Sync", run: sync }
        : null;
  const dismiss = () => {
    setDismissedTag(tag);
    try {
      window.localStorage.setItem(DISMISSED_TAG_KEY, tag);
    } catch {
      // Not remembered across reloads; the notice is still hidden for now.
    }
  };

  return (
    <div className="relative flex min-h-7 w-full shrink-0 items-center overflow-hidden rounded-lg bg-sidebar-control-surface text-2xs leading-4 font-medium text-sidebar-foreground has-[button[data-nightly-notice-main]:hover]:bg-sidebar-row-hover">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-nightly-notice-main
              className="relative z-[1] flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
              onClick={() => {
                void readLocalApi()?.shell.openExternal(`${UPSTREAM_RELEASE_TAG_URL}/${tag}`);
              }}
            >
              {presentation.icon}
              <span className="min-w-0 wrap-break-word">{presentation.title}</span>
            </button>
          }
        />
        <TooltipPopup side="top">{presentation.hint}</TooltipPopup>
      </Tooltip>
      {action ? (
        <button
          type="button"
          className="relative z-[1] mr-0.5 flex h-5 shrink-0 cursor-pointer items-center rounded-md px-1.5 text-2xs font-medium text-primary outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={action.run}
        >
          {action.label}
        </button>
      ) : null}
      {syncState === "syncing" ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Dismiss nightly notice"
                className="relative z-[1] mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-70 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={dismiss}
              >
                <XIcon className="size-3.5 shrink-0" />
              </button>
            }
          />
          <TooltipPopup side="top">Hide until the next nightly</TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}
