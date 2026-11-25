import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, environments: { ssr: {} }, logLevel: "silent" });
const { publicationFailureMessage } = await vite.environments.ssr.runner.import("/app/organizer-publication-presentation.ts");
const { publicationProgress: adminPublicationProgress } = await vite.environments.ssr.runner.import("/app/admin/admin-service-status.tsx");
after(() => vite.close());

test("Admin summary keeps unresolved failure separate from retry permission and paused processing", () => {
  for (const retryable of [true, false]) for (const enabled of [true, false]) {
    assert.equal(adminPublicationProgress({ status: "failed", step: "waiting_deployment", retryable }, enabled), "未完成 · 更新網站");
  }
  assert.equal(adminPublicationProgress({ status: "queued", step: "preparing_data", updatedAt: 1 }, true), "已排程 · 等待開始");
  assert.equal(adminPublicationProgress({ status: "publishing", step: "waiting_deployment", updatedAt: 1 }, false), "發布中 · 已暫停");
});

test("a failed publication says the content stands and what the owner can do next", () => {
  assert.match(publicationFailureMessage({ failureCode: "event_id_collision", retryable: false, started: false }, true), /首次發布不能覆寫/);
  assert.match(publicationFailureMessage({ failureCode: "infrastructure_error", retryable: true, started: true }, true), /內容沒有被退件/);
  const neverStarted = { failureCode: "queued_timeout", retryable: true, started: false };
  assert.match(publicationFailureMessage(neverStarted, true), /發布沒有開始/);
  assert.doesNotMatch(publicationFailureMessage({ failureCode: "queued_timeout", retryable: true, started: true }, true), /發布沒有開始/);
});

// #234: with publication switched off the retry button is disabled, so a
// message inviting a retry sends the owner at a control that cannot be used.
test("a failure message never offers a retry the owner cannot take", () => {
  for (const job of [{ failureCode: "queued_timeout", retryable: true, started: false }, { failureCode: "infrastructure_error", retryable: true, started: true }]) {
    assert.match(publicationFailureMessage(job, true), /可以重試發布/);
    assert.doesNotMatch(publicationFailureMessage(job, false), /重試/);
    assert.match(publicationFailureMessage(job, false), /內容沒有被退件/);
  }
  for (const failureCode of ["event_id_collision", "snapshot_mismatch", "amendment_baseline_changed"]) {
    const job = { failureCode, retryable: false, started: true };
    assert.equal(publicationFailureMessage(job, false), publicationFailureMessage(job, true));
  }
});

test("a correction whose public version changed sends the owner to the administrator, not to retry", () => {
  for (const failureCode of ["amendment_baseline_changed", "amendment_base_conflict", "amendment_baseline_legacy"]) {
    const message = publicationFailureMessage({ failureCode, retryable: false, started: false }, true);
    assert.match(message, /公開版本已經變更/);
    assert.match(message, /聯絡網站管理者/);
    assert.doesNotMatch(message, /重試/);
  }
});
