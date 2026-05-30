#!/usr/bin/env node

import { GENERIC_HELP, parseArgs } from "../lib/core.mjs";
import { runCapture } from "../lib/engine.mjs";

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(GENERIC_HELP);
    return;
  }
  await runCapture(args);
}
