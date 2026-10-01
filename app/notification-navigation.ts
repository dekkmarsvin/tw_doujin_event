/** A login continuation carries only selectors, never a caller-supplied URL. */
export function notificationParameters(value: unknown, audience: "circle" | "organizer") {
  const output = new URLSearchParams();
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  const input = value as Record<string, unknown>;
  const keys = audience === "circle" ? ["event", "circle"] : ["candidate", "application"];
  for (const key of keys) {
    const item = input[key];
    if (typeof item === "string" && /^[\p{L}\p{N}_.:-]{1,200}$/u.test(item)) output.set(key, item);
  }
  if (audience === "organizer" && input.section === "review") output.set("section", "review");
  if (input.notifications === "1") output.set("notifications", "1");
  return output;
}
