"use client";

import { useLayoutEffect, useRef } from "react";
import { useLocale } from "../i18n/locale-context";
import styles from "./portal.module.css";

/**
 * Cloudflare Turnstile, rendered explicitly.
 *
 * This is the only third-party script this code loads, and only on `/circle` and
 * `/organizer` — `public/_headers` widens the CSP for those paths. (The Web
 * Analytics beacon on the production domain is injected by Cloudflare's edge,
 * not by this repository; see the note at the top of `public/_headers`.) It is
 * fetched on demand rather than from the document head so the reader's entry
 * cannot pick it up, and so a sign-in page nobody opens costs nothing.
 *
 * A token is single-use and expires a few minutes after it is issued, so the
 * parent remounts this component after every submit rather than reusing one.
 *
 * The widget is an iframe of fixed size: 300px wide normally, 150px wide and
 * 140px tall in its compact form. Inside a sign-in card on a 320px phone the
 * form is narrower than 300px, and the normal widget pushed the page sideways.
 * (The `flexible` size is no help there: it stretches to its host but never
 * below 300px.) So the host is measured first and the compact form is used
 * wherever the normal one would not fit.
 */

type TurnstileSize = "normal" | "compact";

type TurnstileApi = {
  render: (target: HTMLElement, options: {
    sitekey: string;
    size: TurnstileSize;
    language: "zh-tw" | "en" | "ja";
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
const NORMAL_WIDTH = 300;
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
  const { locale } = useLocale();

  // A layout effect, so the height reserved for the chosen size is in place
  // before the first paint rather than jumping once it is known.
  useLayoutEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    const target = host.current;
    if (!target) return;
    onToken(null);
    const size: TurnstileSize = target.clientWidth >= NORMAL_WIDTH ? "normal" : "compact";
    target.dataset.size = size;

    void loadTurnstile().then((turnstile) => {
      if (cancelled) return;
      widgetId = turnstile.render(target, {
        sitekey,
        size,
        language: locale === "zh-Hant" ? "zh-tw" : locale,
        callback: (token) => { if (!cancelled) onToken(token); },
        "expired-callback": () => { if (!cancelled) onToken(null); },
        "error-callback": () => { if (!cancelled) onToken(null); },
      });
    }).catch(() => {
      if (!cancelled) onUnavailable();
    });

    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [locale, onToken, onUnavailable, sitekey]);

  return <div className={styles.turnstile} ref={host} />;
}
