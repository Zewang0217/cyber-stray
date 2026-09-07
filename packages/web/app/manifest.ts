import type { MetadataRoute } from "next";

/** PWA manifest（spec Decision 12）：掌机隐喻天然 standalone；离线策略为雾区不在此做。 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "STRAY-BOY · 赛博街溜子",
    short_name: "STRAY-BOY",
    description: "一台掌机，一座夜城，一只自己会动的猫。",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1A1C2C",
    theme_color: "#1A1C2C",
    icons: [
      { src: "/icons/strayboy-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/strayboy-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
