import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Application Form",
};

export default function WidgetLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preconnect"
          href="https://pirhnklvtjjpuvbvibxf.supabase.co"
        />
        <link
          rel="dns-prefetch"
          href="https://pirhnklvtjjpuvbvibxf.supabase.co"
        />
      </head>
      <body style={{ background: "transparent" }}>{children}</body>
    </html>
  );
}
