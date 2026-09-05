import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

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
  // The layout viewport itself shrinks when the keyboard opens, in engines
  // that support this (WebKit 17+, which covers both the iOS shell and any
  // phone bought recently enough to run it). That is the actual fix for the
  // composer/keyboard geometry problem: `100dvh`, `100%`, `window.innerHeight`
  // all correctly report the space above the keyboard on their own, so there
  // is no separate "visible area" to compute and no page-scroll-to-reveal for
  // a fixed composer to fight. `--visual-vh` below still runs as a fallback
  // for anything that ignores this value, and is a no-op where it doesn't.
  interactiveWidget: "resizes-content",
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
      className="h-full antialiased"
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
                /*
                  The interface scale, before the first paint.

                  Same shape as the theme below it and for the same reason: a
                  value read after hydration means the app renders once at the
                  standard size and then jumps, which on a cold start is the
                  most visible thing on screen. Written as a custom property
                  because the root font size is derived from it in CSS — one
                  place decides what the number means.
                */
                var storedScale = Number(localStorage.getItem('nox:ui-scale'));
                var scaleLevel = Number.isInteger(storedScale) && storedScale >= 1 && storedScale <= 7
                  ? storedScale
                  : 4;
                var scaleSteps = { 1: 0.86, 2: 0.91, 3: 0.955, 4: 1, 5: 1.06, 6: 1.11, 7: 1.16 };
                document.documentElement.style.setProperty('--ui-scale', String(scaleSteps[scaleLevel]));
                document.documentElement.dataset.uiScale = String(scaleLevel);

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
