#!/usr/bin/env sh
set -eu

if [ "$(uname -s)" != "Linux" ] || ! command -v apt-get >/dev/null 2>&1 || ! command -v dpkg >/dev/null 2>&1; then
  printf 'This private-runtime installer supports Debian and Ubuntu only.\n' >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  printf 'Do not run this installer with sudo or as root; the runtime belongs to the current AICP user.\n' >&2
  exit 1
fi

ARCHITECTURE=$(dpkg --print-architecture)
if [ "$ARCHITECTURE" != "amd64" ]; then
  printf 'Microsoft Edge for Linux requires amd64/x86_64; detected: %s\n' "$ARCHITECTURE" >&2
  exit 1
fi

for command_name in curl gzip awk sort apt-cache apt-get dpkg-deb python3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing host prerequisite: %s\n' "$command_name" >&2
    exit 1
  fi
done

if [ -n "${AICP_INSTALL_DIR:-}" ]; then
  ROOT=$AICP_INSTALL_DIR
else
  ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/aicp-cli"
fi
RUNTIME="$ROOT/runtime"
STAGING="$ROOT/.runtime.$$.tmp"
DOWNLOADS=$(mktemp -d)
COMMITTED=0

case "$ROOT" in
  ""|/|"$HOME") printf 'Unsafe AICP installation root: %s\n' "$ROOT" >&2; exit 1 ;;
esac

cleanup() {
  rm -rf "$DOWNLOADS"
  if [ "$COMMITTED" -eq 0 ]; then rm -rf "$STAGING"; fi
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$ROOT" "$STAGING/rootfs" "$STAGING/bin" "$DOWNLOADS/debs"

printf 'Downloading Microsoft Edge into the AICP private runtime...\n'
EDGE_REPOSITORY=https://packages.microsoft.com/repos/edge
curl -fsSL "$EDGE_REPOSITORY/dists/stable/main/binary-amd64/Packages.gz" -o "$DOWNLOADS/edge-packages.gz"
gzip -dc "$DOWNLOADS/edge-packages.gz" > "$DOWNLOADS/edge-packages"
EDGE_FILENAME=$(awk '
  BEGIN { RS=""; FS="\n" }
  {
    package_name=""; filename=""
    for (index=1; index<=NF; index++) {
      if ($index ~ /^Package: /) { package_name=substr($index, 10) }
      if ($index ~ /^Filename: /) { filename=substr($index, 11) }
    }
    if (package_name == "microsoft-edge-stable" && filename != "") { print filename; exit }
  }
' "$DOWNLOADS/edge-packages")
if [ -z "$EDGE_FILENAME" ]; then
  printf 'Could not locate microsoft-edge-stable in the Microsoft repository metadata.\n' >&2
  exit 1
fi
curl -fsSL "$EDGE_REPOSITORY/$EDGE_FILENAME" -o "$DOWNLOADS/debs/microsoft-edge-stable.deb"

printf 'Downloading Xvfb/noVNC components without installing system packages...\n'
SEED_PACKAGES="xvfb x11vnc novnc websockify openbox"
OPTIONAL_EDGE_LIBRARIES="libasound2 libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libcups2t64 libdbus-1-3 libdrm2 libexpat1 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 libudev1 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2"
AVAILABLE_PACKAGES=$SEED_PACKAGES
for package_name in $OPTIONAL_EDGE_LIBRARIES; do
  if apt-cache show "$package_name" >/dev/null 2>&1; then AVAILABLE_PACKAGES="$AVAILABLE_PACKAGES $package_name"; fi
done

apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks --no-replaces --no-enhances $AVAILABLE_PACKAGES \
  | awk '/^[[:alnum:]][[:alnum:].+_-]*(:[[:alnum:]_-]+)?$/ { sub(/:.*/, "", $1); print $1 }' \
  | sort -u > "$DOWNLOADS/package-list"

for package_name in $SEED_PACKAGES; do
  if ! grep -qx "$package_name" "$DOWNLOADS/package-list"; then printf '%s\n' "$package_name" >> "$DOWNLOADS/package-list"; fi
done
sort -u "$DOWNLOADS/package-list" -o "$DOWNLOADS/package-list"

while IFS= read -r package_name; do
  [ -n "$package_name" ] || continue
  case "$package_name" in
    libc6|libgcc-s1|libstdc++6|zlib1g|libselinux1|libpcre2-8-0) continue ;;
  esac
  if ! (cd "$DOWNLOADS/debs" && apt-get download "$package_name" >/dev/null 2>&1); then
    case " $SEED_PACKAGES " in
      *" $package_name "*) printf 'Failed to download required package: %s\n' "$package_name" >&2; exit 1 ;;
      *) printf 'Warning: optional package could not be downloaded: %s\n' "$package_name" >&2 ;;
    esac
  fi
done < "$DOWNLOADS/package-list"

for package_file in "$DOWNLOADS"/debs/*.deb; do
  [ -e "$package_file" ] || continue
  dpkg-deb -x "$package_file" "$STAGING/rootfs"
done

for required_file in \
  opt/microsoft/msedge/msedge \
  usr/bin/Xvfb \
  usr/bin/x11vnc \
  usr/bin/openbox \
  usr/bin/websockify \
  usr/share/X11/xkb \
  usr/share/novnc/vnc.html; do
  if [ ! -e "$STAGING/rootfs/$required_file" ]; then
    printf 'Private runtime is incomplete; missing: %s\n' "$required_file" >&2
    exit 1
  fi
done

write_native_wrapper() {
  wrapper_name=$1
  target_path=$2
  printf '%s\n' \
    '#!/usr/bin/env sh' \
    'set -eu' \
    'RUNTIME=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)' \
    'ROOTFS="$RUNTIME/rootfs"' \
    'PRIVATE_LIBS="$ROOTFS/opt/microsoft/msedge:$ROOTFS/usr/lib/x86_64-linux-gnu:$ROOTFS/lib/x86_64-linux-gnu:$ROOTFS/usr/lib:$ROOTFS/lib"' \
    'export LD_LIBRARY_PATH="$PRIVATE_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
    'export PATH="$ROOTFS/usr/bin:$PATH"' \
    'export XDG_CONFIG_DIRS="$ROOTFS/etc/xdg${XDG_CONFIG_DIRS:+:$XDG_CONFIG_DIRS}"' \
    'export XDG_DATA_DIRS="$ROOTFS/usr/share${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"' \
    "exec \"\$ROOTFS/$target_path\" \"\$@\"" \
    > "$STAGING/bin/$wrapper_name"
  chmod 0755 "$STAGING/bin/$wrapper_name"
}

write_native_wrapper x11vnc usr/bin/x11vnc
write_native_wrapper openbox usr/bin/openbox

printf '%s\n' \
  '#!/usr/bin/env sh' \
  'set -eu' \
  'RUNTIME=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)' \
  'ROOTFS="$RUNTIME/rootfs"' \
  'PRIVATE_LIBS="$ROOTFS/opt/microsoft/msedge:$ROOTFS/usr/lib/x86_64-linux-gnu:$ROOTFS/lib/x86_64-linux-gnu:$ROOTFS/usr/lib:$ROOTFS/lib"' \
  'export LD_LIBRARY_PATH="$PRIVATE_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
  'export PATH="$ROOTFS/usr/bin:$PATH"' \
  'SANDBOX_ARGUMENT=--disable-setuid-sandbox' \
  'if [ -e "$RUNTIME/allow-no-sandbox" ]; then SANDBOX_ARGUMENT=--no-sandbox; fi' \
  'exec "$ROOTFS/opt/microsoft/msedge/msedge" "$SANDBOX_ARGUMENT" "$@"' \
  > "$STAGING/bin/microsoft-edge-stable"
chmod 0755 "$STAGING/bin/microsoft-edge-stable"

printf '%s\n' \
  '#!/usr/bin/env sh' \
  'set -eu' \
  'RUNTIME=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)' \
  'ROOTFS="$RUNTIME/rootfs"' \
  'PRIVATE_LIBS="$ROOTFS/usr/lib/x86_64-linux-gnu:$ROOTFS/lib/x86_64-linux-gnu:$ROOTFS/usr/lib:$ROOTFS/lib"' \
  'export LD_LIBRARY_PATH="$PRIVATE_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
  'export PATH="$ROOTFS/usr/bin:$PATH"' \
  'exec "$ROOTFS/usr/bin/Xvfb" "$@" -xkbdir "$ROOTFS/usr/share/X11/xkb"' \
  > "$STAGING/bin/Xvfb"
chmod 0755 "$STAGING/bin/Xvfb"

printf '%s\n' \
  '#!/usr/bin/env sh' \
  'set -eu' \
  'RUNTIME=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)' \
  'ROOTFS="$RUNTIME/rootfs"' \
  'export PYTHONPATH="$ROOTFS/usr/lib/python3/dist-packages${PYTHONPATH:+:$PYTHONPATH}"' \
  'exec python3 "$ROOTFS/usr/bin/websockify" "$@"' \
  > "$STAGING/bin/websockify"
chmod 0755 "$STAGING/bin/websockify"

if [ "${AICP_ALLOW_NO_SANDBOX:-0}" = "1" ]; then
  : > "$STAGING/allow-no-sandbox"
  printf 'Warning: private Edge sandbox is disabled by explicit request. Use only on a trusted dedicated server.\n' >&2
fi

printf '%s\n' \
  'version=1' \
  'scope=aicp-private-runtime' \
  "installed_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  "edge_package=$EDGE_FILENAME" \
  > "$STAGING/manifest.txt"

if ! "$STAGING/bin/microsoft-edge-stable" --headless=new --disable-gpu --no-first-run \
  --user-data-dir="$DOWNLOADS/edge-smoke-profile" --dump-dom about:blank >/dev/null 2>&1; then
  printf 'The private Edge runtime could not start. Check base libraries and unprivileged user namespaces.\n' >&2
  printf 'On a trusted dedicated server only, retry with: AICP_ALLOW_NO_SANDBOX=1 %s\n' "$0" >&2
  exit 1
fi

BACKUP="$ROOT/.runtime.$$.old"
if [ -e "$RUNTIME" ]; then mv "$RUNTIME" "$BACKUP"; fi
if ! mv "$STAGING" "$RUNTIME"; then
  if [ -e "$BACKUP" ]; then mv "$BACKUP" "$RUNTIME"; fi
  exit 1
fi
rm -rf "$BACKUP"
COMMITTED=1

printf '\nAICP private remote UI runtime installed successfully.\n'
printf 'Runtime: %s\n' "$RUNTIME"
printf 'No files were written to /usr, /opt, or /etc.\n'
printf 'Run as your normal user:\n'
printf '  aicp remote-ui doctor\n'
printf '  aicp login --remote-ui --yes\n'
