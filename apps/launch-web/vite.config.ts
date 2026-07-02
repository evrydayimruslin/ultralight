const launchApiProxyTarget = process.env.LAUNCH_API_PROXY_TARGET ||
  "http://127.0.0.1:8787";

export default {
  clearScreen: false,
  server: {
    port: 5178,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api/launch": {
        target: launchApiProxyTarget,
        changeOrigin: true,
        secure: true,
      },
      // Stripe Connect status/onboarding + earnings→balance transfers live
      // under /api/user on the same worker.
      "/api/user": {
        target: launchApiProxyTarget,
        changeOrigin: true,
        secure: true,
      },
      "/auth": {
        target: launchApiProxyTarget,
        changeOrigin: true,
        secure: true,
      },
    },
    fs: {
      allow: ["../.."],
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
  envPrefix: ["VITE_"],
};
