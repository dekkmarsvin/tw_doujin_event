// staged-data: portal
//
// Replaces the behavioural half of `tests/organizer-entry.test.mjs`, which
// reads `organizer-app.tsx` and its CSS with seventeen `readFile` calls and
// sixty-odd regexes — including assertions on JSX prop wiring such as
// `onDraftStateChange=.*setLiveDraft`. Those break on a rename and prove
// nothing about whether an organizer can get in, so the parts that describe
// what a person sees are checked here against the running workspace instead.
//
// Publication read failures use an explicit local response fixture. Creating
// events, importing workbooks and production publication remain separate.
import assert from "node:assert/strict";
import { ADMIN, clearMail, signIn } from "./support/portal.mjs";
import { base, start } from "./support/journey.mjs";

const journey = await start("portal-organizer-entry");
try {
  await clearMail();

  // The authoring entry is a separate audience from the circle portal: a link
  // minted for organizers lands in the workspace, not on the reader.
  const organizer = await signIn(journey, ADMIN, "organizer", { viewport: { width: 1440, height: 900 } });
  assert.equal(new URL(organizer.url()).pathname, "/organizer", "an organizer link opens the authoring entry");
  const workspace = organizer.locator("body");
  assert.match(await workspace.innerText(), /主辦單位工作區/, "the workspace mounts on a desktop width");
  await organizer.getByRole("button", { name: "建立新活動", exact: true }).waitFor();
  await journey.capture(organizer, "organizer-desktop");

  // #439: one session opens both workspaces. Signed in at /circle, the
  // organizer workspace is still named there, and opening it asks for nothing.
  await organizer.goto(`${base}/circle`);
  const circleSwitch = organizer.getByRole("banner").getByRole("navigation", { name: "工作區" });
  assert.equal(await circleSwitch.getByRole("link", { name: "社團資料", exact: true }).getAttribute("aria-current"), "page");
  await journey.capture(organizer, "circle-signed-in-switch");
  await circleSwitch.getByRole("link", { name: "主辦工作區", exact: true }).click();
  await organizer.getByRole("button", { name: "建立新活動", exact: true }).waitFor();
  assert.equal(await organizer.getByRole("button", { name: "寄出登入連結", exact: true }).count(), 0, "the same session opens the workspace");
  const organizerSwitch = organizer.getByRole("banner").getByRole("navigation", { name: "工作區" });
  assert.equal(await organizerSwitch.getByRole("link", { name: "主辦工作區", exact: true }).getAttribute("aria-current"), "page");
  assert.equal(await organizerSwitch.getByRole("link", { name: "社團資料", exact: true }).getAttribute("href"), "/circle", "and leads back the same way");

  // The browser may deny the storage accessor itself. Publication polling
  // must still mount, distinguish stale progress, and offer a recovery path.
  const event = { id: "poll-fixture", tentativeName: "本機發布測試", eventId: "poll-test", status: "publishing",
    version: 1, updatedAt: 1, updatedByRole: "system", role: "owner", workspaceMode: "binder" };
  const fixture = { event: { ...event, eventIdLocked: true }, publicationAvailable: true,
    draft: { schema: "organizer-event-draft/1", event: { id: "poll-test", name: "本機發布測試", days: [] },
      venue: { assignments: [] }, officialSource: { label: "", url: null } },
    venueCatalog: { venues: [] }, revisions: [], import: null,
    publication: { id: "poll-job", status: "publishing", step: "waiting_deployment", error: null, retryable: true, updatedAt: 1 },
    workspace: { mode: "binder", onboardingCompletedAt: 1, resume: { guidedTask: "identity_source", section: "review" },
      readiness: { completed: 5, total: 6, suggestedNextSection: "review", blockers: [],
        sections: ["event", "venue", "import", "map", "validate", "review"].map((id) => ({ id, state: "available" })) } } };
  let readStatus = 200;
  let reads = 0;
  await organizer.route("**/api/organizer/events", (route) => route.fulfill({ json: { events: [event] } }));
  await organizer.route("**/api/organizer/events/poll-fixture", (route) => {
    reads++;
    return route.fulfill({ status: readStatus, json: readStatus === 200 ? fixture : { error: "fixture read failure" } });
  });
  await organizer.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage blocked", "SecurityError"); } });
  });
  await organizer.clock.install();
  await organizer.reload();
  await organizer.getByRole("heading", { name: "送審與發布狀態" }).waitFor();
  readStatus = 401;
  await organizer.clock.runFor(5000);
  await organizer.getByText("登入已到期，請重新登入。", { exact: true }).waitFor();
  await organizer.getByRole("button", { name: "寄出登入連結", exact: true }).waitFor();
  assert.equal(await organizer.getByRole("button", { name: "登出", exact: true }).count(), 0);
  assert.equal(await organizer.getByRole("heading", { name: "送審與發布狀態" }).count(), 0);
  const after401 = reads;
  await organizer.clock.runFor(20_000);
  assert.equal(reads, after401, "401 stops polling");
  await journey.capture(organizer, "publication-session-expired");

  readStatus = 200;
  await organizer.reload();
  await organizer.getByRole("heading", { name: "送審與發布狀態" }).waitFor();
  readStatus = 503;
  for (let attempt = 0; attempt < 3; attempt++) {
    await Promise.all([organizer.waitForResponse((response) => response.url().endsWith("/poll-fixture") && response.status() === 503),
      organizer.clock.runFor(5000)]);
  }
  await organizer.getByRole("alert").getByText(/上次讀取的進度/).waitFor();
  const after503 = reads;
  await organizer.clock.runFor(20_000);
  assert.equal(reads, after503, "three failed reads stop polling");
  readStatus = 200;
  await organizer.getByRole("button", { name: "重新讀取進度" }).click();
  await organizer.getByRole("alert").waitFor({ state: "hidden" });
  await Promise.all([organizer.waitForResponse((response) => response.url().endsWith("/poll-fixture")), organizer.clock.runFor(5000)]);
  assert.ok(reads > after503 + 1, "manual recovery restarts polling");
  await journey.capture(organizer, "publication-read-recovered");
  await organizer.clock.resume();

  // Authoring is desktop-only by decision, and the decision has to be a real
  // absence rather than a hidden panel: a narrow screen that still mounts the
  // controls leaves them reachable by keyboard and by screen reader while
  // telling the reader they are not there.
  await organizer.setViewportSize({ width: 900, height: 900 });
  await organizer.reload();
  await organizer.getByText("請改用桌機").waitFor();
  const narrow = await workspace.innerText();
  assert.match(narrow, /較寬的畫面/, "a narrow screen explains what to do instead");
  assert.doesNotMatch(narrow, /建立新活動|活動列表/, "and offers no authoring controls at all");
  assert.equal(await organizer.getByRole("button", { name: "建立新活動", exact: true }).count(), 0, "the authoring controls are absent, not merely hidden");
  await journey.capture(organizer, "organizer-narrow");
  await organizer.close();

  // #439: signed out, each entry names both workspaces and marks where the
  // reader is, on a phone as well, so an organizer who pressed the public
  // header's "登入" and landed on /circle can still find their own.
  for (const [path, current, other] of [["/circle", "社團資料", "主辦工作區"], ["/organizer", "主辦工作區", "社團資料"]]) {
    const visitor = await journey.page({ url: `${base}${path}`, viewport: { width: 390, height: 844 } });
    await visitor.getByRole("button", { name: "寄出登入連結", exact: true }).waitFor();
    const workspaces = visitor.getByRole("navigation", { name: "工作區" });
    assert.equal(await workspaces.getByRole("link", { name: new RegExp(`^${current}`) }).getAttribute("aria-current"), "page", `${path} marks itself`);
    assert.equal(await workspaces.getByRole("link", { name: new RegExp(`^${other}`) }).getAttribute("href"), other === "社團資料" ? "/circle" : "/organizer");
    await visitor.getByText("社團與主辦單位可在此登入。瀏覽、收藏與排行程不需登入。", { exact: true }).waitFor();
    await journey.capture(visitor, `workspace-entries${path.replace("/", "-")}-390`);
    await visitor.close();
  }

  // #439: an account signed in with nothing to do here is told so once and
  // keeps its session: never the sign-in form again, which would send it round
  // the same loop. An invitee can still ask for an organizer link, the only
  // sign-in that accepts an invitation, for the address already signed in.
  let requested = null;
  const outsider = await journey.page({ url: `${base}/organizer`, viewport: { width: 390, height: 844 }, routes: async (target) => {
    await target.route("**/api/auth/session", (route) => route.fulfill({ json: {
      email: "circle@example.test", isAdmin: false, isMapContributor: false, hasOrganizerAccess: false,
      canApplyForEvent: false, hasEventApplications: false, expiresAt: Date.now() + 86_400_000 } }));
    // Cloudflare's script stands in for itself: a widget that passes at once.
    await target.route("https://challenges.cloudflare.com/turnstile/**", (route) => route.fulfill({ contentType: "text/javascript", body: `
      window.turnstile = { render: (host, options) => { setTimeout(() => options.callback("journey-token")); return "widget"; }, remove: () => {} };
      window.__ff47TurnstileReady();` }));
    await target.route("**/api/auth/request-link", (route) => { requested = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { ok: true } }); });
  } });
  await outsider.getByRole("heading", { name: "此帳號沒有主辦工作區權限", exact: true }).waitFor();
  assert.equal(await outsider.getByLabel("Email", { exact: true }).count(), 0, "no sign-in form for an account already signed in");
  assert.equal(await outsider.getByRole("link", { name: "返回社團資料", exact: true }).getAttribute("href"), "/circle");
  assert.equal(await outsider.getByRole("link", { name: "返回活動列表", exact: true }).getAttribute("href"), "/");
  await outsider.getByRole("button", { name: "登出", exact: true }).waitFor();
  assert.equal(await outsider.locator('script[src^="https://challenges.cloudflare.com/"]').count(), 0, "verification loads only when asked for");
  await journey.capture(outsider, "organizer-no-access-390");
  await outsider.getByRole("button", { name: "寄送主辦登入連結", exact: true }).click();
  await outsider.getByText("寄到 circle@example.test", { exact: true }).waitFor();
  const send = outsider.getByRole("button", { name: "寄出登入連結", exact: true });
  await outsider.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent === "寄出登入連結" && !button.disabled));
  await send.click();
  await outsider.getByText("若帳號可使用，登入連結已寄出。", { exact: true }).waitFor();
  assert.deepEqual([requested?.email, requested?.audience], ["circle@example.test", "organizer"], "an organizer link for the signed-in address");
  await journey.capture(outsider, "organizer-no-access-link-sent-390");
  await outsider.close();

  // The authoring entry is unlisted: it must not be indexed. The reader leads
  // to /circle, which names this workspace; the reader itself never links here.
  const entry = await (await fetch(new URL("/organizer", base))).text();
  assert.match(entry, /<meta name="robots" content="noindex, nofollow"/, "the authoring entry refuses indexing");
  const reader = await journey.mapPage();
  assert.equal(await reader.locator('a[href^="/organizer"]').count(), 0, "the rendered reader never links to the authoring entry");
  await reader.close();

  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
