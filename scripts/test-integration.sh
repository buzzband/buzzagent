#!/usr/bin/env bash
set -e

PORT_PROVIDER=4705
PORT_CORE=4615
PASSWORD="testpass_integration"
PROJECT_DIR="/tmp/kilo/audit/proj"
STATE_DIR="/tmp/kilo/audit/state"

mkdir -p "$PROJECT_DIR" "$STATE_DIR/opencode"

# Ensure mock config exists
cat <<EOF > "$STATE_DIR/opencode/opencode.jsonc"
{
  "\$schema": "https://opencode.ai/config.json",
  "share": "disabled",
  "autoupdate": false,
  "small_model": "mock/mock-coder",
  "provider": {
    "mock": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Mock (local test)",
      "options": {
        "baseURL": "http://127.0.0.1:${PORT_PROVIDER}/v1"
      },
      "models": {
        "mock-coder": {
          "name": "Mock Coder"
        }
      }
    }
  }
}
EOF

# Kill any existing processes on these ports
fuser -k "${PORT_PROVIDER}/tcp" 2>/dev/null || true
fuser -k "${PORT_CORE}/tcp" 2>/dev/null || true

# Start mock provider
python3 scripts/mock-provider.py "$PORT_PROVIDER" >/tmp/kilo/test-provider.log 2>&1 &
PID_PROVIDER=$!

cleanup() {
  kill "$PID_PROVIDER" 2>/dev/null || true
  kill "$PID_CORE" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for provider
for i in {1..30}; do
  if curl -s "http://127.0.0.1:${PORT_PROVIDER}/v1/models" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

# Resolve opencode binary
OPENCODE_BIN="/tmp/kilo/oc/opencode"
if [ ! -f "$OPENCODE_BIN" ]; then
  OPENCODE_BIN="$(which opencode 2>/dev/null || true)"
fi
if [ -z "$OPENCODE_BIN" ] || [ ! -x "$OPENCODE_BIN" ]; then
  echo "Error: opencode binary not found at /tmp/kilo/oc/opencode or on PATH"
  exit 1
fi

# Start core in test project dir
(
  cd "$PROJECT_DIR"
  XDG_STATE_HOME="$STATE_DIR" \
  XDG_CONFIG_HOME="$STATE_DIR" \
  XDG_DATA_HOME="$STATE_DIR" \
  XDG_CACHE_HOME="/tmp/kilo/audit/cache" \
  OPENCODE_SERVER_PASSWORD="$PASSWORD" \
  "$OPENCODE_BIN" serve --hostname 127.0.0.1 --port "$PORT_CORE" >/tmp/kilo/test-core.log 2>&1
) &
PID_CORE=$!

# Wait for core health (can take 10-15s on first start)
for i in {1..120}; do
  if curl -m 2 -s -u "opencode:${PASSWORD}" "http://127.0.0.1:${PORT_CORE}/global/health" | grep -q "healthy"; then
    echo "Core is healthy on port ${PORT_CORE}"
    break
  fi
  sleep 0.5
done

# Run integration tests
BUZZ_TEST_CORE_URL="http://127.0.0.1:${PORT_CORE}" \
BUZZ_TEST_CORE_PASSWORD="$PASSWORD" \
BUZZ_TEST_MODEL="mock/mock-coder" \
npx vitest run src/tests/integration.test.ts
