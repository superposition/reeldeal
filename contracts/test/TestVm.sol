// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// The small cheatcode surface these tests need; no external test library.
interface TestVm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory logs);
}
