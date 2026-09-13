// staged-data: portal
//
// Replaces the behavioural half of `tests/organizer-entry.test.mjs`, which
// reads `organizer-app.tsx` and its CSS with seventeen `readFile` calls and
// sixty-odd regexes — including assertions on JSX prop wiring such as
// `onDraftStateChange=.*setLiveDraft`. Those break on a rename and prove
// nothing about whether an organizer can get in, so the parts that describe
// what a person sees are checked here against the running workspace instead.
//
// Not covered here, and not claimed to be: creating an event, importing a
// workbook, and publication state. Those need a populated organizer and belong
// with the import journeys rather than with the entry.
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
