import { Children, cloneElement, createContext, isValidElement, useContext, useId, useState, type ReactElement, type ReactNode } from "react";
import type { OrganizerEventDraft, OrganizerValidationIssue } from "../organizer-event";
import styles from "./organizer.module.css";

export type FieldRequest = { candidateId: string; section: string; target: string };
export const FieldGuidance = createContext<{ issues: OrganizerValidationIssue[]; attempted: boolean; target?: string }>({ issues: [], attempted: false });

/** The API also serves older saved candidates, whose reference issues all
 * pointed at `references`. Resolve those codes without parsing prose. */
export function organizerIssueTarget(issue: { code: string; target?: string }, draft: OrganizerEventDraft): string | undefined {
  if (issue.code === "missing_venue") return "venue.assignments.0.venueId";
  if (issue.code === "missing_category_catalog" || issue.code === "invalid_category_catalog") return "references.categoryCatalog";
  if (["missing_organizer", "unknown_organizer", "duplicate_organizer", "organizer_lead"].includes(issue.code)) return "references.organizerAssignments";
  if (issue.code === "invalid_day" && issue.target) {
    const index = Number(issue.target.split(".")[2]);
    const day = draft.event.days[index];
    // Match the existing draft validator's ID grammar, including nonempty
    // invalid values; otherwise the valid date gets blamed for a bad code.
    if (day) return `${issue.target}.${!/^[a-z0-9][a-z0-9-]*$/u.test(day.id) ? "id" : !day.label ? "label" : "date"}`;
  }
  return issue.target;
}

export function RequiredMark({ review = false }: { review?: boolean }) {
  return <span className={styles.requiredMark} aria-hidden="true">{review ? "送審前必填" : "必填"}</span>;
}

export function FieldIssue({ target }: { target: string }) {
  const guidance = useContext(FieldGuidance);
  const issue = guidance.issues.find(item => item.target === target);
  return issue && (guidance.attempted || guidance.target === target)
    ? <p className={styles.fieldError}>{issue.message}</p> : null;
}

/** Keep the existing accessible field name; expose requirements and errors
 * through the native control as well as the visible label. */
export function GuidedField({ target, required = false, children }: { target: string; required?: boolean | "review"; children: ReactNode }) {
  const guidance = useContext(FieldGuidance);
  const [touched, setTouched] = useState(false);
  const errorId = useId();
  const labelId = useId();
  const issue = guidance.issues.find(item => item.target === target);
  const error = (touched || guidance.attempted || guidance.target === target) ? issue?.message : undefined;
  const parts = Children.toArray(children);
  const start = parts.findIndex(child => isValidElement(child) && (child.type === "input" || child.type === "select"));
  return <label data-organizer-field={target} onBlur={() => setTouched(true)}>
    <span><span id={labelId}>{parts.slice(0, start)}</span>{required && <RequiredMark review={required === "review"} />}</span>
    {parts.slice(start).map(child => {
      if (!isValidElement(child) || (child.type !== "input" && child.type !== "select")) return child;
      const control = child as ReactElement<{ required?: boolean; "aria-label"?: string; "aria-labelledby"?: string; "aria-describedby"?: string; "aria-invalid"?: boolean; "aria-description"?: string }>;
      return cloneElement(control, {
        required: Boolean(required) || control.props.required,
        "aria-labelledby": control.props["aria-label"] ? undefined : labelId,
        "aria-description": required === "review" ? "送審前必填，可先儲存草稿。" : undefined,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": [control.props["aria-describedby"], error ? errorId : null].filter(Boolean).join(" ") || undefined,
      });
    })}
    {error && <small id={errorId} className={styles.fieldError}>{error}</small>}
  </label>;
}

/** Open folded day details, then bring the actual control into view. There
 * may be no control yet (e.g. no days), so its add action is also a target. */
export function focusOrganizerField(root: HTMLElement, target: string) {
  const fields = [...root.querySelectorAll<HTMLElement>("[data-organizer-field]")];
  const field = fields.find(item => item.dataset.organizerField === target)
    ?? fields.filter(item => target.startsWith(`${item.dataset.organizerField}.`))
      .sort((left, right) => right.dataset.organizerField!.length - left.dataset.organizerField!.length)[0];
  if (!field) return false;
  for (let parent: HTMLElement | null = field; parent && parent !== root; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  root.querySelectorAll("[data-field-highlight]").forEach(item => item.removeAttribute("data-field-highlight"));
  field.dataset.fieldHighlight = "true";
  const control = field.querySelector<HTMLElement>("input:not(:disabled):not([readonly]), select:not(:disabled), textarea:not(:disabled):not([readonly]), button:not(:disabled)") ?? field;
  if (control === field) field.tabIndex = -1;
  control.focus({ preventScroll: true });
  field.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  return true;
}
