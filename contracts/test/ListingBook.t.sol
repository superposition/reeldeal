// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ListingBook} from "../src/ListingBook.sol";
import {TestVm} from "./TestVm.sol";

contract ListingBookTest {
    TestVm private constant vm = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant LOT = bytes32(uint256(1));
    address private constant BUYER = address(0xB0B);

    ListingBook private book;

    function setUp() public {
        book = new ListingBook();
    }

    function test_createListingSetsSellerAndEmitsReferenceAmount() public {
        vm.recordLogs();
        bytes32 listingId = book.createListing(LOT, 2_400, "demo://lot-1");

        (address seller, bool open) = book.listings(listingId);
        assert(seller == address(this));
        assert(open);

        TestVm.Log[] memory logs = vm.getRecordedLogs();
        assert(logs.length == 1);
        assert(logs[0].emitter == address(book));
        assert(logs[0].topics[0] == keccak256("ListingCreated(bytes32,bytes32,address,uint256,string)"));
        assert(logs[0].topics[1] == listingId);
        assert(logs[0].topics[2] == LOT);
        (uint256 amount, string memory uri) = abi.decode(logs[0].data, (uint256, string));
        assert(amount == 2_400);
        assert(keccak256(bytes(uri)) == keccak256(bytes("demo://lot-1")));
    }

    function test_anotherSellerCannotReserveMyListingId() public {
        bytes32 mine = book.createListing(LOT, 2_400, "demo://mine");
        vm.prank(address(0xBEEF));
        bytes32 theirs = book.createListing(LOT, 2_500, "demo://theirs");
        assert(mine != theirs);
        (address mineSeller,) = book.listings(mine);
        (address theirSeller,) = book.listings(theirs);
        assert(mineSeller == address(this));
        assert(theirSeller == address(0xBEEF));
    }

    function test_recordSaleRevertsForNonSeller() public {
        bytes32 listingId = book.createListing(LOT, 2_400, "demo://lot-1");
        vm.expectRevert(ListingBook.NotSeller.selector);
        vm.prank(address(0xBEEF));
        book.recordSale(listingId, BUYER, 2_400);
        (, bool open) = book.listings(listingId);
        assert(open);
    }

    function test_recordSaleClosesListingOnce() public {
        bytes32 listingId = book.createListing(LOT, 2_400, "demo://lot-1");
        vm.recordLogs();
        book.recordSale(listingId, BUYER, 2_400);
        (, bool open) = book.listings(listingId);
        assert(!open);

        TestVm.Log[] memory logs = vm.getRecordedLogs();
        assert(logs.length == 1);
        assert(logs[0].topics[0] == keccak256("SaleSettled(bytes32,address,uint256)"));
        assert(logs[0].topics[1] == listingId);
        assert(address(uint160(uint256(logs[0].topics[2]))) == BUYER);
        assert(abi.decode(logs[0].data, (uint256)) == 2_400);

        vm.expectRevert(ListingBook.AlreadySettled.selector);
        book.recordSale(listingId, BUYER, 2_400);
    }
}
