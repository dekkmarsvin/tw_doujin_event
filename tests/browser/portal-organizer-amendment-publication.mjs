// staged-data: portal
// Real UI + real handlers + isolated D1. Only the published-source loader and
// remote publication driver are synthetic. This is not production acceptance.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer } from "vite";
import { amendmentFixture } from "../support/organizer-amendment-fixture.mjs";
import { base, start } from "./support/journey.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const runner = vite.environments.ssr.runner;
const { createIdentityRepository } = await runner.import("/db/identity-repository.ts");
const { createCirclePortalHandlers, SESSION_COOKIE } = await runner.import("/app/circle-portal-handlers.ts");
const { hmacSign } = await runner.import("/app/portal-crypto.ts");
const { createOrganizerPublicationExecutor, PublicationFailure } = await runner.import("/app/organizer-publication.ts");
const { buildApprovedPublicationArtifacts, buildPublicationMainStage } = await runner.import("/app/publication-artifacts.ts");
const data = await amendmentFixture(runner);
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: { DB: "amendment-ui-publication" } }));
const db = await mf.getD1Database("DB");
const repo = createIdentityRepository(db);
const journey = await start("portal-organizer-amendment-publication");
journey.report.sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
journey.report.sourceDirty = execFileSync("git", ["status", "--short"], { encoding: "utf8" }).trim().length > 0;
journey.report.backend = "real handlers and isolated Miniflare D1; synthetic remote publication driver";
journey.report.productionWrites = 0;
const secret = "isolated-browser-session";
const calls = [];
let failOnce = true;
let publishedBytes = JSON.stringify(data.published.catalog);
const beforeBytes = publishedBytes;
let generated;
try {
  await repo.ensureTables();
  const actors = {};
  for (const role of ["owner", "admin"]) {
    const id = await repo.upsertAccount(`${role}@example.test`, data.now);
    const sessionId = crypto.randomUUID();
    await repo.createSession(id, data.now, data.now + 86_400_000, sessionId);
    actors[role] = { id, cookie: `${SESSION_COOKIE}=${sessionId}.${await hmacSign(secret, sessionId)}` };
  }
  await repo.addAdmin("admin@example.test", "bootstrap", data.now);
  await repo.createOrganizerCandidate({ id: "source", tentativeName: "測試活動", ownerEmail: "owner@example.test",
    createdByAccountId: actors.admin.id, draftJson: JSON.stringify(data.baseline.draft), now: data.now });
  await repo.acceptOrganizerInvitations({ accountId: actors.owner.id, email: "owner@example.test", now: data.now });
  await db.prepare("UPDATE organizer_event_candidates SET event_id='event-alpha',event_id_locked_at=?1,status='published',published_version=1,published_at=?1 WHERE id='source'").bind(data.now).run();
  await db.prepare(`INSERT INTO organizer_submission_snapshots (id,candidate_id,candidate_version,snapshot_json,sha256,created_by,created_at)
    VALUES ('published-snapshot','source',1,?1,?2,?3,?4)`).bind(data.source.snapshotJson,data.source.approvalHash,actors.owner.id,data.now).run();
  await db.prepare(`INSERT INTO organizer_publication_jobs (id,candidate_id,candidate_version,snapshot_id,approval_hash,status,step,data_merge_sha,main_merge_sha,created_at,updated_at)
    VALUES ('published-job','source',1,'published-snapshot',?1,'published','completed',?2,?3,?4,?4)`)
    .bind(data.source.approvalHash,data.source.dataCommit,data.source.mainCommit,data.now).run();
  for (const row of data.referenceRecords) await db.prepare(`INSERT OR REPLACE INTO organizer_reference_records
    (path,kind,reference_id,organizer_id,revision,display_name,public_reference_json,source_captured_at,created_by)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(row.path,row.kind,row.id,row.organizerId,row.revision,row.displayName,row.publicReferenceJson,row.sourceCapturedAt,actors.admin.id).run();
  const sourceBefore = await repo.getOrganizerCandidate("source");
  const execute = createOrganizerPublicationExecutor(repo, {
    eventExists: async () => { throw new Error("AMEND must not take CREATE collision path"); },
    async run({ job, step, snapshotJson, assertLease, beginRemoteWrite }) {
      await assertLease(); calls.push(step);
      if (step === "preparing_data") {
        await beginRemoteWrite();
        generated = await buildApprovedPublicationArtifacts({ snapshotJson, approvalHash: job.approval_hash });
      }
      if (step === "preparing_main") {
        const stage = await buildPublicationMainStage({ snapshotJson, approvalHash: job.approval_hash }, {
          dataCommit: job.data_merge_sha, dataFiles: new Map(generated.files.map((file) => [file.path,file.text])),
          mainCommit: data.baseline.mainCommit, publishedEventsJson: data.mainFiles.get("data/published-events.json"),
          existingPinJson: data.mainFiles.get("data/event-data-pins/event-alpha.json"),
          allocationsJson: data.mainFiles.get("data/circle-identities/allocations.json"), evidenceJson: data.mainFiles.get("data/circle-identities/evidence.json") });
        assert.equal(stage.files.find((file) => file.path === "data/published-events.json").text, data.mainFiles.get("data/published-events.json"));
      }
      if (step === "waiting_deployment" && failOnce) { failOnce = false; throw new PublicationFailure("publication_deployment_failed", "Controlled isolated deployment outage", true); }
      if (step === "verifying_production") publishedBytes = JSON.stringify(generated.official);
      return { metadata: ({ preparing_data: { data_pr_number: 10, data_head_sha: "a".repeat(40) }, merging_data: { data_merge_sha: "b".repeat(40) },
        preparing_main: { main_pr_number: 11, main_head_sha: "c".repeat(40) }, merging_main: { main_merge_sha: "d".repeat(40) },
        waiting_deployment: { workflow_run_id: 12, workflow_run_attempt: 2 }, verifying_production: { production_manifest_sha256: "e".repeat(64) } })[step] ?? {},
        productionVerified: step === "verifying_production" };
    },
  }, () => data.now + 1000);
  const handlers = createCirclePortalHandlers({ repository: repo, sendMail: async () => {}, lookupCircle: async () => null,
    searchCircles: async () => [], fetchEvidence: async () => null, verifyHuman: async () => true, turnstileSitekey: () => "test",
    projectCircle: async () => null, loadPublishedAmendmentBaseline: async () => structuredClone(data.baseline),
    dispatchOrganizerPublication: async (jobId) => {
      for (let count = 0; count < 9; count++) {
        await execute(jobId);
        if (["published", "failed"].includes((await repo.getOrganizerPublicationJob(jobId)).status)) return;
      }
      throw new Error("Isolated executor did not settle");
    },
    config: { eventId: "event-alpha", origin: base, sessionSecret: secret, hashPepper: "test", adminEmails: ["admin@example.test"],
      dataUpdatedAt: data.baseline.event.dataUpdatedAt, eventEndsAt: data.baseline.event.eventEndsAt, now: () => data.now, organizerPublicationMode: "fake" } });
  const routes = (role) => async (page) => page.route("**/api/**", async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    const request = new Request(req.url(), { method: req.method(), headers: { ...req.headers(), cookie: actors[role].cookie }, body: req.postData() ?? undefined });
    const match = path.match(/^\/api\/(?:admin\/)?organizer\/events\/([^/]+)(?:\/(.*))?$/);
    let response;
    if (path === "/api/auth/session") response = await handlers.session(request);
    else if (path === "/api/organizer/events") response = await handlers.listOrganizerCandidates(request);
    else if (path.match(/^\/api\/organizer\/publications\/[^/]+\/retry$/)) response = await handlers.adminRetryOrganizerPublication(request,path.split("/")[4]);
    else if (match) {
      const [, id, action] = match;
      const method = ({ amendments: "createOrganizerAmendment", amendment: req.method() === "GET" ? "getOrganizerAmendment" : "saveOrganizerAmendment",
        workspace: "updateOrganizerWorkspacePreference", validate: "validateOrganizerCandidate", preview: "previewOrganizerCandidate",
        submit: "submitOrganizerCandidate", review: "adminReviewOrganizerCandidate" })[action] ?? (!action ? "getOrganizerCandidate" : null);
      assert.ok(method, `Unexpected UI action ${path}`); response = await handlers[method](request,id);
    } else throw new Error(`Unexpected UI request ${path}`);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  const owner = await journey.page({ url: `${base}/organizer`, routes: routes("owner") });
  await owner.getByRole("button", { name: /送審與發布/ }).first().click();
  await owner.getByRole("button", { name: "開始修正已發布名單", exact: true }).click();
  const form = owner.getByRole("form", { name: "修正宣告表單" }); await form.waitFor();
  await form.getByRole("combobox", { name: "變動類型", exact: true }).selectOption("released");
  await form.getByRole("checkbox", { name: /S02/ }).check();
  await form.getByRole("textbox", { name: "接手社團名稱", exact: true }).fill("確認接手社");
  await form.getByRole("button", { name: "加入修正清單", exact: true }).click();
  await owner.getByRole("button", { name: "儲存修正並檢視影響", exact: true }).click();
  await owner.getByRole("heading", { name: "1. 換手", exact: true }).waitFor();
  await journey.capture(owner,"amendment-real-d1-impact");
  const candidate = (await db.prepare("SELECT id FROM organizer_event_candidates WHERE publication_operation='AMEND'").first()).id;
  await owner.getByRole("button", { name: /檢查與預覽/ }).first().click();
  await owner.getByRole("button", { name: "執行檢查", exact: true }).click();
  await owner.getByText("0 項必須修正", { exact: true }).waitFor();
  await owner.getByRole("button", { name: "建立預覽", exact: true }).click();
  await owner.locator('[data-slot-code="S02"]').click();
  await owner.getByRole("status").filter({ hasText: "S02 · 確認接手社" }).waitFor();
  await journey.capture(owner,"amendment-real-d1-preview");
  await owner.getByRole("button", { name: /送審與發布/ }).first().click();
  await owner.getByRole("button", { name: "送出審閱", exact: true }).click();
  await owner.getByText("已送交網站管理者審閱。", { exact: true }).waitFor();
  const approvedSnapshot = await repo.getOrganizerSubmissionSnapshot(candidate,2);
  assert.equal(JSON.parse(approvedSnapshot.snapshot_json).operation,"AMEND");
  await journey.capture(owner,"amendment-real-d1-submitted"); await owner.close();
  const admin = await journey.page({ url: `${base}/organizer`, routes: routes("admin") });
  await admin.getByRole("button", { name: /發布後修正/ }).click();
  await admin.getByRole("button", { name: /送審與發布/ }).first().click();
  await admin.getByRole("textbox", { name: "審閱說明", exact: true }).fill("隔離合成資料核准");
  await admin.getByRole("button", { name: "核准並發布", exact: true }).click();
  await admin.getByRole("button", { name: "重試發布", exact: true }).waitFor();
  const failed = await repo.getLatestOrganizerPublicationJob(candidate);
  assert.equal(failed.status,"failed"); assert.equal(failed.step,"waiting_deployment"); assert.equal(failed.retryable,1);
  assert.equal(publishedBytes,beforeBytes,"Failed amendment must leave synthetic public view unchanged");
  assert.match(await admin.locator("body").innerText(), /系統會從失敗步驟繼續/);
  await admin.getByRole("button", { name: "重試發布", exact: true }).scrollIntoViewIfNeeded();
  await journey.capture(admin,"amendment-real-d1-recoverable-failure"); await admin.close();
  const retryOwner = await journey.page({ url: `${base}/organizer`, routes: routes("owner") });
  await retryOwner.getByRole("button", { name: /發布後修正/ }).click();
  await retryOwner.getByRole("button", { name: /送審與發布/ }).first().click();
  await retryOwner.getByRole("button", { name: "重試發布", exact: true }).click();
  await retryOwner.getByText("已要求從失敗步驟繼續，請查看發布進度。", { exact: true }).waitFor();
  const completed = await repo.getLatestOrganizerPublicationJob(candidate);
  assert.equal(completed.status,"published");
  for (const key of ["id","snapshot_id","approval_hash","data_pr_number","data_head_sha","data_merge_sha","main_pr_number","main_head_sha","main_merge_sha"]) assert.equal(completed[key],failed[key],key);
  assert.equal(calls.filter((step) => step === "preparing_data").length,1);
  assert.equal(calls.filter((step) => step === "preparing_main").length,1);
  assert.deepEqual(await repo.getOrganizerSubmissionSnapshot(candidate,2),approvedSnapshot);
  assert.deepEqual(await repo.getOrganizerCandidate("source"),sourceBefore);
  assert.notEqual(publishedBytes,beforeBytes); assert.match(publishedBytes,/確認接手社/);
  journey.report.publication = { candidateId:candidate, version:2, jobId:completed.id, approvalHash:completed.approval_hash, failedStep:failed.step, calls };
  await journey.capture(retryOwner,"amendment-real-d1-recovered"); await retryOwner.close();
  await journey.finish();
} catch (error) { await journey.abort(error); }
finally { await mf.dispose(); await vite.close(); }
