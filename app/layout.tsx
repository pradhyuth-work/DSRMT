import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Varasidhi MT — Billing & Dispatch",
  description: "Order billing, inventory dispatch, outlet ledgers and staff reconciliation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
