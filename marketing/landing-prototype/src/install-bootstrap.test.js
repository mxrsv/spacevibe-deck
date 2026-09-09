import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const MAC_INSTALLER = resolve(REPO_ROOT, "marketing/landing-prototype/install.sh");
const WINDOWS_INSTALLER = resolve(REPO_ROOT, "marketing/landing-prototype/install.ps1");
const scratchDirectories = [];

function scratch(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  scratchDirectories.push(directory);
  return directory;
}

function executable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function macFixture({ failCodesign = false } = {}) {
  const directory = scratch("deck-install-mac-");
  const bin = join(directory, "bin");
  const releaseJson = join(directory, "release.json");
  const copyLog = join(directory, "copy.log");
  mkdirSync(bin);

  writeFileSync(
    releaseJson,
    JSON.stringify({
      draft: false,
      prerelease: false,
      tag_name: "v1.2.3",
      assets: [
        {
          name: "SpaceVibe-Deck-1.2.3-arm64.dmg",
          browser_download_url:
            "https://github.com/mxrsv/spacevibe-deck/releases/download/v1.2.3/SpaceVibe-Deck-1.2.3-arm64.dmg",
        },
      ],
    }),
  );

  executable(
    join(bin, "curl"),
    `#!/bin/sh
output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) shift; output="$1" ;;
    http*) url="$1" ;;
  esac
  shift
done
case "$url" in
  *api.github.com*) cp "$DECK_TEST_RELEASE_JSON" "$output" ;;
  *github.com*) printf 'fixture-dmg' > "$output" ;;
  *) exit 2 ;;
esac
`,
  );
  executable(
    join(bin, "hdiutil"),
    `#!/bin/sh
if [ "$1" = "attach" ]; then
  mount=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "-mountpoint" ]; then shift; mount="$1"; fi
    shift
  done
  mkdir -p "$mount/SpaceVibe Deck.app"
fi
exit 0
`,
  );
  executable(
    join(bin, "codesign"),
    `#!/bin/sh
[ "${failCodesign ? "1" : "0"}" -eq 0 ]
`,
  );
  executable(join(bin, "spctl"), "#!/bin/sh\nexit 0\n");
  executable(
    join(bin, "ditto"),
    "#!/bin/sh\nprintf '%s\\n' \"$*\" > \"$DECK_TEST_COPY_LOG\"\n",
  );

  const result = spawnSync("/bin/sh", [MAC_INSTALLER], {
    encoding: "utf8",
    env: {
      ...process.env,
      DECK_TEST_COPY_LOG: copyLog,
      DECK_TEST_RELEASE_JSON: releaseJson,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
    },
  });

  return { copyLog, result };
}

function powershellPath() {
  if (process.platform !== "win32") {
    return null;
  }

  return join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
}

function runWindowsFixture({ validHash }) {
  const directory = scratch("deck-install-win-");
  const wrapper = join(directory, "wrapper.ps1");
  const patchedInstaller = join(directory, "install-fixture.ps1");
  const marker = join(directory, "started.txt");
  const installerBytes = Buffer.from("trusted installer fixture");
  const expectedHash = createHash("sha512").update(installerBytes).digest("base64");
  const manifestHash = validHash ? expectedHash : Buffer.alloc(64, 7).toString("base64");
  const installerSource = readFileSync(WINDOWS_INSTALLER, "utf8");
  const patchedSource = installerSource.replace(
    "function Receive-TrustedAsset(",
    "function Receive-TrustedAssetReal(",
  );

  if (patchedSource === installerSource) {
    throw new Error("Windows fixture could not isolate the download function.");
  }

  writeFileSync(patchedInstaller, patchedSource);
  const escapedInstaller = patchedInstaller.replaceAll("'", "''");
  const escapedMarker = marker.replaceAll("'", "''");
  const bytes = [...installerBytes].join(",");

  writeFileSync(
    wrapper,
    `$global:MockRelease = [pscustomobject]@{
  draft = $false
  prerelease = $false
  tag_name = 'v1.2.3'
  assets = @(
    [pscustomobject]@{
      name = 'SpaceVibe-Deck-1.2.3-win-x64-setup.exe'
      browser_download_url = 'https://github.com/mxrsv/spacevibe-deck/releases/download/v1.2.3/SpaceVibe-Deck-1.2.3-win-x64-setup.exe'
    },
    [pscustomobject]@{
      name = 'latest.yml'
      browser_download_url = 'https://github.com/mxrsv/spacevibe-deck/releases/download/v1.2.3/latest.yml'
    }
  )
}
function Invoke-RestMethod { return $global:MockRelease }
function Receive-TrustedAsset {
  param([Uri]$Uri, [string]$Tag, [string]$Name, [string]$OutFile)
  if ($Name -eq 'latest.yml') {
    $NewLine = [Environment]::NewLine
    [IO.File]::WriteAllText($OutFile, "version: 1.2.3" + $NewLine + "path: SpaceVibe-Deck-1.2.3-win-x64-setup.exe" + $NewLine + "sha512: ${manifestHash}" + $NewLine)
  } else {
    [IO.File]::WriteAllBytes($OutFile, [byte[]]@(${bytes}))
  }
}
function Start-Process {
  [IO.File]::WriteAllText('${escapedMarker}', 'started')
  return [pscustomobject]@{ ExitCode = 0 }
}
. '${escapedInstaller}'
`,
  );

  const result = spawnSync(
    powershellPath(),
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper],
    { encoding: "utf8" },
  );

  return { marker, result };
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("macOS bootstrap", () => {
  it.runIf(process.platform === "darwin" && process.arch === "arm64")(
    "validates a mocked stable release and signed app before copying",
    () => {
      const { copyLog, result } = macFixture();

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("SpaceVibe Deck v1.2.3");
      expect(readFileSync(copyLog, "utf8")).toContain("SpaceVibe Deck.app");
    },
  );

  it.runIf(process.platform === "darwin" && process.arch === "arm64")(
    "stops before copying when signature validation fails",
    () => {
      const { copyLog, result } = macFixture({ failCodesign: true });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Code signature verification failed");
      expect(existsSync(copyLog)).toBe(false);
    },
  );
});

describe("Windows bootstrap", () => {
  it.runIf(process.platform === "win32")(
    "starts a mocked installer only after its latest.yml SHA-512 matches",
    () => {
      const { marker, result } = runWindowsFixture({ validHash: true });

      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(marker)).toBe(true);
    },
  );

  it.runIf(process.platform === "win32")(
    "does not start a mocked installer when its SHA-512 differs",
    () => {
      const { marker, result } = runWindowsFixture({ validHash: false });

      expect(result.status).toBe(1);
      expect(existsSync(marker)).toBe(false);
      expect(result.stderr).toContain("SHA-512 verification failed");
    },
  );
});

describe("bootstrap security contract", () => {
  it("keeps silent install and platform-security bypass flags out of both endpoints", () => {
    const sources = [MAC_INSTALLER, WINDOWS_INSTALLER].map((path) =>
      readFileSync(path, "utf8"),
    );

    for (const source of sources) {
      expect(source).not.toMatch(/--silent-install|\/S\b|smartscreen.*disable|spctl.*disable/i);
      expect(source).toContain("https://github.com/mxrsv/spacevibe-deck/releases");
    }
  });
});
