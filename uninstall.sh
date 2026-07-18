#!/usr/bin/env sh
set -eu

KEEP_DATA=0
YES=0
for argument in "$@"; do
  case "$argument" in
    --keep-data) KEEP_DATA=1 ;;
    --yes) YES=1 ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

SYSTEM=$(uname -s)
if [ -n "${AICP_INSTALL_DIR:-}" ]; then
  ROOT=$AICP_INSTALL_DIR
elif [ "$SYSTEM" = "Darwin" ]; then
  ROOT="$HOME/Library/Application Support/aicp-cli"
else
  ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/aicp-cli"
fi
BIN="${AICP_BIN_DIR:-$HOME/.local/bin}"
if [ -n "${AICP_HOME:-}" ]; then
  DATA=$AICP_HOME
elif [ "$SYSTEM" = "Darwin" ]; then
  DATA="$HOME/Library/Application Support/aicp-cli"
else
  DATA="${XDG_STATE_HOME:-$HOME/.local/state}/aicp-cli"
fi

if [ "$YES" -eq 0 ]; then
  printf 'Uninstall AICP Desk? Type yes to continue: '
  read -r answer
  if [ "$answer" != "yes" ]; then printf 'Cancelled.\n'; exit 0; fi
fi

if [ "$SYSTEM" = "Linux" ] && [ -e "$ROOT/app/bin/aicp.mjs" ]; then
  node "$ROOT/app/bin/aicp.mjs" remote-ui stop --all --yes >/dev/null 2>&1 || true
fi

safe_remove() {
  target=$1
  case "$target" in ""|/|"$HOME") printf 'Refusing to remove unsafe path: %s\n' "$target" >&2; exit 1 ;; esac
  rm -rf "$target"
}

safe_remove "$BIN/aicp"
if [ "$SYSTEM" = "Darwin" ]; then safe_remove "$HOME/Applications/AICP Desk.command"; fi
if [ "$SYSTEM" = "Linux" ]; then safe_remove "${XDG_DATA_HOME:-$HOME/.local/share}/applications/aicp-desk.desktop"; fi

if [ "$KEEP_DATA" -eq 1 ]; then
  safe_remove "$ROOT/app"
  safe_remove "$ROOT/runtime"
  printf 'Application and private runtime removed. Templates and login data remain in: %s\n' "$DATA"
else
  safe_remove "$ROOT"
  if [ "$DATA" != "$ROOT" ]; then safe_remove "$DATA"; fi
  printf 'Application, templates, and the dedicated login profile were removed.\n'
fi
