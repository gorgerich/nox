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
        {/*
          The visual viewport, published as a variable.

          Bottom-anchored chrome — the dock, the composer — has floated above
          the real bottom on a fresh open and only settled after a tap. Every
          viewport unit misreports at some point in that sequence on iOS:
          `dvh` before the chrome settles, `100%` when the layout viewport
          exceeds what is on screen. `visualViewport` is the one measurement
          that describes what the user can actually see, and it fires an event
          whenever that changes.

          Inline and before paint, so the first frame is already correct rather
          than corrected. Falls back to `innerHeight` where the API is absent.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                var root = document.documentElement;
                function publish() {
                  var vv = window.visualViewport;
                  var height = vv ? vv.height : window.innerHeight;
                  if (height > 0) root.style.setProperty('--visual-vh', height + 'px');

                  /*
                    How much of the window the keyboard is covering.

                    Needed separately from the height because of one iOS
                    detail: while the keyboard is up, env(safe-area-inset-bottom)
                    keeps reporting the home indicator's 34px even though the
                    indicator is no longer on screen. Anything padding itself
                    against that inset — the composer — floats a phantom 34px
                    gap above the keyboard. With the covered amount published,
                    that padding can collapse exactly while it is wrong.

                    Small values are treated as no keyboard: the URL bar and the
                    rubber-band both move the visual viewport by a few pixels,
                    and reacting to those would make the composer twitch.
                  */
                  var covered = vv ? window.innerHeight - vv.height - vv.offsetTop : 0;
                  var keyboard = covered > 120 ? Math.round(covered) : 0;
                  root.style.setProperty('--keyboard-inset', keyboard + 'px');
                  root.dataset.keyboard = keyboard > 0 ? 'open' : 'closed';

                }
                publish();
                if (window.visualViewport) {
                  window.visualViewport.addEventListener('resize', publish);
                  window.visualViewport.addEventListener('scroll', publish);
                }
                window.addEventListener('orientationchange', publish);
                window.addEventListener('pageshow', publish);
              })();
            `,
          }}
        />
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

                /*
                  Tell the iOS shell which theme is on screen.

                  The native status bar resolves its glyph colour against the
                  *system* appearance, so a user running iOS light with Nox set
                  to dark got black glyphs on a black header. The shell listens
                  on this channel and follows the app instead.

                  A MutationObserver rather than a call from the theme switch:
                  every path that changes the theme ends by writing this
                  attribute, so watching the attribute covers all of them and
                  needs no React involvement. Absent outside the iOS shell, in
                  which case the whole block is a no-op.
                */
                var channel = window.webkit && window.webkit.messageHandlers
                  && window.webkit.messageHandlers.noxTheme;
                if (channel) {
                  var post = function () {
                    try { channel.postMessage(document.documentElement.dataset.theme || 'system'); } catch (e) {}
                  };
                  post();
                  new MutationObserver(post).observe(document.documentElement, {
                    attributes: true,
                    attributeFilter: ['data-theme'],
                  });
                }
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
