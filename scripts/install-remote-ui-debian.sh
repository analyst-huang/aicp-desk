#!/usr/bin/env sh
set -eu

if [ "$(uname -s)" != "Linux" ]; then
  printf 'This hybrid-runtime installer supports Linux only.\n' >&2
  exit 1
fi

USER_ID=$(id -u)
INSTALL_STRATEGY=${AICP_RUNTIME_INSTALL_MODE:-auto}
case "$INSTALL_STRATEGY" in
  auto|private|system) : ;;
  *) printf 'AICP_RUNTIME_INSTALL_MODE must be auto, private, or system: %s\n' "$INSTALL_STRATEGY" >&2; exit 1 ;;
esac
CONTAINER_DETECTED=0
ROOT_MODEL=0
RUNTIME_MODE=user-sandbox
if [ -n "${container:-}" ] || [ -n "${KUBERNETES_SERVICE_HOST:-}" ] || [ -e /.dockerenv ] || [ -e /run/.containerenv ]; then
  CONTAINER_DETECTED=1
elif [ -r /proc/1/cgroup ] && grep -Eqi '(docker|kubepods|containerd|libpod|podman|lxc)' /proc/1/cgroup; then
  CONTAINER_DETECTED=1
elif [ -r /proc/1/cmdline ] && tr '\000' ' ' < /proc/1/cmdline | grep -Fq '/kaic/webide/supervisord'; then
  CONTAINER_DETECTED=1
fi

if [ "$USER_ID" -eq 0 ]; then
  if [ "$CONTAINER_DETECTED" -eq 1 ]; then
    ROOT_MODEL=1
    RUNTIME_MODE=root-container
  elif [ "${AICP_ALLOW_ROOT:-0}" = "1" ]; then
    ROOT_MODEL=1
    RUNTIME_MODE=root-explicit
  else
    printf 'Bare-metal root was detected. Root is automatic only inside a detected container.\n' >&2
    printf 'If this environment is isolated but detection failed, retry through: aicp remote-ui install --allow-root --yes\n' >&2
    exit 1
  fi
fi

if [ -n "${AICP_INSTALL_DIR:-}" ]; then
  ROOT=$AICP_INSTALL_DIR
else
  ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/aicp-cli"
fi
RUNTIME="$ROOT/runtime"
STAGING="$ROOT/.runtime.$$.tmp"
DOWNLOADS=$(mktemp -d)
COMMITTED=0
RUNTIME_MOVED=0

case "$ROOT" in
  ""|/|"$HOME") printf 'Unsafe AICP installation root: %s\n' "$ROOT" >&2; exit 1 ;;
esac

cleanup() {
  if [ "$COMMITTED" -eq 0 ]; then
    if [ "$RUNTIME_MOVED" -eq 1 ]; then
      if [ ! -e "$RUNTIME" ] && [ -e "$STAGING" ]; then
        mv "$STAGING" "$RUNTIME"
        for metadata_name in manifest.txt root-model allow-no-sandbox; do
          rm -f "$RUNTIME/$metadata_name"
          if [ -e "$DOWNLOADS/previous-metadata/$metadata_name" ]; then
            cp -p "$DOWNLOADS/previous-metadata/$metadata_name" "$RUNTIME/$metadata_name"
          fi
        done
        printf 'Restored the previous AICP runtime after an interrupted or failed update.\n' >&2
      elif [ -e "$STAGING" ]; then
        printf 'Preserved recovery runtime because the target path is occupied: %s\n' "$STAGING" >&2
      fi
    else
      rm -rf "$STAGING"
    fi
  fi
  rm -rf "$DOWNLOADS"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$ROOT" "$DOWNLOADS/debs"
if [ -e "$STAGING" ]; then
  printf 'Refusing to overwrite an unexpected transaction directory: %s\n' "$STAGING" >&2
  exit 1
fi

# Move an existing runtime into the transaction instead of copying a large
# private rootfs (especially expensive on NFS). The trap restores it on error.
if [ -e "$RUNTIME" ]; then
  mkdir -p "$DOWNLOADS/previous-metadata"
  for metadata_name in manifest.txt root-model allow-no-sandbox; do
    if [ -e "$RUNTIME/$metadata_name" ]; then cp -p "$RUNTIME/$metadata_name" "$DOWNLOADS/previous-metadata/$metadata_name"; fi
  done
  mv "$RUNTIME" "$STAGING"
  RUNTIME_MOVED=1
else
  mkdir -p "$STAGING"
fi
mkdir -p "$STAGING/rootfs" "$STAGING/bin"

external_command() {
  candidate=$(command -v "$1" 2>/dev/null || true)
  [ -n "$candidate" ] || return 1
  case "$candidate" in "$RUNTIME"/*) return 1 ;; esac
  printf '%s\n' "$candidate"
}

first_external_command() {
  for command_candidate in "$@"; do
    if resolved_candidate=$(external_command "$command_candidate"); then printf '%s\n' "$resolved_candidate"; return 0; fi
  done
  return 1
}

EDGE_COMMAND=""
XVFB_COMMAND=""
X11VNC_COMMAND=""
WINDOW_MANAGER_COMMAND=""
WEBSOCKIFY_COMMAND=""
NOVNC_ROOT=""
if [ "$INSTALL_STRATEGY" != "private" ]; then
  EDGE_COMMAND=$(first_external_command microsoft-edge microsoft-edge-stable msedge || true)
  if [ -z "$EDGE_COMMAND" ] && [ -x /opt/microsoft/msedge/msedge ]; then EDGE_COMMAND=/opt/microsoft/msedge/msedge; fi
  if [ -n "$EDGE_COMMAND" ] && ! "$EDGE_COMMAND" --version >/dev/null 2>&1; then EDGE_COMMAND=""; fi
  XVFB_COMMAND=$(first_external_command Xvfb || true)
  X11VNC_COMMAND=$(first_external_command x11vnc || true)
  WINDOW_MANAGER_COMMAND=$(first_external_command openbox openbox-session fluxbox || true)
  WEBSOCKIFY_COMMAND=$(first_external_command websockify || true)
  for web_root_candidate in "${NOVNC_WEB:-}" /usr/share/novnc /usr/share/noVNC /opt/novnc /opt/noVNC; do
    [ -n "$web_root_candidate" ] || continue
    case "$web_root_candidate" in "$RUNTIME"/*) continue ;; esac
    if [ -e "$web_root_candidate/vnc.html" ] || [ -e "$web_root_candidate/vnc_lite.html" ]; then NOVNC_ROOT=$web_root_candidate; break; fi
  done
fi

PRIVATE_EDGE=0
PRIVATE_XVFB=0
PRIVATE_X11VNC=0
PRIVATE_WINDOW_MANAGER=0
PRIVATE_WEBSOCKIFY=0
PRIVATE_NOVNC=0
PRIVATE_XKBCOMP=0
[ -x "$STAGING/bin/microsoft-edge-stable" ] && [ -x "$STAGING/rootfs/opt/microsoft/msedge/msedge" ] && PRIVATE_EDGE=1
if [ -x "$STAGING/bin/Xvfb" ]; then
  if [ "$INSTALL_STRATEGY" = "private" ] && [ -e "$STAGING/rootfs/usr/share/X11/xkb" ]; then PRIVATE_XVFB=1
  elif [ "$INSTALL_STRATEGY" != "private" ] && { [ -e "$STAGING/rootfs/usr/share/X11/xkb" ] || [ -e /usr/share/X11/xkb ]; }; then PRIVATE_XVFB=1
  fi
fi
[ -x "$STAGING/bin/x11vnc" ] && PRIVATE_X11VNC=1
[ -x "$STAGING/bin/openbox" ] && PRIVATE_WINDOW_MANAGER=1
[ -x "$STAGING/bin/websockify" ] && PRIVATE_WEBSOCKIFY=1
[ -e "$STAGING/rootfs/usr/share/novnc/vnc.html" ] && PRIVATE_NOVNC=1
[ -x "$STAGING/rootfs/usr/bin/xkbcomp" ] && PRIVATE_XKBCOMP=1

MISSING_SEED_PACKAGES=""
[ -n "$XVFB_COMMAND" ] || [ "$PRIVATE_XVFB" -eq 1 ] || MISSING_SEED_PACKAGES="$MISSING_SEED_PACKAGES xvfb"
[ -n "$X11VNC_COMMAND" ] || [ "$PRIVATE_X11VNC" -eq 1 ] || MISSING_SEED_PACKAGES="$MISSING_SEED_PACKAGES x11vnc"
[ -n "$WINDOW_MANAGER_COMMAND" ] || [ "$PRIVATE_WINDOW_MANAGER" -eq 1 ] || MISSING_SEED_PACKAGES="$MISSING_SEED_PACKAGES openbox"
[ -n "$WEBSOCKIFY_COMMAND" ] || [ "$PRIVATE_WEBSOCKIFY" -eq 1 ] || MISSING_SEED_PACKAGES="$MISSING_SEED_PACKAGES websockify"
[ -n "$NOVNC_ROOT" ] || [ "$PRIVATE_NOVNC" -eq 1 ] || MISSING_SEED_PACKAGES="$MISSING_SEED_PACKAGES novnc"
if [ -z "$XVFB_COMMAND" ] && [ "$PRIVATE_XKBCOMP" -eq 0 ]; then
  MISSING_SEED_PACKAGES="$MISSING_SEED_PACKAGES x11-xkb-utils"
fi
if [ "$INSTALL_STRATEGY" = "private" ] && [ ! -e "$STAGING/rootfs/usr/share/X11/xkb" ]; then
  MISSING_SEED_PACKAGES="$MISSING_SEED_PACKAGES xkb-data"
fi

NEED_EDGE_DOWNLOAD=0
[ -n "$EDGE_COMMAND" ] || [ "$PRIVATE_EDGE" -eq 1 ] || NEED_EDGE_DOWNLOAD=1

if [ "$INSTALL_STRATEGY" = "system" ]; then
  MISSING_SYSTEM_COMPONENTS=""
  [ -n "$EDGE_COMMAND" ] || MISSING_SYSTEM_COMPONENTS="$MISSING_SYSTEM_COMPONENTS Edge"
  [ -n "$XVFB_COMMAND" ] || MISSING_SYSTEM_COMPONENTS="$MISSING_SYSTEM_COMPONENTS Xvfb"
  [ -n "$X11VNC_COMMAND" ] || MISSING_SYSTEM_COMPONENTS="$MISSING_SYSTEM_COMPONENTS x11vnc"
  [ -n "$WINDOW_MANAGER_COMMAND" ] || MISSING_SYSTEM_COMPONENTS="$MISSING_SYSTEM_COMPONENTS window-manager"
  [ -n "$WEBSOCKIFY_COMMAND" ] || MISSING_SYSTEM_COMPONENTS="$MISSING_SYSTEM_COMPONENTS websockify"
  [ -n "$NOVNC_ROOT" ] || MISSING_SYSTEM_COMPONENTS="$MISSING_SYSTEM_COMPONENTS noVNC"
  if [ -n "$MISSING_SYSTEM_COMPONENTS" ]; then
    printf 'System installer did not provide required components:%s\n' "$MISSING_SYSTEM_COMPONENTS" >&2
    exit 1
  fi
  MISSING_SEED_PACKAGES=""
  NEED_EDGE_DOWNLOAD=0
fi

component_plan() {
  environment_path=$1
  cached=$2
  if [ -n "$environment_path" ]; then printf '%s' "$environment_path"
  elif [ "$cached" -eq 1 ]; then printf '%s' 'private (cached)'
  else printf '%s' 'private (install)'
  fi
}

printf 'Remote UI component plan (strategy: %s):\n' "$INSTALL_STRATEGY"
printf '  Edge:         '; component_plan "$EDGE_COMMAND" "$PRIVATE_EDGE"; printf '\n'
printf '  Xvfb:         '; component_plan "$XVFB_COMMAND" "$PRIVATE_XVFB"; printf '\n'
printf '  x11vnc:       '; component_plan "$X11VNC_COMMAND" "$PRIVATE_X11VNC"; printf '\n'
printf '  window mgr:   '; component_plan "$WINDOW_MANAGER_COMMAND" "$PRIVATE_WINDOW_MANAGER"; printf '\n'
printf '  websockify:   '; component_plan "$WEBSOCKIFY_COMMAND" "$PRIVATE_WEBSOCKIFY"; printf '\n'
printf '  noVNC web:    '; component_plan "$NOVNC_ROOT" "$PRIVATE_NOVNC"; printf '\n'

if [ "$NEED_EDGE_DOWNLOAD" -eq 1 ] || [ -n "$MISSING_SEED_PACKAGES" ]; then
  for command_name in awk sort grep apt-cache apt-get dpkg-deb; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      printf 'Missing host prerequisite needed for private fallback: %s\n' "$command_name" >&2
      exit 1
    fi
  done
  if command -v dpkg >/dev/null 2>&1; then ARCHITECTURE=$(dpkg --print-architecture)
  else ARCHITECTURE=$(uname -m)
  fi
  case "$ARCHITECTURE" in amd64|x86_64) : ;; *)
    printf 'The private fallback requires amd64/x86_64; detected: %s\n' "$ARCHITECTURE" >&2
    exit 1 ;;
  esac
fi
if [ "$NEED_EDGE_DOWNLOAD" -eq 1 ]; then
  for command_name in curl gzip tail timeout; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      printf 'Missing host prerequisite needed for private Edge: %s\n' "$command_name" >&2
      exit 1
    fi
  done
fi
if [ -z "$WEBSOCKIFY_COMMAND" ] && ! command -v python3 >/dev/null 2>&1; then
  printf 'Missing host prerequisite needed for private websockify: python3\n' >&2
  exit 1
fi

EDGE_FILENAME=environment
if [ "$PRIVATE_EDGE" -eq 1 ]; then
  EDGE_FILENAME=""
  if [ -r "$DOWNLOADS/previous-metadata/manifest.txt" ]; then
    while IFS='=' read -r manifest_key manifest_value; do
      if [ "$manifest_key" = "edge_package" ]; then EDGE_FILENAME=$manifest_value; break; fi
    done < "$DOWNLOADS/previous-metadata/manifest.txt"
  fi
  EDGE_FILENAME=${EDGE_FILENAME:-cached}
fi
if [ "$NEED_EDGE_DOWNLOAD" -eq 1 ]; then
  printf 'Downloading missing Microsoft Edge into the AICP private runtime...\n'
  EDGE_REPOSITORY=https://packages.microsoft.com/repos/edge
  curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 20 \
    "$EDGE_REPOSITORY/dists/stable/main/binary-amd64/Packages.gz" -o "$DOWNLOADS/edge-packages.gz"
  gzip -dc "$DOWNLOADS/edge-packages.gz" > "$DOWNLOADS/edge-packages"
  EDGE_ENTRY=$(awk '
    BEGIN { RS=""; FS="\n" }
    {
      package_name=""; package_version=""; filename=""
      for (field_number=1; field_number<=NF; field_number++) {
        if ($field_number ~ /^Package: /) { package_name=substr($field_number, 10) }
        if ($field_number ~ /^Version: /) { package_version=substr($field_number, 10) }
        if ($field_number ~ /^Filename: /) { filename=substr($field_number, 11) }
      }
      if (package_name == "microsoft-edge-stable" && package_version != "" && filename != "") {
        print package_version " " filename
      }
    }
  ' "$DOWNLOADS/edge-packages" | sort -k1,1V | tail -n 1)
  if [ -z "$EDGE_ENTRY" ]; then
    printf 'Could not locate microsoft-edge-stable in the Microsoft repository metadata.\n' >&2
    exit 1
  fi
  EDGE_VERSION=${EDGE_ENTRY%% *}
  EDGE_FILENAME=${EDGE_ENTRY#* }
  EDGE_CACHE_DIR="$ROOT/cache/edge"
  EDGE_CACHE_FILE="$EDGE_CACHE_DIR/${EDGE_FILENAME##*/}"
  EDGE_CACHE_PARTIAL="$EDGE_CACHE_FILE.partial"
  mkdir -p "$EDGE_CACHE_DIR"
  printf 'Edge package: %s (%s)\n' "$EDGE_VERSION" "$EDGE_FILENAME"
  if dpkg-deb --info "$EDGE_CACHE_FILE" >/dev/null 2>&1; then
    printf 'Reusing verified Edge download cache: %s\n' "$EDGE_CACHE_FILE"
  else
    rm -f "$EDGE_CACHE_FILE"
    printf 'Downloading Edge into the persistent AICP cache...\n'
    if ! curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --progress-bar --continue-at - \
      "$EDGE_REPOSITORY/$EDGE_FILENAME" -o "$EDGE_CACHE_PARTIAL"; then
      printf 'Could not resume the partial Edge download; retrying from the beginning...\n' >&2
      rm -f "$EDGE_CACHE_PARTIAL"
      curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --progress-bar \
        "$EDGE_REPOSITORY/$EDGE_FILENAME" -o "$EDGE_CACHE_PARTIAL"
    fi
    if ! dpkg-deb --info "$EDGE_CACHE_PARTIAL" >/dev/null 2>&1; then
      printf 'The downloaded Microsoft Edge package is incomplete or invalid. Retry the installer.\n' >&2
      exit 1
    fi
    mv "$EDGE_CACHE_PARTIAL" "$EDGE_CACHE_FILE"
  fi
  EDGE_DEB_PATH=$EDGE_CACHE_FILE
  if ! dpkg-deb --info "$EDGE_DEB_PATH" >/dev/null 2>&1; then
    printf 'The downloaded Microsoft Edge package is incomplete or invalid. Retry the installer.\n' >&2
    exit 1
  fi
fi

AVAILABLE_PACKAGES=$MISSING_SEED_PACKAGES
if [ "$NEED_EDGE_DOWNLOAD" -eq 1 ]; then
  OPTIONAL_EDGE_LIBRARIES="libasound2 libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libcups2t64 libdbus-1-3 libdrm2 libexpat1 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 libudev1 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2"
  for package_name in $OPTIONAL_EDGE_LIBRARIES; do
    if apt-cache show "$package_name" >/dev/null 2>&1; then AVAILABLE_PACKAGES="$AVAILABLE_PACKAGES $package_name"; fi
  done
fi

if [ -n "$AVAILABLE_PACKAGES" ]; then
  printf 'Downloading only missing helper components and their private dependencies...\n'
  apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks --no-replaces --no-enhances $AVAILABLE_PACKAGES \
    | awk '/^[[:alnum:]][[:alnum:].+_-]*(:[[:alnum:]_-]+)?$/ { sub(/:.*/, "", $1); print $1 }' \
    | sort -u > "$DOWNLOADS/package-list"

  for package_name in $MISSING_SEED_PACKAGES; do
    if ! grep -qx "$package_name" "$DOWNLOADS/package-list"; then printf '%s\n' "$package_name" >> "$DOWNLOADS/package-list"; fi
  done
  sort -u "$DOWNLOADS/package-list" -o "$DOWNLOADS/package-list"

  download_package_batch() {
    [ "$#" -gt 0 ] || return 0
    printf '  downloading dependency batch (%s packages)...\n' "$#"
    if (cd "$DOWNLOADS/debs" && apt-get download "$@" >/dev/null 2>&1); then return 0; fi
    printf '  batch had an unavailable package; retrying only unresolved items...\n' >&2
    for batch_package in "$@"; do
      if ls "$DOWNLOADS/debs/${batch_package}_"*.deb >/dev/null 2>&1; then continue; fi
      if ! (cd "$DOWNLOADS/debs" && apt-get download "$batch_package" >/dev/null 2>&1); then
        case " $MISSING_SEED_PACKAGES " in
          *" $batch_package "*) printf 'Failed to download required package: %s\n' "$batch_package" >&2; exit 1 ;;
          *) printf 'Warning: optional package could not be downloaded: %s\n' "$batch_package" >&2 ;;
        esac
      fi
    done
  }

  batch_count=0
  reused_host_packages=0
  set --
  while IFS= read -r package_name; do
    [ -n "$package_name" ] || continue
    case "$package_name" in
      libc6|libgcc-s1|libstdc++6|zlib1g|libselinux1|libpcre2-8-0) continue ;;
    esac
    case " $MISSING_SEED_PACKAGES " in
      *" $package_name "*) required_seed=1 ;;
      *) required_seed=0 ;;
    esac
    if [ "$required_seed" -eq 0 ] && command -v dpkg-query >/dev/null 2>&1 \
      && dpkg-query -W -f='${Status}' "$package_name" 2>/dev/null | grep -qx 'install ok installed'; then
      reused_host_packages=$((reused_host_packages + 1))
      continue
    fi
    set -- "$@" "$package_name"
    batch_count=$((batch_count + 1))
    if [ "$batch_count" -ge 32 ]; then
      download_package_batch "$@"
      set --
      batch_count=0
    fi
  done < "$DOWNLOADS/package-list"
  download_package_batch "$@"
  printf '  reused %s already-installed host packages.\n' "$reused_host_packages"
fi

if [ "$NEED_EDGE_DOWNLOAD" -eq 1 ]; then
  dpkg-deb -x "$EDGE_DEB_PATH" "$STAGING/rootfs"
fi
for package_file in "$DOWNLOADS"/debs/*.deb; do
  [ -e "$package_file" ] || continue
  dpkg-deb -x "$package_file" "$STAGING/rootfs"
done

require_private_file() {
  if [ ! -e "$STAGING/rootfs/$1" ]; then printf 'Private runtime is incomplete; missing: %s\n' "$1" >&2; exit 1; fi
}
[ -n "$EDGE_COMMAND" ] || require_private_file opt/microsoft/msedge/msedge
if [ -z "$XVFB_COMMAND" ]; then
  require_private_file usr/bin/Xvfb
  if [ ! -e "$STAGING/rootfs/usr/share/X11/xkb" ] && { [ "$INSTALL_STRATEGY" = "private" ] || [ ! -e /usr/share/X11/xkb ]; }; then
    printf 'Private Xvfb needs XKB data, but neither the private runtime nor /usr/share/X11/xkb provides it.\n' >&2
    exit 1
  fi
  require_private_file usr/bin/xkbcomp
fi
[ -n "$X11VNC_COMMAND" ] || require_private_file usr/bin/x11vnc
[ -n "$WINDOW_MANAGER_COMMAND" ] || require_private_file usr/bin/openbox
[ -n "$WEBSOCKIFY_COMMAND" ] || require_private_file usr/bin/websockify
[ -n "$NOVNC_ROOT" ] || require_private_file usr/share/novnc/vnc.html

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

if [ -z "$X11VNC_COMMAND" ]; then write_native_wrapper x11vnc usr/bin/x11vnc; fi
if [ -z "$WINDOW_MANAGER_COMMAND" ]; then write_native_wrapper openbox usr/bin/openbox; fi

patch_private_xvfb_xkbcomp() {
  xvfb_binary=$1
  node --input-type=module -e '
    import { readFileSync, writeFileSync } from "node:fs";
    const target = process.argv[1];
    const data = readFileSync(target);
    const original = Buffer.from("/usr/bin");
    const replacement = Buffer.from("./xkbbin");
    const occurrences = (needle) => {
      let count = 0;
      let offset = 0;
      while ((offset = data.indexOf(needle, offset)) !== -1) {
        count += 1;
        offset += needle.length;
      }
      return count;
    };
    const originalCount = occurrences(original);
    const replacementCount = occurrences(replacement);
    if (originalCount === 1) {
      replacement.copy(data, data.indexOf(original));
      writeFileSync(target, data);
    } else if (!(originalCount === 0 && replacementCount === 1)) {
      throw new Error(`Unexpected Xvfb XKB compiler path count: original=${originalCount}, patched=${replacementCount}`);
    }
  ' "$xvfb_binary"
}

if [ -z "$XVFB_COMMAND" ]; then
  patch_private_xvfb_xkbcomp "$STAGING/rootfs/usr/bin/Xvfb"
  mkdir -p "$STAGING/xkbbin"
  ln -sf ../rootfs/usr/bin/xkbcomp "$STAGING/xkbbin/xkbcomp"
fi

if [ -z "$EDGE_COMMAND" ]; then printf '%s\n' \
  '#!/usr/bin/env sh' \
  'set -eu' \
  'RUNTIME=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)' \
  'ROOTFS="$RUNTIME/rootfs"' \
  'PRIVATE_LIBS="$ROOTFS/opt/microsoft/msedge:$ROOTFS/usr/lib/x86_64-linux-gnu:$ROOTFS/lib/x86_64-linux-gnu:$ROOTFS/usr/lib:$ROOTFS/lib"' \
  'export LD_LIBRARY_PATH="$PRIVATE_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
  'export PATH="$ROOTFS/usr/bin:$PATH"' \
  'export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$RUNTIME/xdg-config}"' \
  'mkdir -p "$XDG_CONFIG_HOME"' \
  'SANDBOX_ARGUMENT=--disable-setuid-sandbox' \
  'if [ -e "$RUNTIME/allow-no-sandbox" ]; then SANDBOX_ARGUMENT=--no-sandbox; fi' \
  'exec "$ROOTFS/opt/microsoft/msedge/msedge" "$SANDBOX_ARGUMENT" "$@"' \
  > "$STAGING/bin/microsoft-edge-stable"
chmod 0755 "$STAGING/bin/microsoft-edge-stable"
fi

if [ -z "$XVFB_COMMAND" ]; then printf '%s\n' \
  '#!/usr/bin/env sh' \
  'set -eu' \
  'RUNTIME=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)' \
  'ROOTFS="$RUNTIME/rootfs"' \
  'PRIVATE_LIBS="$ROOTFS/usr/lib/x86_64-linux-gnu:$ROOTFS/lib/x86_64-linux-gnu:$ROOTFS/usr/lib:$ROOTFS/lib"' \
  'export LD_LIBRARY_PATH="$PRIVATE_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
  'export PATH="$ROOTFS/usr/bin:$PATH"' \
  'XKB_DIR="$ROOTFS/usr/share/X11/xkb"' \
  'if [ ! -e "$XKB_DIR" ]; then XKB_DIR=/usr/share/X11/xkb; fi' \
  'cd "$RUNTIME"' \
  'exec "$ROOTFS/usr/bin/Xvfb" "$@" -xkbdir "$XKB_DIR"' \
  > "$STAGING/bin/Xvfb"
chmod 0755 "$STAGING/bin/Xvfb"
fi

if [ -z "$WEBSOCKIFY_COMMAND" ]; then printf '%s\n' \
  '#!/usr/bin/env sh' \
  'set -eu' \
  'RUNTIME=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)' \
  'ROOTFS="$RUNTIME/rootfs"' \
  'export PYTHONPATH="$ROOTFS/usr/lib/python3/dist-packages${PYTHONPATH:+:$PYTHONPATH}"' \
  'exec python3 "$ROOTFS/usr/bin/websockify" "$@"' \
  > "$STAGING/bin/websockify"
chmod 0755 "$STAGING/bin/websockify"
fi

rm -f "$STAGING/root-model" "$STAGING/allow-no-sandbox"
if [ "$ROOT_MODEL" -eq 1 ]; then
  : > "$STAGING/root-model"
  : > "$STAGING/allow-no-sandbox"
  printf 'Warning: %s mode detected. Edge runs as root without Chromium sandbox.\n' "$RUNTIME_MODE" >&2
elif [ "${AICP_ALLOW_NO_SANDBOX:-0}" = "1" ]; then
  : > "$STAGING/allow-no-sandbox"
  RUNTIME_MODE=user-no-sandbox
  printf 'Warning: the selected Edge sandbox is disabled by explicit request. Use only on a trusted dedicated server.\n' >&2
fi

EDGE_SOURCE=${EDGE_COMMAND:-private:runtime/bin/microsoft-edge-stable}
XVFB_SOURCE=${XVFB_COMMAND:-private:runtime/bin/Xvfb}
X11VNC_SOURCE=${X11VNC_COMMAND:-private:runtime/bin/x11vnc}
WINDOW_MANAGER_SOURCE=${WINDOW_MANAGER_COMMAND:-private:runtime/bin/openbox}
WEBSOCKIFY_SOURCE=${WEBSOCKIFY_COMMAND:-private:runtime/bin/websockify}
NOVNC_SOURCE=${NOVNC_ROOT:-private:runtime/rootfs/usr/share/novnc}
if [ -z "$XVFB_COMMAND" ] && [ -x "$STAGING/xkbbin/xkbcomp" ]; then XKBCOMP_SOURCE=private:runtime/xkbbin/xkbcomp
elif [ -x /usr/bin/xkbcomp ]; then XKBCOMP_SOURCE=/usr/bin/xkbcomp
else XKBCOMP_SOURCE=unavailable
fi

printf '%s\n' \
  'version=2' \
  "scope=aicp-$INSTALL_STRATEGY-runtime" \
  "install_strategy=$INSTALL_STRATEGY" \
  "mode=$RUNTIME_MODE" \
  "installed_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  "edge_package=$EDGE_FILENAME" \
  "edge_source=$EDGE_SOURCE" \
  "xvfb_source=$XVFB_SOURCE" \
  "x11vnc_source=$X11VNC_SOURCE" \
  "window_manager_source=$WINDOW_MANAGER_SOURCE" \
  "websockify_source=$WEBSOCKIFY_SOURCE" \
  "novnc_source=$NOVNC_SOURCE" \
  "xkbcomp_source=$XKBCOMP_SOURCE" \
  > "$STAGING/manifest.txt"

EDGE_SMOKE_COMMAND=$EDGE_COMMAND
if [ -z "$EDGE_SMOKE_COMMAND" ]; then EDGE_SMOKE_COMMAND="$STAGING/bin/microsoft-edge-stable"; fi
EDGE_SMOKE_SANDBOX=""
if [ "$ROOT_MODEL" -eq 1 ] || [ "${AICP_ALLOW_NO_SANDBOX:-0}" = "1" ]; then EDGE_SMOKE_SANDBOX=--no-sandbox; fi
EDGE_SMOKE_LOG="$DOWNLOADS/edge-smoke.log"
EDGE_SMOKE_CONFIG="$STAGING/xdg-config"
mkdir -p "$EDGE_SMOKE_CONFIG"
if ! XDG_CONFIG_HOME="$EDGE_SMOKE_CONFIG" timeout --signal=TERM --kill-after=5s 30s \
  "$EDGE_SMOKE_COMMAND" $EDGE_SMOKE_SANDBOX --headless=new --disable-gpu --no-first-run \
  --user-data-dir="$DOWNLOADS/edge-smoke-profile" --dump-dom about:blank >"$EDGE_SMOKE_LOG" 2>&1; then
  printf 'The selected Edge could not start. Check its libraries and the current sandbox mode.\n' >&2
  printf '%s\n' '--- Edge smoke-test output ---' >&2
  tail -n 30 "$EDGE_SMOKE_LOG" >&2 || true
  printf 'On a trusted dedicated server only, retry with: AICP_ALLOW_NO_SANDBOX=1 %s\n' "$0" >&2
  exit 1
fi

if [ "$INSTALL_STRATEGY" = "system" ]; then
  rm -rf "$STAGING/bin" "$STAGING/rootfs" "$STAGING/xkbbin" "$STAGING/xdg-config"
  mkdir -p "$STAGING/bin"
fi

BACKUP="$ROOT/.runtime.$$.old"
if [ -e "$RUNTIME" ]; then mv "$RUNTIME" "$BACKUP"; fi
if ! mv "$STAGING" "$RUNTIME"; then
  if [ -e "$BACKUP" ]; then mv "$BACKUP" "$RUNTIME"; fi
  exit 1
fi
rm -rf "$BACKUP"
COMMITTED=1

printf '\nAICP hybrid remote UI runtime installed successfully.\n'
printf 'Runtime: %s\n' "$RUNTIME"
printf 'Mode: %s\n' "$RUNTIME_MODE"
printf 'No files were written to /usr, /opt, or /etc.\n'
printf 'Run as the same user:\n'
printf '  aicp remote-ui doctor\n'
printf '  aicp login --remote-ui --yes\n'
