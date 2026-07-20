"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";

// Native (Capacitor Android/iOS) push path. The plugin is only present in
// native builds; guarded dynamic import keeps the web bundle unaffected.
function isNativePush() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("PushNotifications");
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export type PushStatus = "unsupported" | "loading" | "granted" | "denied" | "default";

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);

  const fcmTokenRef = useRef<string | null>(null);

  const checkSupport = useCallback(async () => {
    if (isNativePush()) return true;
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return false;
    }
    return true;
  }, []);

  const syncStatus = useCallback(async (reg: ServiceWorkerRegistration) => {
    const subscription = await reg.pushManager.getSubscription();
    setIsSubscribed(!!subscription);
    setStatus(Notification.permission as PushStatus);
  }, []);

  useEffect(() => {
    let active = true;

    async function init() {
      if (isNativePush()) {
        // Native FCM: reflect current permission; token is (re)registered on
        // subscribe. Also wire notification-tap → in-app navigation.
        try {
          const { PushNotifications } = await import("@capacitor/push-notifications");
          const perm = await PushNotifications.checkPermissions();
          if (!active) return;
          setStatus(perm.receive === "granted" ? "granted" : perm.receive === "denied" ? "denied" : "default");
          setIsSubscribed(perm.receive === "granted");
          // Android 8+ requires channels; server targets these ids explicitly.
          await PushNotifications.createChannel({
            id: "messages",
            name: "Сообщения",
            importance: 4,
            visibility: 0,
          }).catch(() => undefined);
          await PushNotifications.createChannel({
            id: "calls",
            name: "Звонки",
            importance: 5,
            sound: "default",
            visibility: 1,
          }).catch(() => undefined);
          await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
            const url = action.notification?.data?.url;
            if (typeof url === "string" && url.startsWith("/")) {
              window.location.href = url;
            }
          });
        } catch (err) {
          console.error("Native push init failed", err);
          if (active) setStatus("unsupported");
        }
        return;
      }

      const supported = await checkSupport();
      if (!supported || !active) return;

      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        if (!active) return;
        setSwRegistration(reg);
        await syncStatus(reg);
      } catch (err) {
        console.error("SW registration failed", err);
        if (active) setStatus("unsupported");
      }
    }

    void init();
    return () => { active = false; };
  }, [checkSupport, syncStatus]);

  const subscribeNative = async () => {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== "granted") {
        setStatus("denied");
        setError("Уведомления запрещены. Разрешите их в настройках Android для приложения Nox.");
        return;
      }

      const token = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("FCM registration timeout")), 15_000);
        void PushNotifications.addListener("registration", (t) => {
          clearTimeout(timeout);
          resolve(t.value);
        });
        void PushNotifications.addListener("registrationError", (e) => {
          clearTimeout(timeout);
          reject(new Error(JSON.stringify(e)));
        });
        void PushNotifications.register();
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fcmToken: token }),
      });
      if (!res.ok) throw new Error(`subscribe endpoint ${res.status}`);

      fcmTokenRef.current = token;
      setStatus("granted");
      setIsSubscribed(true);
    } catch (err) {
      console.error("Native push subscribe failed", err);
      setError("Не удалось включить уведомления. Проверьте, что в сборке приложения настроен Firebase.");
    }
  };

  const subscribe = async () => {
    setError(null);

    if (isNativePush()) {
      await subscribeNative();
      return;
    }

    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      // Android System WebView without the native plugin: no push path at all.
      setStatus("unsupported");
      setError("Push-уведомления не поддерживаются в этой среде. Откройте сайт в браузере (Chrome) или установите как приложение с экрана «Домой».");
      return;
    }

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      setError("Сервер не настроен для push-уведомлений (нет ключа). Обратитесь к администратору.");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setStatus(permission as PushStatus);

      if (permission !== "granted") {
        setError(permission === "denied"
          ? "Уведомления заблокированы. Разрешите их в настройках браузера для этого сайта."
          : "Разрешение на уведомления не выдано.");
        return;
      }

      // Wait for the service worker to actually activate before subscribing —
      // on Android Chrome, subscribing against a freshly-registered (not yet
      // active) worker throws, which looked like the toggle "not working".
      const reg = swRegistration ?? (await navigator.serviceWorker.ready);
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
      if (!res.ok) throw new Error(`subscribe endpoint ${res.status}`);

      setIsSubscribed(true);
    } catch (err) {
      console.error("Failed to subscribe to push", err);
      setError("Не удалось включить уведомления. Попробуйте ещё раз.");
    }
  };

  const unsubscribe = async () => {
    if (isNativePush()) {
      try {
        if (fcmTokenRef.current) {
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: fcmTokenRef.current }),
          });
          fcmTokenRef.current = null;
        }
        const { PushNotifications } = await import("@capacitor/push-notifications");
        await PushNotifications.unregister();
        setIsSubscribed(false);
      } catch (err) {
        console.error("Native push unsubscribe failed", err);
      }
      return;
    }

    if (!swRegistration) return;

    try {
      const subscription = await swRegistration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setIsSubscribed(false);
    } catch (err) {
      console.error("Failed to unsubscribe from push", err);
    }
  };

  return { status, error, isSubscribed, subscribe, unsubscribe };
}
