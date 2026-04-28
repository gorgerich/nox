self.addEventListener('push', function (event) {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const isIncomingCall = data.type === 'incoming-call' || data.type === 'call';
    const title = isIncomingCall ? 'Входящий звонок' : (data.title || 'Новое уведомление');
    const url = isIncomingCall && data.callId
      ? `/calls/incoming?callId=${encodeURIComponent(data.callId)}`
      : (data.url || '/chats');
    const options = {
      body: data.body || '',
      icon: data.icon || '/favicon.ico',
      badge: data.badge || '/favicon.ico',
      tag: data.tag || 'nox-notification',
      requireInteraction: Boolean(isIncomingCall && 'requireInteraction' in Notification.prototype),
      data: {
        type: data.type,
        url,
        chatId: data.chatId,
        callId: data.callId,
        fromUserId: data.fromUserId
      }
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    console.error('Error handling push event:', err);
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const urlToOpen = new URL(event.notification.data.url || '/chats', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if ('focus' in client && new URL(client.url).origin === self.location.origin) {
          return client.focus().then(function (focusedClient) {
            if ('navigate' in focusedClient) {
              return focusedClient.navigate(urlToOpen);
            }
            return focusedClient;
          });
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
