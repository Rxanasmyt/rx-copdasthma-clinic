// sw.js — Service Worker for Rx-COPD/Asthma Clinic
// HTML/navigation: network-first (always latest when online)
// CDN libs/icons: cache-first (immutable, versioned)

const CACHE_VERSION = 'rxcopd-v17';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // CDN dependencies
  'https://unpkg.com/react@18.3.1/umd/react.development.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js',
  'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js',
  'https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap',
];

// Install — precache app shell
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('SW cache failed for:', url, err))
        )
      )
    )
  );
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - Firebase/Firestore APIs: always network (don't cache live data)
// - HTML / navigation (the app itself): NETWORK-FIRST → always get the latest
//   deployed version when online; fall back to cache only when offline.
//   (กันปัญหาอุปกรณ์ติดโค้ดเก่า ไม่ต้อง unregister service worker เองอีก)
// - CDN libs + icons + manifest: cache-first (immutable / versioned)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Always network for Firebase/Firestore
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebase.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('googleapis.com') && url.pathname.includes('firestore')) {
    return; // let the browser handle normally
  }

  const isHTML =
    event.request.mode === 'navigate' ||
    event.request.destination === 'document' ||
    url.pathname === '/' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.html');

  if (isHTML) {
    // NETWORK-FIRST: ดึงเวอร์ชันล่าสุดเสมอเมื่อออนไลน์
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone).catch(() => {}));
        }
        return response;
      }).catch(() =>
        caches.match(event.request).then((c) => c || caches.match('./index.html'))
      )
    );
    return;
  }

  // CACHE-FIRST สำหรับ asset ที่ไม่เปลี่ยน (react/babel/fonts/icons)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone).catch(() => {}));
        return response;
      });
    })
  );
});
