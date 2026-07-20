// Firebase Cloud Messaging sender for native Android push.
//
// Initialized from the FIREBASE_SERVICE_ACCOUNT env var — the full service
// account JSON (Firebase console → Project settings → Service accounts →
// Generate new private key). When the var is absent, sends are skipped
// gracefully so web push keeps working without any Firebase setup.

import type { App } from "firebase-admin/app";
import type { Message } from "firebase-admin/messaging";
import type { PushPayload } from "./push";

let cachedApp: App | null | undefined;

function getFirebaseApp(): App | null {
  if (cachedApp !== undefined) return cachedApp;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    cachedApp = null;
    return cachedApp;
  }

  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { initializeApp, cert, getApps } = require("firebase-admin/app") as typeof import("firebase-admin/app");
    /* eslint-enable @typescript-eslint/no-require-imports */
    const credentials = JSON.parse(raw);
    const existing = getApps();
    cachedApp = existing.length > 0 ? existing[0] : initializeApp({ credential: cert(credentials) });
  } catch (error) {
    console.error("[fcm] init failed", error);
    cachedApp = null;
  }
  return cachedApp;
}

export function isFcmConfigured() {
  return getFirebaseApp() !== null;
}

/**
 * Send one push to one FCM device token.
 * Returns { ok, dead } — dead=true means the token is permanently invalid
 * (uninstalled app / rotated token) and should be disabled in the DB.
 */
export async function sendFcmToToken(token: string, payload: PushPayload): Promise<{ ok: boolean; dead: boolean }> {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return { ok: false, dead: false };

  const message: Message = {
    token,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: {
      url: payload.url,
      type: payload.type,
      ...(payload.chatId ? { chatId: payload.chatId } : {}),
      ...(payload.callId ? { callId: payload.callId } : {}),
    },
    android: {
      priority: payload.type === "call" ? "high" : "normal",
      notification: {
        tag: payload.tag,
        channelId: payload.type === "call" ? "calls" : "messages",
        priority: payload.type === "call" ? "max" : "default",
      },
    },
  };

  try {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports */
    const { getMessaging } = require("firebase-admin/messaging") as typeof import("firebase-admin/messaging");
    await getMessaging(firebaseApp).send(message);
    return { ok: true, dead: false };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    const dead = code === "messaging/registration-token-not-registered"
      || code === "messaging/invalid-registration-token"
      || code === "messaging/invalid-argument";
    if (!dead) console.error("[fcm] send failed", code || err);
    return { ok: false, dead };
  }
}
