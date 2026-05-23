const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;
const APP_DIR = __dirname;
const HTML_FILE = path.join(APP_DIR, 'app.html');

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

console.log(`Serving from: ${APP_DIR}`);
console.log(`HTML file: ${HTML_FILE}`);

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '') {
    fs.readFile(HTML_FILE, 'utf8', (err, data) => {
      if (err) {
        console.error('Error reading app.html:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Error: Cannot load app.html\n' + err.message);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`✓ Server ready at http://localhost:${PORT}/`);
  console.log(`✓ Also accessible at http://${localIP}:${PORT}/`);
  console.log(`✓ Press Ctrl+C to stop`);
});
