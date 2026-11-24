#!/usr/bin/env bash
# Task 2. Create, join, cancel, and claim on Anvil. Stakes are 20 MockUSDC.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
require_anvil

ALICE=$(wallet "$ALICE_KEY")
BOB=$(wallet "$BOB_KEY")
FEE=$(wallet "$FEE_KEY")
STAKE=20000000
FUND=100000000
COMMIT_A=0x1111111111111111111111111111111111111111111111111111111111111111
COMMIT_B=0x2222222222222222222222222222222222222222222222222222222222222222
ZERO=0x0000000000000000000000000000000000000000000000000000000000000000

USDC=$(deploy src/MockUSDC.sol MockUSDC "$ALICE_KEY")
RPS=$(deploy src/Rps.sol Rps "$ALICE_KEY" --constructor-args "$USDC" "$FEE" "$ALICE")
echo "MockUSDC $USDC"
echo "Rps $RPS"

send_ok "$ALICE_KEY" "$USDC" "mint(address,uint256)" "$ALICE" "$FUND"
send_ok "$ALICE_KEY" "$USDC" "mint(address,uint256)" "$BOB" "$FUND"
send_ok "$ALICE_KEY" "$USDC" "approve(address,uint256)" "$RPS" "$FUND"
send_ok "$BOB_KEY" "$USDC" "approve(address,uint256)" "$RPS" "$FUND"

expect_revert "blank commit" "BadCommit()" \
  cast send --rpc-url "$RPC" --private-key "$ALICE_KEY" "$RPS" "createMatch(bytes32,uint256)" "$ZERO" "$STAKE"
expect_revert "stake below 1 USDC" "BadStake()" \
  cast send --rpc-url "$RPC" --private-key "$ALICE_KEY" "$RPS" "createMatch(bytes32,uint256)" "$COMMIT_A" 999999

send_ok "$ALICE_KEY" "$RPS" "createMatch(bytes32,uint256)" "$COMMIT_A" "$STAKE"
assert_eq "$(call_uint "$RPS" "nextMatchId()(uint256)")" "2" "next match id"
assert_eq "$(call_uint "$RPS" "matchStatus(uint256)(uint8)" 1)" "1" "match 1 waiting"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$ALICE")" "80000000" "alice after create"

expect_revert "stranger cannot cancel a fresh lobby" "NotPlayer()" \
  cast send --rpc-url "$RPC" --private-key "$BOB_KEY" "$RPS" "cancel(uint256)" 1
send_ok "$ALICE_KEY" "$RPS" "cancel(uint256)" 1
assert_eq "$(call_uint "$RPS" "matchStatus(uint256)(uint8)" 1)" "4" "match 1 cancelled"
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$ALICE")" "$STAKE" "creator credit"
send_ok "$ALICE_KEY" "$RPS" "claim()"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$ALICE")" "$FUND" "alice refunded"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$RPS")" "0" "contract empty after claim"
expect_revert "second claim" "NothingToClaim()" \
  cast send --rpc-url "$RPC" --private-key "$ALICE_KEY" "$RPS" "claim()"

send_ok "$ALICE_KEY" "$RPS" "createMatch(bytes32,uint256)" "$COMMIT_A" "$STAKE"
expect_revert "creator cannot join own match" "SamePlayer()" \
  cast send --rpc-url "$RPC" --private-key "$ALICE_KEY" "$RPS" "joinMatch(uint256,bytes32)" 2 "$COMMIT_B"
send_ok "$BOB_KEY" "$RPS" "joinMatch(uint256,bytes32)" 2 "$COMMIT_B"
assert_eq "$(call_uint "$RPS" "matchStatus(uint256)(uint8)" 2)" "2" "match 2 in reveal"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$ALICE")" "80000000" "alice staked"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$BOB")" "80000000" "bob staked"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$RPS")" "40000000" "pot locked"
expect_revert "cannot cancel after join" "BadStatus()" \
  cast send --rpc-url "$RPC" --private-key "$ALICE_KEY" "$RPS" "cancel(uint256)" 2
expect_revert "cannot join twice" "BadStatus()" \
  cast send --rpc-url "$RPC" --private-key "$BOB_KEY" "$RPS" "joinMatch(uint256,bytes32)" 2 "$COMMIT_B"

send_ok "$ALICE_KEY" "$RPS" "createMatch(bytes32,uint256)" "$COMMIT_A" "$STAKE"
cast rpc --rpc-url "$RPC" evm_increaseTime 601 >/dev/null
cast rpc --rpc-url "$RPC" evm_mine >/dev/null
expect_revert "join window closed" "Expired()" \
  cast send --rpc-url "$RPC" --private-key "$BOB_KEY" "$RPS" "joinMatch(uint256,bytes32)" 3 "$COMMIT_B"
send_ok "$FEE_KEY" "$RPS" "cancel(uint256)" 3
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$ALICE")" "$STAKE" "expired lobby credit"
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$FEE")" "0" "no fee on cancel"

echo "task 2 passed on $RPC"
