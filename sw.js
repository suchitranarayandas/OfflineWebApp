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

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' && event.request.method !== 'POST') {
    // Bypass the service worker for non-GET or non-POST requests
    return;
  }

  console.log('[ServiceWorker] Fetch', event.request.url);

  // Handle failed POST requests when offline
  if (event.request.method === 'POST') {
    const requestClone = event.request.clone(); // Clone the request

    event.respondWith(
      fetch(event.request).catch(() => {
        return saveFormDataLocally(requestClone); // Use the clone if fetch fails
      })
    );
  } else { // This else is now properly paired with the first if statement
    // Handle GET requests: serve from cache or network
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request);
      })
    );
  }
});


// Function to save form data locally in IndexedDB (using form_data.db)
async function saveFormDataLocally(request) {
  const formData = await request.clone().json();
  const db = await openIndexedDB();
  const tx = db.transaction('formData', 'readwrite');
  tx.store.put(formData);
  await tx.done;
  return new Response('Form data saved locally, will retry later');
}

// Open IndexedDB to store form data (using form_data.db)
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('form_data.db', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject('IndexedDB error');
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('formData', { keyPath: 'id', autoIncrement: true });
    };
  });
}

// Listen for background sync and retry failed POST requests when online
self.addEventListener('sync', event => {
  if (event.tag === 'retryFormData') {
    event.waitUntil(retryFormData());
  }
});

// Retry the failed form submissions when the network is available
async function retryFormData() {
  const db = await openIndexedDB();
  const tx = db.transaction('formData', 'readonly');
  const formDataStore = tx.store;
  const formDataList = await formDataStore.getAll();

  formDataList.forEach(async (formData) => {
    try {
      await fetch('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      // If successful, remove data from IndexedDB
      const deleteTx = db.transaction('formData', 'readwrite');
      deleteTx.store.delete(formData.id);
      await deleteTx.done;
    } catch (error) {
      console.error('Failed to send data', error);
    }
  });
}

// Handle QR Code download: save it locally when offline
self.addEventListener('fetch', event => {
  if (event.request.url.includes('/download_qr') && event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).then(response => {
        // Cache the QR code image locally
        const clonedResponse = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clonedResponse);
        });
        return response;
      }).catch(() => {
        // If offline, serve the cached QR code if available
        return caches.match(event.request);
      })
    );
  }
});
