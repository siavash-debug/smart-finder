import type { Metadata, Viewport } from "next";

// Self-hosted Vazirmatn. The package ships the woff2 files, so nothing is fetched from a
// third-party font CDN at runtime (MASTER_PROMPT §17).
import "@fontsource-variable/vazirmatn";
import "./globals.css";

export const metadata: Metadata = {
  title: "خانه‌یاب — پیدا کردن خانه‌ای که می‌خواهید",
  description:
    "جست‌وجوی هوشمند آپارتمان در تهران: تطابق دقیق و نزدیک، تشخیص آگهی‌های تکراری، و اطلاع‌رسانی تغییر قیمت.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
