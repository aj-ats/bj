#!/usr/bin/env bash
# Deploy MockUSDC and Rps to the local chain and check the addresses that were written.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
require_anvil

ALICE=$(wallet "$ALICE_KEY")
FEE=$(wallet "$FEE_KEY")
BOB=$(wallet "$BOB_KEY")

export PRIVATE_KEY="$ALICE_KEY"
export FEE_RECIPIENT="$FEE"
mkdir -p "$CONTRACTS/broadcast"

(
  cd "$CONTRACTS"
  forge script script/Deploy.s.sol:Deploy \
    --rpc-url "$RPC" \
    --broadcast \
    --private-key "$ALICE_KEY"
)

JSON="$CONTRACTS/broadcast/local.json"
[[ -f "$JSON" ]]

read -r USDC RPS OWNER < <(python3 -c '
import json, sys
data = json.load(open(sys.argv[1]))
assert data["chainId"] == 31337
print(data["usdc"], data["rps"], data["owner"])
' "$JSON")

echo "local.json usdc=$USDC rps=$RPS"

on_chain_token=$(cast call --rpc-url "$RPC" "$RPS" "token()(address)" | tr -d '[:space:]')
on_chain_fee=$(cast call --rpc-url "$RPC" "$RPS" "feeRecipient()(address)" | tr -d '[:space:]')
on_chain_owner=$(cast call --rpc-url "$RPC" "$RPS" "owner()(address)" | tr -d '[:space:]')

assert_eq "$(echo "$on_chain_token" | tr '[:upper:]' '[:lower:]')" "$(echo "$USDC" | tr '[:upper:]' '[:lower:]')" "token address"
assert_eq "$(echo "$on_chain_fee" | tr '[:upper:]' '[:lower:]')" "$(echo "$FEE" | tr '[:upper:]' '[:lower:]')" "fee recipient"
assert_eq "$(echo "$on_chain_owner" | tr '[:upper:]' '[:lower:]')" "$(echo "$OWNER" | tr '[:upper:]' '[:lower:]')" "owner"
assert_eq "$(echo "$on_chain_owner" | tr '[:upper:]' '[:lower:]')" "$(echo "$ALICE" | tr '[:upper:]' '[:lower:]')" "owner is anvil account 0"

# 100_000 token units of 6 decimals. Public mint is the local faucet.
send_ok "$ALICE_KEY" "$USDC" "mint(address,uint256)" "$BOB" 100000000000
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$BOB")" "100000000000" "faucet mints 100000 USDC"

echo "deploy passed on $RPC"
