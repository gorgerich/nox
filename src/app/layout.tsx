import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
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
  // Zoom stays available. Blocking it is the usual way to stop iOS from
  // zooming when a field is focused, but iOS Safari has ignored the request
  // since 10 — so it never bought anything here, while every other browser
  // honours it and takes pinch-zoom away from anyone who needs it. The actual
  // fix for the iOS behaviour is a 16px input font, which the fields already
  // have.
  viewportFit: "cover",
  // Per-scheme status bar / browser chrome colour. A single dark value used to
  // be emitted, which left the light theme with dark system chrome.
  themeColor: [
    // Matches --messenger-canvas-background, so the browser chrome and the
    // overscroll area are the same colour as the shell rather than the old
    // grouped grey showing through above and below it.
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  colorScheme: "light dark",
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
                var meta = document.createElement('meta');
                meta.name = 'theme-color';
                meta.content = effectiveTheme === 'dark' ? '#000000' : '#ffffff';
                document.head.appendChild(meta);
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
