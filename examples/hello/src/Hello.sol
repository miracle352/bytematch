// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// The smallest useful contract: it answers one question.
contract Hello {
    function answer() external pure returns (uint256) {
        return 42;
    }
}
