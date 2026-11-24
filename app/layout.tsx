import type { Metadata } from "next";
import "./globals.css";
import "./enhance.css";
import "./ticket.css";
import Enhance from "@/components/dashboard/Enhance";

export const metadata: Metadata = {
  title: "Varasidhi MT — Billing & Dispatch",
  description: "Order billing, inventory dispatch, outlet ledgers and staff reconciliation",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Enhance />
        {children}
      </body>
    </html>
  );
}
