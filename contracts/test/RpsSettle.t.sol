// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Rps} from "../src/Rps.sol";

contract RpsSettleTest is Test {
    MockUSDC internal usdc;
    Rps internal rps;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal fee = makeAddr("fee");
    address internal owner = makeAddr("owner");

    uint256 internal constant STAKE = 20_000_000;
    uint256 internal constant POT = 40_000_000;
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

    function test_commitHashMatchesAbiEncode() public view {
        assertEq(rps.commitHash(rps.ROCK(), SALT_A), keccak256(abi.encode(uint8(1), SALT_A)));
    }

    function test_rockBeatsScissors() public {
        uint256 id = _revealBoth(rps.ROCK(), rps.SCISSORS());
        vm.prank(fee);
        rps.settle(id);
        _assertDecision(alice);
    }

    function test_paperBeatsRock() public {
        uint256 id = _revealBoth(rps.ROCK(), rps.PAPER());
        rps.settle(id);
        _assertDecision(bob);
    }

    function test_scissorsBeatsPaper() public {
        uint256 id = _revealBoth(rps.PAPER(), rps.SCISSORS());
        rps.settle(id);
        _assertDecision(bob);
    }

    function test_everyPairPaysTheTable() public {
        for (uint8 a = 1; a <= 3; a++) {
            for (uint8 b = 1; b <= 3; b++) {
                uint256 id = _revealBoth(a, b);
                rps.settle(id);
                if (a == b) {
                    assertEq(rps.claimable(alice), STAKE, "tie alice");
                    assertEq(rps.claimable(bob), STAKE, "tie bob");
                    assertEq(rps.claimable(fee), 0, "tie fee");
                } else if (rps.beats(a, b)) {
                    assertEq(rps.claimable(alice), PAYOUT, "alice win");
                    assertEq(rps.claimable(bob), 0, "bob loss");
                    assertEq(rps.claimable(fee), FEE, "fee");
                } else {
                    assertEq(rps.claimable(alice), 0, "alice loss");
                    assertEq(rps.claimable(bob), PAYOUT, "bob win");
                    assertEq(rps.claimable(fee), FEE, "fee");
                }
                _claimAll();
                assertEq(usdc.balanceOf(address(rps)), 0);
            }
        }
    }

    function test_tieChargesNoFee() public {
        uint256 id = _revealBoth(rps.PAPER(), rps.PAPER());
        rps.settle(id);
        assertEq(rps.matchStatus(id), uint8(Rps.Status.Settled));
        assertEq(rps.claimable(alice), STAKE);
        assertEq(rps.claimable(bob), STAKE);
        assertEq(rps.claimable(fee), 0);

        vm.prank(alice);
        rps.claim();
        vm.prank(bob);
        rps.claim();
        assertEq(usdc.balanceOf(alice), 1_000_000_000);
        assertEq(usdc.balanceOf(bob), 1_000_000_000);
        assertEq(usdc.balanceOf(address(rps)), 0);
    }

    function test_settleWaitsForBothRevealsAndPaysOnce() public {
        uint8 rock = rps.ROCK();
        uint8 scissors = rps.SCISSORS();
        uint256 id = _join(rock, scissors);
        vm.expectRevert(Rps.BadStatus.selector);
        rps.settle(id);

        vm.prank(alice);
        rps.reveal(id, rock, SALT_A);
        vm.expectRevert(Rps.BadStatus.selector);
        rps.settle(id);

        vm.prank(bob);
        rps.reveal(id, scissors, SALT_B);
        rps.settle(id);
        vm.expectRevert(Rps.BadStatus.selector);
        rps.settle(id);
    }

    function test_badRevealDoesNotStick() public {
        uint8 rock = rps.ROCK();
        uint8 paper = rps.PAPER();
        uint256 id = _join(rock, rps.SCISSORS());

        vm.expectRevert(Rps.BadReveal.selector);
        vm.prank(alice);
        rps.reveal(id, rock, SALT_B);

        vm.expectRevert(Rps.BadChoice.selector);
        vm.prank(alice);
        rps.reveal(id, 4, SALT_A);

        vm.expectRevert(Rps.NotPlayer.selector);
        vm.prank(fee);
        rps.reveal(id, rock, SALT_A);

        vm.prank(alice);
        rps.reveal(id, rock, SALT_A);
        vm.expectRevert(Rps.AlreadyRevealed.selector);
        vm.prank(alice);
        rps.reveal(id, paper, SALT_A);

        assertEq(rps.matchStatus(id), uint8(Rps.Status.Reveal));
    }

    function test_revealBeforeJoinReverts() public {
        uint8 rock = rps.ROCK();
        bytes32 commitA = rps.commitHash(rock, SALT_A);
        vm.prank(alice);
        uint256 id = rps.createMatch(commitA, STAKE);
        vm.expectRevert(Rps.BadStatus.selector);
        vm.prank(alice);
        rps.reveal(id, rock, SALT_A);
    }

    function _assertDecision(address winner) internal view {
        address loser = winner == alice ? bob : alice;
        assertEq(rps.claimable(winner), PAYOUT);
        assertEq(rps.claimable(loser), 0);
        assertEq(rps.claimable(fee), FEE);
        assertEq(rps.claimable(winner) + rps.claimable(fee), POT);
    }

    function _claimAll() internal {
        if (rps.claimable(alice) > 0) {
            vm.prank(alice);
            rps.claim();
        }
        if (rps.claimable(bob) > 0) {
            vm.prank(bob);
            rps.claim();
        }
        if (rps.claimable(fee) > 0) {
            vm.prank(fee);
            rps.claim();
        }
    }

    function _join(uint8 a, uint8 b) internal returns (uint256 id) {
        bytes32 commitA = rps.commitHash(a, SALT_A);
        bytes32 commitB = rps.commitHash(b, SALT_B);
        vm.prank(alice);
        id = rps.createMatch(commitA, STAKE);
        vm.prank(bob);
        rps.joinMatch(id, commitB);
    }

    function _revealBoth(uint8 a, uint8 b) internal returns (uint256 id) {
        id = _join(a, b);
        vm.prank(bob);
        rps.reveal(id, b, SALT_B);
        vm.prank(alice);
        rps.reveal(id, a, SALT_A);
    }
}
