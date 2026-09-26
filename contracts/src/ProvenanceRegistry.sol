// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Append-only provenance commitments for demo lots.
/// @dev Only the deployer can write. The hash and URI live in events, while
///      storage holds only a per-lot count. A later correction adds a new
///      commitment; it cannot overwrite an earlier one.
contract ProvenanceRegistry {
    error NotAnchorer();
    error EmptyLotId();
    error EmptyPayloadHash();

    address public immutable anchorer;
    mapping(bytes32 => uint256) public anchorCount;

    event Anchored(bytes32 indexed lotId, bytes32 payloadHash, address indexed author, string uri);

    constructor() {
        anchorer = msg.sender;
    }

    function anchor(bytes32 lotId, bytes32 payloadHash, string calldata uri) external {
        if (msg.sender != anchorer) revert NotAnchorer();
        if (lotId == bytes32(0)) revert EmptyLotId();
        if (payloadHash == bytes32(0)) revert EmptyPayloadHash();

        anchorCount[lotId] += 1;
        emit Anchored(lotId, payloadHash, msg.sender, uri);
    }
}
