/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REC_CORE_API_URL: string;
  readonly VITE_SITE_PUBLIC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
