#!/bin/sh
# Qoder CLI reports agent status in Herdr's terminal itself, but only when
# QODER_PROGRAM_STATUS is set. This wrapper turns that on for the one process
# Herdr starts, the same way the Windows launcher (qoder.ps1) does.
#
# Qoder CLI lands in different places depending on how it was installed:
#   official script  ~/.local/bin/qodercli -> ~/.qoder/bin/qodercli/qodercli-<version>
#   npm              <prefix>/bin/qodercli
#   Windows layout   ~/.qoder/bin/qodercli/qodercli[.exe]
# so probe instead of trusting one path.

find_qoder() {
  if [ -n "${QODER_BIN:-}" ] && [ -x "$QODER_BIN" ]; then
    printf '%s' "$QODER_BIN"; return 0
  fi
  if [ -x "$HOME/.qoder/bin/qodercli/qodercli" ]; then
    printf '%s' "$HOME/.qoder/bin/qodercli/qodercli"; return 0
  fi
  for name in qodercli qoder qodercn; do
    path=$(command -v "$name" 2>/dev/null) || continue
    [ -n "$path" ] && { printf '%s' "$path"; return 0; }
  done
  # Last resort: a versioned binary whose entry point went missing.
  for path in "$HOME"/.qoder/bin/qodercli/qodercli-*; do
    [ -x "$path" ] && { printf '%s' "$path"; return 0; }
  done
  return 1
}

qoder=$(find_qoder) || {
  echo "Qoder CLI not found." >&2
  echo "Install it with: curl -fsSL https://qoder.com/install | bash" >&2
  exit 127
}

QODER_PROGRAM_STATUS=1
export QODER_PROGRAM_STATUS
exec "$qoder" "$@"
