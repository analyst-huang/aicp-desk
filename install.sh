#!/usr/bin/env sh
set -eu

NO_SHORTCUT=0
for argument in "$@"; do
  case "$argument" in
    --no-shortcut) NO_SHORTCUT=1 ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js was not found. Install Node.js 22 or newer first.\n' >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  printf 'Node.js %s is too old. Version 22 or newer is required.\n' "$NODE_MAJOR" >&2
  exit 1
fi

SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SYSTEM=$(uname -s)
if [ -n "${AICP_INSTALL_DIR:-}" ]; then
  ROOT=$AICP_INSTALL_DIR
elif [ "$SYSTEM" = "Darwin" ]; then
  ROOT="$HOME/Library/Application Support/aicp-cli"
else
  ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/aicp-cli"
fi
APP="$ROOT/app"
BIN="${AICP_BIN_DIR:-$HOME/.local/bin}"

case "$APP" in
  ""|/|"$HOME") printf 'Unsafe installation path: %s\n' "$APP" >&2; exit 1 ;;
esac

if [ -e "$APP/bin/aicp.mjs" ]; then
  ps -ax -o pid= -o command= 2>/dev/null | while IFS= read -r process_line; do
    case "$process_line" in
      *"$APP/bin/aicp.mjs"*" gui"*)
        process_id=$(printf '%s\n' "$process_line" | sed -E 's/^[[:space:]]*([0-9]+).*/\1/')
        if [ -n "$process_id" ] && [ "$process_id" != "$$" ]; then
          kill "$process_id" 2>/dev/null || true
          printf 'Stopped running AICP Desk GUI (PID %s).\n' "$process_id"
        fi
        ;;
    esac
  done
  sleep 1
fi

mkdir -p "$ROOT" "$BIN"
rm -rf "$APP"
mkdir -p "$APP"
for item in bin lib web docs examples package.json README.md install.sh uninstall.sh aicp start-gui.sh; do
  if [ -e "$SOURCE/$item" ]; then cp -R "$SOURCE/$item" "$APP/"; fi
done
chmod +x "$APP/bin/aicp.mjs" "$APP/aicp" "$APP/start-gui.sh" "$APP/install.sh" "$APP/uninstall.sh"

LAUNCHER="$BIN/aicp"
printf '#!/usr/bin/env sh\nexec node "%s/bin/aicp.mjs" "$@"\n' "$APP" > "$LAUNCHER"
chmod +x "$LAUNCHER"

if [ "$NO_SHORTCUT" -eq 0 ] && [ "$SYSTEM" = "Darwin" ]; then
  mkdir -p "$HOME/Applications"
  SHORTCUT="$HOME/Applications/AICP Desk.command"
  printf '#!/usr/bin/env sh\nexec "%s" gui\n' "$LAUNCHER" > "$SHORTCUT"
  chmod +x "$SHORTCUT"
elif [ "$NO_SHORTCUT" -eq 0 ] && [ "$SYSTEM" = "Linux" ]; then
  DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$DESKTOP_DIR"
  SHORTCUT="$DESKTOP_DIR/aicp-desk.desktop"
  printf '[Desktop Entry]\nType=Application\nName=AICP Desk\nComment=Local AICP dashboard\nExec="%s" gui\nTerminal=false\nCategories=Development;\n' "$LAUNCHER" > "$SHORTCUT"
  chmod +x "$SHORTCUT"
fi

printf '\nAICP Desk installed successfully.\n'
printf 'Application: %s\n' "$APP"
printf 'Launcher: %s\n' "$LAUNCHER"
case ":$PATH:" in
  *:"$BIN":*) ;;
  *) printf 'Add this directory to PATH, then open a new terminal: %s\n' "$BIN" ;;
esac
printf 'First login: aicp login\n'
printf 'Dashboard:   aicp gui\n'
