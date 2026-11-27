/**
 * Whether this browser has signed in here (#581). The session cookie is
 * HttpOnly, so the reader cannot see it; this flag lets the reader ask the
 * server who is signed in only on devices that ever were, and send nothing for
 * the anonymous readers who make up most of the traffic.
 *
 * It is only a hint: the server still answers who is signed in, and a 401
 * clears it.
 */
const KEY = "tw-doujin:signed-in";

export function rememberSignedIn() {
  try { window.localStorage.setItem(KEY, "1"); } catch { /* Storage blocked: the reader simply shows 登入. */ }
}

export function forgetSignedIn() {
  try { window.localStorage.removeItem(KEY); } catch { /* Nothing to clear. */ }
}

export function wasSignedIn() {
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
}
