/** Minimal Vite build surface used by this application.
 * Vite replaces these flags at build time; only the ones we read are declared.
 */
interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
