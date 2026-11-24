// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Rps} from "../src/Rps.sol";

/// @notice Deploys the local faucet and the game. The broadcaster is the pause owner.
contract Deploy is Script {
    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address fee = vm.envAddress("FEE_RECIPIENT");
        address deployer = vm.addr(key);

        vm.startBroadcast(key);
        MockUSDC usdc = new MockUSDC();
        Rps rps = new Rps(address(usdc), fee, deployer);
        vm.stopBroadcast();

        console2.log("USDC", address(usdc));
        console2.log("RPS", address(rps));

        string memory json = string.concat(
            '{"chainId":31337,"usdc":"',
            vm.toString(address(usdc)),
            '","rps":"',
            vm.toString(address(rps)),
            '","feeRecipient":"',
            vm.toString(fee),
            '","owner":"',
            vm.toString(deployer),
            '"}'
        );
        vm.writeFile("broadcast/local.json", json);
    }
}
