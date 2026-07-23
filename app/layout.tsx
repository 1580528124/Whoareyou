import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WhoAreYou",
  description: "A web version of the WhoAreYou undercover word game.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
