import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "../globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EdgeX",
  description: "Multi-tenant lead generation CRM by Zunkiree Labs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly/ColorZilla's cz-shortcut-listen) inject
          attributes on <body> before React hydrates. One level only; it cannot mask mismatches in children. */}
      <body
        className="antialiased h-screen overflow-hidden"
        suppressHydrationWarning
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
