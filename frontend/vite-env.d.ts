interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_API_URL: string;
  readonly VITE_AUTH_URL: string;
  readonly PROD: boolean;
  readonly VITE_OTEL_ENABLED: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Type declaration for Vite's ?url import suffix
declare module "*?url" {
  const url: string;
  export default url;
}
