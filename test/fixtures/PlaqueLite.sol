// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PlaqueLite
/// @notice The Plaque registry in a fallback-only assembly body, for a chain that charges the
///         code deposit per byte of deployed code.
///
/// Portaldot V3 charges roughly 0.071 tPOT per byte plus a fixed reserve, so the readable
/// builds (`Plaque.sol`, `PlaqueV2.sol`) cost ~71 tPOT to deploy. This build implements the same
/// claim with the same digest and the same storage layout in ~250 bytes of runtime code.
///
/// Semantics: identical to PlaqueV2.sol.
///   * calldata is exactly `handle || who || v || r || s` (5 words, 160 bytes, no selector);
///   * the digest is keccak256(abi.encode(1, handle, who, CHAIN_ID, address(this))), signed with
///     the EIP-191 personal-sign prefix;
///   * the storage slot is keccak256(abi.encode(handle, uint256(0))) - the same slot a Solidity
///     `mapping(bytes32 => address)` at slot 0 uses, so `eth_getStorageAt` reads it directly;
///   * no `block.*` opcode is used anywhere (the V3 runtime reverts on the BLOCK family).
///
/// The readable reference implementation and its tests are `Plaque.sol` / `PlaqueV2.sol` and
/// `tests/plaque.test.mjs`; `tests/plaque-lite.test.mjs` runs both against the same inputs.
contract PlaqueLite {
    /// @dev The chain id of the Portaldot V3 testnet. `block.chainid` is unusable on this runtime.
    uint256 private constant CHAIN_ID = 420420777;

    /// @dev topic0 of `Claimed(bytes32 indexed handle, address indexed who, address indexed sponsor)`:
    ///      keccak256("Claimed(bytes32,address,address)"), as a plain number constant so the
    ///      inline assembly can use it directly.
    uint256 private constant CLAIMED_TOPIC =
        0x8428df912f4f2125b442b488df9c7260cb607246895bcd29f262ecca090b1538;

    fallback() external payable {
        assembly {
            // ---- calldata: handle || who || v || r || s --------------------------------
            if iszero(eq(calldatasize(), 0xa0)) { revert(0, 0) }

            let handle := calldataload(0x00)
            let who := calldataload(0x20)

            // `who` must be a non-zero 160-bit address.
            if iszero(who) { revert(0, 0) }
            if shr(160, who) { revert(0, 0) }

            // ---- the handle must be free: sload(keccak256(handle . 0)) == 0 --------------
            mstore(0x00, handle)
            mstore(0x20, 0)
            let slot := keccak256(0x00, 0x40)
            if sload(slot) { revert(0, 0) }

            // ---- digest = keccak256(abi.encode(1, handle, who, CHAIN_ID, address())) -----
            mstore(0x00, 1)
            mstore(0x20, handle)
            mstore(0x40, who)
            mstore(0x60, CHAIN_ID)
            mstore(0x80, address())
            let digest := keccak256(0x00, 0xa0)

            // ---- the EIP-191 personal-sign envelope: "\x19Ethereum Signed Message:\n32" ----
            mstore(0x00, 0x19457468657265756d205369676e6564204d6573736167653a0a333200000000)
            mstore(0x1c, digest)
            let hash := keccak256(0x00, 0x3c)

            // ---- ecrecover(hash, v, r, s) at the precompile, and compare to `who` ---------
            mstore(0x00, hash)
            mstore(0x20, calldataload(0x40))
            mstore(0x40, calldataload(0x60))
            mstore(0x60, calldataload(0x80))
            let ok := staticcall(gas(), 1, 0x00, 0x80, 0x00, 0x20)
            if iszero(ok) { revert(0, 0) }
            if iszero(eq(mload(0x00), who)) { revert(0, 0) }

            // ---- bind the handle, and record the sponsor (the caller) -------------------
            sstore(slot, who)
            // Claimed(bytes32 indexed handle, address indexed who, address indexed sponsor)
            // - all three parameters are indexed, so the event has four topics and no data.
            log4(0x00, 0x00, CLAIMED_TOPIC, handle, who, caller())
        }
    }
}
