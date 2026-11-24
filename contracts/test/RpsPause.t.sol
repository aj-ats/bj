// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Rps} from "../src/Rps.sol";

/// @notice Calls back into the game from the token transfer. A second payout must not land.
contract EvilToken {
    Rps public game;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public nestedCreated;
    bytes public lastRevert;

    function setGame(address next) external {
        game = Rps(next);
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allow");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        if (address(game) != address(0)) {
            try game.createMatch(bytes32(uint256(9)), 1_000_000) {
                nestedCreated = true;
            } catch (bytes memory reason) {
                lastRevert = reason;
            }
        }
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        if (address(game) != address(0)) {
            try game.claim() {}
            catch (bytes memory reason) {
                lastRevert = reason;
            }
        }
        return true;
    }
}

contract RpsPauseTest is Test {
    MockUSDC internal usdc;
    Rps internal rps;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal fee = makeAddr("fee");
    address internal owner = makeAddr("owner");

    uint256 internal constant STAKE = 20_000_000;
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

    function test_onlyOwnerPauses() public {
        vm.expectRevert(Rps.NotOwner.selector);
        vm.prank(alice);
        rps.pause();

        vm.prank(owner);
        rps.pause();
        assertTrue(rps.paused());

        vm.prank(owner);
        rps.unpause();
        assertFalse(rps.paused());
    }

    function test_pauseBlocksNewMoneyAndLeavesTheExitOpen() public {
        uint8 rock = rps.ROCK();
        uint8 scissors = rps.SCISSORS();
        bytes32 commitA = rps.commitHash(rock, SALT_A);
        bytes32 commitB = rps.commitHash(scissors, SALT_B);

        vm.prank(owner);
        rps.pause();
        vm.expectRevert(Rps.GameIsPaused.selector);
        vm.prank(alice);
        rps.createMatch(commitA, STAKE);

        vm.prank(owner);
        rps.unpause();
        vm.prank(alice);
        uint256 waiting = rps.createMatch(commitA, STAKE);
        vm.prank(alice);
        uint256 live = rps.createMatch(commitA, STAKE);
        vm.prank(bob);
        rps.joinMatch(live, commitB);

        vm.prank(owner);
        rps.pause();

        vm.expectRevert(Rps.GameIsPaused.selector);
        vm.prank(bob);
        rps.joinMatch(waiting, commitB);

        vm.prank(alice);
        rps.cancel(waiting);
        vm.prank(alice);
        rps.claim();
        assertEq(usdc.balanceOf(alice), 1_000_000_000 - STAKE);

        vm.prank(alice);
        rps.reveal(live, rock, SALT_A);
        vm.prank(bob);
        rps.reveal(live, scissors, SALT_B);
        rps.settle(live);
        assertEq(rps.claimable(alice), 39_960_000);
        assertEq(rps.matchStatus(live), uint8(Rps.Status.Settled));
    }

    function test_reentrancyCannotOpenOrClaimTwice() public {
        EvilToken evil = new EvilToken();
        Rps game = new Rps(address(evil), fee, owner);
        evil.setGame(address(game));
        evil.mint(alice, 100_000_000);
        vm.prank(alice);
        evil.approve(address(game), type(uint256).max);

        vm.prank(alice);
        uint256 id = game.createMatch(bytes32(uint256(1)), STAKE);
        assertFalse(evil.nestedCreated());
        assertEq(_selector(evil.lastRevert()), Rps.Reentrancy.selector);
        assertEq(game.nextMatchId(), 2);
        assertEq(evil.balanceOf(address(game)), STAKE);

        vm.prank(alice);
        game.cancel(id);
        vm.prank(alice);
        game.claim();
        assertEq(evil.balanceOf(alice), 100_000_000);
        assertEq(game.claimable(alice), 0);
        assertEq(_selector(evil.lastRevert()), Rps.Reentrancy.selector);
    }

    function _selector(bytes memory data) internal pure returns (bytes4 out) {
        assembly {
            out := mload(add(data, 32))
        }
    }
}
