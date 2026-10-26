'use strict';

// Servidor de la vista previa. Se registra con ámbito vista/ y responde a
// vista/<id>/<ejercicio>/<ruta> como respondería Live Server con la carpeta
// del ejercicio abierta:
//   - los archivos editables, con el código que el alumno tiene en el editor
//     (el laboratorio los guarda en la caché CACHE antes de cada vista previa),
//   - el resto (imágenes, vídeo, subtítulos, páginas de solo lectura), desde
//     practicas/<id>/<ejercicio>/<ruta>, con peticiones Range para el vídeo,
//   - una página de error 404 si el archivo no existe, para que una ruta mal
//     escrita se vea rota igual que en un servidor real.
// vista/_diagnostico/<ruta> sirve el proyecto de diagnóstico de diag/.
// Subir VERSION en cada cambio: el navegador instala el service worker nuevo
// al detectar que el archivo ha cambiado
const VERSION = 1;
const CACHE = 'lmsgi-vista';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.registration.scope)) return;
  e.respondWith(responder(e.request));
});

function noEncontrado(ruta) {
  const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>404</title></head>'
    + '<body style="font-family: sans-serif; padding: 1em"><h1 style="font-size: 1.2em">Error 404: no se encuentra el archivo</h1>'
    + '<p><code>' + ruta.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;')) + '</code></p>'
    + '<p>Revisa la ruta del enlace: mayúsculas, tildes, espacios y carpetas.</p></body></html>';
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function responder(peticion) {
  const url = new URL(peticion.url);
  let ruta = decodeURIComponent(url.pathname.slice(new URL(self.registration.scope).pathname.length));
  if (ruta === '' || ruta.endsWith('/')) ruta += 'index.html';
  const clave = new URL(encodeURI(ruta), self.registration.scope).href;

  const guardado = await (await caches.open(CACHE)).match(clave);
  if (guardado) return guardado;

  const origen = ruta.startsWith('_diagnostico/')
    ? new URL('../diag/' + encodeURI(ruta.slice('_diagnostico/'.length)), self.registration.scope)
    : new URL('../practicas/' + encodeURI(ruta), self.registration.scope);
  const cabeceras = {};
  const rango = peticion.headers.get('range');
  if (rango) cabeceras.Range = rango;
  try {
    const r = await fetch(origen, { headers: cabeceras, cache: 'no-cache' });
    if (r.ok || r.status === 206) return r;
  } catch (e) {
    // sin red: se responde como archivo inexistente
  }
  return noEncontrado(ruta.split('/').slice(2).join('/') || ruta);
}
