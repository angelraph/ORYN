// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OrynVault
/// @notice A per-user cUSD treasury. The owner pre-approves a split (rules); the
/// ORYN agent may only *trigger* that pre-approved split (`distribute`) — it can
/// never redirect funds, change recipients, or withdraw. Only the owner can do that.
/// This is the non-custodial boundary the whole product depends on.
contract OrynVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Rule {
        address recipient;
        uint16 bps; // basis points of each distribution sent to this recipient
    }

    uint16 public constant MAX_BPS = 10_000;

    IERC20 public immutable token;
    address public owner;
    address public agent;

    Rule[] public rules;
    uint256 public pendingBalance; // deposited, not yet split
    uint256 public savingsBalance; // the unallocated remainder of each split, kept in-vault
    uint256 public totalDeposited;
    uint256 public totalDistributed;

    event Deposited(address indexed from, uint256 amount);
    event RulesUpdated(Rule[] rules);
    event Distributed(address indexed recipient, uint256 amount);
    event SavingsCredited(uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event AgentUpdated(address indexed agent);

    error NotOwner();
    error NotAuthorized();
    error BpsExceedsMax();
    error NothingToDistribute();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgentOrOwner() {
        if (msg.sender != agent && msg.sender != owner) revert NotAuthorized();
        _;
    }

    constructor(address _owner, address _token, address _agent) {
        owner = _owner;
        token = IERC20(_token);
        agent = _agent;
    }

    /// @notice Owner defines where each future distribution goes. Sum of bps must be <= 100%;
    /// the remainder automatically stays in the vault as savings.
    function setRules(Rule[] calldata newRules) external onlyOwner {
        uint256 sum;
        for (uint256 i = 0; i < newRules.length; i++) {
            sum += newRules[i].bps;
        }
        if (sum > MAX_BPS) revert BpsExceedsMax();

        delete rules;
        for (uint256 i = 0; i < newRules.length; i++) {
            rules.push(newRules[i]);
        }
        emit RulesUpdated(newRules);
    }

    function setAgent(address newAgent) external onlyOwner {
        agent = newAgent;
        emit AgentUpdated(newAgent);
    }

    /// @notice Anyone can pay into the vault (e.g. a client paying the owner's invoice).
    function deposit(uint256 amount) external nonReentrant {
        token.safeTransferFrom(msg.sender, address(this), amount);
        pendingBalance += amount;
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Splits the current pendingBalance per the owner's rules. Callable by the
    /// agent (automation) or the owner (manual override) — never redirects, only executes
    /// the rules the owner already set.
    function distribute() external nonReentrant onlyAgentOrOwner {
        uint256 amount = pendingBalance;
        if (amount == 0) revert NothingToDistribute();
        pendingBalance = 0;

        uint256 allocated;
        for (uint256 i = 0; i < rules.length; i++) {
            uint256 share = (amount * rules[i].bps) / MAX_BPS;
            if (share > 0) {
                allocated += share;
                token.safeTransfer(rules[i].recipient, share);
                emit Distributed(rules[i].recipient, share);
            }
        }

        uint256 remainder = amount - allocated;
        if (remainder > 0) {
            savingsBalance += remainder;
            emit SavingsCredited(remainder);
        }
        totalDistributed += allocated;
    }

    /// @notice Owner-only sweep of accumulated savings (or any vault balance).
    function withdraw(uint256 amount, address to) external onlyOwner nonReentrant {
        if (amount <= savingsBalance) {
            savingsBalance -= amount;
        } else {
            savingsBalance = 0;
        }
        token.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function ruleCount() external view returns (uint256) {
        return rules.length;
    }

    function getRule(uint256 index) external view returns (address recipient, uint16 bps) {
        Rule storage r = rules[index];
        return (r.recipient, r.bps);
    }
}
