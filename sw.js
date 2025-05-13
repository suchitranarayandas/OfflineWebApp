const CACHE_NAME = 'app-cache-v1';
const FILES_TO_CACHE = [
  '/',
  '/form',
  '/upload_qr',
  '/static/style.css',
  '/favicon.ico',
];

// Install event: caching files
self.addEventListener('install', event => {
  console.log('[ServiceWorker] Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[ServiceWorker] Pre-caching offline files');
      return Promise.allSettled(
        FILES_TO_CACHE.map(file => cache.add(file))
      );
    })
  );
  self.skipWaiting();
});

// Activate event: cleanup old caches
self.addEventListener('activate', event => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    caches.keys().then(keyList =>
      Promise.all(
        keyList.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache', key);
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// Fetch event: handle all requests
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Handle POST requests (form submissions)
  if (req.method === 'POST' && url.pathname === '/submit') {
    event.respondWith(
      fetch(req).catch(async () => {
        const formData = await req.clone().json();
        const db = await openIndexedDB();
        const tx = db.transaction('formData', 'readwrite');
        tx.store.put(formData);
        await tx.done;

        return new Response(
          JSON.stringify({ status: 'offline', id: formData.id }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Handle QR download requests
  if (req.method === 'GET' && url.pathname.includes('/download_qr')) {
    event.respondWith(
      fetch(req).then(response => {
        const cloned = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(req, cloned);
        });
        return response;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Handle all other GET requests
  if (req.method === 'GET') {
    event.respondWith(
      caches.match(req).then(response => response || fetch(req))
    );
  }
});

// IndexedDB setup for storing form data offline
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('form_data.db', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('formData')) {
        db.createObjectStore('formData', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject('IndexedDB error');
  });
}

// Background sync event to retry failed submissions
self.addEventListener('sync', event => {
  if (event.tag === 'retryFormData') {
    event.waitUntil(retryFormData());
  }
});

async function retryFormData() {
  const db = await openIndexedDB();
  const tx = db.transaction('formData', 'readonly');
  const store = tx.objectStore('formData');
  const allData = await store.getAll();

  for (const formData of allData) {
    try {
      await fetch('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      // Remove successfully submitted form from IndexedDB
      const deleteTx = db.transaction('formData', 'readwrite');
      deleteTx.objectStore('formData').delete(formData.id);
      await deleteTx.done;
    } catch (error) {
      console.error('Retry failed:', error);
    }
  }
}
