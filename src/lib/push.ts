import webpush from "web-push";
import { getPrisma } from "./prisma";

if (process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "https://noxchat.ru",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  type: "message" | "call" | "request";
  chatId?: string;
  callId?: string;
  tag?: string;
};

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const prisma = getPrisma();
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId, disabledAt: null },
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      // Native Android devices register an FCM token instead of a web-push
      // subscription (kind="fcm", endpoint = token).
      if (sub.kind === "fcm") {
        const { sendFcmToToken } = await import("./fcm");
        const { ok, dead } = await sendFcmToToken(sub.endpoint, payload);
        if (dead) {
          await prisma.pushSubscription.update({
            where: { endpoint: sub.endpoint },
            data: { disabledAt: new Date() },
          });
        }
        if (!ok) throw new Error("FCM send failed");
        return;
      }

      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          JSON.stringify(payload)
        );
      } catch (err: unknown) {
        const error = err as { statusCode?: number };
        if (error.statusCode === 404 || error.statusCode === 410) {
          // Subscription has expired or is no longer valid
          await prisma.pushSubscription.update({
            where: { endpoint: sub.endpoint },
            data: { disabledAt: new Date() },
          });
        }
        throw err;
      }
    })
  );

  return results;
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  return Promise.allSettled(userIds.map((id) => sendPushToUser(id, payload)));
}
