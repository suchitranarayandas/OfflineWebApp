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

// Fetch event: handle both form submissions and QR code download requests
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' && event.request.method !== 'POST') {
    return;
  }

  console.log('[ServiceWorker] Fetch', event.request.url);

  // ✅ [MODIFIED] Handle failed POST requests (offline or server errors)
  if (event.request.method === 'POST') {
    const requestClone = event.request.clone();

    event.respondWith(
      fetch(event.request)
        .then(response => {
          // ✅ [ADDED] Save locally if response status is not OK
          if (!response.ok) {
            console.warn('[ServiceWorker] Server error, saving locally');
            return saveFormDataLocally(requestClone);
          }
          return response;
        })
        .catch(() => {
          // Network failure — save locally
          return saveFormDataLocally(requestClone);
        })
    );
  } else {
    if (event.request.url.includes('/download_qr')) {
      event.respondWith(
        fetch(event.request).then(response => {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clonedResponse);
          });
          return response;
        }).catch(() => {
          return caches.match(event.request);
        })
      );
    } else {
      event.respondWith(
        caches.match(event.request).then(response => {
          return response || fetch(event.request);
        })
      );
    }
  }
});

// Function to save form data locally in IndexedDB (using form_data.db)
async function saveFormDataLocally(request) {
  try {
    const formData = await request.clone().json();
    console.log('[ServiceWorker] Saving form data locally', formData);
    
    const db = await openIndexedDB();
    const tx = db.transaction('formData', 'readwrite');
    const store = tx.objectStore('formData');
    console.log('[ServiceWorker] Object store retrieved:', store);
    console.log(formData)
    store.put(formData);
    await tx.done;
    console.log('[ServiceWorker] Form data saved locally');
    
    return new Response(JSON.stringify({ message: 'Form data saved locally, will retry later' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[ServiceWorker] Error saving form data:', error);
    return new Response('Failed to save form data locally');
  }
}

// Open IndexedDB to store form data (using form_data.db)
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('form_data.db', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => {
      console.error('[ServiceWorker] IndexedDB error', event.target.error);
      reject('IndexedDB error');
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('formData')) {
        db.createObjectStore('formData', { keyPath: 'id', autoIncrement: true });
        console.log('[ServiceWorker] Object store "formData" created');
      }
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
      const deleteTx = db.transaction('formData', 'readwrite');
      deleteTx.store.delete(formData.id);
      await deleteTx.done;
    } catch (error) {
      console.error('Failed to send data', error);
    }
  });
}
