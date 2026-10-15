#!/usr/bin/env bash
# Ask the installed OpenCode whether .opencode/plugins/agent-kit.js is active.
# File presence is not a status. A private server is used so this does not
# attach the target to the operator's already-running session.
# Usage: probe-plugin.sh <target-root>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <target-root>" >&2
  exit 2
fi

TARGET=$(cd "$1" && pwd)
PLUGIN="$TARGET/.opencode/plugins/agent-kit.js"

emit() {
  local status=$1 version=$2 id=$3 state=$4 path=$5 error=$6
  printf 'plugin-activation: %s\n' "$status"
  printf 'opencode: %s\n' "$version"
  printf 'plugin-id: %s\n' "$id"
  printf 'plugin-state: %s\n' "$state"
  printf 'plugin-path: %s\n' "$path"
  printf 'plugin-error: %s\n' "$error"
}

if [[ ! -f "$PLUGIN" ]]; then
  emit not-installed n/a - - - "plugin file is absent"
  exit 0
fi

if ! command -v opencode >/dev/null 2>&1; then
  emit opencode-missing missing - - "$PLUGIN" "opencode is not on PATH; activation was not tested"
  exit 0
fi

VERSION=$(opencode --version 2>/dev/null | head -1 || true)
VERSION=${VERSION:-unknown}

PORT=$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)

LOG=$(mktemp "${TMPDIR:-/tmp}/agent-kit-probe.XXXXXX")
spid=""
cleanup() {
  if [[ -n "$spid" ]]; then
    kill "$spid" 2>/dev/null || true
    wait "$spid" 2>/dev/null || true
  fi
  rm -f "$LOG"
}
trap cleanup EXIT

opencode serve --port "$PORT" --hostname 127.0.0.1 >"$LOG" 2>&1 &
spid=$!

pass=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do
  if ! kill -0 "$spid" 2>/dev/null; then
    break
  fi
  pass=$(sed -n 's/^server password //p' "$LOG" | head -1 || true)
  if [[ -n "$pass" ]]; then
    break
  fi
  sleep 0.25
done

if [[ -z "$pass" ]]; then
  emit unobserved "$VERSION" - - "$PLUGIN" "private OpenCode server did not become ready; activation was not observed"
  exit 0
fi

export OPENCODE_PASSWORD="$pass"
BODY=$(mktemp "${TMPDIR:-/tmp}/agent-kit-plugins.XXXXXX")
trap 'rm -f "$BODY"; cleanup' EXIT

seen=0
for _ in 1 2 3 4 5 6 7 8; do
  if OPENCODE_PASSWORD="$pass" opencode api get "/api/plugin?location[directory]=$TARGET" --server "http://127.0.0.1:$PORT" >"$BODY" 2>/dev/null; then
    seen=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1])).get("data") or []))' "$BODY" || echo 0)
    if [[ "$seen" != "0" ]]; then
      break
    fi
  fi
  sleep 1
done

if [[ "$seen" == "0" ]]; then
  emit unobserved "$VERSION" - - "$PLUGIN" "plugin list stayed empty after the location boot; activation was not observed"
  exit 0
fi

python3 - "$BODY" "$PLUGIN" "$VERSION" <<'PY'
import json, os, sys
body, plugin, version = sys.argv[1:]
data = json.load(open(body)).get("data") or []

def canon(p):
    try:
        return os.path.realpath(p)
    except OSError:
        return p

want = canon(plugin)
match = None
for item in data:
    src = item.get("source") or {}
    path = src.get("path") or ""
    if src.get("type") == "local" and path and canon(path) == want:
        match = item
        break

if not match:
    print(f"plugin-activation: not-listed")
    print(f"opencode: {version}")
    print("plugin-id: -")
    print("plugin-state: -")
    print(f"plugin-path: {plugin}")
    print("plugin-error: location loaded but this file was not in the plugin list")
    raise SystemExit(0)

state = match.get("state") or {}
status = state.get("status") or ""
err = state.get("error") or ""
pid = match.get("id") or "-"
if status == "active" and pid == "agent-kit":
    activation = "active"
elif status == "failed":
    activation = "failed"
else:
    activation = "failed"
    if not err:
        err = f"listed as {status or 'unknown'} id={pid}; not treated as active"
print(f"plugin-activation: {activation}")
print(f"opencode: {version}")
print(f"plugin-id: {pid}")
print(f"plugin-state: {status or '-'}")
print(f"plugin-path: {plugin}")
print(f"plugin-error: {err}")
PY
