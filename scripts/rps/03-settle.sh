#!/usr/bin/env bash
# Task 3. Reveal and settle a win, a loss, and a tie on Anvil.
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
PAPER=2
SCISSORS=3

USDC=$(deploy src/MockUSDC.sol MockUSDC "$ALICE_KEY")
RPS=$(deploy src/Rps.sol Rps "$ALICE_KEY" --constructor-args "$USDC" "$FEE" "$ALICE")
echo "Rps $RPS"

send_ok "$ALICE_KEY" "$USDC" "mint(address,uint256)" "$ALICE" "$FUND"
send_ok "$ALICE_KEY" "$USDC" "mint(address,uint256)" "$BOB" "$FUND"
send_ok "$ALICE_KEY" "$USDC" "approve(address,uint256)" "$RPS" "$FUND"
send_ok "$BOB_KEY" "$USDC" "approve(address,uint256)" "$RPS" "$FUND"

commit_of() {
  cast call --rpc-url "$RPC" "$RPS" "commitHash(uint8,bytes32)(bytes32)" "$1" "$2" | tr -d '[:space:]'
}

play() {
  local choice_a="$1" choice_b="$2" id="$3"
  local commit_a commit_b
  commit_a=$(commit_of "$choice_a" "$SALT_A")
  commit_b=$(commit_of "$choice_b" "$SALT_B")
  send_ok "$ALICE_KEY" "$RPS" "createMatch(bytes32,uint256)" "$commit_a" "$STAKE"
  send_ok "$BOB_KEY" "$RPS" "joinMatch(uint256,bytes32)" "$id" "$commit_b"
  if [[ "$id" == "1" ]]; then
    expect_revert "wrong salt" "BadReveal()" \
      cast send --rpc-url "$RPC" --private-key "$ALICE_KEY" "$RPS" \
      "reveal(uint256,uint8,bytes32)" "$id" "$choice_a" "$SALT_B"
  fi
  send_ok "$ALICE_KEY" "$RPS" "reveal(uint256,uint8,bytes32)" "$id" "$choice_a" "$SALT_A"
  expect_revert "settle waits for both reveals on match $id" "BadStatus()" \
    cast send --rpc-url "$RPC" --private-key "$FEE_KEY" "$RPS" "settle(uint256)" "$id"
  send_ok "$BOB_KEY" "$RPS" "reveal(uint256,uint8,bytes32)" "$id" "$choice_b" "$SALT_B"
  send_ok "$FEE_KEY" "$RPS" "settle(uint256)" "$id"
}

play "$ROCK" "$SCISSORS" 1
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$ALICE")" "39960000" "alice wins rock vs scissors"
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$BOB")" "0" "bob loses rock vs scissors"
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$FEE")" "40000" "fee on a decision"
send_ok "$ALICE_KEY" "$RPS" "claim()"
send_ok "$FEE_KEY" "$RPS" "claim()"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$ALICE")" "119960000" "alice balance after the win"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$FEE")" "40000" "fee balance"

play "$PAPER" "$PAPER" 2
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$ALICE")" "$STAKE" "tie credits alice"
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$BOB")" "$STAKE" "tie credits bob"
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$FEE")" "0" "tie charges no fee"
send_ok "$ALICE_KEY" "$RPS" "claim()"
send_ok "$BOB_KEY" "$RPS" "claim()"

play "$PAPER" "$SCISSORS" 3
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$BOB")" "39960000" "bob wins scissors vs paper"
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$ALICE")" "0" "alice loses scissors vs paper"
send_ok "$BOB_KEY" "$RPS" "claim()"
send_ok "$FEE_KEY" "$RPS" "claim()"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$ALICE")" "99960000" "alice after the loss"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$BOB")" "99960000" "bob after the win"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$FEE")" "80000" "fee after two decisions"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$RPS")" "0" "contract paid out"

echo "task 3 passed on $RPC"
