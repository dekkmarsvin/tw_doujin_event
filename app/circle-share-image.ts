import { isHttpsUrl, type CircleOverrideFields } from "./circle-overrides";
import { SHARE_IMAGE } from "./seo";

export type CircleShareImage = { url: string; width?: number; height?: number };

/** Only current, published media can be used. A stale selection is harmless
 * after deletion, replacement or reordering of the sale sheets. */
export function circleShareImageOptions(fields: CircleOverrideFields) {
  return [
    { value: "brand", label: "場刊 Map 通用圖", image: SHARE_IMAGE as CircleShareImage },
    ...(fields.thumbnail && isHttpsUrl(fields.thumbnail.url)
      ? [{ value: "thumbnail", label: "社團代表圖", image: { url: fields.thumbnail.url } as CircleShareImage }] : []),
    ...(fields.catalogImages ?? []).filter(image => isHttpsUrl(image.url)).map((image, index) => ({
      value: image.url, label: `品書第 ${index + 1} 張`, image: { url: image.url, width: image.width, height: image.height } as CircleShareImage,
    })),
  ];
}

export function selectedCircleShareImage(fields: CircleOverrideFields = {}) {
  const options = circleShareImageOptions(fields);
  return options.find(option => option.value === fields.shareImage) ?? options[0];
}
