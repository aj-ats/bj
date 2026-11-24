// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC token;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        token = new MockUSDC();
    }

    function test_metadata() public view {
        assertEq(token.decimals(), 6);
        assertEq(token.name(), "Mock USDC");
        assertEq(token.symbol(), "USDC");
    }

    function test_mintTransferAndAllowance() public {
        token.mint(alice, 1_000_000);
        vm.prank(alice);
        assertTrue(token.approve(bob, 400_000));
        vm.prank(bob);
        assertTrue(token.transferFrom(alice, bob, 250_000));
        assertEq(token.balanceOf(alice), 750_000);
        assertEq(token.balanceOf(bob), 250_000);
        assertEq(token.allowance(alice, bob), 150_000);
    }

    function test_maxAllowanceIsNotSpent() public {
        token.mint(alice, 10);
        vm.prank(alice);
        token.approve(bob, type(uint256).max);
        vm.prank(bob);
        token.transferFrom(alice, bob, 4);
        assertEq(token.allowance(alice, bob), type(uint256).max);
        assertEq(token.balanceOf(bob), 4);
    }

    function test_insufficientBalanceReverts() public {
        vm.expectRevert(MockUSDC.InsufficientBalance.selector);
        token.transfer(alice, 1);
    }

    function test_insufficientAllowanceReverts() public {
        token.mint(alice, 10);
        vm.prank(bob);
        vm.expectRevert(MockUSDC.InsufficientAllowance.selector);
        token.transferFrom(alice, bob, 1);
    }

    function test_mintToZeroReverts() public {
        vm.expectRevert(MockUSDC.ZeroAddress.selector);
        token.mint(address(0), 1);
    }
}
