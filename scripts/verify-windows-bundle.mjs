import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function requireDirectory(root) {
  let metadata;
  try {
    metadata = await stat(root);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Windows bundle root does not exist: ${root}`);
    }
    throw new Error(`Could not inspect Windows bundle root ${root}: ${error}`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Windows bundle root is not a directory: ${root}`);
  }
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(root, entry.name);
      if (entry.isDirectory()) {
        return listFiles(path);
      }
      return entry.isFile() ? [path] : [];
    }),
  );
  return nested.flat();
}

function listed(paths) {
  return paths.length === 0 ? "  (none)" : paths.map((path) => `  ${path}`).join("\n");
}

export async function verifyWindowsBundle(bundleRoot) {
  if (typeof bundleRoot !== "string" || bundleRoot.trim() === "") {
    throw new Error("Windows bundle root argument is required");
  }
  const root = resolve(bundleRoot);
  await requireDirectory(root);
  const files = await listFiles(root);
  const setupExecutables = files
    .filter((path) => path.toLowerCase().endsWith("-setup.exe"))
    .toSorted();
  const msiFiles = files
    .filter((path) => path.toLowerCase().endsWith(".msi"))
    .toSorted();

  if (setupExecutables.length !== 1 || msiFiles.length !== 0) {
    throw new Error(
      [
        `Invalid Windows bundle: expected exactly one *-setup.exe, found ${setupExecutables.length}; expected zero .msi files, found ${msiFiles.length}.`,
        "Setup matches:",
        listed(setupExecutables),
        "MSI matches:",
        listed(msiFiles),
      ].join("\n"),
    );
  }
  return setupExecutables[0];
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  verifyWindowsBundle(process.argv[2])
    .then((setupPath) => {
      console.log(`Verified Windows NSIS bundle: ${setupPath}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
