interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_API_URL: string;
  readonly VITE_AUTH_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Type declaration for Vite's ?url import suffix
declare module "*?url" {
  const url: string;
  export default url;
}
