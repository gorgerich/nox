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
  tag?: string;
};

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const prisma = getPrisma();
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId, disabledAt: null },
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
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
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
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
