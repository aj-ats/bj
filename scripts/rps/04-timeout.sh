#!/usr/bin/env bash
# Task 4. After the reveal window, one reveal wins and zero reveals refund.
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

open_match() {
  local choice_a="$1" choice_b="$2" id="$3"
  send_ok "$ALICE_KEY" "$RPS" "createMatch(bytes32,uint256)" "$(commit_of "$choice_a" "$SALT_A")" "$STAKE"
  send_ok "$BOB_KEY" "$RPS" "joinMatch(uint256,bytes32)" "$id" "$(commit_of "$choice_b" "$SALT_B")"
}

mine_past_reveal() {
  cast rpc --rpc-url "$RPC" evm_increaseTime 601 >/dev/null
  cast rpc --rpc-url "$RPC" evm_mine >/dev/null
}

open_match "$ROCK" "$PAPER" 1
expect_revert "timeout before the reveal deadline" "TooEarly()" \
  cast send --rpc-url "$RPC" --private-key "$FEE_KEY" "$RPS" "timeout(uint256)" 1
send_ok "$ALICE_KEY" "$RPS" "reveal(uint256,uint8,bytes32)" 1 "$ROCK" "$SALT_A"
mine_past_reveal
send_ok "$BOB_KEY" "$RPS" "timeout(uint256)" 1
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$ALICE")" "39960000" "revealer takes the pot"
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$BOB")" "0" "silent player forfeits"
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$FEE")" "40000" "forfeit still pays the fee"
assert_eq "$(call_uint "$RPS" "matchStatus(uint256)(uint8)" 1)" "3" "forfeit settled"

open_match "$ROCK" "$PAPER" 2
mine_past_reveal
send_ok "$FEE_KEY" "$RPS" "timeout(uint256)" 2
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$ALICE")" "59960000" "alice credit includes the refund"
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$BOB")" "$STAKE" "bob refund when nobody reveals"
assert_eq "$(call_uint "$RPS" "claimable(address)(uint256)" "$FEE")" "40000" "empty timeout adds no fee"

send_ok "$ALICE_KEY" "$RPS" "claim()"
send_ok "$BOB_KEY" "$RPS" "claim()"
send_ok "$FEE_KEY" "$RPS" "claim()"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$RPS")" "0" "timeout pots are claimed"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$ALICE")" "119960000" "alice after forfeit and refund"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$BOB")" "80000000" "bob after forfeit and refund"
assert_eq "$(call_uint "$USDC" "balanceOf(address)(uint256)" "$FEE")" "40000" "fee claimed once"

echo "task 4 passed on $RPC"
