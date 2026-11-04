import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { install, installedRunners, pickDownload } from "./install.ts";

const sha = "a".repeat(64);
const other = "b".repeat(64);
const url = (name: string) =>
  `https://github.com/actions/runner/releases/download/v2.329.0/${name}`;

function release(overrides: { body?: string; digest?: string | null; url?: string } = {}) {
  const name = "actions-runner-osx-arm64-2.329.0.tar.gz";
  return {
    tag_name: "v2.329.0",
    body:
      overrides.body ??
      `- actions-runner-osx-arm64-2.329.0.tar.gz <!-- BEGIN SHA osx-arm64 -->${sha}<!-- END SHA osx-arm64 -->`,
    assets: [
      {
        name: "actions-runner-linux-x64-2.329.0.tar.gz",
        browser_download_url: url("x"),
        digest: null,
      },
      {
        name,
        browser_download_url: overrides.url ?? url(name),
        digest: overrides.digest === undefined ? null : overrides.digest,
      },
    ],
  };
}

const mac = { os: "osx", arch: "arm64" } as const;

describe("pickDownload", () => {
  it("takes the checksum from the release notes", () => {
    expect(pickDownload(release(), mac)).toEqual({
      version: "2.329.0",
      url: url("actions-runner-osx-arm64-2.329.0.tar.gz"),
      sha256: sha,
    });
  });

  it("takes the checksum from the asset digest", () => {
    expect(pickDownload(release({ body: "", digest: `sha256:${other}` }), mac).sha256).toBe(other);
  });

  it("refuses a digest and notes that disagree", () => {
    expect(() => pickDownload(release({ digest: `sha256:${other}` }), mac)).toThrow(/SHA-256/);
  });

  it("refuses a release with no checksum for this platform", () => {
    expect(() => pickDownload(release({ body: "no sums" }), mac)).toThrow(/SHA-256/);
  });

  it("refuses an archive that isn't on github.com/actions/runner", () => {
    expect(() =>
      pickDownload(release({ url: "https://example.com/runner.tar.gz" }), mac),
    ).toThrow();
  });

  it("refuses a platform the release doesn't have", () => {
    expect(() => pickDownload(release(), { os: "linux", arch: "arm64" })).toThrow();
  });
});

describe("install", () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function archive() {
    const src = mkdtempSync(join(tmpdir(), "rr-src-"));
    writeFileSync(join(src, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
    const file = join(src, "runner.tar.gz");
    execFileSync("tar", ["-czf", file, "-C", src, "run.sh"]);
    const bytes = readFileSync(file);
    rmSync(src, { recursive: true });
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  }

  const serve = (bytes: Buffer) => async () => new Response(new Uint8Array(bytes));

  it("unpacks a verified archive under its version", async () => {
    root = mkdtempSync(join(tmpdir(), "rr-runner-"));
    const { bytes, sha256 } = archive();
    await install(root, { version: "2.329.0", url: "unused", sha256 }, serve(bytes));
    expect(existsSync(join(root, "2.329.0", "run.sh"))).toBe(true);
    expect(installedRunners(root)).toEqual([{ version: "2.329.0", dir: join(root, "2.329.0") }]);
  });

  it("refuses an archive whose hash doesn't match, and leaves nothing behind", async () => {
    root = mkdtempSync(join(tmpdir(), "rr-runner-"));
    const { bytes } = archive();
    await expect(
      install(root, { version: "2.329.0", url: "unused", sha256: sha }, serve(bytes)),
    ).rejects.toThrow(/SHA-256/);
    expect(installedRunners(root)).toEqual([]);
    expect(existsSync(join(root, "2.329.0"))).toBe(false);
  });

  it("lists installed versions newest first", () => {
    root = mkdtempSync(join(tmpdir(), "rr-runner-"));
    for (const version of ["2.9.0", "2.329.0", "2.10.1"]) {
      mkdirSync(join(root, version));
      writeFileSync(join(root, version, "run.sh"), "");
    }
    mkdirSync(join(root, ".install-x"));
    expect(installedRunners(root).map((r) => r.version)).toEqual(["2.329.0", "2.10.1", "2.9.0"]);
  });
});
