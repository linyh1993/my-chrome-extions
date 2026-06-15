#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function printHelp() {
  console.log(`Simplify captured NDJSON files into compact JSON files.

Usage:
  node simplify-capture.mjs --input <file-or-dir> [options]

Options:
  --input <path>             Source NDJSON file or directory
  --output-dir <dir>         Output directory. Default: sibling "<input>-simplified"
  --only-api                 Keep only XHR, Fetch, and JSON-like responses
  --include-failed           Keep failed requests with null response
  --help                     Show this help

Output fields:
  interface
  method
  requestParams
  requestParamsType
  response
  responseType
`);
}

function parseArgs(argv) {
  const args = {
    onlyApi: false,
    includeFailed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--help":
        args.help = true;
        break;
      case "--input":
        args.input = next;
        index += 1;
        break;
      case "--output-dir":
        args.outputDir = next;
        index += 1;
        break;
      case "--only-api":
        args.onlyApi = true;
        break;
      case "--include-failed":
        args.includeFailed = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.help && !args.input) {
    throw new Error("Missing required argument: --input");
  }

  return args;
}

function defaultOutputDir(inputPath) {
  const absoluteInput = path.resolve(process.cwd(), inputPath);
  const stats = fs.statSync(absoluteInput);

  if (stats.isDirectory()) {
    return path.join(path.dirname(absoluteInput), `${path.basename(absoluteInput)}-simplified`);
  }

  const parsed = path.parse(absoluteInput);
  return path.join(parsed.dir, `${parsed.name}-simplified`);
}

function collectNdjsonFiles(inputPath) {
  const absoluteInput = path.resolve(process.cwd(), inputPath);
  const stats = fs.statSync(absoluteInput);

  if (stats.isFile()) {
    return [absoluteInput];
  }

  const files = [];
  const queue = [absoluteInput];

  while (queue.length) {
    const currentDir = queue.shift();
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile() && fullPath.toLowerCase().endsWith(".ndjson")) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

function parseNdjsonFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Failed to parse JSON in ${filePath} at line ${index + 1}: ${error.message}`);
    }
  });
}

function chooseRequestParams(record) {
  const request = record.request || {};

  if (request.postDataJson !== null && request.postDataJson !== undefined) {
    return request.postDataJson;
  }

  if (typeof request.postData === "string" && request.postData.trim()) {
    return request.postData;
  }

  if (request.queryParams && Object.keys(request.queryParams).length > 0) {
    return request.queryParams;
  }

  return null;
}

function chooseResponse(record) {
  const response = record.response || {};

  if (response.bodyJson !== null && response.bodyJson !== undefined) {
    return response.bodyJson;
  }

  if (response.body !== null && response.body !== undefined) {
    return response.body;
  }

  return null;
}

function describeValueType(value) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return typeof value;
  }
}

function isApiLike(record) {
  const type = String(record.type || "").toLowerCase();
  const mimeType = String(record.response?.mimeType || "").toLowerCase();
  const contentType = String(record.response?.headers?.["Content-Type"] || record.response?.headers?.["content-type"] || "").toLowerCase();

  return (
    type === "xhr" ||
    type === "fetch" ||
    mimeType.includes("json") ||
    contentType.includes("json")
  );
}

function simplifyRecord(record) {
  const requestParams = chooseRequestParams(record);
  const response = chooseResponse(record);

  return {
    interface: record.request?.url ?? record.response?.url ?? null,
    method: record.request?.method ?? null,
    requestParams,
    requestParamsType: describeValueType(requestParams),
    response,
    responseType: describeValueType(response),
  };
}

function writeJsonFile(outputPath, records) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function buildOutputFilePath(inputRoot, outputRoot, sourceFilePath) {
  const relativePath = path.relative(inputRoot, sourceFilePath);
  const parsed = path.parse(relativePath);
  return path.join(outputRoot, parsed.dir, `${parsed.name}.json`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const absoluteInput = path.resolve(process.cwd(), args.input);
  const inputStats = fs.statSync(absoluteInput);
  const inputRoot = inputStats.isDirectory() ? absoluteInput : path.dirname(absoluteInput);
  const outputRoot = path.resolve(process.cwd(), args.outputDir || defaultOutputDir(absoluteInput));
  const sourceFiles = collectNdjsonFiles(absoluteInput);

  let writtenFiles = 0;
  let writtenRecords = 0;

  for (const sourceFile of sourceFiles) {
    const sourceRecords = parseNdjsonFile(sourceFile);
    const filtered = sourceRecords.filter((record) => {
      if (!args.includeFailed && record.failure) {
        return false;
      }
      if (args.onlyApi && !isApiLike(record)) {
        return false;
      }
      return true;
    });

    const simplifiedRecords = filtered.map(simplifyRecord);
    if (!simplifiedRecords.length) {
      continue;
    }

    const outputFilePath = buildOutputFilePath(inputRoot, outputRoot, sourceFile);
    writeJsonFile(outputFilePath, simplifiedRecords);
    writtenFiles += 1;
    writtenRecords += simplifiedRecords.length;
  }

  console.log(`Source: ${absoluteInput}`);
  console.log(`Output: ${outputRoot}`);
  console.log(`Files written: ${writtenFiles}`);
  console.log(`Records written: ${writtenRecords}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
