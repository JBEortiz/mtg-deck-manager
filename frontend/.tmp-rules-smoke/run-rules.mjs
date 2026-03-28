import { findBestRulesMatch } from "./matcher.js";
const result = findBestRulesMatch("does ward use the stack?");
if (!result || result.entry.id !== "ward") {
  console.log("STEP2_RULES_FAIL");
  process.exit(2);
}
console.log(`STEP2_RULES_OK id=${result.entry.id} stack=${result.entry.usesStack}`);
