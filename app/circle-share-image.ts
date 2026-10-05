import { isHttpsUrl, type CircleOverrideFields } from "./circle-overrides";
import { SHARE_IMAGE } from "./seo";
import type { Locale } from "./i18n/locale";

export type CircleShareImage = { url: string; width?: number; height?: number };

/** Only current, published media can be used. A stale selection is harmless
 * after deletion, replacement or reordering of the sale sheets. */
export function circleShareImageOptions(fields: CircleOverrideFields, locale: Locale = "zh-Hant") {
  const labels = locale === "en" ? { brand: "場刊 Map default image", thumbnail: "Circle featured image", page: (index: number) => `Item list page ${index}` }
    : locale === "ja" ? { brand: "場刊 Map 共通画像", thumbnail: "サークル代表画像", page: (index: number) => `お品書き ${index} ページ目` }
      : { brand: "場刊 Map 通用圖", thumbnail: "社團代表圖", page: (index: number) => `品書第 ${index} 張` };
  return [
    { value: "brand", label: labels.brand, image: SHARE_IMAGE as CircleShareImage },
    ...(fields.thumbnail && isHttpsUrl(fields.thumbnail.url)
      ? [{ value: "thumbnail", label: labels.thumbnail, image: { url: fields.thumbnail.url } as CircleShareImage }] : []),
    ...(fields.catalogImages ?? []).filter(image => isHttpsUrl(image.url)).map((image, index) => ({
      value: image.url, label: labels.page(index + 1), image: { url: image.url, width: image.width, height: image.height } as CircleShareImage,
    })),
  ];
}

export function selectedCircleShareImage(fields: CircleOverrideFields = {}, locale: Locale = "zh-Hant") {
  const options = circleShareImageOptions(fields, locale);
  return options.find(option => option.value === fields.shareImage) ?? options[0];
}
