// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title SourceRegistry
/// @notice On-chain record of which contract code on Portaldot has verified source.
///
/// Attestations are keyed by runtime code hash, not by address. One verification
/// covers every contract deployed from the same code, and if the code at an address
/// ever differs, the attestation no longer applies to it.
///
/// The code hash is read from a live contract at attestation time, so an attester can
/// only vouch for code that actually exists on chain. Anyone can attest; readers pick
/// which attesters they trust.
contract SourceRegistry {
    enum Match {
        None,
        Partial, // same executable code; metadata (source text, paths) differs
        Exact // byte-for-byte, metadata included
    }

    struct Attestation {
        bytes32 sourceDigest; // keccak256 of the canonical verification bundle
        Match level;
        uint64 attestedAt;
        address sample; // the address the verification was run against
    }

    mapping(address attester => mapping(bytes32 codeHash => Attestation)) private _attestations;

    event Attested(
        address indexed attester,
        bytes32 indexed codeHash,
        address indexed sample,
        bytes32 sourceDigest,
        Match level
    );
    event Revoked(address indexed attester, bytes32 indexed codeHash);

    error NotAContract(address sample);
    error InvalidLevel();
    error NothingToRevoke();

    bytes32 private constant EMPTY_CODE_HASH = keccak256("");

    /// @notice Record that the code currently at `sample` matches the bundle `sourceDigest`.
    function attest(address sample, bytes32 sourceDigest, Match level) external returns (bytes32 codeHash) {
        if (level == Match.None) revert InvalidLevel();
        codeHash = sample.codehash;
        if (codeHash == bytes32(0) || codeHash == EMPTY_CODE_HASH) revert NotAContract(sample);
        _attestations[msg.sender][codeHash] = Attestation(sourceDigest, level, uint64(block.timestamp), sample);
        emit Attested(msg.sender, codeHash, sample, sourceDigest, level);
    }

    function revoke(bytes32 codeHash) external {
        if (_attestations[msg.sender][codeHash].level == Match.None) revert NothingToRevoke();
        delete _attestations[msg.sender][codeHash];
        emit Revoked(msg.sender, codeHash);
    }

    /// @notice What `attester` says about the code currently deployed at `target`.
    /// @dev Other contracts can gate on this, e.g. only accept tokens whose source is verified.
    function check(address target, address attester) external view returns (Match level, bytes32 sourceDigest) {
        Attestation storage a = _attestations[attester][target.codehash];
        return (a.level, a.sourceDigest);
    }

    function attestation(address attester, bytes32 codeHash) external view returns (Attestation memory) {
        return _attestations[attester][codeHash];
    }
}
