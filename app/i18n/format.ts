import type { Locale } from "./locale";

export function formatCount(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Reader budgets already use this prefix and NumberFormat's default precision. */
export function formatTwd(amount: number, locale: Locale): string {
  return `NT$ ${formatCount(amount, locale)}`;
}
