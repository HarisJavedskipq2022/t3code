#!/usr/bin/env bash
# Brings the `fork` branch up to the newest upstream T3 Code nightly tag,
# checks the fork patches, rebuilds HCode, and installs it.
#
#   scripts/fork-sync.sh               sync to the newest nightly, build, install
#   scripts/fork-sync.sh --force       rebuild even when already on the newest nightly
#   scripts/fork-sync.sh --install     only install the newest built DMG
#   scripts/fork-sync.sh --schedule    run the sync daily at 04:00 through launchd
#   scripts/fork-sync.sh --unschedule  remove that daily run
#
# The nightly is merged on a fork-sync/<tag> branch first; `fork` only
# fast-forwards to it after the typecheck, tests and build pass, so a failure
# leaves `fork` untouched and the candidate branch kept for inspection.
# Installing waits for HCode to be closed so running agents are not interrupted.
# launchd runs a missed time once the Mac wakes; a Mac that is shut down skips it.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="HCode"
APP_PATH="/Applications/$APP_NAME.app"
# The app's name before the rename; the next install replaces it.
OLD_APP_PATH="/Applications/T3 Code Fork.app"
STATE_DIR="$HOME/.t3code-fork"
LOG="$STATE_DIR/sync.log"
WAITER_PID="$STATE_DIR/install-waiter.pid"
MONITOR="native/resource-monitor/target/aarch64-apple-darwin/release/t3-resource-monitor"
SCHEDULE_LABEL="com.harisjaved.hcode-fork-sync"
SCHEDULE_PLIST="$HOME/Library/LaunchAgents/$SCHEDULE_LABEL.plist"
# A clean textual merge can still break fork code that uses something upstream moved.
TYPECHECKED_PACKAGES=(
  packages/contracts
  packages/shared
  packages/client-runtime
  apps/server
  apps/web
  apps/desktop
  apps/mobile
)

NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v24.*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="${NODE_BIN:+$NODE_BIN:}$HOME/.local/share/vite-plus/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$STATE_DIR"
exec > >(tee -a "$LOG") 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') fork-sync $*"

notify() {
  osascript -e "display notification \"$1\" with title \"$APP_NAME\"" >/dev/null 2>&1 || true
  echo "$1"
}
fail() {
  notify "Sync stopped: $1 (log: $LOG)"
  exit 1
}

# A waiter left by an earlier run would reinstall and reopen the app on the
# next quit, so a new waiter or a manual install replaces it.
cancel_pending_install() {
  local pid
  pid="$(cat "$WAITER_PID" 2>/dev/null)" || return 0
  rm -f "$WAITER_PID"
  # The waiter runs `--install` itself once the app is gone.
  [ "$pid" = "$PPID" ] && return 0
  # Only signal the PID while it is still that waiter, never a reused one.
  if ps -o command= -p "$pid" 2>/dev/null | grep -qF -- "--install && sleep 2"; then
    kill "$pid" 2>/dev/null || true
  fi
}

install_latest() {
  local dmg mount
  dmg="$(ls -t "$REPO"/release/*-arm64.dmg 2>/dev/null | head -1)"
  [ -n "$dmg" ] || fail "no built DMG in release/"
  cancel_pending_install
  if pgrep -f "$APP_PATH/Contents/MacOS/|$OLD_APP_PATH/Contents/MacOS/" >/dev/null; then
    # Run from the app's own terminal, so wait in a new session that outlives
    # the app, then install and reopen it once the user quits.
    python3 -c 'import subprocess, sys; print(subprocess.Popen(sys.argv[1:], start_new_session=True,
      stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).pid)' \
      /bin/bash -c 'while pgrep -f "$0/Contents/MacOS/|$2/Contents/MacOS/" >/dev/null; do sleep 2; done
        "$1" --install && sleep 2 && open "$0"' "$APP_PATH" "$REPO/scripts/fork-sync.sh" "$OLD_APP_PATH" \
      >"$WAITER_PID"
    notify "Update built. Quit $APP_NAME (Cmd-Q); it installs and reopens on its own."
    return 0
  fi
  mount="$(hdiutil attach -nobrowse -readonly "$dmg" | awk -F'\t' '/\/Volumes\//{print $NF}' | tail -1)"
  local old
  for old in "$APP_PATH" "$OLD_APP_PATH"; do
    if [ -d "$old" ]; then
      mv "$old" "$HOME/.Trash/$(basename "$old" .app) $(date +%Y%m%d-%H%M%S).app"
    fi
  done
  ditto "$mount/$APP_NAME.app" "$APP_PATH"
  hdiutil detach "$mount" -quiet
  notify "Installed $(basename "$dmg" .dmg)."
}

schedule() {
  mkdir -p "$(dirname "$SCHEDULE_PLIST")"
  cat >"$SCHEDULE_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SCHEDULE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/fork-sync.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>4</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$STATE_DIR/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>$STATE_DIR/launchd.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$SCHEDULE_LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$SCHEDULE_PLIST"
  echo "Scheduled a daily sync at 04:00 ($SCHEDULE_PLIST)."
}

unschedule() {
  launchctl bootout "gui/$(id -u)/$SCHEDULE_LABEL" 2>/dev/null || true
  rm -f "$SCHEDULE_PLIST"
  echo "Removed the daily sync."
}

typecheck_all() {
  local pkg
  for pkg in "${TYPECHECKED_PACKAGES[@]}"; do
    if ! (cd "$REPO/$pkg" && vp run typecheck >/dev/null 2>&1); then
      echo "typecheck failed in $pkg"
      return 1
    fi
  done
}

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --install) install_latest; exit 0 ;;
    --schedule) schedule; exit 0 ;;
    --unschedule) unschedule; exit 0 ;;
    *) fail "unknown option $arg" ;;
  esac
done

cd "$REPO"
[ "$(git branch --show-current)" = "fork" ] || fail "checkout is not on the fork branch"
[ -z "$(git status --porcelain)" ] || fail "checkout has uncommitted changes"

git fetch upstream --tags --quiet || fail "could not fetch upstream"
TAG="$(git tag -l 'v*-nightly.*' --sort=-v:refname | head -1)"
[ -n "$TAG" ] || fail "no upstream nightly tag found"

if git merge-base --is-ancestor "$TAG" fork; then
  echo "Already on $TAG."
  [ "$FORCE" = 1 ] || exit 0
  CANDIDATE=fork
else
  CANDIDATE="fork-sync/$TAG"
  # A candidate left by an earlier failed run for this tag starts over from `fork`.
  git switch --quiet -C "$CANDIDATE" fork || fail "could not create $CANDIDATE"
  git merge --quiet --no-edit "$TAG" || {
    git merge --abort
    git switch --quiet fork
    git branch -D "$CANDIDATE" >/dev/null 2>&1 || true
    fail "fork patches conflict with $TAG; resolve on a branch by hand"
  }
fi

stop() {
  git reset --hard --quiet
  git switch --quiet fork
  fail "$1; fork is unchanged and $CANDIDATE is kept"
}

vp i >/dev/null || stop "dependency install failed"
typecheck_all || stop "typecheck failed on $TAG"
vp test run scripts/build-desktop-artifact.test.ts apps/desktop/src/app/DesktopUserData.test.ts \
  apps/server/src/vet/VetService.test.ts \
  || stop "fork patch tests failed on $TAG"

# The build reuses the native monitor shipped in an installed T3 Code app instead of needing Rust.
if [ ! -x "$MONITOR" ]; then
  source_monitor="$(ls /Applications/T3\ Code*/Contents/Resources/resource-monitor/t3-resource-monitor 2>/dev/null | head -1)"
  [ -n "$source_monitor" ] || stop "no t3-resource-monitor to reuse"
  mkdir -p "$(dirname "$MONITOR")"
  cp "$source_monitor" "$MONITOR"
fi
# Stamp the nightly's version, as upstream's release workflow does, so About shows the base.
T3CODE_DESKTOP_VERSION="${TAG#v}" T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=true vp run dist:desktop:fork \
  || stop "desktop build failed"

if [ "$CANDIDATE" != fork ]; then
  git switch --quiet fork
  git merge --quiet --ff-only "$CANDIDATE"
  git branch -d "$CANDIDATE" >/dev/null 2>&1 || true
fi
git push --quiet origin fork \
  && git push --quiet origin "refs/remotes/upstream/main:refs/heads/main" \
  || echo "warning: could not push to origin; the local fork branch is still updated"

install_latest
