document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('userForm');
    const qrContainer = document.getElementById('qrContainer');
    const qrImage = document.getElementById('qrImage');
    const downloadLink = document.getElementById('downloadLink');

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;

            const response = await fetch('/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email })
            });

            const result = await response.json();
            if (result.qr_path) {
                qrImage.src = result.qr_path;
                downloadLink.href = result.qr_path;
                qrContainer.style.display = 'block';
            }
        });
    }
});
