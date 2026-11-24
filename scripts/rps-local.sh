#!/usr/bin/env bash
# Start a fresh Anvil, run every RPS check against it, then stop it.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
RPC="${RPC:-http://127.0.0.1:8545}"
LOG=/tmp/rps-anvil-e2e.log

if lsof -nP -iTCP:8545 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8545 is already in use. Stop that process, then run this again." >&2
  exit 1
fi

forge test --root "$ROOT/contracts"

anvil --host 127.0.0.1 --port 8545 --chain-id 31337 >"$LOG" 2>&1 &
ANVIL_PID=$!
cleanup() {
  kill "$ANVIL_PID" 2>/dev/null || true
  wait "$ANVIL_PID" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 50); do
  if cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$ANVIL_PID" 2>/dev/null; then
    echo "Anvil exited before it was ready." >&2
    cat "$LOG" >&2
    exit 1
  fi
  sleep 0.1
done
if [[ "$ready" != "1" ]]; then
  echo "Anvil did not answer on $RPC" >&2
  cat "$LOG" >&2
  exit 1
fi

bash "$ROOT/scripts/rps/01-token.sh"
bash "$ROOT/scripts/rps/02-lobby.sh"
bash "$ROOT/scripts/rps/03-settle.sh"
bash "$ROOT/scripts/rps/04-timeout.sh"
bash "$ROOT/scripts/rps/05-pause.sh"
bash "$ROOT/scripts/rps/deploy.sh"

echo "rps local e2e passed"
