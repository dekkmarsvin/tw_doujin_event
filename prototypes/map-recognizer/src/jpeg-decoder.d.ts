// The decoder half of jpeg-js, imported on its own so the bundle does not pull
// in the encoder (which assumes Node's Buffer).
declare module "jpeg-js/lib/decoder.js" {
  export default function decode(
    jpegData: Uint8Array,
    opts: { useTArray: true; formatAsRGBA?: boolean; maxResolutionInMP?: number; maxMemoryUsageInMB?: number },
  ): { width: number; height: number; data: Uint8Array };
}
