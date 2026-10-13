#!/usr/bin/env bash
# Brings the `fork` branch up to the newest upstream T3 Code nightly tag,
# checks the fork patches, rebuilds T3 Code Fork, and installs it.
#
#   scripts/fork-sync.sh            sync to the newest nightly, build, install
#   scripts/fork-sync.sh --force    rebuild even when already on the newest nightly
#   scripts/fork-sync.sh --install  only install the newest built DMG
#
# The nightly is merged on a fork-sync/<tag> branch first; `fork` only
# fast-forwards to it after the tests and build pass, so a failure leaves
# `fork` untouched and the candidate branch kept for inspection. Installing
# waits for T3 Code Fork to be closed so running agents are not interrupted.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="T3 Code Fork"
APP_PATH="/Applications/$APP_NAME.app"
LOG="$HOME/.t3code-fork/sync.log"
MONITOR="native/resource-monitor/target/aarch64-apple-darwin/release/t3-resource-monitor"

NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v24.*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="${NODE_BIN:+$NODE_BIN:}$HOME/.local/share/vite-plus/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$(dirname "$LOG")"
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

install_latest() {
  local dmg mount
  dmg="$(ls -t "$REPO"/release/*-arm64.dmg 2>/dev/null | head -1)"
  [ -n "$dmg" ] || fail "no built DMG in release/"
  if pgrep -f "$APP_PATH/Contents/MacOS/" >/dev/null; then
    # Run from the app's own terminal, so wait in a new session that outlives
    # the app, then install and reopen it once the user quits.
    python3 -c 'import subprocess, sys; subprocess.Popen(sys.argv[1:], start_new_session=True,
      stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)' \
      /bin/bash -c 'while pgrep -f "$0/Contents/MacOS/" >/dev/null; do sleep 2; done
        "$1" --install && sleep 2 && open "$0"' "$APP_PATH" "$REPO/scripts/fork-sync.sh"
    notify "Update built. Quit $APP_NAME (Cmd-Q); it installs and reopens on its own."
    return 0
  fi
  mount="$(hdiutil attach -nobrowse -readonly "$dmg" | awk -F'\t' '/\/Volumes\//{print $NF}' | tail -1)"
  if [ -d "$APP_PATH" ]; then
    mv "$APP_PATH" "$HOME/.Trash/$APP_NAME $(date +%Y%m%d-%H%M%S).app"
  fi
  ditto "$mount/$APP_NAME.app" "$APP_PATH"
  hdiutil detach "$mount" -quiet
  notify "Installed $(basename "$dmg" .dmg)."
}

cd "$REPO"
if [ "${1:-}" = "--install" ]; then
  install_latest
  exit 0
fi

[ "$(git branch --show-current)" = "fork" ] || fail "checkout is not on the fork branch"
[ -z "$(git status --porcelain)" ] || fail "checkout has uncommitted changes"

git fetch upstream --tags --quiet || fail "could not fetch upstream"
TAG="$(git tag -l 'v*-nightly.*' --sort=-v:refname | head -1)"
[ -n "$TAG" ] || fail "no upstream nightly tag found"

if git merge-base --is-ancestor "$TAG" fork; then
  echo "Already on $TAG."
  [ "${1:-}" = "--force" ] || exit 0
  CANDIDATE=fork
else
  CANDIDATE="fork-sync/$TAG"
  git switch --quiet -c "$CANDIDATE" fork || fail "could not create $CANDIDATE"
  git merge --quiet --no-edit "$TAG" || {
    git merge --abort
    git switch --quiet fork
    fail "fork patches conflict with $TAG; resolve on a branch by hand"
  }
fi

stop() {
  git switch --quiet fork
  fail "$1; fork is unchanged and $CANDIDATE is kept"
}

vp i >/dev/null || stop "dependency install failed"
vp test run scripts/build-desktop-artifact.test.ts apps/desktop/src/app/DesktopUserData.test.ts \
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
fi
git push --quiet origin fork \
  && git push --quiet origin "refs/remotes/upstream/main:refs/heads/main" \
  || echo "warning: could not push to origin; the local fork branch is still updated"

install_latest
