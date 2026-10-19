#!/usr/bin/env bash
# Runs the OpenPencil editor for a project's design/ folder: a development-mode bundle
# (only development builds bridge a browser tab to the MCP server) served by
# `vite preview`.
#
#   design/open-pencil/editor.sh setup   # clone, install, and build once
#   design/open-pencil/editor.sh start   # foreground; run it through vibepod-preview
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
op_dir="${OPENPENCIL_DIR:-$HOME/workspaces/open-pencil}"
op_ref="${OPENPENCIL_REF:-de913ce}"
token_file="${OPENPENCIL_TOKEN_FILE:-$HOME/.config/vibepod/open-pencil/token}"

case "${1:-}" in
setup)
  [ -d "$op_dir/.git" ] || git clone https://github.com/open-pencil/open-pencil.git "$op_dir"
  git -C "$op_dir" fetch --quiet origin
  git -C "$op_dir" checkout --quiet "$op_ref"
  grep -qx vite.vibepod.config.ts "$op_dir/.git/info/exclude" ||
    echo vite.vibepod.config.ts >>"$op_dir/.git/info/exclude"
  (cd "$op_dir" && bun install --frozen-lockfile && bun run build:packages)
  if [ ! -f "$token_file" ]; then
    mkdir -p "$(dirname "$token_file")"
    (umask 077 && openssl rand -hex 32 >"$token_file")
  fi
  ;;
start)
  : "${OPENPENCIL_DEV_ORIGIN:?set to the public editor origin, e.g. https://open-pencil.<preview-domain>}"
  cp "$here/vite.vibepod.config.ts" "$op_dir/vite.vibepod.config.ts"
  cd "$op_dir"
  export OPENPENCIL_DEV_TOKEN="$(cat "$token_file")"
  export OPENPENCIL_FILES_ROOT="${OPENPENCIL_FILES_ROOT:-$(dirname "$here")/views}"
  # The document a bare editor URL opens: the first one in views/ unless set.
  export OPENPENCIL_DEFAULT_FILE="${OPENPENCIL_DEFAULT_FILE:-$(cd "$OPENPENCIL_FILES_ROOT" 2>/dev/null && ls -1 -- *.fig 2>/dev/null | head -1)}"
  NODE_ENV=development bunx vite build --config vite.vibepod.config.ts --mode development
  exec bunx vite preview --config vite.vibepod.config.ts --mode development \
    --host 127.0.0.1 --port "${PORT:-1420}" --strictPort
  ;;
*)
  echo "usage: $0 setup|start" >&2
  exit 2
  ;;
esac
