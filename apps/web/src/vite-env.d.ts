/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REC_CORE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
