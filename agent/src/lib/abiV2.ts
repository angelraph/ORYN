import { parseAbi } from "viem";

// Minimal ABIs for OrynVaultV2 / OrynVaultFactoryV2 (see contracts/). Hand-kept rather than
// imported from artifacts/ so the agent and the pay service run without a compile step.
export const vaultV2Abi = parseAbi([
  "struct Leg { address recipient; uint16 bps; address payoutToken; }",
  "struct Link { address token; uint256 amount; uint32 period; bool active; string memo; }",
  "function factory() view returns (address)",
  "function owner() view returns (address)",
  "function agent() view returns (address)",
  "function acceptedToken(address) view returns (bool)",
  "function tokens() view returns (address[])",
  "function pending(address) view returns (uint256)",
  "function held(address) view returns (uint256)",
  "function reserved(address) view returns (uint256)",
  "function savingsBps() view returns (uint16)",
  "function savingsToken() view returns (address)",
  "function getLegs() view returns (Leg[])",
  "function linkCount() view returns (uint256)",
  "function getLink(uint256) view returns (Link)",
  "function conversionCount() view returns (uint256)",
  "function conversions(uint256) view returns (address sellToken, address buyToken, address to, uint256 amount)",
  "function dailyConvertCap(address) view returns (uint256)",
  "function distribute(address token)",
  "function convert(uint256 id, uint256 minBuy, bytes swapData)",
  "function releaseConversion(uint256 id)",
  "event Split(address indexed token, uint256 amount)",
  "event Paid(address indexed token, address indexed recipient, uint256 amount)",
  "event Kept(address indexed token, uint256 savings, uint256 remainder)",
  "event ConversionQueued(uint256 indexed id, address indexed sellToken, address indexed buyToken, address to, uint256 amount)",
  "event Converted(uint256 indexed id, uint256 sold, uint256 bought)",
  "event LinkCreated(uint256 indexed id, address indexed token, uint256 amount, uint32 period, string memo)",
]);

export const factoryV2Abi = parseAbi([
  "function vaultOf(address) view returns (address)",
  "function allVaults(uint256) view returns (address)",
  "function vaultCount() view returns (uint256)",
  "event VaultCreated(address indexed owner, address indexed vault, address agent)",
]);
