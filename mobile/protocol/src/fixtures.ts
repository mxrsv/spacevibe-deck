/** Test-only support: the vector file and a deterministic hex reader. Not part of the package API. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hexDecode } from "./encoding";

export type Vectors = ReturnType<typeof import("../scripts/make-test-vectors").buildVectors>;

export function loadVectors(): Vectors {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-vectors.json");
  return JSON.parse(readFileSync(file, "utf8")) as Vectors;
}

export const hex = hexDecode;
