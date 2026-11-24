# Shared helpers for the local Anvil checks. Source this file. Do not execute it.
# The keys are Anvil's published defaults. They are for chain id 31337 only.
# docs/rps/foundry.md explains how a script uses these helpers.

if [[ -z "${BASH_SOURCE[0]:-}" ]]; then
  echo "source scripts/rps/common.sh from another script" >&2
  exit 1
fi

_RPS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$_RPS_DIR/../.." && pwd)
RPC="${RPC:-http://127.0.0.1:8545}"
CONTRACTS="$ROOT/contracts"

ALICE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
BOB_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
FEE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a

require_anvil() {
  local id
  if ! id=$(cast chain-id --rpc-url "$RPC" 2>/dev/null); then
    echo "Anvil is not answering at $RPC" >&2
    exit 1
  fi
  if [[ "$id" != "31337" ]]; then
    echo "Refusing to run against chain id $id. Start Anvil with --chain-id 31337." >&2
    exit 1
  fi
}

assert_eq() {
  local got="$1" expected="$2" label="$3"
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL $label" >&2
    echo "  got      $got" >&2
    echo "  expected $expected" >&2
    exit 1
  fi
  echo "ok  $label"
}

# forge create --json, then print the deployed address on stdout. Diagnostics stay on stderr.
deploy() {
  local file="$1" name="$2" key="$3"
  shift 3
  local out address err
  err=$(mktemp)
  if ! out=$(forge create "$file:$name" \
    --root "$CONTRACTS" \
    --rpc-url "$RPC" \
    --private-key "$key" \
    --broadcast \
    --json \
    "$@" 2>"$err"); then
    echo "FAIL deploy $file:$name" >&2
    cat "$err" >&2
    rm -f "$err"
    exit 1
  fi
  if ! address=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["deployedTo"])' <<<"$out"); then
    echo "FAIL deploy $file:$name: forge did not return JSON" >&2
    printf '%s\n' "$out" >&2
    cat "$err" >&2
    rm -f "$err"
    exit 1
  fi
  rm -f "$err"
  printf '%s\n' "$address"
}

# A mined successful transaction. The first argument after the key and the target is the call, and that is what a failure prints.
send_ok() {
  local key="$1" to="$2"
  shift 2
  local out err
  err=$(mktemp)
  if ! out=$(cast send --json --rpc-url "$RPC" --private-key "$key" "$to" "$@" 2>"$err"); then
    echo "FAIL send $1" >&2
    cat "$err" >&2
    rm -f "$err"
    exit 1
  fi
  rm -f "$err"
  if ! python3 -c 'import json,sys; d=json.load(sys.stdin); status=d.get("status"); assert status in ("0x1", 1, "1"), status' <<<"$out"; then
    echo "FAIL send $1: the transaction was mined and did not succeed" >&2
    exit 1
  fi
}

# The command must revert with this custom error. Any other failure is a broken check, not a pass.
# `set -e` does not abort the script when the command is the condition of `if`.
expect_revert() {
  local label="$1" signature="$2"
  shift 2
  local err selector
  err=$(mktemp)
  if "$@" >"$err" 2>&1; then
    echo "FAIL $label: command succeeded. Expected revert $signature." >&2
    cat "$err" >&2
    rm -f "$err"
    exit 1
  fi
  selector=$(cast sig "$signature")
  if ! grep -F -q -e "$selector" "$err"; then
    echo "FAIL $label: revert did not match $signature ($selector)." >&2
    echo "A failed command is not a pass. A dead RPC or a bad argument fails too." >&2
    cat "$err" >&2
    rm -f "$err"
    exit 1
  fi
  rm -f "$err"
  echo "ok  $label"
}

# Decimal return value of a cast call. Cast prints `75000000[7.5e7]`; keep the integer.
call_uint() {
  local out
  out=$(cast call --rpc-url "$RPC" "$@" | sed -E 's/\[.*$//' | tr -d '[:space:]')
  if [[ -z "$out" ]]; then
    echo "FAIL empty return from cast call $*" >&2
    exit 1
  fi
  printf '%s\n' "$out"
}

wallet() {
  cast wallet address --private-key "$1"
}
