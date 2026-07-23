import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
// Astryx design-system styles. Imported before globals.css so its cascade
// layer (astryx-base) sits below the app's own rules; the components use
// hashed StyleX atomic classes, so nothing here restyles the existing UI.
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

// Inter — the closest web equivalent to Telegram's clean system sans. Cyrillic
// subset is required (the UI is in Russian); `display: swap` avoids invisible
// text while the webfont loads.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#050608",
};

export const metadata: Metadata = {
  title: "Nox",
  description: "Закрытый мессенджер с доступом по приглашениям",
  appleWebApp: {
    capable: true,
    title: "Nox",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      { url: "/apple-icon.png", type: "image/png", sizes: "180x180" },
    ],
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const storedTheme = localStorage.getItem('nox:theme');
                const theme = storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system'
                  ? storedTheme
                  : 'system';
                const effectiveTheme = theme === 'system'
                  ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
                  : theme;
                const storedAccent = localStorage.getItem('nox:accent');
                const accent = ['blue', 'graphite', 'gray', 'purple', 'cyan', 'green'].includes(storedAccent)
                  ? storedAccent
                  : 'blue';
                document.documentElement.dataset.theme = effectiveTheme;
                document.documentElement.dataset.themeMode = theme;
                document.documentElement.dataset.accent = accent;
                document.documentElement.classList.toggle('dark', effectiveTheme === 'dark');
                document.documentElement.classList.remove('light');
                document.documentElement.style.colorScheme = effectiveTheme;
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col transition-colors duration-300">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
