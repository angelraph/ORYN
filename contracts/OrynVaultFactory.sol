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
        if (vaultOf[msg.sender] != address(0)) revert VaultAlreadyExists();

        OrynVault v = new OrynVault(msg.sender, token, agent);
        vault = address(v);

        vaultOf[msg.sender] = vault;
        allVaults.push(vault);

        emit VaultCreated(msg.sender, vault, agent);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
