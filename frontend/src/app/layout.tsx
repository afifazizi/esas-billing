import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ESAS Billing",
  description: "Enterprise Storage Archiving System",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/brand/esas-icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/esas-icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/brand/esas-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

const themeBootScript = `
(function () {
  try {
    var stored = window.localStorage.getItem('esas-theme');
    var preference = stored === 'light' || stored === 'system' || stored === 'dark' ? stored : 'dark';
    var resolved = preference === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : preference;
    var root = document.documentElement;
    root.dataset.theme = resolved;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  } catch (error) {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-[var(--color-bg)] font-sans text-[var(--color-text)] antialiased`}
      >
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
