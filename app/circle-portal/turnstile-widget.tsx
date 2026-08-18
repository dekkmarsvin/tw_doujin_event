"use client";

import { useEffect, useRef } from "react";
import styles from "./portal.module.css";

/**
 * Cloudflare Turnstile, rendered explicitly.
 *
 * This is the only third-party script the site loads, and it loads on `/circle`
 * alone — `public/_headers` widens the CSP for that path and nowhere else. It is
 * fetched on demand rather than from the document head so the reader's entry
 * cannot pick it up, and so a sign-in page nobody opens costs nothing.
 *
 * A token is single-use and expires a few minutes after it is issued, so the
 * parent remounts this component after every submit rather than reusing one.
 */

type TurnstileApi = {
  render: (target: HTMLElement, options: {
    sitekey: string;
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __ff47TurnstileReady?: () => void;
  }
}

const READY_CALLBACK = "__ff47TurnstileReady";
const SCRIPT_URL = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${READY_CALLBACK}`;

/** One load per document, shared by every mount. */
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  // `onload` is the documented signal. A plain `script.onload` can fire before
  // the API object is installed, which would leave `render` undefined.
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    window[READY_CALLBACK] = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile loaded without installing its API."));
    };
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error("Turnstile script could not be loaded."));
    };
    document.head.append(script);
  });
  return loading;
}

export function TurnstileWidget({ sitekey, onToken, onUnavailable }: {
  sitekey: string;
  /** A token to submit, or `null` once it expires or the challenge fails. */
  onToken: (token: string | null) => void;
  onUnavailable: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;

    void loadTurnstile().then((turnstile) => {
      if (cancelled || !host.current) return;
      widgetId = turnstile.render(host.current, {
        sitekey,
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    }).catch(() => {
      if (!cancelled) onUnavailable();
    });

    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [onToken, onUnavailable, sitekey]);

  return <div className={styles.turnstile} ref={host} />;
}
