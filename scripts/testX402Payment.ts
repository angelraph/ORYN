import "dotenv/config";
import { categorizeDistribution } from "../x402-service/client.js";

const result = await categorizeDistribution({
  vault: "0xc3c92EA811e5fF318E0D12384CdeD13BD3aEee0E",
  recipient: "0x4a8B3B1BBE395844d8A79f3Cf33554873b388203",
  amount: "6000000000000000",
});

console.log("categorize result:", result);
