"use client";

import { useState, useEffect, useCallback } from "react";

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
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);

  const checkSupport = useCallback(async () => {
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

  const subscribe = async () => {
    if (!swRegistration) return;

    try {
      const permission = await Notification.requestPermission();
      setStatus(permission as PushStatus);
      
      if (permission !== "granted") return;

      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        console.error("VAPID public key missing");
        return;
      }

      const subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });

      setIsSubscribed(true);
    } catch (err) {
      console.error("Failed to subscribe to push", err);
    }
  };

  const unsubscribe = async () => {
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

  return { status, isSubscribed, subscribe, unsubscribe };
}
