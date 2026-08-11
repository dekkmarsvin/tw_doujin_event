import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { removeVinextDeployRedirect } from "../scripts/prepare-pages-build.mjs";

test("removes only the vinext deploy redirect before a Pages build", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff47-pages-build-"));
  const deployDirectory = join(root, ".wrangler", "deploy");
  const redirectPath = join(deployDirectory, "config.json");

  try {
    await mkdir(deployDirectory, { recursive: true });
    await writeFile(redirectPath, JSON.stringify({ configPath: "../../dist/server/wrangler.json" }), "utf8");
    assert.equal(await removeVinextDeployRedirect(root), true);
    await assert.rejects(access(redirectPath), { code: "ENOENT" });

    await writeFile(redirectPath, JSON.stringify({ configPath: "../../worker/wrangler.json" }), "utf8");
    await assert.rejects(removeVinextDeployRedirect(root), /Refusing to remove/);
    assert.match(await readFile(redirectPath, "utf8"), /worker\/wrangler\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
