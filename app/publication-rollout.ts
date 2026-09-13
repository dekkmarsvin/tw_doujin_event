export const PUBLICATION_REQUIRED_CHECKS = {
  data: ["data / check", "Organizer publication approval"],
  main: ["Verify and deploy", "Full preview portal E2E", "Organizer publication approval"],
} as const;

type Ruleset = {
  enforcement: string;
  conditions?: { ref_name?: { include: string[]; exclude: string[] } };
  bypass_actors?: Array<{ actor_type: string; actor_id: number | null }>;
  rules: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string }> } }>;
};

/** Conservative rollout report. The caller supplies full API ruleset details,
 * not list summaries. Unknown targeting is never evidence of protection. */
export function publicationRolloutProblems(stage: "data" | "main", rulesets: readonly Ruleset[], appId: number) {
  const problems: string[] = [];
  const applicable = rulesets.filter((ruleset) => ruleset.enforcement === "active"
    && ruleset.conditions?.ref_name?.exclude.length === 0
    && ruleset.conditions.ref_name.include.some((ref) => ["~ALL", "~DEFAULT_BRANCH", "refs/heads/main"].includes(ref)));
  if (!applicable.some((ruleset) => ruleset.rules.some((rule) => rule.type === "pull_request"))) problems.push("missing_pull_request_rule");
  const checks = new Set(applicable.flatMap((ruleset) => ruleset.rules.flatMap((rule) => rule.type === "required_status_checks"
    ? (rule.parameters?.required_status_checks ?? []).map((check) => check.context) : [])));
  for (const name of PUBLICATION_REQUIRED_CHECKS[stage]) if (!checks.has(name)) problems.push(`missing_check:${name}`);
  if (!Number.isSafeInteger(appId) || appId <= 0) problems.push("unverified_app_identity");
  if (applicable.some((ruleset) => ruleset.bypass_actors?.some((actor) => actor.actor_type === "Integration" && actor.actor_id === appId))) problems.push("app_bypasses_ruleset");
  return problems;
}
