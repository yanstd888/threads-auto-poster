import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Threads Auto-Poster",
  description: "Auto-post to Threads via Hermes agent",
};

interface LayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
