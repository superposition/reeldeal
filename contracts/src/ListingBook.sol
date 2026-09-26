// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal listing and sale evidence for a demo market.
/// @dev These functions do not transfer funds. Amounts are display/reference
///      numbers in events; the API owns the authoritative price and sale.
///      URI and amount are not kept in contract storage.
contract ListingBook {
    error EmptyLotId();
    error ListingExists();
    error NotSeller();
    error AlreadySettled();
    error InvalidBuyer();

    struct Listing {
        address seller;
        bool open;
    }

    mapping(bytes32 => Listing) public listings;

    event ListingCreated(
        bytes32 indexed listingId, bytes32 indexed lotId, address indexed seller, uint256 referenceAmount, string uri
    );
    event SaleSettled(bytes32 indexed listingId, address indexed buyer, uint256 referenceAmount);

    /// @return listingId Seller-scoped ID, so another account cannot reserve
    ///         a lot's global ID before its legitimate seller creates it.
    function createListing(bytes32 lotId, uint256 referenceAmount, string calldata uri)
        external
        returns (bytes32 listingId)
    {
        if (lotId == bytes32(0)) revert EmptyLotId();
        listingId = keccak256(abi.encode(msg.sender, lotId));
        if (listings[listingId].seller != address(0)) revert ListingExists();

        listings[listingId] = Listing({seller: msg.sender, open: true});
        emit ListingCreated(listingId, lotId, msg.sender, referenceAmount, uri);
    }

    function recordSale(bytes32 listingId, address buyer, uint256 referenceAmount) external {
        Listing storage listing = listings[listingId];
        if (listing.seller != msg.sender) revert NotSeller();
        if (!listing.open) revert AlreadySettled();
        if (buyer == address(0)) revert InvalidBuyer();

        listing.open = false;
        emit SaleSettled(listingId, buyer, referenceAmount);
    }
}
