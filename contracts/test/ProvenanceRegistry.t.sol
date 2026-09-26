// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProvenanceRegistry} from "../src/ProvenanceRegistry.sol";
import {TestVm} from "./TestVm.sol";

contract ProvenanceRegistryTest {
    TestVm private constant vm = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant LOT = bytes32(uint256(1));
    bytes32 private constant FIRST_HASH = bytes32(uint256(11));
    bytes32 private constant SECOND_HASH = bytes32(uint256(12));

    ProvenanceRegistry private registry;

    function setUp() public {
        registry = new ProvenanceRegistry();
    }

    function test_anchorAppendsEventsAndIncrementsCount() public {
        vm.recordLogs();
        registry.anchor(LOT, FIRST_HASH, "demo://version-1");
        registry.anchor(LOT, SECOND_HASH, "demo://version-2");

        assert(registry.anchorCount(LOT) == 2);
        TestVm.Log[] memory logs = vm.getRecordedLogs();
        assert(logs.length == 2);
        assert(logs[0].emitter == address(registry));
        assert(logs[1].emitter == address(registry));
        assert(logs[0].topics[0] == keccak256("Anchored(bytes32,bytes32,address,string)"));
        assert(logs[0].topics[1] == LOT);
        assert(logs[1].topics[1] == LOT);
        (bytes32 firstHash, string memory firstUri) = abi.decode(logs[0].data, (bytes32, string));
        (bytes32 secondHash, string memory secondUri) = abi.decode(logs[1].data, (bytes32, string));
        assert(firstHash == FIRST_HASH);
        assert(secondHash == SECOND_HASH);
        assert(keccak256(bytes(firstUri)) == keccak256(bytes("demo://version-1")));
        assert(keccak256(bytes(secondUri)) == keccak256(bytes("demo://version-2")));
    }

    function test_nonAnchorerCannotPolluteLotHistory() public {
        vm.expectRevert(ProvenanceRegistry.NotAnchorer.selector);
        vm.prank(address(0xBEEF));
        registry.anchor(LOT, FIRST_HASH, "demo://fake");
        assert(registry.anchorCount(LOT) == 0);
    }
}
