import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FF47 場刊 MAP｜同人展逛攤地圖",
  description: "搜尋 FF47 三日攤位、收藏社團並規劃你的逛攤路線。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body className={`${geist.variable} ${mono.variable}`}>{children}</body></html>;
}

