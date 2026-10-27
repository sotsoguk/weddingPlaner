const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_DIR = path.join(__dirname, '..', 'exports', 'qrcodes');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const baseUrl = process.env.BASE_URL || 'https://hochzeit.bertundbine.de';

function loadGuests() {
  const jsonPath = path.join(DATA_DIR, 'guests.json');
  if (fs.existsSync(jsonPath)) {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  }
  return [];
}

async function run() {
  const guests = loadGuests();
  console.log(`Generiere ${guests.length} QR-Codes für Ziel-URL: ${baseUrl}/?code=...`);

  for (const guest of guests) {
    const url = `${baseUrl}/?code=${encodeURIComponent(guest.code)}`;
    const safeFilename = `${guest.code}_${guest.name.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_')}.png`;
    const dest = path.join(OUT_DIR, safeFilename);

    await QRCode.toFile(dest, url, {
      width: 600,
      margin: 2,
      color: {
        dark: '#2c2523',
        light: '#ffffff'
      }
    });

    console.log(` ✓ Erstellt: ${safeFilename} -> ${url}`);
  }

  console.log(`\nFertig! Alle QR-Codes wurden in ${OUT_DIR} gespeichert.`);
}

run().catch(console.error);
