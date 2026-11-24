#!/usr/bin/env bash
# Task 1. Deploy MockUSDC on Anvil, mint, and read the balance back.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
require_anvil

cd "$CONTRACTS"
ALICE=$(wallet "$ALICE_KEY")
BOB=$(wallet "$BOB_KEY")

USDC=$(deploy src/MockUSDC.sol MockUSDC "$ALICE_KEY")
echo "MockUSDC $USDC"

DECIMALS=$(call_uint "$USDC" "decimals()(uint8)")
assert_eq "$DECIMALS" "6" "decimals"

NAME=$(cast call --rpc-url "$RPC" "$USDC" "name()(string)" | tr -d '"')
assert_eq "$NAME" "Mock USDC" "name"

send_ok "$ALICE_KEY" "$USDC" "mint(address,uint256)" "$ALICE" 100000000
send_ok "$ALICE_KEY" "$USDC" "approve(address,uint256)" "$BOB" 25000000
send_ok "$BOB_KEY" "$USDC" "transferFrom(address,address,uint256)" "$ALICE" "$BOB" 25000000

assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$ALICE")" "75000000" "alice balance after transferFrom"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$BOB")" "25000000" "bob balance after transferFrom"
assert_eq "$(call_uint "$USDC" "allowance(address,address)(uint256)" "$ALICE" "$BOB")" "0" "allowance spent"

echo "task 1 passed on $RPC"
