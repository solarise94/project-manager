import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { MobileNav } from "@/components/mobile-nav";
import { ensureSchedulerStarted } from "@/lib/reminder";

// Only start scheduler in development; production should use external cron
if (typeof window === "undefined" && process.env.NODE_ENV === "development") {
  ensureSchedulerStarted();
}

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SciManage - 科研项目管理",
  description: "单细胞测序与空间转录组科研项目管理系统",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col md:flex-row bg-background text-foreground">
        <Providers>
          <Sidebar />
          <div className="flex-1 flex flex-col min-h-screen md:h-screen md:overflow-hidden">
            <Header />
            <main className="flex-1 overflow-auto p-4 md:p-8 pb-24 md:pb-8">
              {children}
            </main>
            <MobileNav />
          </div>
        </Providers>
      </body>
    </html>
  );
}
