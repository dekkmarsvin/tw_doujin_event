import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR environment unavailable.");
const publication = await environment.runner.import("/app/publication-bundle-assembler.ts");
after(() => vite.close());

test("PublicationBundleAssembler is deterministic, ordered and has no filesystem side effects", async () => {
  const input = {
    candidateId: "candidate-pf", eventId: "pf45", candidateVersion: 7, approvalHash: "a".repeat(64),
    dataFiles: [
      { path: "events/pf45/map.json", content: { eventId: "pf45", revision: 1 } },
      { path: "events/pf45/event.json", content: { id: "pf45" } },
    ],
    mainFiles: [
      { path: "data/published-events.json", content: { events: ["pf45"] } },
      { path: "data/event-data-pins/pf45.json", content: { eventId: "pf45" } },
    ],
  };
  const first = await publication.assemblePublicationBundle(input);
  const second = await publication.assemblePublicationBundle(structuredClone(input));
  assert.equal(first.bundleHash, second.bundleHash);
  assert.deepEqual(first.stages.map(({ repository }) => repository), ["data", "main"]);
  assert.deepEqual(first.stages[0].files.map(({ path }) => path), ["events/pf45/event.json", "events/pf45/map.json"]);
  assert.match(first.stages[0].files[0].text, /\n$/);
});

test("publication paths fail closed outside the two repository allowlists", async () => {
  const base = { candidateId: "candidate-pf", eventId: "pf45", candidateVersion: 1, approvalHash: "a".repeat(64), dataFiles: [], mainFiles: [] };
  await assert.rejects(publication.assemblePublicationBundle({ ...base, dataFiles: [{ path: ".github/workflows/pwn.yml", content: "x" }] }), /not allowed/);
  await assert.rejects(publication.assemblePublicationBundle({ ...base, mainFiles: [{ path: "app/event-map-app.tsx", content: "x" }] }), /not allowed/);
  await assert.rejects(publication.assemblePublicationBundle({ ...base, dataFiles: [{ path: "events/other/event.json", content: "x" }] }), /not allowed/);
});

test("GitHub webhook HMAC accepts exact bytes and rejects tampering", async () => {
  const body = JSON.stringify({ action: "completed", check_run: { id: 1 } });
  const signature = await publication.signGitHubWebhookForTest("secret", body);
  assert.equal(await publication.verifyGitHubWebhookSignature("secret", body, signature), true);
  assert.equal(await publication.verifyGitHubWebhookSignature("secret", `${body} `, signature), false);
  assert.equal(await publication.verifyGitHubWebhookSignature("secret", body, "sha256=00"), false);
});
