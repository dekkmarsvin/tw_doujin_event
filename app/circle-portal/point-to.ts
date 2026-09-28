/**
 * Takes the reader to the control that lifts a block, when they press
 * something it is holding back.
 *
 * A control that another one gates is kept reachable (`aria-disabled`, not
 * `disabled`) so the press can be answered here: a disabled button that does
 * nothing leaves the reader to guess which checkbox or field is in the way.
 * Centred rather than merely scrolled into view, so the editor's sticky save
 * bar cannot end up covering it; focused, so a keyboard or screen reader lands
 * on it too.
 */
export function pointTo(target: HTMLElement | null | undefined) {
  if (!target) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  target.focus({ preventScroll: true });
}
