// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Rps} from "../src/Rps.sol";

contract FalseToken {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

contract RpsLobbyTest is Test {
    MockUSDC internal usdc;
    Rps internal rps;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal fee = makeAddr("fee");
    address internal owner = makeAddr("owner");

    uint256 internal constant STAKE = 20_000_000;
    bytes32 internal constant COMMIT_A = bytes32(uint256(0x11));
    bytes32 internal constant COMMIT_B = bytes32(uint256(0x22));

    function setUp() public {
        usdc = new MockUSDC();
        rps = new Rps(address(usdc), fee, owner);
        usdc.mint(alice, 100_000_000);
        usdc.mint(bob, 100_000_000);
        vm.prank(alice);
        usdc.approve(address(rps), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(rps), type(uint256).max);
    }

    function test_constructorRejectsZeroAddress() public {
        vm.expectRevert(Rps.ZeroAddress.selector);
        new Rps(address(0), fee, owner);
        vm.expectRevert(Rps.ZeroAddress.selector);
        new Rps(address(usdc), address(0), owner);
        vm.expectRevert(Rps.ZeroAddress.selector);
        new Rps(address(usdc), fee, address(0));
    }

    function test_createLocksTheStake() public {
        uint256 id = _create();
        assertEq(id, 1);
        assertEq(rps.nextMatchId(), 2);
        assertEq(rps.matchStatus(id), uint8(Rps.Status.Waiting));
        assertEq(usdc.balanceOf(alice), 80_000_000);
        assertEq(usdc.balanceOf(address(rps)), STAKE);
        assertEq(rps.claimable(fee), 0);
    }

    function test_createRejectsABlankCommitAndASmallStake() public {
        vm.expectRevert(Rps.BadCommit.selector);
        vm.prank(alice);
        rps.createMatch(bytes32(0), STAKE);

        uint256 tooSmall = rps.MIN_STAKE() - 1;
        vm.expectRevert(Rps.BadStake.selector);
        vm.prank(alice);
        rps.createMatch(COMMIT_A, tooSmall);
        assertEq(rps.nextMatchId(), 1);
    }

    function test_createWithoutTokensDoesNotOpenAMatch() public {
        address carol = makeAddr("carol");
        vm.prank(carol);
        usdc.approve(address(rps), type(uint256).max);
        vm.expectRevert(MockUSDC.InsufficientBalance.selector);
        vm.prank(carol);
        rps.createMatch(COMMIT_A, STAKE);
        assertEq(rps.nextMatchId(), 1);
        assertEq(rps.matchStatus(1), uint8(Rps.Status.None));
    }

    function test_falseTransferDoesNotOpenAMatch() public {
        FalseToken fake = new FalseToken();
        Rps game = new Rps(address(fake), fee, owner);
        vm.expectRevert(Rps.TransferFailed.selector);
        game.createMatch(COMMIT_A, STAKE);
        assertEq(game.nextMatchId(), 1);
    }

    function test_creatorCancelRefundsOnce() public {
        uint256 id = _create();
        vm.prank(bob);
        vm.expectRevert(Rps.NotPlayer.selector);
        rps.cancel(id);

        vm.prank(alice);
        rps.cancel(id);
        assertEq(rps.matchStatus(id), uint8(Rps.Status.Cancelled));
        assertEq(rps.claimable(alice), STAKE);
        assertEq(rps.claimable(fee), 0);

        vm.prank(alice);
        rps.claim();
        assertEq(usdc.balanceOf(alice), 100_000_000);
        assertEq(usdc.balanceOf(address(rps)), 0);

        vm.prank(alice);
        vm.expectRevert(Rps.NothingToClaim.selector);
        rps.claim();

        vm.prank(alice);
        vm.expectRevert(Rps.BadStatus.selector);
        rps.cancel(id);
    }

    function test_joinLocksTheOpponent() public {
        uint256 id = _create();
        uint256 openedAt = block.timestamp;
        vm.prank(bob);
        rps.joinMatch(id, COMMIT_B);

        assertEq(rps.matchStatus(id), uint8(Rps.Status.Reveal));
        assertEq(usdc.balanceOf(alice), 80_000_000);
        assertEq(usdc.balanceOf(bob), 80_000_000);
        assertEq(usdc.balanceOf(address(rps)), STAKE * 2);

        (
            address p1,
            address p2,
            uint256 stake,
            bytes32 commit1,
            bytes32 commit2,
            uint8 choice1,
            uint8 choice2,
            uint64 createdAt,
            uint64 revealDeadline,
            Rps.Status status
        ) = rps.matches(id);
        assertEq(p1, alice);
        assertEq(p2, bob);
        assertEq(stake, STAKE);
        assertEq(commit1, COMMIT_A);
        assertEq(commit2, COMMIT_B);
        assertEq(choice1, 0);
        assertEq(choice2, 0);
        assertEq(createdAt, openedAt);
        assertEq(revealDeadline, openedAt + rps.REVEAL_WINDOW());
        assertEq(uint8(status), uint8(Rps.Status.Reveal));
    }

    function test_cannotJoinYourselfOrAFilledMatch() public {
        uint256 id = _create();
        vm.prank(alice);
        vm.expectRevert(Rps.SamePlayer.selector);
        rps.joinMatch(id, COMMIT_B);

        vm.prank(bob);
        rps.joinMatch(id, COMMIT_B);
        vm.prank(bob);
        vm.expectRevert(Rps.BadStatus.selector);
        rps.joinMatch(id, COMMIT_B);

        vm.prank(alice);
        vm.expectRevert(Rps.BadStatus.selector);
        rps.cancel(id);
    }

    function test_expiredLobbyRefundsThroughAnyone() public {
        uint256 id = _create();
        vm.warp(block.timestamp + rps.JOIN_WINDOW() + 1);

        vm.prank(bob);
        vm.expectRevert(Rps.Expired.selector);
        rps.joinMatch(id, COMMIT_B);

        vm.prank(bob);
        rps.cancel(id);
        assertEq(rps.claimable(alice), STAKE);
        assertEq(rps.matchStatus(id), uint8(Rps.Status.Cancelled));
    }

    function test_joinRejectsABlankCommit() public {
        uint256 id = _create();
        vm.prank(bob);
        vm.expectRevert(Rps.BadCommit.selector);
        rps.joinMatch(id, bytes32(0));
        assertEq(rps.matchStatus(id), uint8(Rps.Status.Waiting));
    }

    function _create() internal returns (uint256 id) {
        vm.prank(alice);
        id = rps.createMatch(COMMIT_A, STAKE);
    }
}
