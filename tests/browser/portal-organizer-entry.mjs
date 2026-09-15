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

  // The authoring entry is unlisted: it must not be indexed, and the reader
  // must not advertise a door that only organizers can walk through.
  const entry = await (await fetch(new URL("/organizer", base))).text();
  assert.match(entry, /<meta name="robots" content="noindex, nofollow"/, "the authoring entry refuses indexing");
  const reader = await (await fetch(new URL("/", base))).text();
  assert.doesNotMatch(reader, /href=["']\/organizer/, "the reader never links to the authoring entry");

  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
