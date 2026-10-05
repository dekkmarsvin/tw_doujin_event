import { UiIcon } from "../ui-icons";
import { LOCALES, type Locale } from "./locale";
import { useLocale } from "./locale-context";
import styles from "./language-switcher.module.css";

/** Each language names itself, so a reader who cannot read the current one still finds theirs. */
const ENDONYM: Record<Locale, { name: string; short: string }> = {
  "zh-Hant": { name: "繁體中文", short: "中" },
  en: { name: "English", short: "EN" },
  ja: { name: "日本語", short: "日" },
};

const LABEL: Record<Locale, string> = { "zh-Hant": "介面語言", en: "Language", ja: "表示言語" };

/**
 * A native select under a visible face: the platform supplies the keyboard,
 * screen reader and phone picker, and the face can shorten to a code where a
 * header has no room for "繁體中文". Every option carries its own `lang` so a
 * screen reader pronounces "日本語" as Japanese wherever the page is. `narrow`
 * shortens the face up to 1050px too, for a header with no room at narrow
 * desktop widths.
 */
export function LanguageSwitcher({ className, narrow = false, onChange }: { className?: string; narrow?: boolean; onChange?: (locale: Locale) => void }) {
  const { locale, setLocale } = useLocale();
  return <label className={[styles.switcher, narrow && styles.narrow, className].filter(Boolean).join(" ")}>
    <UiIcon name="globe" className={styles.icon} />
    <span className={styles.face} aria-hidden="true">
      <span className={styles.full} lang={locale}>{ENDONYM[locale].name}</span>
      <span className={styles.short} lang={locale}>{ENDONYM[locale].short}</span>
    </span>
    <UiIcon name="chevron-down" className={styles.chevron} />
    <select aria-label={LABEL[locale]} value={locale} onChange={(changed) => {
      const next = LOCALES.find(option => option === changed.currentTarget.value);
      if (next) { setLocale(next); onChange?.(next); }
    }}>
      {LOCALES.map((option) => <option key={option} value={option} lang={option}>{ENDONYM[option].name}</option>)}
    </select>
  </label>;
}
