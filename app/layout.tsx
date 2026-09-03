import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PostHog Engineering Impact · 90-day view",
  description: "A transparent, evidence-backed view of the five engineers creating the most sustained impact across PostHog.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
