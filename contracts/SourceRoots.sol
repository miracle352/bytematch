// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title SourceRoots
/// @notice Every verification an attester stands behind, recorded as one Merkle root.
///
/// Writing a new storage slot on Portaldot costs a deposit (~4.5 POT a slot), so one
/// slot per verified contract does not scale. Instead an attester publishes the root of
/// a tree over all its results. Updating the root overwrites the same slot, which costs
/// about a hundredth of a POT however many contracts it covers.
///
/// The entries themselves travel in the event, so anyone can rebuild the tree, and every
/// proof, from the chain alone: `entries` is 65 bytes per contract code, packed as
/// codeHash (32) | level (1: 2 = exact, 1 = partial) | sourceDigest (32).
///
/// A leaf is keccak256(keccak256(abi.encode(codeHash, level, sourceDigest))), keyed by
/// runtime code hash like SourceRegistry: one entry covers every contract deployed from
/// that code. Pairs are hashed in sorted order.
contract SourceRoots {
    /// [0] the current root, [1] the one before it, so proofs fetched just before an
    /// update stay valid until the next one.
    mapping(address attester => bytes32[2]) public roots;

    event RootPublished(address indexed attester, bytes32 indexed root, bytes entries);

    function publish(bytes32 root, bytes calldata entries) external {
        bytes32[2] storage r = roots[msg.sender];
        r[1] = r[0];
        r[0] = root;
        emit RootPublished(msg.sender, root, entries);
    }

    /// @notice The level `attester` vouches for, for the code currently at `target`.
    /// @dev Returns 0 unless the proof places (target's code hash, level, digest) under one
    ///      of the attester's two latest roots.
    function check(address target, address attester, uint8 level, bytes32 sourceDigest, bytes32[] calldata proof)
        external
        view
        returns (uint8)
    {
        bytes32 node = keccak256(bytes.concat(keccak256(abi.encode(target.codehash, level, sourceDigest))));
        for (uint256 i; i < proof.length; ++i) {
            bytes32 p = proof[i];
            node = node < p ? keccak256(abi.encode(node, p)) : keccak256(abi.encode(p, node));
        }
        bytes32[2] storage r = roots[attester];
        return node != bytes32(0) && (node == r[0] || node == r[1]) ? level : 0;
    }
}
