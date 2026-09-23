/** 活動別稱：主辦與讀者實際用來稱呼這場活動的其他名字（ADR-0068）。
 *
 * The first alias is the event's short name. Aliases are optional and a
 * definition without any carries no `aliases` key at all, so every artifact
 * approved before the field existed rebuilds byte-for-byte. The organizer draft
 * and the published event definition share these rules so a draft that saves
 * is a draft that publishes.
 */
export const EVENT_ALIAS_MAX_COUNT = 5;
export const EVENT_ALIAS_MAX_LENGTH = 40;

export type EventAliasProblem =
  | { code: "too_many_aliases" }
  | { code: "invalid_alias" | "duplicate_alias"; index: number };

/** NFKC plus case folding: 「ＦＦ４７」 and 「ff47」 are the same alias to a reader. */
const aliasKey = (value: string) => value.normalize("NFKC").toLowerCase();

export function eventAliasProblems(name: string, aliases: readonly string[]): EventAliasProblem[] {
  const problems: EventAliasProblem[] = [];
  if (aliases.length > EVENT_ALIAS_MAX_COUNT) problems.push({ code: "too_many_aliases" });
  // An alias equal to the name repeats it rather than naming the event another way.
  const seen = new Set([aliasKey(name)]);
  aliases.forEach((alias, index) => {
    if (!alias || alias !== alias.trim() || [...alias].length > EVENT_ALIAS_MAX_LENGTH) {
      problems.push({ code: "invalid_alias", index });
      return;
    }
    if (seen.has(aliasKey(alias))) problems.push({ code: "duplicate_alias", index });
    seen.add(aliasKey(alias));
  });
  return problems;
}
