// Regresión del laboratorio web: abre cada práctica publicada en Chrome sin
// interfaz y comprueba, para cada ejercicio, que la vista previa muestra su
// página de inicio servida por el service worker, que la validación y las
// comprobaciones visibles se ejecutan y que "Copiar código" genera la entrega
// con las marcas de archivo y el informe del entorno. Comprueba además el
// aviso sin práctica, el de una práctica sin publicar y el laboratorio
// incrustado en una página de otro sitio, como en el cuestionario de Moodle.
//
// Uso: node pruebas/regresion.js [id...]   (por defecto, todas las prácticas)
// Requisitos: puppeteer-core y Google Chrome (variable CHROME si no está en
// la ruta habitual). Lo ejecuta GitHub Actions en cada push.
'use strict';
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const PUERTO = 8765;
const PUERTO_AULA = 8766;
const PREFIJO = '/lmsgi-ide-web/';
const BASE = 'http://localhost:' + PUERTO + PREFIJO;
const CHROME = process.env.CHROME || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');

const practicas = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(path.join(RAIZ, 'practicas')).filter((d) => fs.existsSync(path.join(RAIZ, 'practicas', d, 'practica.json')));

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8', '.mp3': 'audio/mpeg', '.xml': 'application/xml' };

// Como GitHub Pages, distingue mayúsculas de minúsculas aunque el disco
// (Windows) no lo haga: una ruta mal escrita tiene que dar 404
function existeExacto(fichero) {
  const relativa = path.relative(RAIZ, fichero).split(path.sep);
  let actual = RAIZ;
  for (const parte of relativa) {
    if (!fs.existsSync(actual) || !fs.readdirSync(actual).includes(parte)) return false;
    actual = path.join(actual, parte);
  }
  return true;
}

function servidor() {
  return http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (!url.startsWith(PREFIJO) || url.includes('..')) { res.writeHead(404); return res.end(); }
    url = url.slice(PREFIJO.length - 1);
    if (url.endsWith('/')) url += 'index.html';
    const fichero = path.join(RAIZ, url);
    fs.stat(fichero, (err, st) => {
      if (err || !st.isFile() || !existeExacto(fichero)) { res.writeHead(404); return res.end(); }
      const tipo = TIPOS[path.extname(fichero)] || 'application/octet-stream';
      const rango = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
      if (rango) {
        const ini = rango[1] === '' ? st.size - Number(rango[2]) : Number(rango[1]);
        const fin = rango[2] === '' || rango[1] === '' ? st.size - 1 : Math.min(Number(rango[2]), st.size - 1);
        res.writeHead(206, { 'Content-Type': tipo, 'Content-Range': `bytes ${ini}-${fin}/${st.size}`,
          'Content-Length': fin - ini + 1, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(fichero, { start: ini, end: fin }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(fichero).pipe(res);
      }
    });
  }).listen(PUERTO);
}

// Página de otro sitio (127.0.0.1 frente a localhost) que incrusta el
// laboratorio como el cuestionario de Moodle
function servidorAula() {
  return http.createServer((req, res) => {
    const id = new URL(req.url, 'http://x').searchParams.get('p') || '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Aula</title></head><body>'
      + '<iframe id="lab" src="' + BASE + '?p=' + encodeURIComponent(id) + '&diagnostico" style="width: 1300px; height: 760px"'
      + ' allowfullscreen></iframe></body></html>');
  }).listen(PUERTO_AULA, '127.0.0.1');
}

const fallos = [];
const comprobar = (id, prueba, ok, detalle) => {
  console.log((ok ? '  ok    ' : '  FALLO ') + prueba + (detalle ? ' | ' + detalle : ''));
  if (!ok) fallos.push(id + ': ' + prueba + (detalle ? ' (' + detalle + ')' : ''));
};

const LISTO = /^(Entorno listo|Modo diagnóstico|No se pudo|Esta práctica|Abre el laboratorio)/;

async function abrir(navegador, url) {
  const p = await navegador.newPage();
  await p.setViewport({ width: 1366, height: 768 });
  p.on('pageerror', (e) => console.log('  error de la página: ' + e.message));
  await p.goto(url);
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) { /* sin almacenamiento */ } });
  await p.reload();
  await p.waitForFunction((re) => new RegExp(re).test(document.getElementById('estado').textContent),
    { timeout: 60000 }, LISTO.source);
  return p;
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const emmetProbado = new Set();

async function probarPractica(navegador, id) {
  console.log('\n=== ' + id + ' ===');
  const manifiesto = JSON.parse(fs.readFileSync(path.join(RAIZ, 'practicas', id, 'practica.json'), 'utf8'));
  const p = await abrir(navegador, BASE + '?p=' + id);
  const estado = await p.$eval('#estado', (e) => e.textContent);
  comprobar(id, 'carga', estado.startsWith('Entorno listo'), estado);
  if (!estado.startsWith('Entorno listo')) { await p.close(); return; }
  const modo = await p.evaluate(() => estado.modoVista);
  comprobar(id, 'vista previa con service worker', modo === 'sw', modo);

  for (const ej of manifiesto.ejercicios) {
    const inicio = ej.carpeta + '/' + ej.inicio;
    await p.click(`.archivo[data-archivo="${inicio}"]`);
    await p.waitForFunction((c, i) => {
      const m = document.getElementById('marco-vista');
      return m.dataset.carpeta === c && document.getElementById('previa-ruta').textContent === c + '/' + i;
    }, { timeout: 15000 }, ej.carpeta, ej.inicio).catch(() => null);
    const ruta = await p.$eval('#previa-ruta', (e) => e.textContent);
    comprobar(id, ej.carpeta + ': la vista previa muestra ' + ej.inicio, ruta === inicio, ruta);
    const servida = await p.evaluate(() => {
      const d = document.getElementById('marco-vista').contentDocument;
      return d && d.contentType === 'text/html' && !/^404$/.test(d.title);
    });
    comprobar(id, ej.carpeta + ': la página de inicio se sirve', servida);
    const vistas = await p.evaluate(() => estado.metricas.vistas);
    await p.click('#btn-recargar');
    await pausa(1000);
    const recarga = await p.evaluate(() => ({ vistas: estado.metricas.vistas, ruta: document.getElementById('previa-ruta').textContent }));
    comprobar(id, ej.carpeta + ': el botón de recargar vuelve a cargar la vista previa',
      recarga.vistas > vistas && recarga.ruta === inicio, recarga.ruta);

    // Atajo de Emmet en el primer archivo HTML editable de la práctica
    const html = ej.archivos.find((a) => a.editable && /\.html?$/.test(a.nombre));
    if (html && !emmetProbado.has(id)) {
      emmetProbado.add(id);
      await p.click(`.archivo[data-archivo="${ej.carpeta + '/' + html.nombre}"]`);
      const original = await p.evaluate(() => editor.getValue());
      await p.evaluate(() => { editor.setValue('!'); editor.setCursor({ line: 0, ch: 1 }); editor.focus(); });
      await p.keyboard.press('Tab');
      const r = await p.evaluate(() => ({ texto: editor.getValue(), cursor: editor.getCursor() }));
      comprobar(id, ej.carpeta + ': ! + Tab genera el esqueleto de Emmet',
        r.texto.startsWith('<!DOCTYPE html>\n<html lang="en">') && r.texto.includes('<title>Document</title>')
          && r.cursor.line === 8 && r.cursor.ch === 4, JSON.stringify(r.cursor));
      await p.evaluate((t) => editor.setValue(t), original);
      await p.click(`.archivo[data-archivo="${inicio}"]`);
    }
    await pausa(1200);
    const problemas = await p.$eval('#contador-problemas', (e) => e.textContent);
    console.log('        problemas en la plantilla: ' + (problemas || 'ninguno'));

    if (ej.comprobaciones) {
      await p.click('#btn-comprobar');
      await p.waitForFunction(() => !document.getElementById('btn-comprobar').disabled
        && document.querySelectorAll('#lista-comprobaciones li').length > 0, { timeout: 60000 }).catch(() => null);
      const lista = JSON.parse(fs.readFileSync(path.join(RAIZ, 'practicas', id, ej.carpeta, ej.comprobaciones), 'utf8'));
      const n = await p.$$eval('#lista-comprobaciones li', (l) => l.length);
      const errores = await p.evaluate((c) => estado.comprobaciones[c].resultados
        .filter((r) => /no se pudo comprobar/.test(r.detalle)).map((r) => r.id + ': ' + r.detalle), ej.carpeta);
      comprobar(id, ej.carpeta + ': Comprobar evalúa las ' + lista.length + ' comprobaciones', n === lista.length && !errores.length,
        n + ' evaluadas' + (errores.length ? '; ' + errores.join(' / ') : ''));
    }

    await p.click('#btn-copiar-codigo');
    await pausa(500);
    const copiado = await p.evaluate(() => navigator.clipboard.readText());
    const editables = ej.archivos.filter((a) => a.editable).map((a) => ej.carpeta + '/' + a.nombre);
    comprobar(id, ej.carpeta + ': Copiar código genera las marcas y el informe',
      editables.every((e) => copiado.includes('===== Archivo: ' + e + ' =====')) && /<!-- Informe del entorno \(no borrar\): .*modo_vista=sw/.test(copiado),
      (copiado.match(/errores_validacion=([^|>]*)/) || ['', 'sin informe'])[1].trim());
  }
  await p.close();
}

async function probarIncrustado(navegador, id) {
  console.log('\n=== ' + id + ' incrustado en otro sitio ===');
  const p = await navegador.newPage();
  p.on('pageerror', (e) => console.log('  error de la página: ' + e.message));
  await p.goto('http://127.0.0.1:' + PUERTO_AULA + '/aula.html?p=' + id);
  // El iframe cambia de proceso al navegar a otro sitio: se espera al marco
  // definitivo en lugar de tomar el inicial
  const marco = await p.waitForFrame((f) => f.url().startsWith(BASE), { timeout: 30000 });
  // Con ?diagnostico el laboratorio prepara la vista previa aunque no haya práctica
  await marco.waitForFunction(() => /^(Entorno listo|Modo diagnóstico)/.test(document.getElementById('estado').textContent),
    { timeout: 60000 });
  const modo = await marco.evaluate(() => estado.modoVista + (estado.errorVista ? ' (' + estado.errorVista + ')' : ''));
  comprobar(id, 'incrustado: vista previa con service worker', modo === 'sw', modo);
  await marco.click('#btn-diagnostico');
  await marco.waitForFunction(() => /^Diagnóstico terminado/.test(document.getElementById('estado').textContent),
    { timeout: 90000 }).catch(() => null);
  const informe = await marco.evaluate(() => textoInforme());
  const malos = informe.split('\n').filter((l) => /=(fallo|aviso|pendiente)/.test(l) && !/^portapapeles=aviso/.test(l));
  comprobar(id, 'incrustado: diagnóstico completo', malos.length === 0, malos.join(' / '));
  await p.close();
}

(async () => {
  const srv = servidor();
  const aula = servidorAula();
  const navegador = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 600000,
    args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
  await navegador.defaultBrowserContext().overridePermissions('http://localhost:' + PUERTO,
    ['clipboard-read', 'clipboard-write']);
  try {
    console.log('=== raíz sin parámetro ===');
    const r = await abrir(navegador, BASE);
    const aviso = await r.$eval('#estado', (e) => e.textContent);
    comprobar('raíz', 'pide abrir el laboratorio desde el cuestionario', aviso.startsWith('Abre el laboratorio'), aviso);
    await r.close();
    const q = await abrir(navegador, BASE + '?p=zz-practica-no-publicada');
    const aviso2 = await q.$eval('#estado', (e) => e.textContent);
    comprobar('raíz', 'avisa de una práctica sin publicar', aviso2.includes('todavía no está disponible'), aviso2);
    await q.close();
    for (const id of practicas) await probarPractica(navegador, id);
    await probarIncrustado(navegador, practicas[0] || '');
  } finally {
    await navegador.close();
    srv.close();
    aula.close();
  }
  console.log('\n' + (fallos.length ? fallos.length + ' fallos:\n- ' + fallos.join('\n- ') : 'Regresión superada: '
    + practicas.length + ' práctica(s).'));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
