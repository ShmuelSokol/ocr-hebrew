import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "OCR Hebrew",
  description: "Handwritten Hebrew OCR with correction and learning",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="bg-gray-50 min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
