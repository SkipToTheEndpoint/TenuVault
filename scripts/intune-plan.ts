/**
 * Prints the Graph requests TenuVault would send to restore a snapshot, for verifying restore
 * against a lab tenant:
 *   npx jiti scripts/intune-plan.ts <Folder> <snapshot.json> [--prefix <text>] [--assignments]
 *   npx jiti scripts/intune-plan.ts <Folder> <snapshot.json> --replace <existing id> [--current <live.json>] [--assignments]
 */
import { readFileSync } from "node:fs"
import { typeForFolder } from "../src/shared/intune/registry"
import { buildRestorePlan, buildUpdatePlan } from "../src/shared/intune/restore-plan"

const [folder, file, ...flags] = process.argv.slice(2)
const type = folder ? typeForFolder(folder) : undefined
if (!type || !file) {
  console.error("Usage: npx jiti scripts/intune-plan.ts <Folder> <snapshot.json> [--prefix <text>] [--replace <id>] [--assignments]")
  process.exit(2)
}
const option = (name: string) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined)
const snapshot = JSON.parse(readFileSync(file, "utf8"))
const includeAssignments = flags.includes("--assignments")
const replace = option("--replace")
const current = option("--current") ? JSON.parse(readFileSync(option("--current")!, "utf8")) : undefined
const plan = replace ? { update: buildUpdatePlan(type, snapshot, replace, { includeAssignments, current }) } : buildRestorePlan(type, snapshot, { prefix: option("--prefix"), includeAssignments })
console.log(JSON.stringify(plan, null, 2))
