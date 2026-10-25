import type { Metadata } from "next";
import "./carbon.scss";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "NAAL Hesap Yönetimi", template: "%s · NAAL Hesap Yönetimi" },
  description: "Nevzat Ayaz Anadolu Lisesi Google Workspace hesap yönetimi",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
