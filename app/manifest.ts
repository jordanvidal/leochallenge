import type { MetadataRoute } from "next";

// Manifest PWA. Next le sert sur /manifest.webmanifest et le référence tout seul.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "100 · 100 · 100",
    short_name: "100·100·100",
    description:
      "Challenge sportif entre potes : 100 pompes, 100 abdos, 100 squats par jour.",
    start_url: "/",
    display: "standalone", // plein écran, sans barre d'URL
    background_color: "#151515",
    theme_color: "#131313",
    orientation: "portrait",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
