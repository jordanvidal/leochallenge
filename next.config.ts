import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Version du build, passée à l'enregistrement du service worker
    // (/sw.js?v=…) pour que chaque déploiement reparte sur un cache de
    // shell neuf. Sans elle, le cache portait un nom fixe et gardait le
    // HTML et les chunks de tous les déploiements précédents.
    // Vercel fournit le SHA au build ; en local il n'y en a pas, et un
    // nom stable suffit.
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? "dev",
  },
};

export default nextConfig;
