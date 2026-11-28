import { canonicalLocale } from "./app/i18n/locale";
import { startPublicAccount } from "./app/start-public-account";

startPublicAccount(canonicalLocale(document.documentElement.lang) ?? "zh-Hant");
