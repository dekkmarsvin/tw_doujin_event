import { readFile } from "node:fs/promises";
import { TextDecoder } from "node:util";

export function parseJsonBytesStrict(bytes, label = "JSON file") {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
}

export async function readJsonFileStrict(filePath, label = filePath) {
  return parseJsonBytesStrict(await readFile(filePath), label);
}
