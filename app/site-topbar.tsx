import type { ReactNode } from "react";

/** Shared reading and workspace header, in keyboard navigation order. */
export function SiteTopbar({ className, innerClassName, brand, event, search, navigation, status, account }: {
  className?: string; innerClassName?: string; brand: ReactNode; event?: ReactNode; search?: ReactNode;
  navigation?: ReactNode; status?: ReactNode; account?: ReactNode;
}) {
  const content = <>{brand}{event}{search}{navigation}{status}{account}</>;
  return <header className={className}>{innerClassName ? <div className={innerClassName}>{content}</div> : content}</header>;
}
