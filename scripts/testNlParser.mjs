// Extracted copy of the parser/calldata logic from scripts/set-rules.html for
// headless testing (no DOM/browser needed).

function parseNaturalLanguage(text, addressBook) {
  const warnings = [];
  const rules = [];
  const clauses = text.split(/,|;|\n|\band\b/i).map((s) => s.trim()).filter(Boolean);

  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    const isSavingsPhrase = /\b(saving|savings|rest|remainder|remaining|keep)\b/.test(lower);

    const addrMatch = clause.match(/0x[a-fA-F0-9]{40}/);
    const textForPct = addrMatch ? clause.replace(addrMatch[0], "") : clause;
    const pctMatch = textForPct.match(/(\d+(?:\.\d+)?)\s*%/);

    if (isSavingsPhrase && !pctMatch) continue;
    if (!pctMatch) {
      warnings.push(`Couldn't find a percentage in: "${clause}"`);
      continue;
    }
    const pct = parseFloat(pctMatch[1]);
    if (!(pct > 0 && pct <= 100)) {
      warnings.push(`Invalid percentage ${pct} in: "${clause}"`);
      continue;
    }
    if (isSavingsPhrase) {
      warnings.push(`Note: "${clause}" mentions savings with a percentage.`);
      continue;
    }

    let recipient = null;
    let label = null;
    if (addrMatch) {
      recipient = addrMatch[0];
      label = recipient;
    } else {
      const foundName = Object.keys(addressBook).find((name) => lower.includes(name.toLowerCase()));
      if (foundName) {
        recipient = addressBook[foundName];
        label = foundName;
      }
    }
    if (!recipient) {
      warnings.push(`Found ${pct}% but no known recipient in: "${clause}"`);
      continue;
    }
    rules.push({ recipient, label, pct });
  }

  const totalPct = rules.reduce((sum, r) => sum + r.pct, 0);
  if (totalPct > 100) warnings.push(`Total allocated (${totalPct}%) exceeds 100%`);
  return { rules, warnings };
}

function padHex(hex, bytes) {
  return hex.replace(/^0x/, "").padStart(bytes * 2, "0");
}

function buildCalldata(rules) {
  const SELECTOR_SET_RULES = "3c143dff";
  const validRules = rules.filter((r) => /^0x[a-fA-F0-9]{40}$/.test(r.recipient) && r.pct > 0);
  let data = SELECTOR_SET_RULES;
  data += padHex("20", 32);
  data += padHex(validRules.length.toString(16), 32);
  for (const r of validRules) {
    data += padHex(r.recipient, 32);
    const bps = Math.round(r.pct * 100);
    data += padHex(bps.toString(16), 32);
  }
  return "0x" + data;
}

// ---- Tests ----

const KNOWN_GOOD_CALLDATA =
  "0x3c143dff000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000004a8b3b1bbe395844d8a79f3cf33554873b3882030000000000000000000000000000000000000000000000000000000000000bb8";

const addressBook = { designer: "0x4a8B3B1BBE395844d8A79f3Cf33554873b388203" };

const tests = [
  {
    name: "matches the real deployed rule exactly",
    input: "pay designer 30%, rest stays as savings",
    check: (result) => {
      const cd = buildCalldata(result.rules).toLowerCase();
      if (cd !== KNOWN_GOOD_CALLDATA.toLowerCase()) {
        throw new Error(`Calldata mismatch.\n  got: ${cd}\n  want: ${KNOWN_GOOD_CALLDATA.toLowerCase()}`);
      }
    },
  },
  {
    name: "direct address, no address book needed",
    input: "send 0x4a8B3B1BBE395844d8A79f3Cf33554873b388203 30%, keep the rest",
    check: (result) => {
      if (result.rules.length !== 1 || result.rules[0].pct !== 30) throw new Error("expected one 30% rule");
    },
  },
  {
    name: "multiple recipients",
    input: "pay designer 20% and 0x1111111111111111111111111111111111111111 15%, rest savings",
    check: (result) => {
      if (result.rules.length !== 2) throw new Error(`expected 2 rules, got ${result.rules.length}`);
      const total = result.rules.reduce((s, r) => s + r.pct, 0);
      if (total !== 35) throw new Error(`expected total 35%, got ${total}`);
    },
  },
  {
    name: "unknown recipient produces a warning, not a silent rule",
    input: "pay someone-unknown 10%",
    check: (result) => {
      if (result.rules.length !== 0) throw new Error("should not have created a rule for an unknown recipient");
      if (result.warnings.length === 0) throw new Error("should have warned about the unknown recipient");
    },
  },
  {
    name: "over-100% is flagged",
    input: "pay designer 80%, pay 0x1111111111111111111111111111111111111111 50%",
    check: (result) => {
      const hasOverflowWarning = result.warnings.some((w) => w.includes("exceeds 100%"));
      if (!hasOverflowWarning) throw new Error("should have warned about exceeding 100%");
    },
  },
  {
    name: "bare number without % is not silently misread",
    input: "pay designer 30",
    check: (result) => {
      if (result.rules.length !== 0) throw new Error("should not create a rule without an explicit %");
      if (result.warnings.length === 0) throw new Error("should warn that no percentage was found");
    },
  },
  {
    name: "decimal percentages work",
    input: "pay designer 12.5%, rest savings",
    check: (result) => {
      if (result.rules.length !== 1 || result.rules[0].pct !== 12.5) throw new Error("expected one 12.5% rule");
    },
  },
  {
    name: "address book name matching is case-insensitive",
    input: "pay Designer 30%, rest savings",
    check: (result) => {
      if (result.rules.length !== 1 || result.rules[0].recipient !== addressBook.designer) {
        throw new Error("expected case-insensitive match on 'Designer'");
      }
    },
  },
];

let failed = 0;
for (const t of tests) {
  try {
    const result = parseNaturalLanguage(t.input, addressBook);
    t.check(result);
    console.log(`PASS: ${t.name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL: ${t.name}\n  ${err.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log(`\nAll ${tests.length} tests passed`);
}
