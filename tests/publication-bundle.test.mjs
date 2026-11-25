import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR environment unavailable.");
const { assemblePublicationFiles } = await environment.runner.import("/app/publication-bundle-assembler.ts");
after(() => vite.close());

test("an approval's files come out sorted and serialized the same way every time", async () => {
  const files = [
    { path: "events/pf45/map.json", content: { eventId: "pf45", revision: 1 } },
    { path: "events/pf45/event.json", content: { id: "pf45" } },
  ];
  const first = await assemblePublicationFiles("pf45", files);
  assert.deepEqual(await assemblePublicationFiles("pf45", structuredClone(files)), first);
  assert.deepEqual(first.map(({ path }) => path), ["events/pf45/event.json", "events/pf45/map.json"]);
  assert.match(first[0].text, /\n$/);
});

test("an approval cannot write outside its own event's files and the references", async () => {
  for (const path of [".github/workflows/pwn.yml", "events/other/event.json", "events/pf45/../other/event.json", "app/event-map-app.tsx", "index.json"]) {
    await assert.rejects(assemblePublicationFiles("pf45", [{ path, content: "x" }]), /not allowed/, path);
  }
});
