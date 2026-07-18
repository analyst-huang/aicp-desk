#!/usr/bin/env sh
set -eu

if [ "$(uname -s)" != "Linux" ]; then
  printf 'The system remote UI installer supports Linux only.\n' >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  printf 'System mode modifies OS packages and must be run as root.\n' >&2
  exit 1
fi
for command_name in apt-get awk curl gzip sort tail; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing prerequisite for system installation: %s\n' "$command_name" >&2
    exit 1
  fi
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DOWNLOADS=$(mktemp -d)
cleanup() { rm -rf "$DOWNLOADS"; }
trap cleanup EXIT HUP INT TERM

printf 'Updating package metadata for explicit system installation...\n'
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  xvfb x11vnc openbox websockify novnc x11-xkb-utils

EDGE_COMMAND=$(command -v microsoft-edge 2>/dev/null || command -v microsoft-edge-stable 2>/dev/null || true)
if [ -z "$EDGE_COMMAND" ] && [ ! -x /opt/microsoft/msedge/msedge ]; then
  printf 'Installing Microsoft Edge into the current system/container...\n'
  EDGE_REPOSITORY=https://packages.microsoft.com/repos/edge
  curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 20 \
    "$EDGE_REPOSITORY/dists/stable/main/binary-amd64/Packages.gz" -o "$DOWNLOADS/edge-packages.gz"
  gzip -dc "$DOWNLOADS/edge-packages.gz" > "$DOWNLOADS/edge-packages"
  EDGE_FILENAME=$(awk '
    BEGIN { RS=""; FS="\n" }
    {
      package_name=""; package_version=""; package_file=""
      for (field_number=1; field_number<=NF; field_number++) {
        if ($field_number ~ /^Package: /) { package_name=substr($field_number, 10) }
        if ($field_number ~ /^Version: /) { package_version=substr($field_number, 10) }
        if ($field_number ~ /^Filename: /) { package_file=substr($field_number, 11) }
      }
      if (package_name == "microsoft-edge-stable" && package_version != "" && package_file != "") {
        print package_version " " package_file
      }
    }
  ' "$DOWNLOADS/edge-packages" | sort -k1,1V | tail -n 1)
  if [ -z "$EDGE_FILENAME" ]; then
    printf 'Could not locate microsoft-edge-stable in Microsoft repository metadata.\n' >&2
    exit 1
  fi
  EDGE_FILENAME=${EDGE_FILENAME#* }
  curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --progress-bar \
    "$EDGE_REPOSITORY/$EDGE_FILENAME" -o "$DOWNLOADS/microsoft-edge-stable.deb"
  DEBIAN_FRONTEND=noninteractive apt-get install -y "$DOWNLOADS/microsoft-edge-stable.deb"
fi

export AICP_RUNTIME_INSTALL_MODE=system
sh "$SCRIPT_DIR/install-remote-ui-debian.sh"
