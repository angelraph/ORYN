// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OrynVaultV2
/// @notice A per-owner, multi-currency treasury that ORYN's agent runs on the owner's behalf.
///
/// What changed from v1, and why:
/// - Balance-based accounting. x402 payments settle as a plain token transfer from the payer
///   straight to `payTo` (this vault), never through a deposit() call. Anything that arrives
///   and isn't already earmarked is "pending" and gets split.
/// - Any accepted token (wARS, wBRL, wCOP, USA₮, USD₮, USDC, ...), not only cUSD.
/// - A policy is mandatory from creation, so a vault can never silently swallow payments with
///   no split (half of all v1 vaults ended up that way).
/// - Each leg of the split can pay out in a different currency, and savings can be held in a
///   different currency (typically dollars). Those legs are queued as conversions and settled
///   through Textile FX by `convert`.
///
/// The non-custodial boundary is the same as v1 and is enforced here, not by trust: the agent can
/// split, convert through the one allow-listed swap contract under onchain spend/receive checks
/// and an owner-set daily cap, or release a stuck conversion to its intended destination. It can
/// never withdraw, change the policy, add tokens, or send funds anywhere the owner didn't choose.
contract OrynVaultV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_BPS = 10_000;
    uint256 public constant MAX_LEGS = 10;

    /// @dev payoutToken == address(0) means "pay in whatever currency arrived".
    struct Leg {
        address recipient;
        uint16 bps;
        address payoutToken;
    }

    /// @dev to == address(this) means the bought tokens are credited to the owner's balance.
    struct Conversion {
        address sellToken;
        address buyToken;
        address to;
        uint256 amount;
    }

    /// @dev period == 0 is a one-off invoice; otherwise the expected seconds between payments.
    struct Link {
        address token;
        uint256 amount;
        uint32 period;
        bool active;
        string memo;
    }

    address public immutable factory;
    /// @notice The only contract `convert` may call: Textile FX's LimitOrderReactor on Celo.
    address public immutable swapTarget;
    address public owner;
    address public agent;

    Leg[] internal _legs;
    uint16 public savingsBps;
    address public savingsToken; // address(0) = keep savings in the currency that arrived

    mapping(address => bool) public acceptedToken;
    address[] internal _tokens;

    /// @notice Owner's own balance per token (savings + the unallocated remainder). Withdrawable.
    mapping(address => uint256) public held;
    /// @notice Amount per token earmarked for queued conversions. Not withdrawable, not re-split.
    mapping(address => uint256) public reserved;

    Conversion[] public conversions;

    /// @notice Max amount of a token the agent may sell per UTC day. 0 = conversions disabled.
    mapping(address => uint256) public dailyConvertCap;
    mapping(address => mapping(uint256 => uint256)) public convertedOnDay;

    Link[] internal _links;

    event PolicyUpdated(Leg[] legs, uint16 savingsBps, address savingsToken);
    event TokenAccepted(address indexed token, bool accepted);
    event AgentUpdated(address indexed agent);
    event DailyConvertCapSet(address indexed token, uint256 cap);
    event Split(address indexed token, uint256 amount);
    event Paid(address indexed token, address indexed recipient, uint256 amount);
    event Kept(address indexed token, uint256 savings, uint256 remainder);
    event ConversionQueued(uint256 indexed id, address indexed sellToken, address indexed buyToken, address to, uint256 amount);
    event Converted(uint256 indexed id, uint256 sold, uint256 bought);
    event ConversionReleased(uint256 indexed id, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event LinkCreated(uint256 indexed id, address indexed token, uint256 amount, uint32 period, string memo);
    event LinkActiveSet(uint256 indexed id, bool active);

    error NotOwner();
    error NotAuthorized();
    error EmptyPolicy();
    error TooManyLegs();
    error BpsExceedsMax();
    error InvalidLeg();
    error TokenNotAccepted(address token);
    error NothingToSplit();
    error UnknownConversion();
    error ConvertCapExceeded();
    error SwapFailed(bytes reason);
    error Overspent(uint256 sold, uint256 max);
    error Underfilled(uint256 bought, uint256 minBuy);
    error ExceedsAvailable();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgentOrOwner() {
        if (msg.sender != agent && msg.sender != owner) revert NotAuthorized();
        _;
    }

    /// @dev Grouped to keep the constructor readable and under the stack limit.
    struct Init {
        address owner;
        address agent;
        address swapTarget;
        address[] tokens;
        Leg[] legs;
        uint16 savingsBps;
        address savingsToken;
        address[] capTokens;
        uint256[] caps;
    }

    error LengthMismatch();

    constructor(Init memory init) {
        if (init.owner == address(0) || init.swapTarget == address(0)) revert ZeroAddress();
        if (init.capTokens.length != init.caps.length) revert LengthMismatch();
        factory = msg.sender;
        owner = init.owner;
        agent = init.agent;
        swapTarget = init.swapTarget;
        for (uint256 i = 0; i < init.tokens.length; i++) {
            _setAccepted(init.tokens[i], true);
        }
        _setPolicy(init.legs, init.savingsBps, init.savingsToken);
        for (uint256 i = 0; i < init.capTokens.length; i++) {
            dailyConvertCap[init.capTokens[i]] = init.caps[i];
            emit DailyConvertCapSet(init.capTokens[i], init.caps[i]);
        }
    }

    // ------------------------------------------------------------------ owner configuration

    function setPolicy(Leg[] calldata legs, uint16 _savingsBps, address _savingsToken) external onlyOwner {
        _setPolicy(legs, _savingsBps, _savingsToken);
    }

    function setAgent(address newAgent) external onlyOwner {
        agent = newAgent;
        emit AgentUpdated(newAgent);
    }

    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        _setAccepted(token, accepted);
    }

    function setDailyConvertCap(address token, uint256 cap) external onlyOwner {
        dailyConvertCap[token] = cap;
        emit DailyConvertCapSet(token, cap);
    }

    // ------------------------------------------------------------------ payment links

    /// @notice Publishes a payment link onchain. The pay page and the x402 endpoint read it from
    /// here, so there is no off-chain database to trust or keep in sync.
    function createLink(address token, uint256 amount, uint32 period, string calldata memo)
        external
        onlyOwner
        returns (uint256 id)
    {
        if (!acceptedToken[token]) revert TokenNotAccepted(token);
        id = _links.length;
        _links.push(Link({token: token, amount: amount, period: period, active: true, memo: memo}));
        emit LinkCreated(id, token, amount, period, memo);
    }

    function setLinkActive(uint256 id, bool active) external onlyOwner {
        _links[id].active = active;
        emit LinkActiveSet(id, active);
    }

    // ------------------------------------------------------------------ the agent's work

    /// @notice Tokens that arrived and aren't yet split, held, or earmarked for a conversion.
    function pending(address token) public view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 accounted = held[token] + reserved[token];
        return bal > accounted ? bal - accounted : 0;
    }

    /// @notice Splits everything pending in `token` according to the owner's policy.
    function distribute(address token) external nonReentrant onlyAgentOrOwner {
        if (!acceptedToken[token]) revert TokenNotAccepted(token);
        uint256 amount = pending(token);
        if (amount == 0) revert NothingToSplit();
        emit Split(token, amount);

        uint256 allocated;
        for (uint256 i = 0; i < _legs.length; i++) {
            Leg storage leg = _legs[i];
            uint256 share = (amount * leg.bps) / MAX_BPS;
            if (share == 0) continue;
            allocated += share;
            if (leg.payoutToken == address(0) || leg.payoutToken == token) {
                IERC20(token).safeTransfer(leg.recipient, share);
                emit Paid(token, leg.recipient, share);
            } else {
                _queueConversion(token, leg.payoutToken, leg.recipient, share);
            }
        }

        uint256 savings = (amount * savingsBps) / MAX_BPS;
        if (savings > 0) {
            allocated += savings;
            if (savingsToken == address(0) || savingsToken == token) {
                held[token] += savings;
            } else {
                _queueConversion(token, savingsToken, address(this), savings);
                savings = 0; // credited when the conversion settles
            }
        }

        uint256 remainder = amount - allocated;
        held[token] += remainder;
        emit Kept(token, savings, remainder);
    }

    /// @notice Settles a queued conversion through Textile FX. `swapData` is the firm-quote swap
    /// transaction Textile returns for this vault as taker. Whatever the calldata says, the vault
    /// only lets `swapTarget` pull up to the earmarked amount, and reverts unless at least
    /// `minBuy` of the right token came back. The agent prices `minBuy` off two independent paid
    /// rate sources; the owner's daily cap bounds what any bad price could cost.
    function convert(uint256 id, uint256 minBuy, bytes calldata swapData) external nonReentrant onlyAgentOrOwner {
        if (id >= conversions.length) revert UnknownConversion();
        Conversion memory c = conversions[id];
        if (c.amount == 0) revert UnknownConversion();
        if (!acceptedToken[c.buyToken]) revert TokenNotAccepted(c.buyToken);

        uint256 day = block.timestamp / 1 days;
        uint256 usedToday = convertedOnDay[c.sellToken][day] + c.amount;
        if (usedToday > dailyConvertCap[c.sellToken]) revert ConvertCapExceeded();
        convertedOnDay[c.sellToken][day] = usedToday;

        conversions[id].amount = 0;
        reserved[c.sellToken] -= c.amount;

        IERC20 sell = IERC20(c.sellToken);
        IERC20 buy = IERC20(c.buyToken);
        uint256 sellBefore = sell.balanceOf(address(this));
        uint256 buyBefore = buy.balanceOf(address(this));

        sell.forceApprove(swapTarget, c.amount);
        (bool ok, bytes memory ret) = swapTarget.call(swapData);
        if (!ok) revert SwapFailed(ret);
        sell.forceApprove(swapTarget, 0);

        uint256 sold = sellBefore - sell.balanceOf(address(this));
        uint256 bought = buy.balanceOf(address(this)) - buyBefore;
        if (sold > c.amount) revert Overspent(sold, c.amount);
        if (bought < minBuy) revert Underfilled(bought, minBuy);

        // Anything the quote didn't use still belongs to the same destination, in the old currency.
        uint256 unused = c.amount - sold;
        if (c.to == address(this)) {
            held[c.buyToken] += bought;
            held[c.sellToken] += unused;
        } else {
            if (bought > 0) buy.safeTransfer(c.to, bought);
            if (unused > 0) sell.safeTransfer(c.to, unused);
        }
        emit Converted(id, sold, bought);
    }

    /// @notice Delivers a queued conversion unconverted, in the currency that arrived. For when no
    /// fair quote is available: the recipient still gets paid, just not in their chosen currency.
    function releaseConversion(uint256 id) external nonReentrant onlyAgentOrOwner {
        if (id >= conversions.length) revert UnknownConversion();
        Conversion memory c = conversions[id];
        if (c.amount == 0) revert UnknownConversion();
        conversions[id].amount = 0;
        reserved[c.sellToken] -= c.amount;
        if (c.to == address(this)) {
            held[c.sellToken] += c.amount;
        } else {
            IERC20(c.sellToken).safeTransfer(c.to, c.amount);
        }
        emit ConversionReleased(id, c.amount);
    }

    // ------------------------------------------------------------------ owner funds

    /// @notice Owner-only. Takes from the owner's balance first, then from anything pending.
    /// Never touches amounts earmarked for other people's queued conversions.
    function withdraw(address token, uint256 amount, address to) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 available = bal > reserved[token] ? bal - reserved[token] : 0;
        if (amount > available) revert ExceedsAvailable();
        held[token] = amount >= held[token] ? 0 : held[token] - amount;
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    // ------------------------------------------------------------------ views

    function legCount() external view returns (uint256) {
        return _legs.length;
    }

    function getLeg(uint256 i) external view returns (Leg memory) {
        return _legs[i];
    }

    function getLegs() external view returns (Leg[] memory) {
        return _legs;
    }

    function tokens() external view returns (address[] memory) {
        return _tokens;
    }

    function conversionCount() external view returns (uint256) {
        return conversions.length;
    }

    function linkCount() external view returns (uint256) {
        return _links.length;
    }

    function getLink(uint256 id) external view returns (Link memory) {
        return _links[id];
    }

    // ------------------------------------------------------------------ internals

    function _setPolicy(Leg[] memory legs, uint16 _savingsBps, address _savingsToken) internal {
        if (legs.length == 0 && _savingsBps == 0) revert EmptyPolicy();
        if (legs.length > MAX_LEGS) revert TooManyLegs();
        if (_savingsToken != address(0) && !acceptedToken[_savingsToken]) revert TokenNotAccepted(_savingsToken);

        uint256 sum = _savingsBps;
        delete _legs;
        for (uint256 i = 0; i < legs.length; i++) {
            Leg memory leg = legs[i];
            if (leg.recipient == address(0) || leg.recipient == address(this) || leg.bps == 0) revert InvalidLeg();
            if (leg.payoutToken != address(0) && !acceptedToken[leg.payoutToken]) {
                revert TokenNotAccepted(leg.payoutToken);
            }
            sum += leg.bps;
            _legs.push(leg);
        }
        if (sum > MAX_BPS) revert BpsExceedsMax();

        savingsBps = _savingsBps;
        savingsToken = _savingsToken;
        emit PolicyUpdated(legs, _savingsBps, _savingsToken);
    }

    function _setAccepted(address token, bool accepted) internal {
        if (token == address(0)) revert ZeroAddress();
        if (accepted && !_isListed(token)) _tokens.push(token);
        acceptedToken[token] = accepted;
        emit TokenAccepted(token, accepted);
    }

    function _isListed(address token) internal view returns (bool) {
        for (uint256 i = 0; i < _tokens.length; i++) {
            if (_tokens[i] == token) return true;
        }
        return false;
    }

    function _queueConversion(address sellToken, address buyToken, address to, uint256 amount) internal {
        reserved[sellToken] += amount;
        uint256 id = conversions.length;
        conversions.push(Conversion({sellToken: sellToken, buyToken: buyToken, to: to, amount: amount}));
        emit ConversionQueued(id, sellToken, buyToken, to, amount);
    }
}
