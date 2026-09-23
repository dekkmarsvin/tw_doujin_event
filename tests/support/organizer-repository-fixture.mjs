import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Test-only worker: run the existing fixture operations beside the real D1
// binding instead of sending every prepare/bind/result through Node's proxy.
// One Miniflare instance owns one DB and one sequential test file.
export async function organizerRepositoryFixtureScript() {
  const bundle = await build({ bundle: true, format: "esm", write: false, stdin: {
    resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    contents: `
      import { createIdentityRepository } from './db/identity-repository';
      let repository;
      export default { async fetch(request, env) {
        if (request.method !== 'POST' || new URL(request.url).pathname !== '/reset') {
          return new Response('Not found', { status: 404 });
        }
        const { now } = await request.json();
        repository ??= createIdentityRepository(env.DB);
        await repository.ensureTables();
        await repository.clearPreviewData();
        const adminId = await repository.upsertAccount('admin@example.test', now);
        await repository.addAdmin('admin@example.test', 'bootstrap', now);
        const ownerId = await repository.upsertAccount('owner@example.test', now);
        const editorId = await repository.upsertAccount('editor@example.test', now);
        return Response.json({ adminId, ownerId, editorId });
      } };
    `,
  } });
  return bundle.outputFiles[0].text;
}

export async function resetOrganizerRepositoryFixture(runtime, now) {
  const response = await runtime.dispatchFetch("http://fixture/reset", {
    method: "POST", body: JSON.stringify({ now }), headers: { "content-type": "application/json" },
  });
  if (!response.ok) throw new Error(`Organizer fixture reset failed (${response.status}): ${await response.text()}`);
  return response.json();
}
