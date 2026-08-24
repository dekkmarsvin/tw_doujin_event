import assert from "node:assert/strict";
import test from "node:test";
import { ensurePagesFailOpen } from "../scripts/ensure-pages-fail-open.mjs";

const response = (result, { ok = true, status = 200, success = true, errors = [] } = {}) => ({
  ok,
  status,
  json: async () => ({ success, errors, result }),
});

test("keeps an already fail-open Pages project unchanged", async () => {
  const requests = [];
  const result = await ensurePagesFailOpen({
    accountId: "account",
    projectName: "tw-catalog",
    token: "token",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return response({ deployment_configs: { production: { fail_open: true }, preview: { fail_open: true } } });
    },
  });
  assert.deepEqual(result, { changed: false });
  assert.equal(requests.length, 1);
});

test("patches both Pages environments and verifies the response", async () => {
  const requests = [];
  const result = await ensurePagesFailOpen({
    accountId: "account",
    projectName: "tw-catalog",
    token: "token",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) return response({ deployment_configs: { production: { fail_open: false }, preview: { fail_open: true } } });
      return response({ deployment_configs: { production: { fail_open: true }, preview: { fail_open: true } } });
    },
  });
  assert.deepEqual(result, { changed: true });
  assert.equal(requests[1].init.method, "PATCH");
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    deployment_configs: {
      production: { fail_open: true },
      preview: { fail_open: true },
    },
  });
});

test("fails closed when Cloudflare does not confirm both environments", async () => {
  await assert.rejects(
    ensurePagesFailOpen({
      accountId: "account",
      projectName: "tw-catalog",
      token: "token",
      fetchImpl: async () => response({ deployment_configs: { production: { fail_open: true }, preview: { fail_open: false } } }),
    }),
    /did not confirm fail_open/,
  );
});
