export const PUBLICATION_REQUIRED_CHECKS = {
  data: ["data / check", "Organizer publication approval"],
  main: ["Verify and deploy", "Full preview portal E2E", "Browser acceptance", "Organizer publication approval"],
} as const;

type Ruleset = {
  enforcement: string;
  conditions?: { ref_name?: { include?: string[]; exclude?: string[] } };
  bypass_actors?: Array<{ actor_type: string; actor_id: number | null }>;
  rules: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string; integration_id?: number | null }> } }>;
};

/** Conservative rollout report. The caller supplies full API ruleset details,
 * not list summaries. Unknown targeting is never evidence of protection. */
export function publicationRolloutProblems(stage: "data" | "main", rulesets: readonly Ruleset[], appId: number) {
  const problems: string[] = [];
  const applicable = rulesets.filter((ruleset) => ruleset.enforcement === "active"
    && Array.isArray(ruleset.conditions?.ref_name?.exclude) && ruleset.conditions.ref_name.exclude.length === 0
    && Array.isArray(ruleset.conditions.ref_name.include)
    && ruleset.conditions.ref_name.include.some((ref) => ["~ALL", "~DEFAULT_BRANCH", "refs/heads/main"].includes(ref)));
  if (!applicable.some((ruleset) => ruleset.rules.some((rule) => rule.type === "pull_request"))) problems.push("missing_pull_request_rule");
  const checks = new Set(applicable.flatMap((ruleset) => ruleset.rules.flatMap((rule) => rule.type === "required_status_checks"
    ? (rule.parameters?.required_status_checks ?? []).map((check) => check.context) : [])));
  for (const name of PUBLICATION_REQUIRED_CHECKS[stage]) if (!checks.has(name)) problems.push(`missing_check:${name}`);
  // A required check names a context, and GitHub matches on that name alone
  // unless the entry pins `integration_id`. Anything holding checks write can
  // then report the name itself -- which is how this App satisfies its own
  // approval check -- so an unpinned entry does not constrain the identity the
  // rule exists to constrain (ADR-0066 decision 2).
  for (const ruleset of applicable) {
    for (const rule of ruleset.rules) {
      if (rule.type !== "required_status_checks") continue;
      for (const check of rule.parameters?.required_status_checks ?? []) {
        if (!Number.isSafeInteger(check.integration_id ?? NaN)) problems.push(`unpinned_check:${check.context}`);
      }
    }
  }
  if (!Number.isSafeInteger(appId) || appId <= 0) problems.push("unverified_app_identity");
  // Any actor that can bypass the ruleset can merge a publication PR without
  // the checks running. `Integration` is this App's own misconfiguration;
  // every other type is a human or a role someone granted, which is a
  // governance choice rather than a mistake, so the two are reported apart
  // (ADR-0058 decision 3).
  const bypasses = applicable.flatMap((ruleset) => ruleset.bypass_actors ?? []);
  if (bypasses.some((actor) => actor.actor_type === "Integration" && actor.actor_id === appId)) problems.push("app_bypasses_ruleset");
  if (bypasses.some((actor) => actor.actor_type !== "Integration")) problems.push("human_bypasses_ruleset");
  return problems;
}
