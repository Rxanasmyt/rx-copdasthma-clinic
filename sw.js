// sw.js — Service Worker for Rx-COPD/Asthma Clinic
// Caches app shell + assets for offline use (cache-first strategy)

const CACHE_VERSION = 'rxcopd-v3';
const APP_SHELL = [
  './',
  './COPD-Asthma Clinic.html',
  './manifest.json',
  './src/store.js',
  './src/Shared.jsx',
  './src/Settings.jsx',
  './src/ExportUtils.jsx',
  './src/PatientViews.jsx',
  './src/VisitForm.jsx',
  './src/TelepharmacyReports.jsx',
  './src/QuickSearch.jsx',
  './src/SOAPTemplates.jsx',
  './src/TrendCharts.jsx',
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
// - Same-origin app shell + CDN assets: cache-first, fall back to network
// - Other: network-first
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Always network for Firebase/Firestore
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebase.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com')) {
    return; // let the browser handle normally
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Only cache successful basic/cors responses
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_VERSION).then((cache) => {
          cache.put(event.request, clone).catch(() => {});
        });
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./COPD-Asthma Clinic.html');
        }
      });
    })
  );
});
