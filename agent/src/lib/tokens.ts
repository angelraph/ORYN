import { getAddress, type Address } from "viem";

// Every currency an ORYN v2 vault accepts, with exactly what Celo's x402 facilitator needs to
// settle it. name/version are the token's EIP-712 domain (NOT its symbol) and must match
// https://api.x402.celo.org/supported byte for byte, or signature verification fails.
// The wFIAT tokens settle through Permit2; the dollar stablecoins through EIP-3009.
export type TokenInfo = {
  symbol: string;
  currency: string; // ISO code shown to people
  address: Address;
  decimals: number;
  eip712Name: string;
  eip712Version: string;
  transfer: "eip3009" | "permit2";
};

export const TOKENS: TokenInfo[] = [
  { symbol: "wARS", currency: "ARS", address: getAddress("0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D"), decimals: 18, eip712Name: "Peso Argentino", eip712Version: "1", transfer: "permit2" },
  { symbol: "wBRL", currency: "BRL", address: getAddress("0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0"), decimals: 18, eip712Name: "Real Brasileño", eip712Version: "1", transfer: "permit2" },
  { symbol: "wCOP", currency: "COP", address: getAddress("0x8a1D45e102e886510e891d2Ec656a708991e2D76"), decimals: 18, eip712Name: "Peso Colombiano", eip712Version: "1", transfer: "permit2" },
  { symbol: "USAT", currency: "USD", address: getAddress("0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771"), decimals: 6, eip712Name: "Tether America USD", eip712Version: "1", transfer: "eip3009" },
  { symbol: "USDT", currency: "USD", address: getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"), decimals: 6, eip712Name: "Tether USD", eip712Version: "1", transfer: "eip3009" },
  { symbol: "USDC", currency: "USD", address: getAddress("0xcebA9300f2b948710d2653dD7B07f33A8B32118C"), decimals: 6, eip712Name: "USDC", eip712Version: "2", transfer: "eip3009" },
];

const BY_ADDRESS = new Map(TOKENS.map((t) => [t.address.toLowerCase(), t]));

export function tokenByAddress(address: string): TokenInfo | undefined {
  return BY_ADDRESS.get(address.toLowerCase());
}
