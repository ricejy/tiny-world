import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tiny World — A little world, in your words",
  description: "Meet Pip, Moss, and Dot. Give your island natural-language commands and explore Jev’s semantic decisions.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
