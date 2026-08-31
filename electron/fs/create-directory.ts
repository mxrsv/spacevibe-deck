import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

export interface CreateDirectoryParams {
  readonly parent: string;
  readonly name: string;
}

export interface CreateDirectoryResult {
  readonly path: string;
}

function validName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name !== "" &&
    name === name.trim() &&
    !name.startsWith(".") &&
    !name.includes("..") &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

/** Create one plain child folder after validating the renderer payload. */
export async function createDirectory({
  parent,
  name,
}: CreateDirectoryParams): Promise<CreateDirectoryResult> {
  if (!validName(name)) {
    throw new Error("Choose a valid folder name without dots or path separators");
  }
  if (typeof parent !== "string" || parent === "" || !path.isAbsolute(parent)) {
    throw new Error("Parent folder must be an absolute directory path");
  }

  let parentInfo;
  try {
    parentInfo = await stat(parent);
  } catch {
    throw new Error("Parent folder does not exist or is not a directory");
  }
  if (!parentInfo.isDirectory()) {
    throw new Error("Parent folder does not exist or is not a directory");
  }

  const destination = path.join(parent, name);
  try {
    await mkdir(destination, { recursive: false });
  } catch (cause: unknown) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("A folder with that name already exists", { cause });
    }
    throw new Error("Couldn't create the workspace folder", { cause });
  }
  return { path: destination };
}
