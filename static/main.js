// Function to save form data to IndexedDB when offline
async function saveToIndexedDB(data) {
  const db = await window.idb.openDB('form-db', 1, {
    upgrade(db) {
      db.createObjectStore('form-data', { keyPath: 'id' });
    }
  });
  await db.put('form-data', data);
}

// Handle form submission
document.getElementById('userForm').addEventListener('submit', async function(event) {
  event.preventDefault();

  const formData = {
    id: crypto.randomUUID(), // Generate a unique ID for offline storage
    name: document.getElementById('name').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    account_type: document.getElementById('accountType').value,
  };

  // If the user is online, submit the data to the server
  if (navigator.onLine) {
    try {
      const response = await fetch('/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (result.status === 'received') {
        generateQRCode(result.id);
        document.getElementById('qrSection').style.display = 'block';
      }
    } catch (error) {
      console.error('Error:', error);
    }
  } else {
    // If the user is offline, save data to IndexedDB and generate QR code
    console.log('Offline: saving form data to IndexedDB');
    await saveToIndexedDB(formData);

    // Generate QR code for offline form submission
    generateQRCode(formData.id);
    document.getElementById('qrSection').style.display = 'block';

    // Show a message to the user
    alert('You are offline! Your data has been saved locally and the QR code is ready for download.');
  }

  document.getElementById('userForm').reset(); // Clear the form after submission
});

// QR Code generation
function generateQRCode(formId) {
  const qrContainer = document.getElementById('qrCodeContainer');
  qrContainer.innerHTML = ''; // Clear any previous QR codes

  const qr = new QRCode(qrContainer, {
    text: formId,
    width: 200,
    height: 200,
  });

  // Setup download button
  document.getElementById('downloadQR').onclick = function () {
    const img = qrContainer.querySelector('img');
    if (img) {
      const link = document.createElement('a');
      link.href = img.src;
      link.download = 'form_qr_code.png';
      link.click();
    }
  };
}

// Register the service worker for offline functionality
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/static/sw.js')
            .then((registration) => {
                console.log('Service Worker registered with scope:', registration.scope);
            })
            .catch((error) => {
                console.error('Service Worker registration failed:', error);
            });
    });
}
