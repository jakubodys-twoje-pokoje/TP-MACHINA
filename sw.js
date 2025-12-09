self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  
  const options = {
    body: data.body || 'Nowe powiadomienie w systemie',
    icon: 'https://cdn-icons-png.flaticon.com/512/2645/2645897.png', // Przykładowa ikona
    badge: 'https://cdn-icons-png.flaticon.com/512/2645/2645897.png',
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Machina Rezerwacji', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});