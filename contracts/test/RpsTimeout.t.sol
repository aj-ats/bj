// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Rps} from "../src/Rps.sol";

contract RpsTimeoutTest is Test {
    MockUSDC internal usdc;
    Rps internal rps;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal fee = makeAddr("fee");
    address internal owner = makeAddr("owner");

    uint256 internal constant STAKE = 20_000_000;
    uint256 internal constant FEE = 40_000;
    uint256 internal constant PAYOUT = 39_960_000;
    bytes32 internal constant SALT_A = bytes32(uint256(0xA1));
    bytes32 internal constant SALT_B = bytes32(uint256(0xB1));

    function setUp() public {
        usdc = new MockUSDC();
        rps = new Rps(address(usdc), fee, owner);
        usdc.mint(alice, 1_000_000_000);
        usdc.mint(bob, 1_000_000_000);
        vm.prank(alice);
        usdc.approve(address(rps), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(rps), type(uint256).max);
    }

    function test_timeoutBeforeTheDeadlineReverts() public {
        uint256 id = _join(rps.ROCK(), rps.SCISSORS());
        vm.expectRevert(Rps.TooEarly.selector);
        rps.timeout(id);
        assertEq(rps.matchStatus(id), uint8(Rps.Status.Reveal));
    }

    function test_oneRevealTakesThePot() public {
        uint8 rock = rps.ROCK();
        uint256 id = _join(rock, rps.SCISSORS());
        vm.prank(alice);
        rps.reveal(id, rock, SALT_A);
        vm.warp(block.timestamp + rps.REVEAL_WINDOW() + 1);

        vm.prank(fee);
        rps.timeout(id);

        assertEq(rps.matchStatus(id), uint8(Rps.Status.Settled));
        assertEq(rps.claimable(alice), PAYOUT);
        assertEq(rps.claimable(bob), 0);
        assertEq(rps.claimable(fee), FEE);
    }

    function test_opponentRevealAlsoWinsAForfeit() public {
        uint8 paper = rps.PAPER();
        uint256 id = _join(rps.ROCK(), paper);
        vm.prank(bob);
        rps.reveal(id, paper, SALT_B);
        vm.warp(block.timestamp + rps.REVEAL_WINDOW() + 1);
        rps.timeout(id);
        assertEq(rps.claimable(bob), PAYOUT);
        assertEq(rps.claimable(alice), 0);
        assertEq(rps.claimable(fee), FEE);
    }

    function test_neitherRevealRefundsBoth() public {
        uint256 id = _join(rps.ROCK(), rps.PAPER());
        vm.warp(block.timestamp + rps.REVEAL_WINDOW() + 1);
        rps.timeout(id);
        assertEq(rps.claimable(alice), STAKE);
        assertEq(rps.claimable(bob), STAKE);
        assertEq(rps.claimable(fee), 0);
        assertEq(rps.matchStatus(id), uint8(Rps.Status.Settled));
    }

    function test_bothRevealedAfterTheDeadlineStillUsesTheThrows() public {
        uint8 rock = rps.ROCK();
        uint8 scissors = rps.SCISSORS();
        uint256 id = _join(rock, scissors);
        vm.warp(block.timestamp + rps.REVEAL_WINDOW() + 1);
        vm.prank(alice);
        rps.reveal(id, rock, SALT_A);
        vm.prank(bob);
        rps.reveal(id, scissors, SALT_B);
        rps.timeout(id);
        assertEq(rps.claimable(alice), PAYOUT);
        assertEq(rps.claimable(bob), 0);
        assertEq(rps.claimable(fee), FEE);
    }

    function test_timeoutDoesNotApplyToALobby() public {
        bytes32 commitA = rps.commitHash(rps.ROCK(), SALT_A);
        vm.prank(alice);
        uint256 id = rps.createMatch(commitA, STAKE);
        vm.warp(block.timestamp + rps.REVEAL_WINDOW() + 1);
        vm.expectRevert(Rps.BadStatus.selector);
        rps.timeout(id);
    }

    function _join(uint8 a, uint8 b) internal returns (uint256 id) {
        bytes32 commitA = rps.commitHash(a, SALT_A);
        bytes32 commitB = rps.commitHash(b, SALT_B);
        vm.prank(alice);
        id = rps.createMatch(commitA, STAKE);
        vm.prank(bob);
        rps.joinMatch(id, commitB);
    }
}
