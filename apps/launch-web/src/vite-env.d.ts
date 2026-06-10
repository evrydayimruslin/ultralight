declare module "*.css";
declare module "*.png" {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_LAUNCH_API_BASE_URL?: string;
  readonly VITE_LAUNCH_ENVIRONMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
