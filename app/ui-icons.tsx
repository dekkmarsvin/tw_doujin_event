import type { SVGProps } from "react";

type UiIconName =
  | "arrow-down"
  | "arrow-up"
  | "chevron-left"
  | "chevron-right"
  | "check"
  | "close"
  | "drag"
  | "external"
  | "heart"
  | "locate"
  | "map-pin"
  | "minus"
  | "north"
  | "plus"
  | "search"
  | "square"
  | "check-square"
  | "upload";

export function UiIcon({ name, ...props }: { name: UiIconName } & SVGProps<SVGSVGElement>) {
  const shared: SVGProps<SVGSVGElement> = {
    viewBox: "0 0 24 24",
    width: "1em",
    height: "1em",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
  };

  return <svg {...shared} {...props}>
    {name === "search" && <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>}
    {name === "heart" && <path fill="currentColor" stroke="none" d="M12 21s-7.5-4.8-9.5-9.2C.8 8 3.1 4.5 7 4.5c2.2 0 3.8 1.2 5 2.8 1.2-1.6 2.8-2.8 5-2.8 3.9 0 6.2 3.5 4.5 7.3C19.5 16.2 12 21 12 21Z" />}
    {name === "close" && <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>}
    {name === "drag" && <><circle cx="9" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none" /></>}
    {name === "arrow-up" && <><path d="m6 10 6-6 6 6" /><path d="M12 4v16" /></>}
    {name === "arrow-down" && <><path d="m6 14 6 6 6-6" /><path d="M12 20V4" /></>}
    {name === "chevron-left" && <path d="m15 18-6-6 6-6" />}
    {name === "chevron-right" && <path d="m9 18 6-6-6-6" />}
    {name === "external" && <><path d="M14 5h5v5" /><path d="m19 5-8 8" /><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>}
    {name === "plus" && <><path d="M12 5v14" /><path d="M5 12h14" /></>}
    {name === "minus" && <path d="M5 12h14" />}
    {name === "locate" && <><circle cx="12" cy="12" r="6" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /></>}
    {name === "north" && <><path d="m12 3 5 14-5-3-5 3 5-14Z" /><path d="M12 14v7" /></>}
    {name === "map-pin" && <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>}
    {name === "upload" && <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 14v5h14v-5" /></>}
    {name === "check" && <path d="m5 12 4 4L19 6" />}
    {name === "square" && <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />}
    {name === "check-square" && <><rect x="4.5" y="4.5" width="15" height="15" rx="2.5" /><path d="m8 12 2.6 2.7L16.5 9" /></>}
  </svg>;
}
