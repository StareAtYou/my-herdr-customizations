#!/bin/sh
set -eu

case "${1:-}" in
    macos|windows) platform=$1 ;;
    *) printf '%s\n' 'Usage: apply.sh macos|windows /path/to/herdr-app' >&2; exit 2 ;;
esac

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source=$(CDPATH= cd -- "${2:?Missing Herdr App source checkout}" && pwd)
frame="$source/defaults/frame/settings"
patch="$here/native-settings-v0.1.15.patch"
if ! git -C "$source" apply --reverse --check "$patch" 2>/dev/null; then
    git -C "$source" apply "$patch"
fi
cp "$here/workspace-appearance.js" "$frame/workspace-appearance.js"
cp "$here/../../platforms/$platform/desktop/look-platform.js" "$frame/look-platform.js"
