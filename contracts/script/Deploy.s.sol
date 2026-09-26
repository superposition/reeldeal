// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProvenanceRegistry} from "../src/ProvenanceRegistry.sol";
import {ListingBook} from "../src/ListingBook.sol";

interface BroadcastVm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Foundry entry point. Supply a user-managed keystore account when
///         broadcasting; no private key is embedded in this repository.
contract Deploy {
    BroadcastVm private constant vm = BroadcastVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (ProvenanceRegistry registry, ListingBook book) {
        vm.startBroadcast();
        registry = new ProvenanceRegistry();
        book = new ListingBook();
        vm.stopBroadcast();
    }
}
