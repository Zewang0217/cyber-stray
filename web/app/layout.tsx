import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "@/components/layout/Sidebar";
import { CyberGridBackground } from "@/components/effects/CyberGridBackground";
import { MouseGlow } from "@/components/effects/MouseGlow";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Cyber Stray | 赛博街溜子",
  description: "一只在互联网暗巷中游荡的自动化信息猎犬",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex bg-base text-text" suppressHydrationWarning>
        <Providers>
          <CyberGridBackground />
          <MouseGlow />
          <Sidebar />
          <main className="flex-1 ml-64 relative z-10">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
