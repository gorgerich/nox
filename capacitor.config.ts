import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAPACITOR_SERVER_URL ?? 'https://noxchat.ru';

const config: CapacitorConfig = {
  appId: 'ru.nox.messenger',
  appName: 'Nox',
  webDir: 'public',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
    // Shown when the web layer cannot be reached at all. Without it WKWebView
    // falls back to WebKit's own English error sheet, which is the clearest
    // possible signal to the user that they are looking at a wrapper.
    errorPath: 'offline.html',
  },
};

export default config;
