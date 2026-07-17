#!/usr/bin/env sh
set -eu

REPOSITORY=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/aicp-install.XXXXXX")
trap 'rm -rf "$SANDBOX"' EXIT HUP INT TERM

export AICP_INSTALL_DIR="$SANDBOX/application"
export AICP_BIN_DIR="$SANDBOX/bin"
export AICP_HOME="$SANDBOX/state"

"$REPOSITORY/install.sh" --no-shortcut
"$AICP_BIN_DIR/aicp" --help >/dev/null
test -f "$AICP_INSTALL_DIR/app/package.json"
test -f "$AICP_BIN_DIR/aicp"

"$REPOSITORY/uninstall.sh" --keep-data --yes
test ! -e "$AICP_INSTALL_DIR/app"
test ! -e "$AICP_BIN_DIR/aicp"
