#!/usr/bin/env node

import { OPS_HELP, parseArgs } from "../lib/core.mjs";
import { runCapture } from "../lib/engine.mjs";
import { createOpsMenuAdapter } from "../lib/ops-menu.mjs";

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.splitDir = args.menuRootDir || args.splitDir || args.outputDir;
  if (args.help) {
    console.log(OPS_HELP);
    return;
  }
  await runCapture(args, createOpsMenuAdapter());
}
