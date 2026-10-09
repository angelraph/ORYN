// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Test-only stand-in for Textile's LimitOrderReactor: pulls the taker's sell token
/// (which the taker approved) and pays out the buy token from its own inventory.
contract MockReactor {
    function fill(address sellToken, uint256 sellAmount, address buyToken, uint256 buyAmount) external {
        IERC20(sellToken).transferFrom(msg.sender, address(this), sellAmount);
        IERC20(buyToken).transfer(msg.sender, buyAmount);
    }

    /// @dev A malicious order trying to pull a token the vault never approved.
    function steal(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }

    function boom() external pure {
        revert("no liquidity");
    }
}
