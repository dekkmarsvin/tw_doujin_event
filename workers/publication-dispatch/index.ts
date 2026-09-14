import { createIdentityRepository } from "../../db/identity-repository";
import { runPublicationTick } from "../../app/publication-scheduler";
import { createRuntimePublicationDriver, readPublishedEventAtOrigin } from "../../app/publication-runtime";
import { createFakePublicationDriver } from "../../app/publication-dispatch";

type Env = Pick<PortalEnv, "DB" | "ORGANIZER_PUBLICATION_MODE" | "PREVIEW_MAIL_SINK" | "GITHUB_APP_ID" | "GITHUB_APP_INSTALLATION_ID" | "GITHUB_APP_PRIVATE_KEY">;

/** No HTTP entry point. This Worker shares only the environment's identity D1. */
export default {
  async scheduled(_controller: ScheduledController, env: Env) {
    if (env.ORGANIZER_PUBLICATION_MODE !== "github" && !(env.ORGANIZER_PUBLICATION_MODE === "fake" && env.PREVIEW_MAIL_SINK === "d1")) return;
    const driver = env.ORGANIZER_PUBLICATION_MODE === "fake" ? createFakePublicationDriver(async () => false)
      : createRuntimePublicationDriver(env, readPublishedEventAtOrigin);
    const summary = await runPublicationTick({ repository: createIdentityRepository(env.DB), driver });
    console.log(JSON.stringify({ event: "publication.tick", ...summary }));
  },
};
