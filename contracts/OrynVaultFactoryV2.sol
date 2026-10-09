// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OrynVaultV2} from "./OrynVaultV2.sol";

/// @title OrynVaultFactoryV2
/// @notice Deploys one OrynVaultV2 per owner, with a policy from the first block, and keeps the
/// index the agent and the pay pages use to find vaults.
contract OrynVaultFactoryV2 {
    address public immutable swapTarget;
    address public immutable defaultAgent;
    address[] internal _defaultTokens;

    mapping(address => address) public vaultOf;
    address[] public allVaults;

    event VaultCreated(address indexed owner, address indexed vault, address agent);

    error VaultAlreadyExists();

    /// @param _swapTarget Textile FX LimitOrderReactor on Celo.
    /// @param _defaultAgent ORYN's agent wallet. Each owner can replace it on their own vault.
    /// @param tokenList Currencies every new vault accepts (wARS, wBRL, wCOP, USA₮, USD₮, USDC, ...).
    constructor(address _swapTarget, address _defaultAgent, address[] memory tokenList) {
        swapTarget = _swapTarget;
        defaultAgent = _defaultAgent;
        _defaultTokens = tokenList;
    }

    /// @notice The caller becomes the owner. There is deliberately no create-for-someone-else:
    /// the policy decides where money goes, so only the owner may sign it.
    /// @param capTokens / caps Per-token daily limit on what the agent may convert (0 = never).
    function createVault(
        OrynVaultV2.Leg[] calldata legs,
        uint16 savingsBps,
        address savingsToken,
        address[] calldata capTokens,
        uint256[] calldata caps
    ) external returns (address vault) {
        if (vaultOf[msg.sender] != address(0)) revert VaultAlreadyExists();

        OrynVaultV2 v = new OrynVaultV2(
            OrynVaultV2.Init({
                owner: msg.sender,
                agent: defaultAgent,
                swapTarget: swapTarget,
                tokens: _defaultTokens,
                legs: legs,
                savingsBps: savingsBps,
                savingsToken: savingsToken,
                capTokens: capTokens,
                caps: caps
            })
        );

        vault = address(v);
        vaultOf[msg.sender] = vault;
        allVaults.push(vault);
        emit VaultCreated(msg.sender, vault, defaultAgent);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    function defaultTokens() external view returns (address[] memory) {
        return _defaultTokens;
    }
}
