// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OrynVault} from "./OrynVault.sol";

/// @title OrynVaultFactory
/// @notice Deploys one OrynVault per user and tracks the mapping so the agent
/// can discover every vault it's responsible for watching.
contract OrynVaultFactory {
    mapping(address => address) public vaultOf;
    address[] public allVaults;

    event VaultCreated(address indexed owner, address indexed vault, address agent);

    error VaultAlreadyExists();

    function createVault(address token, address agent) external returns (address vault) {
        return _createVault(msg.sender, token, agent);
    }

    /// @notice Lets ORYN provision a vault on a user's behalf (e.g. from a chat
    /// command) without ever holding the user's key. `owner` is fixed at creation
    /// and is the only address that can set rules or withdraw — this function does
    /// not grant the caller any control over the resulting vault.
    function createVaultFor(address owner, address token, address agent) external returns (address vault) {
        return _createVault(owner, token, agent);
    }

    function _createVault(address owner, address token, address agent) private returns (address vault) {
        if (vaultOf[owner] != address(0)) revert VaultAlreadyExists();

        OrynVault v = new OrynVault(owner, token, agent);
        vault = address(v);

        vaultOf[owner] = vault;
        allVaults.push(vault);

        emit VaultCreated(owner, vault, agent);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
