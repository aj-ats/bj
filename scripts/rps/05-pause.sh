#!/usr/bin/env bash
# Task 5. Pause blocks new matches. Cancel, reveal, settle, and claim still run.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
require_anvil

ALICE=$(wallet "$ALICE_KEY")
BOB=$(wallet "$BOB_KEY")
FEE=$(wallet "$FEE_KEY")
STAKE=20000000
FUND=100000000
SALT_A=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SALT_B=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
ROCK=1
SCISSORS=3
COMMIT_A=0x1111111111111111111111111111111111111111111111111111111111111111

USDC=$(deploy src/MockUSDC.sol MockUSDC "$ALICE_KEY")
RPS=$(deploy src/Rps.sol Rps "$ALICE_KEY" --constructor-args "$USDC" "$FEE" "$ALICE")
echo "Rps $RPS"

send_ok "$ALICE_KEY" "$USDC" "mint(address,uint256)" "$ALICE" "$FUND"
send_ok "$ALICE_KEY" "$USDC" "mint(address,uint256)" "$BOB" "$FUND"
send_ok "$ALICE_KEY" "$USDC" "approve(address,uint256)" "$RPS" "$FUND"
send_ok "$BOB_KEY" "$USDC" "approve(address,uint256)" "$RPS" "$FUND"

expect_revert "bob is not the owner" "NotOwner()" \
  cast send --rpc-url "$RPC" --private-key "$BOB_KEY" "$RPS" "pause()"

send_ok "$ALICE_KEY" "$RPS" "pause()"
assert_eq "$(call_uint "$RPS" "paused()(bool)")" "true" "paused"
expect_revert "create while paused" "GameIsPaused()" \
  cast send --rpc-url "$RPC" --private-key "$ALICE_KEY" "$RPS" "createMatch(bytes32,uint256)" "$COMMIT_A" "$STAKE"

send_ok "$ALICE_KEY" "$RPS" "unpause()"
COMMIT_ROCK=$(cast call --rpc-url "$RPC" "$RPS" "commitHash(uint8,bytes32)(bytes32)" "$ROCK" "$SALT_A" | tr -d '[:space:]')
COMMIT_SCISSORS=$(cast call --rpc-url "$RPC" "$RPS" "commitHash(uint8,bytes32)(bytes32)" "$SCISSORS" "$SALT_B" | tr -d '[:space:]')
send_ok "$ALICE_KEY" "$RPS" "createMatch(bytes32,uint256)" "$COMMIT_A" "$STAKE"
send_ok "$ALICE_KEY" "$RPS" "createMatch(bytes32,uint256)" "$COMMIT_ROCK" "$STAKE"
send_ok "$BOB_KEY" "$RPS" "joinMatch(uint256,bytes32)" 2 "$COMMIT_SCISSORS"

send_ok "$ALICE_KEY" "$RPS" "pause()"
expect_revert "join while paused" "GameIsPaused()" \
  cast send --rpc-url "$RPC" --private-key "$BOB_KEY" "$RPS" "joinMatch(uint256,bytes32)" 1 "$COMMIT_SCISSORS"
send_ok "$ALICE_KEY" "$RPS" "cancel(uint256)" 1
send_ok "$ALICE_KEY" "$RPS" "claim()"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$ALICE")" "80000000" "cancel and claim while paused"

send_ok "$ALICE_KEY" "$RPS" "reveal(uint256,uint8,bytes32)" 2 "$ROCK" "$SALT_A"
send_ok "$BOB_KEY" "$RPS" "reveal(uint256,uint8,bytes32)" 2 "$SCISSORS" "$SALT_B"
send_ok "$FEE_KEY" "$RPS" "settle(uint256)" 2
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$ALICE")" "39960000" "settle while paused"
assert_eq "$(call_uint "$RPS" "matchStatus(uint256)(uint8)" 2)" "3" "match settled while paused"

echo "task 5 passed on $RPC"
