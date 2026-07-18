#!/usr/bin/env sh
set -eu

if ! command -v apt-get >/dev/null 2>&1 || ! command -v dpkg >/dev/null 2>&1; then
  printf 'This helper supports Debian and Ubuntu only. Install Edge, Xvfb, x11vnc, noVNC, websockify, and openbox with your distribution package manager.\n' >&2
  exit 1
fi

ARCHITECTURE=$(dpkg --print-architecture)
if [ "$ARCHITECTURE" != "amd64" ]; then
  printf 'Microsoft Edge for Linux requires amd64/x86_64; detected: %s\n' "$ARCHITECTURE" >&2
  exit 1
fi

for command_name in curl gpg sudo; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing prerequisite: %s\n' "$command_name" >&2
    exit 1
  fi
done

TEMP_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEMP_DIRECTORY"' EXIT HUP INT TERM

curl -fsSL https://packages.microsoft.com/keys/microsoft.asc -o "$TEMP_DIRECTORY/microsoft.asc"
gpg --dearmor --yes --output "$TEMP_DIRECTORY/microsoft-edge.gpg" "$TEMP_DIRECTORY/microsoft.asc"
sudo install -d -m 0755 /usr/share/keyrings
sudo install -o root -g root -m 0644 "$TEMP_DIRECTORY/microsoft-edge.gpg" /usr/share/keyrings/microsoft-edge.gpg
printf '%s\n' 'deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-edge.gpg] https://packages.microsoft.com/repos/edge stable main' \
  | sudo tee /etc/apt/sources.list.d/microsoft-edge.list >/dev/null

sudo apt-get update
sudo apt-get install -y microsoft-edge-stable xvfb x11vnc novnc websockify openbox

printf '\nRemote UI dependencies installed. Run as your normal user:\n'
printf '  aicp remote-ui doctor\n'
printf '  aicp login --remote-ui --yes\n'
