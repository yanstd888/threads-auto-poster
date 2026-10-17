import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Threads Auto-Poster",
  description: "Auto-post to Threads via Hermes agent",
};

interface LayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en" className={inter.className}>
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}
