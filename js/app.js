'use strict';

const VERSION_INFORME = 'INFORME LABORATORIO WEB LMSGI v1';
const VERSION_ENTORNO = 'ENTORNO LABORATORIO WEB LMSGI v1';
const PARAMETROS = new URLSearchParams(location.search);
// El diagnóstico completo solo se muestra abriendo la página con ?diagnostico
const MODO_PROFESOR = PARAMETROS.has('diagnostico');
// La entrega por defecto es pegar el código en el cuestionario; la descarga
// en .zip (para una tarea sin SEB) solo se muestra con ?entrega=zip
const ENTREGA_ZIP = PARAMETROS.get('entrega') === 'zip';

// Cada práctica es una carpeta practicas/<id>/ con su manifiesto
// practica.json, y se elige con ?p=<id>. No hay práctica por defecto.
const ID_PRACTICA = PARAMETROS.get('p');
const RE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_CARPETA = /^[a-z0-9][a-z0-9_-]*$/;
const RE_RUTA = /^(?:[a-z0-9_-]+\/)*[a-z0-9_.-]+\.[a-z0-9]+$/;
const ESQUEMA_MAXIMO = 1;
const DIAGNOSTICO = '_diagnostico';
const CACHE_VISTA = 'lmsgi-vista';

const extension = (n) => (n.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
const TEXTO = new Set(['html', 'htm', 'css', 'xml', 'rss', 'svg', 'txt', 'vtt', 'js', 'json', 'md']);
const MODOS = { html: 'htmlmixed', htm: 'htmlmixed', css: 'css', xml: 'xml', rss: 'xml', svg: 'xml', js: 'javascript',
  json: { name: 'javascript', json: true } };
const MIME = { html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  xml: 'application/xml; charset=utf-8', rss: 'application/rss+xml; charset=utf-8', svg: 'image/svg+xml',
  js: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', vtt: 'text/vtt; charset=utf-8',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8' };
const esHtml = (n) => /\.html?$/i.test(n);

// Se rellenan a partir del manifiesto. La clave de cada archivo incluye la
// carpeta de su ejercicio; cada ejercicio es un proyecto web independiente
// con su propia vista previa.
let PRACTICA = null;
let CLAVE = null;
let NOMBRE_ENTREGA = null;
const ARCHIVOS = {};
const carpetaDe = (clave) => (clave && clave.includes('/') ? clave.split('/')[0] : null);
const relativaDe = (clave) => clave.split('/').slice(1).join('/');
const ejercicioDe = (carpeta) => PRACTICA.ejercicios.find((ej) => ej.carpeta === carpeta);
const editablesDe = (carpeta) => Object.keys(ARCHIVOS).filter((n) => carpetaDe(n) === carpeta && !ARCHIVOS[n].soloLectura);

const PRUEBAS = [
  ['carga', 'Carga del laboratorio'],
  ['incrustado', 'Página incrustada en otra (cuestionario)'],
  ['almacen', 'Almacenamiento local del código'],
  ['modo', 'Servidor de la vista previa'],
  ['pagina', 'Vista previa: carga una página'],
  ['css', 'Vista previa: aplica la hoja de estilos enlazada'],
  ['imagen', 'Vista previa: muestra una imagen'],
  ['enlace', 'Vista previa: enlace a otra página'],
  ['ruta404', 'Vista previa: una ruta que no existe da error 404'],
  ['video', 'Vista previa: vídeo y subtítulos'],
  ['valHtml', 'Validador de HTML'],
  ['valCss', 'Validador de CSS'],
  ['valXml', 'Validador de XML'],
  ['comprobaciones', 'Comprobaciones a varios anchos de pantalla'],
  ['portapapeles', 'Copiar al portapapeles'],
];

const estado = {
  plantillas: {},
  docs: {},
  activo: null,
  ocupado: false,
  listo: false,
  modoVista: null,
  errorVista: '',
  inicioPagina: performance.now(),
  problemas: {},
  marcas: [],
  comprobaciones: {},
  resultados: {},
  vista: { carpeta: null, pagina: null, pila: [], volviendo: false },
  // Métricas que viajan en la entrega sin intervención del alumno
  metricas: { carga: null, vistas: 0, comprobaciones: 0, ultimaComprobacion: 'sin comprobar' },
};

let editor;
let cronometro = null;

// ---------- utilidades ----------

const $ = (id) => document.getElementById(id);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function leerAlmacen(clave) {
  try { return localStorage.getItem(CLAVE + clave); } catch (e) { return null; }
}
function escribirAlmacen(clave, valor) {
  try { localStorage.setItem(CLAVE + clave, valor); } catch (e) { /* sin almacenamiento */ }
}

function setEstado(texto) { $('estado').textContent = texto; }

function iniciarCronometro() {
  const inicio = performance.now();
  $('cronometro').textContent = '';
  cronometro = setInterval(() => {
    $('cronometro').textContent = ((performance.now() - inicio) / 1000).toFixed(0) + ' s';
  }, 500);
}
function pararCronometro() {
  clearInterval(cronometro);
  $('cronometro').textContent = '';
}

function mostrarPanel(nombre) {
  document.querySelectorAll('.pestana').forEach((p) => p.classList.toggle('activa', p.dataset.panel === nombre));
  document.querySelectorAll('.contenido-panel').forEach((c) => c.classList.toggle('activo', c.id === 'panel-' + nombre));
}

// Ejercicio de trabajo: el del archivo abierto o, con el README abierto, el
// que se ve en la vista previa
const carpetaActiva = () => carpetaDe(estado.activo) || estado.vista.carpeta;

function actualizarBotones() {
  const carpeta = carpetaActiva();
  const ej = carpeta && PRACTICA ? ejercicioDe(carpeta) : null;
  $('btn-vista').disabled = !estado.listo || !ej;
  $('btn-comprobar').disabled = estado.ocupado || !estado.listo || !ej || !ej.comprobaciones;
  $('btn-comprobar').title = ej && ej.comprobaciones
    ? 'Comprobar los requisitos de ' + carpeta
    : 'Este ejercicio no tiene comprobaciones automáticas';
  $('btn-copiar-codigo').disabled = !ej;
  $('btn-copiar-codigo').title = ej
    ? 'Copiar el código de ' + carpeta + ' para pegarlo en el cuestionario'
    : 'Abre un archivo de un ejercicio para copiar su código';
  $('btn-diagnostico').disabled = estado.ocupado;
}

async function conBloqueo(fn) {
  if (estado.ocupado) return;
  estado.ocupado = true;
  actualizarBotones();
  iniciarCronometro();
  try {
    await fn();
  } catch (e) {
    setEstado('Error inesperado: ' + e);
    console.error(e);
  } finally {
    pararCronometro();
    estado.ocupado = false;
    actualizarBotones();
  }
}

// ---------- práctica ----------

// El motor acepta todos los esquemas hasta ESQUEMA_MAXIMO: una práctica ya
// publicada no se modifica, así que su manifiesto tiene que seguir siendo
// válido con las versiones posteriores del motor.
function validarManifiesto(m) {
  const fallo = (motivo) => { throw new Error('manifiesto no válido: ' + motivo); };
  if (!m || !Number.isInteger(m.esquema)) fallo('falta el número de esquema');
  if (m.esquema > ESQUEMA_MAXIMO) fallo('el esquema ' + m.esquema + ' necesita una versión más reciente del laboratorio');
  if (m.id !== ID_PRACTICA) fallo('el identificador no coincide con la carpeta');
  if (!Number.isInteger(m.version) || m.version < 1) fallo('versión no válida');
  if (!Array.isArray(m.ejercicios) || !m.ejercicios.length) fallo('no hay ejercicios');
  m.ejercicios.forEach((ej) => {
    if (!RE_CARPETA.test(ej.carpeta || '')) fallo('carpeta de ejercicio no válida: ' + ej.carpeta);
    if (!Array.isArray(ej.archivos) || !ej.archivos.length) fallo(ej.carpeta + ' no tiene archivos');
    ej.archivos.forEach((a) => {
      if (!RE_RUTA.test(a.nombre || '')) fallo('archivo no válido: ' + a.nombre);
      if (a.editable && !TEXTO.has(extension(a.nombre))) fallo('solo un archivo de texto puede ser editable: ' + a.nombre);
    });
    if (!esHtml(ej.inicio || '') || !ej.archivos.some((a) => a.nombre === ej.inicio)) fallo(ej.carpeta + ' no contiene su página de inicio');
    if (ej.comprobaciones && !/^[a-z0-9_-]+\.json$/.test(ej.comprobaciones)) fallo('archivo de comprobaciones no válido en ' + ej.carpeta);
  });
  return m;
}

async function cargarPractica() {
  if (!RE_ID.test(ID_PRACTICA || '')) throw Object.assign(new Error('falta la práctica'), { sinPractica: true });
  const base = 'practicas/' + ID_PRACTICA + '/';
  const r = await fetch(base + 'practica.json', { cache: 'no-cache' });
  // Un 404 es lo normal si el cuestionario se abre antes de publicar la
  // práctica: el iframe ya apunta a su URL definitiva
  if (r.status === 404) throw Object.assign(new Error('práctica no publicada'), { noPublicada: true });
  if (!r.ok) throw new Error('el servidor respondió ' + r.status);
  PRACTICA = validarManifiesto(await r.json());
  // Prefijo propio por práctica y versión: dos prácticas nunca comparten
  // el código guardado, y una versión nueva no muestra la plantilla antigua
  CLAVE = PRACTICA.id + ':v' + PRACTICA.version + ':';
  NOMBRE_ENTREGA = 'entrega_' + PRACTICA.proyecto.replace(/-/g, '_') + '.zip';
  PRACTICA.ejercicios.forEach((ej) => ej.archivos.forEach((a) => {
    const ext = extension(a.nombre);
    ARCHIVOS[ej.carpeta + '/' + a.nombre] = {
      ruta: base + ej.carpeta + '/' + a.nombre,
      soloLectura: !a.editable,
      texto: TEXTO.has(ext),
      modo: MODOS[ext] || 'text/plain',
    };
  }));
  if (PRACTICA.readme) {
    ARCHIVOS[PRACTICA.readme] = { ruta: base + PRACTICA.readme, soloLectura: true, texto: true, modo: 'text/plain' };
  }
  estado.activo = PRACTICA.readme || Object.keys(ARCHIVOS)[0];
  document.title = 'Laboratorio web LMSGI · ' + PRACTICA.titulo;
  document.querySelector('.subtitulo').textContent = PRACTICA.titulo;
}

// Árbol como el explorador de Visual Studio Code: carpetas primero y en
// orden alfabético, después los archivos
function construirExplorador() {
  const arbol = document.querySelector('.arbol');
  arbol.innerHTML = '';
  const raiz = { carpetas: {}, archivos: [] };
  Object.keys(ARCHIVOS).forEach((clave) => {
    const partes = clave.split('/');
    let nodo = raiz;
    partes.slice(0, -1).forEach((p) => {
      nodo.carpetas[p] = nodo.carpetas[p] || { carpetas: {}, archivos: [] };
      nodo = nodo.carpetas[p];
    });
    nodo.archivos.push(clave);
  });
  const sangria = (nivel) => (8 + nivel * 14) + 'px';
  const carpeta = (texto, nivel, clase) => {
    const li = document.createElement('li');
    li.className = 'nodo-carpeta' + (clase ? ' ' + clase : '');
    li.style.paddingLeft = sangria(nivel);
    li.textContent = texto;
    arbol.appendChild(li);
  };
  const archivo = (clave, nivel) => {
    const datos = ARCHIVOS[clave];
    const boton = document.createElement('button');
    boton.className = 'archivo' + (datos.texto ? '' : ' recurso');
    boton.dataset.archivo = clave;
    boton.style.paddingLeft = sangria(nivel + 1);
    boton.textContent = clave.split('/').pop();
    if (datos.texto && datos.soloLectura) {
      const marca = document.createElement('span');
      marca.className = 'solo-lectura';
      marca.textContent = '(solo lectura)';
      boton.append(' ', marca);
    }
    boton.addEventListener('click', () => abrirArchivo(clave));
    const li = document.createElement('li');
    li.appendChild(boton);
    arbol.appendChild(li);
  };
  const pintar = (nodo, nivel) => {
    Object.keys(nodo.carpetas).sort().forEach((nombre) => {
      carpeta(nombre, nivel);
      pintar(nodo.carpetas[nombre], nivel + 1);
    });
    nodo.archivos.sort().forEach((clave) => archivo(clave, nivel));
  };
  carpeta(PRACTICA.proyecto, 0, 'nodo-proyecto');
  pintar(raiz, 1);
}

// ---------- editor ----------

async function cargarFuentes() {
  const nombres = Object.keys(ARCHIVOS).filter((n) => ARCHIVOS[n].texto);
  const textos = await Promise.all(nombres.map((n) => fetch(ARCHIVOS[n].ruta).then((r) => {
    if (!r.ok) throw new Error(n + ': ' + r.status);
    return r.text();
  })));
  nombres.forEach((n, i) => { estado.plantillas[n] = textos[i]; });
}

function crearEditor() {
  Object.keys(ARCHIVOS).filter((n) => ARCHIVOS[n].texto).forEach((n) => {
    const guardado = ARCHIVOS[n].soloLectura ? null : leerAlmacen('archivo:' + n);
    estado.docs[n] = CodeMirror.Doc(guardado !== null ? guardado : estado.plantillas[n], ARCHIVOS[n].modo);
  });
  const ultimo = leerAlmacen('activo');
  if (ultimo && ARCHIVOS[ultimo]) estado.activo = ultimo;
  editor = CodeMirror($('contenedor-editor'), {
    value: '',
    theme: 'default',
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    autoCloseTags: true,
    matchTags: { bothTags: true },
    matchBrackets: true,
    autoCloseBrackets: true,
    styleActiveLine: true,
    lineWrapping: false,
    gutters: ['marcas', 'CodeMirror-linenumbers'],
    extraKeys: {
      Tab: (cm) => {
        if (expandirEmmet(cm)) return;
        if (cm.somethingSelected()) cm.indentSelection('add');
        else cm.replaceSelection('    ');
      },
      'Shift-Tab': (cm) => cm.indentSelection('subtract'),
      'Ctrl-/': (cm) => cm.toggleComment(),
    },
  });
  editor.on('change', () => {
    const clave = estado.activo;
    if (!ARCHIVOS[clave] || ARCHIVOS[clave].soloLectura) return;
    escribirAlmacen('archivo:' + clave, editor.getValue());
    programarRevision(clave);
  });
}

// Atajo de Emmet de Visual Studio Code: "!" (o "html:5") seguido de Tab en un
// archivo HTML genera el esqueleto del documento. Se reproduce tal cual, con
// lang="en" y el título "Document": revisarlo es parte del ejercicio.
const ESQUELETO_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '    <meta charset="UTF-8">',
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '    <title>Document</title>',
  '</head>',
  '<body>',
  '    ',
  '</body>',
  '</html>',
];

function expandirEmmet(cm) {
  if (cm.somethingSelected() || cm.getOption('readOnly') || cm.getOption('mode') !== 'htmlmixed') return false;
  const cursor = cm.getCursor();
  const linea = cm.getLine(cursor.line);
  const m = linea.slice(0, cursor.ch).match(/^(\s*)(!|html:5)$/);
  if (!m || linea.slice(cursor.ch).trim()) return false;
  const sangria = m[1];
  cm.replaceRange(ESQUELETO_HTML.map((l, i) => (i ? sangria : '') + l).join('\n'),
    { line: cursor.line, ch: sangria.length }, { line: cursor.line, ch: linea.length });
  cm.setCursor({ line: cursor.line + 8, ch: sangria.length + 4 });
  return true;
}

function abrirArchivo(clave) {
  if (!ARCHIVOS[clave]) return;
  const anterior = carpetaActiva();
  estado.activo = clave;
  escribirAlmacen('activo', clave);
  const datos = ARCHIVOS[clave];
  $('pestana-editor').textContent = clave + (datos.texto && datos.soloLectura ? ' (solo lectura)' : '');
  document.querySelectorAll('.archivo').forEach((b) => b.classList.toggle('activo', b.dataset.archivo === clave));
  if (datos.texto) {
    $('visor-binario').hidden = true;
    editor.swapDoc(estado.docs[clave]);
    editor.setOption('mode', datos.modo);
    editor.setOption('readOnly', datos.soloLectura);
    editor.refresh();
    editor.focus();
  } else {
    mostrarBinario(clave);
  }
  const carpeta = carpetaDe(clave);
  if (carpeta) {
    // Al abrir una página, la vista previa la muestra, como al abrirla con
    // Live Server; con otro archivo se queda en la página que se estaba viendo
    if (esHtml(clave)) mostrarEnVista(carpeta, relativaDe(clave));
    else if (carpeta !== estado.vista.carpeta) mostrarEnVista(carpeta, ejercicioDe(carpeta).inicio);
    if (carpeta !== anterior) {
      revisarEjercicio(carpeta);
      pintarComprobaciones();
    }
  }
  actualizarBotones();
}

function mostrarBinario(clave) {
  const visor = $('visor-binario');
  visor.innerHTML = '';
  const ext = extension(clave);
  const url = ARCHIVOS[clave].ruta;
  let medio = null;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'ico', 'avif'].includes(ext)) {
    medio = document.createElement('img');
    medio.alt = clave;
    medio.addEventListener('load', () => {
      dato.textContent = 'Imagen de ' + medio.naturalWidth + ' x ' + medio.naturalHeight + ' píxeles (ancho x alto).';
    });
  } else if (['mp4', 'webm', 'ogv'].includes(ext)) {
    medio = document.createElement('video');
    medio.controls = true;
    medio.addEventListener('loadedmetadata', () => {
      dato.textContent = 'Vídeo de ' + medio.videoWidth + ' x ' + medio.videoHeight + ' píxeles, '
        + medio.duration.toFixed(0) + ' s.';
    });
  } else if (['mp3', 'ogg', 'oga', 'wav'].includes(ext)) {
    medio = document.createElement('audio');
    medio.controls = true;
  }
  const dato = document.createElement('p');
  dato.textContent = medio ? '' : 'Archivo binario: no se puede abrir en el editor.';
  if (medio) {
    medio.src = url;
    visor.appendChild(medio);
  }
  visor.appendChild(dato);
  const nota = document.createElement('p');
  nota.textContent = 'Ruta desde la carpeta del ejercicio: ' + relativaDe(clave);
  visor.appendChild(nota);
  visor.hidden = false;
}

async function textoArchivo(clave) {
  if (estado.docs[clave]) return estado.docs[clave].getValue();
  return null;
}

// ---------- vista previa ----------

const urlVista = (carpeta, relativa) => new URL(carpeta === DIAGNOSTICO
  ? 'vista/' + DIAGNOSTICO + '/' + encodeURI(relativa)
  : 'vista/' + ID_PRACTICA + '/' + carpeta + '/' + encodeURI(relativa), location.href).href;
const baseRecursos = (carpeta) => new URL(carpeta === DIAGNOSTICO
  ? 'diag/' : 'practicas/' + ID_PRACTICA + '/' + carpeta + '/', location.href).href;

// Copia el código de los archivos editables del ejercicio a la caché que
// sirve el service worker
async function sincronizar(carpeta) {
  if (estado.modoVista !== 'sw' || carpeta === DIAGNOSTICO) return;
  const cache = await caches.open(CACHE_VISTA);
  await Promise.all(editablesDe(carpeta).map((clave) => cache.put(urlVista(carpeta, relativaDe(clave)),
    new Response(estado.docs[clave].getValue(), { headers: { 'Content-Type': MIME[extension(clave)] || 'text/plain' } }))));
}

// El service worker solo controla el marco si el navegador lo admite en un
// iframe incrustado en otra web: se registra y se prueba con el proyecto de
// diagnóstico. Si falla, la vista previa usa srcdoc (ver documentoSrcdoc).
async function prepararVista() {
  // ?vista=srcdoc fuerza el modo alternativo para probarlo
  if (PARAMETROS.get('vista') === 'srcdoc') {
    estado.errorVista = 'forzado con ?vista=srcdoc';
    return 'srcdoc';
  }
  if (!('serviceWorker' in navigator) || !window.caches) {
    estado.errorVista = 'el navegador no admite service workers';
    return 'srcdoc';
  }
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './vista/' });
    if (!reg.active) {
      const sw = reg.installing || reg.waiting;
      await new Promise((resolver, rechazar) => {
        const t = setTimeout(() => rechazar(new Error('el service worker no se activa')), 15000);
        sw.addEventListener('statechange', () => {
          if (sw.state === 'activated') { clearTimeout(t); resolver(); }
          if (sw.state === 'redundant') { clearTimeout(t); rechazar(new Error('el service worker no se instala')); }
        });
      });
    }
    await caches.open(CACHE_VISTA);
    const marco = $('marco-comprobaciones');
    await cargarEnMarco(marco, urlVista(DIAGNOSTICO, 'index.html'));
    if (marco.contentDocument && marco.contentDocument.title === 'Diagnóstico') return 'sw';
    estado.errorVista = 'el service worker no sirve la vista previa';
  } catch (e) {
    estado.errorVista = e.message;
  }
  return 'srcdoc';
}

function cargarEnMarco(marco, url, { srcdoc = null, reemplazar = false } = {}) {
  return new Promise((resolver) => {
    const fin = () => { clearTimeout(t); marco.removeEventListener('load', fin); resolver(); };
    const t = setTimeout(fin, 10000);
    marco.addEventListener('load', fin);
    if (srcdoc !== null) {
      marco.removeAttribute('src');
      marco.srcdoc = srcdoc;
    } else {
      marco.removeAttribute('srcdoc');
      const destino = url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now();
      if (reemplazar && marco.contentWindow && marco.getAttribute('src')) {
        try { marco.contentWindow.location.replace(destino); return; } catch (e) { /* otro origen */ }
      }
      marco.src = destino;
    }
  });
}

// Modo sin service worker: la página se dibuja con srcdoc y un <base> que
// apunta a la carpeta de la práctica en el servidor. Las hojas de estilo
// editables se sustituyen por su contenido actual. Es menos fiel (los
// enlaces entre páginas se interceptan), así que el diagnóstico lo señala.
async function documentoSrcdoc(carpeta, pagina) {
  const clave = carpeta + '/' + pagina;
  let texto = await textoArchivo(clave);
  if (texto === null) {
    const r = await fetch(baseRecursos(carpeta) + encodeURI(pagina));
    if (!r.ok) {
      return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>404</title></head><body>'
        + '<h1>Error 404: no se encuentra el archivo</h1><p>' + pagina.replace(/</g, '&lt;') + '</p></body></html>';
    }
    texto = await r.text();
  }
  const base = new URL(encodeURI(pagina), baseRecursos(carpeta));
  const doc = new DOMParser().parseFromString(texto, 'text/html');
  for (const link of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const url = new URL(link.getAttribute('href'), base);
    if (!url.href.startsWith(baseRecursos(carpeta))) continue;
    const hoja = carpeta + '/' + decodeURI(url.href.slice(baseRecursos(carpeta).length));
    if (!estado.docs[hoja]) continue;
    const css = estado.docs[hoja].getValue()
      .replace(/url\(\s*(['"]?)(?![a-z]+:|\/)([^'")]+)\1\s*\)/gi, (m, q, ruta) => 'url("' + new URL(ruta, url).href + '")');
    link.setAttribute('data-href', link.getAttribute('href'));
    link.setAttribute('href', URL.createObjectURL(new Blob([css], { type: 'text/css' })));
  }
  const etiquetaBase = doc.createElement('base');
  etiquetaBase.href = base.href;
  doc.head.prepend(etiquetaBase);
  // Todos los nodos del documento, no solo <html>: el tipo de documento y los
  // comentarios que haya antes o después también cuentan
  return Array.from(doc.childNodes).map((n) => {
    if (n.nodeType === Node.DOCUMENT_TYPE_NODE) return new XMLSerializer().serializeToString(n);
    if (n.nodeType === Node.COMMENT_NODE) return '<!--' + n.data + '-->';
    return n.outerHTML || '';
  }).join('\n');
}

// Carga una página de un ejercicio en un marco, con el modo de vista activo
async function cargarPagina(marco, carpeta, pagina, opciones = {}) {
  await sincronizar(carpeta);
  marco.dataset.carpeta = carpeta;
  marco.dataset.pagina = pagina;
  if (estado.modoVista === 'sw') {
    await cargarEnMarco(marco, urlVista(carpeta, pagina), opciones);
  } else {
    await cargarEnMarco(marco, null, { srcdoc: await documentoSrcdoc(carpeta, pagina) });
  }
}

// Página del marco relativa a la carpeta del ejercicio
function paginaDelMarco(marco) {
  if (estado.modoVista !== 'sw') return marco.dataset.pagina || null;
  try {
    const ruta = decodeURIComponent(marco.contentWindow.location.pathname);
    const prefijo = new URL(urlVista(marco.dataset.carpeta, '')).pathname;
    return ruta.startsWith(decodeURIComponent(prefijo)) ? ruta.slice(decodeURIComponent(prefijo).length) : null;
  } catch (e) {
    return null;
  }
}

let temporizadorVista = null;
function mostrarEnVista(carpeta, pagina) {
  estado.vista.carpeta = carpeta;
  estado.vista.pagina = pagina;
  clearTimeout(temporizadorVista);
  temporizadorVista = setTimeout(() => actualizarVista(), 50);
}

async function actualizarVista({ volviendo = false } = {}) {
  const { carpeta } = estado.vista;
  if (!carpeta || !estado.modoVista) return;
  const marco = $('marco-vista');
  let scroll = 0;
  const mismaPagina = marco.dataset.carpeta === carpeta && paginaDelMarco(marco) === estado.vista.pagina;
  try { if (mismaPagina) scroll = marco.contentWindow.scrollY; } catch (e) { /* otro origen */ }
  estado.vista.volviendo = volviendo;
  await cargarPagina(marco, carpeta, estado.vista.pagina, { reemplazar: true });
  try { if (scroll) marco.contentWindow.scrollTo(0, scroll); } catch (e) { /* otro origen */ }
  estado.metricas.vistas++;
}

// Tras cada carga del marco visible: ruta, historial y enlaces que no deben
// salir del laboratorio
function alCargarVista() {
  const marco = $('marco-vista');
  const carpeta = marco.dataset.carpeta;
  if (!carpeta) return;
  const pagina = paginaDelMarco(marco);
  $('previa-ruta').textContent = pagina ? carpeta + '/' + pagina : 'página externa';
  if (pagina) {
    const pila = estado.vista.pila;
    if (!estado.vista.volviendo && pila[pila.length - 1] !== pagina) pila.push(pagina);
    estado.vista.volviendo = false;
    estado.vista.pagina = pagina;
  }
  $('btn-atras').disabled = estado.vista.pila.length < 2;
  let doc;
  try { doc = marco.contentDocument; } catch (e) { return; }
  if (!doc) return;
  doc.addEventListener('click', (ev) => {
    const a = ev.target.closest && ev.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href').trim();
    if (/^(mailto|tel):/i.test(href)) {
      ev.preventDefault();
      setEstado('El enlace abriría el programa de correo o de llamadas: ' + href);
      return;
    }
    const destino = new URL(href, doc.baseURI);
    const dentro = estado.modoVista === 'sw'
      ? destino.href.startsWith(urlVista(carpeta, ''))
      : destino.href.startsWith(baseRecursos(carpeta));
    if (a.target === '_blank') {
      ev.preventDefault();
      setEstado('El enlace se abriría en una pestaña nueva (' + destino.href + '). En el laboratorio no se abren pestañas.');
      return;
    }
    if (!dentro) {
      ev.preventDefault();
      setEstado('El enlace lleva a otra web (' + destino.href + '). En el laboratorio no se abren webs externas.');
      return;
    }
    if (estado.modoVista !== 'sw') {
      // Sin service worker: el marco no puede navegar solo
      ev.preventDefault();
      if (href.startsWith('#')) {
        const objetivo = doc.getElementById(decodeURIComponent(href.slice(1)));
        if (objetivo) objetivo.scrollIntoView();
        return;
      }
      const relativa = decodeURI(destino.href.slice(baseRecursos(carpeta).length).split('#')[0]);
      mostrarEnVista(carpeta, relativa || ejercicioDe(carpeta).inicio);
    }
  });
  doc.addEventListener('submit', (ev) => {
    if (estado.modoVista === 'sw') return;
    ev.preventDefault();
    setEstado('El formulario se enviaría a ' + (ev.target.getAttribute('action') || 'la misma página') + '.');
  });
}

function volverVista() {
  const pila = estado.vista.pila;
  if (pila.length < 2) return;
  pila.pop();
  estado.vista.pagina = pila[pila.length - 1];
  actualizarVista({ volviendo: true });
}

// Ancho de la ventana simulada: con un ancho fijo, la página se dibuja a ese
// ancho y se reduce para caber en el panel
function aplicarAncho() {
  const lienzo = $('previa-lienzo');
  const marco = $('marco-vista');
  const ancho = Number($('previa-ancho').value);
  lienzo.classList.toggle('con-ancho', ancho > 0);
  if (!ancho) {
    marco.style.width = '';
    marco.style.height = '';
    marco.style.transform = '';
    return;
  }
  const escala = Math.min(1, lienzo.clientWidth / ancho);
  marco.style.width = ancho + 'px';
  marco.style.height = (lienzo.clientHeight / escala) + 'px';
  marco.style.transform = escala < 1 ? 'scale(' + escala + ')' : '';
}

// ---------- problemas ----------

let temporizadorRevision = null;
function programarRevision(clave) {
  clearTimeout(temporizadorRevision);
  temporizadorRevision = setTimeout(async () => {
    await revisarArchivo(clave);
    pintarProblemas();
    if (carpetaDe(clave) === estado.vista.carpeta) actualizarVista();
  }, 700);
}

async function revisarArchivo(clave) {
  const nombre = relativaDe(clave);
  if (!Validacion.lenguaje(nombre)) return;
  try {
    estado.problemas[clave] = await Validacion.validar(nombre, estado.docs[clave].getValue());
  } catch (e) {
    estado.problemas[clave] = [{ linea: 1, columna: 1, tipo: 'aviso', mensaje: 'No se pudo validar: ' + e.message }];
  }
}

async function revisarEjercicio(carpeta) {
  await Promise.all(editablesDe(carpeta).map(revisarArchivo));
  pintarProblemas();
}

function limpiarMarcas() {
  estado.marcas.forEach(({ doc, linea, clase }) => {
    doc.removeLineClass(linea, 'background', clase);
    doc.setGutterMarker(linea, 'marcas', null);
  });
  estado.marcas = [];
}

function pintarProblemas() {
  limpiarMarcas();
  const carpeta = carpetaActiva();
  const cuerpo = $('lista-problemas');
  cuerpo.innerHTML = '';
  const lista = [];
  (carpeta ? editablesDe(carpeta) : []).forEach((clave) => (estado.problemas[clave] || [])
    .forEach((p) => lista.push(Object.assign({ clave }, p))));
  lista.sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'error' ? -1 : 1) || a.clave.localeCompare(b.clave) || a.linea - b.linea);
  const errores = lista.filter((p) => p.tipo === 'error').length;
  $('contador-problemas').textContent = lista.length ? '(' + lista.length + ')' : '';
  $('sin-problemas').hidden = lista.length > 0;
  document.querySelectorAll('.archivo').forEach((b) => b.classList.toggle('con-errores',
    (estado.problemas[b.dataset.archivo] || []).some((p) => p.tipo === 'error')));
  lista.forEach((p) => {
    const fila = document.createElement('tr');
    const desc = document.createElement('td');
    desc.className = 'tipo-' + p.tipo;
    desc.textContent = p.mensaje;
    const rec = document.createElement('td');
    rec.textContent = p.clave;
    const lin = document.createElement('td');
    lin.textContent = 'línea ' + p.linea;
    fila.append(desc, rec, lin);
    fila.addEventListener('click', () => irALinea(p.clave, p.linea, p.columna));
    cuerpo.appendChild(fila);

    const doc = estado.docs[p.clave];
    const linea = Math.min(p.linea, doc.lineCount()) - 1;
    const clase = p.tipo === 'error' ? 'linea-error' : 'linea-aviso';
    doc.addLineClass(linea, 'background', clase);
    const marca = document.createElement('span');
    marca.className = p.tipo === 'error' ? 'marca-error' : 'marca-aviso';
    marca.textContent = p.tipo === 'error' ? 'x' : '!';
    marca.title = p.mensaje;
    doc.setGutterMarker(linea, 'marcas', marca);
    estado.marcas.push({ doc, linea, clase });
  });
  return errores;
}

function irALinea(clave, linea, columna) {
  if (!estado.docs[clave]) return;
  abrirArchivo(clave);
  editor.setCursor({ line: linea - 1, ch: Math.max(0, (columna || 1) - 1) });
  editor.scrollIntoView({ line: linea - 1, ch: 0 }, 80);
}

// ---------- comprobaciones ----------

async function listaComprobaciones(carpeta) {
  const ej = ejercicioDe(carpeta);
  if (!ej.comprobaciones) return null;
  if (!estado.comprobaciones[carpeta]) {
    const r = await fetch('practicas/' + ID_PRACTICA + '/' + carpeta + '/' + ej.comprobaciones, { cache: 'no-cache' });
    if (!r.ok) throw new Error('no se pueden leer las comprobaciones (' + r.status + ')');
    estado.comprobaciones[carpeta] = { lista: await r.json(), resultados: null };
  }
  return estado.comprobaciones[carpeta];
}

function entornoComprobacion(carpeta) {
  const marco = $('marco-comprobaciones');
  return {
    marco,
    inicio: carpeta === DIAGNOSTICO ? 'index.html' : ejercicioDe(carpeta).inicio,
    cargar: (pagina) => cargarPagina(marco, carpeta, pagina),
    texto: async (archivo) => {
      const propio = await textoArchivo(carpeta + '/' + archivo);
      if (propio !== null) return propio;
      const r = await fetch(baseRecursos(carpeta) + encodeURI(archivo));
      return r.ok ? r.text() : null;
    },
  };
}

function pintarComprobaciones() {
  const carpeta = carpetaActiva();
  const ej = carpeta ? ejercicioDe(carpeta) : null;
  const lista = $('lista-comprobaciones');
  lista.innerHTML = '';
  $('contador-comprobaciones').textContent = '';
  if (!ej || !ej.comprobaciones) {
    $('nota-comprobaciones').textContent = 'Este ejercicio no tiene comprobaciones automáticas.';
    $('nota-comprobaciones').hidden = false;
    return;
  }
  const datos = estado.comprobaciones[carpeta];
  if (!datos || !datos.resultados) {
    $('nota-comprobaciones').textContent = 'Pulsa Comprobar para revisar los requisitos de ' + carpeta + '.';
    $('nota-comprobaciones').hidden = false;
    return;
  }
  const bien = datos.resultados.filter((r) => r.ok).length;
  $('contador-comprobaciones').textContent = '(' + bien + '/' + datos.resultados.length + ')';
  $('nota-comprobaciones').textContent = 'Que se cumplan todas no garantiza la nota máxima: la corrección revisa más detalles.';
  $('nota-comprobaciones').hidden = false;
  datos.resultados.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.ok ? 'cumple' : 'no-cumple';
    const texto = document.createElement('span');
    texto.textContent = r.texto;
    const marca = document.createElement('span');
    marca.className = 'estado-comprobacion';
    marca.textContent = r.ok ? 'Cumple' : 'Pendiente';
    li.append(texto, marca);
    lista.appendChild(li);
  });
}

async function accionComprobar() {
  const carpeta = carpetaActiva();
  if (!carpeta) return;
  await conBloqueo(async () => {
    mostrarPanel('comprobaciones');
    setEstado('Comprobando ' + carpeta + '...');
    const datos = await listaComprobaciones(carpeta);
    if (!datos) return;
    await revisarEjercicio(carpeta);
    datos.resultados = await Comprobaciones.ejecutar(datos.lista, entornoComprobacion(carpeta));
    const bien = datos.resultados.filter((r) => r.ok).length;
    estado.metricas.comprobaciones++;
    estado.metricas.ultimaComprobacion = carpeta + ' ' + bien + '/' + datos.resultados.length;
    pintarComprobaciones();
    setEstado(carpeta + ': se cumplen ' + bien + ' de ' + datos.resultados.length + ' comprobaciones.');
  });
}

// ---------- diagnóstico ----------

function registrar(id, texto, valor) {
  estado.resultados[id] = { texto, valor };
  pintarDiagnostico();
}

function pintarDiagnostico() {
  const cuerpo = $('lista-diag');
  cuerpo.innerHTML = '';
  const etiquetas = { ok: 'Correcto', aviso: 'Revisar', fallo: 'Fallo', pendiente: 'Pendiente' };
  PRUEBAS.forEach(([id, nombre]) => {
    const r = estado.resultados[id] || { texto: '', valor: 'pendiente' };
    const fila = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = nombre;
    const b = document.createElement('td'); b.textContent = r.texto;
    const c = document.createElement('td'); c.textContent = etiquetas[r.valor]; c.className = 'val-' + r.valor;
    fila.append(a, b, c);
    cuerpo.appendChild(fila);
  });
}

const esperarHasta = async (condicion, ms) => {
  const fin = performance.now() + ms;
  while (performance.now() < fin) {
    if (condicion()) return true;
    await pausa(100);
  }
  return condicion();
};

async function accionDiagnostico() {
  await conBloqueo(async () => {
    mostrarPanel('diagnostico');
    PRUEBAS.forEach(([id]) => { if (!['carga', 'incrustado', 'almacen', 'modo'].includes(id)) delete estado.resultados[id]; });
    pintarDiagnostico();
    const marco = $('marco-comprobaciones');
    const entorno = entornoComprobacion(DIAGNOSTICO);
    const doc = () => marco.contentDocument;

    setEstado('Diagnóstico 1/5: vista previa');
    marco.style.width = '1200px';
    await cargarPagina(marco, DIAGNOSTICO, 'index.html');
    registrar('pagina', 'título «' + (doc() ? doc().title : '') + '»', doc() && doc().title === 'Diagnóstico' ? 'ok' : 'fallo');
    const h1 = doc() && doc().querySelector('h1');
    const color = h1 ? marco.contentWindow.getComputedStyle(h1).color : '';
    registrar('css', 'color del título: ' + color, color === 'rgb(142, 68, 173)' ? 'ok' : 'fallo');
    const img = doc() && doc().querySelector('img');
    await esperarHasta(() => img && img.complete, 3000);
    registrar('imagen', img && img.naturalWidth ? img.naturalWidth + ' x ' + img.naturalHeight + ' px' : 'no se muestra',
      img && img.naturalWidth ? 'ok' : 'fallo');

    setEstado('Diagnóstico 2/5: vídeo y subtítulos');
    const video = doc() && doc().querySelector('video');
    if (video) {
      video.preload = 'auto';
      video.load();
      const pista = video.textTracks[0];
      if (pista) pista.mode = 'showing';
      const meta = await esperarHasta(() => video.readyState >= 1, 6000);
      const subtitulos = await esperarHasta(() => pista && pista.cues && pista.cues.length > 0, 6000);
      registrar('video', 'vídeo ' + (meta ? video.videoWidth + ' x ' + video.videoHeight : 'sin cargar')
        + ', subtítulos ' + (subtitulos ? pista.cues.length + ' frases' : 'sin cargar'), meta && subtitulos ? 'ok' : 'fallo');
    } else {
      registrar('video', 'no hay vídeo en la página de diagnóstico', 'fallo');
    }

    setEstado('Diagnóstico 3/5: enlaces y rutas');
    if (estado.modoVista === 'sw') {
      const enlace = doc() && doc().querySelector('a[href="otra.html"]');
      const cargada = new Promise((r) => marco.addEventListener('load', r, { once: true }));
      if (enlace) enlace.click();
      await Promise.race([cargada, pausa(5000)]);
      registrar('enlace', 'título tras pulsar el enlace: «' + (doc() ? doc().title : '') + '»',
        doc() && doc().title === 'Otra página' ? 'ok' : 'fallo');
      await cargarPagina(marco, DIAGNOSTICO, 'no-existe.html');
      registrar('ruta404', 'título «' + (doc() ? doc().title : '') + '»', doc() && doc().title === '404' ? 'ok' : 'fallo');
    } else {
      registrar('enlace', 'sin service worker: el laboratorio intercepta los enlaces', 'aviso');
      await cargarPagina(marco, DIAGNOSTICO, 'no-existe.html');
      registrar('ruta404', 'título «' + (doc() ? doc().title : '') + '»', doc() && doc().title === '404' ? 'ok' : 'fallo');
    }

    setEstado('Diagnóstico 4/5: validadores');
    const html = await Validacion.validar('a.html', '<!DOCTYPE html>\n<html lang="es">\n<head><meta charset="utf-8"><title>a</title></head>\n<body>\n<p><strong>texto</p></strong>\n<img src="a.jpg">\n</body>\n</html>\n');
    registrar('valHtml', html.length + ' problemas; el primero: ' + (html[0] ? 'línea ' + html[0].linea + ', ' + html[0].mensaje : '-'),
      html.some((p) => p.linea === 5) && html.some((p) => p.linea === 6) ? 'ok' : 'fallo');
    const css = await Validacion.validar('a.css', 'h1 { colr: red; }\np { padding: 10px 20 px; }\n');
    registrar('valCss', css.map((p) => 'línea ' + p.linea + ': ' + p.mensaje).join('; '),
      css.length === 2 && css[0].linea === 1 && css[1].linea === 2 ? 'ok' : 'fallo');
    const xml = await Validacion.validar('a.xml', '<?xml version="1.0"?>\n<rss>\n<channel>\n</rss>\n');
    registrar('valXml', xml.map((p) => 'línea ' + p.linea + ': ' + p.mensaje).join('; ') || 'sin errores',
      xml.length === 1 ? 'ok' : 'fallo');

    setEstado('Diagnóstico 5/5: comprobaciones y portapapeles');
    const r = await Comprobaciones.ejecutar([
      { id: 'fila', texto: 'fila', tipo: 'fila', selector: '.caja', ancho: 1200 },
      { id: 'columna', texto: 'columna', tipo: 'columna', selector: '.caja', ancho: 375 },
      { id: 'enlace', texto: 'enlace', tipo: 'enlace', selector: 'a', destino: 'otra.html' },
    ], entorno);
    registrar('comprobaciones', r.map((x) => x.id + ' ' + (x.ok ? 'sí' : 'no')).join(', '), r.every((x) => x.ok) ? 'ok' : 'fallo');
    const via = await copiarTexto('prueba del laboratorio');
    registrar('portapapeles', { portapapeles: 'portapapeles del navegador', alternativa: 'copia alternativa (execCommand)',
      fallo: 'el navegador no deja copiar' }[via], via === 'fallo' ? 'fallo' : via === 'alternativa' ? 'aviso' : 'ok');
    setEstado('Diagnóstico terminado. Pulsa "Copiar informe" y pégalo donde te haya indicado el profesor.');
  });
}

function textoInforme() {
  const lineas = [VERSION_INFORME];
  lineas.push('navegador=' + navigator.userAgent);
  PRUEBAS.forEach(([id]) => {
    const r = estado.resultados[id];
    lineas.push(id + '=' + (r ? r.valor + ' | ' + r.texto : 'pendiente'));
  });
  return lineas.join('\n');
}

// ---------- entrega ----------

// Incrustado en una página de otro sitio, el navegador puede dejar sin
// respuesta la petición al portapapeles (ni la concede ni la rechaza): pasado
// un segundo y medio se copia con el método antiguo. Devuelve la vía usada.
async function copiarTexto(texto) {
  try {
    await Promise.race([
      navigator.clipboard.writeText(texto),
      pausa(1500).then(() => { throw new Error('el portapapeles no responde'); }),
    ]);
    return 'portapapeles';
  } catch (e) {
    const area = document.createElement('textarea');
    area.value = texto;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok ? 'alternativa' : 'fallo';
  }
}

async function copiarInforme() {
  await copiarTexto(textoInforme());
  setEstado('Informe copiado.');
}

// Entrega por cuestionario: copia los archivos editables del ejercicio abierto
// para pegarlos en su pregunta de ensayo. Cada archivo va precedido de una
// marca con su ruta, escrita como comentario de su lenguaje, y el informe del
// entorno viaja al final como comentario HTML; corregir.sh los separa.
const MARCA_INFORME = '<!-- Informe del entorno (no borrar):';
const marcaArchivo = (clave) => (extension(clave) === 'css'
  ? '/* ===== Archivo: ' + clave + ' ===== */'
  : '<!-- ===== Archivo: ' + clave + ' ===== -->');

async function textoEntrega(carpeta) {
  const partes = editablesDe(carpeta).map((clave) => marcaArchivo(clave) + '\n' + estado.docs[clave].getValue().replace(/\s*$/, '\n'));
  // Separador ' | ': el identificador del navegador contiene ';'
  const informe = (await informeEntorno(carpeta)).trim().split('\n').slice(1).join(' | ');
  return partes.join('\n') + '\n' + MARCA_INFORME + ' ' + informe.replace(/--/g, '- -') + ' -->\n';
}

async function copiarCodigo() {
  const carpeta = carpetaActiva();
  if (!carpeta) return;
  const via = await copiarTexto(await textoEntrega(carpeta));
  setEstado(via === 'fallo'
    ? 'El navegador no ha dejado copiar. Pulsa de nuevo "Copiar código" y, si sigue igual, avisa al profesor.'
    : 'Código de ' + carpeta + ' copiado. Pégalo en su pregunta del cuestionario.');
}

async function informeEntorno(carpeta) {
  const m = estado.metricas;
  const errores = [];
  for (const clave of (carpeta ? editablesDe(carpeta) : Object.keys(ARCHIVOS).filter((n) => !ARCHIVOS[n].soloLectura))) {
    await revisarArchivo(clave);
    errores.push(clave + ' ' + (estado.problemas[clave] || []).filter((p) => p.tipo === 'error').length);
  }
  return [
    VERSION_ENTORNO,
    'fecha=' + new Date().toISOString(),
    'navegador=' + navigator.userAgent,
    'incrustado=' + (window.self !== window.top ? 'sí' : 'no'),
    'modo_vista=' + estado.modoVista,
    'carga_s=' + (m.carga === null ? '?' : m.carga.toFixed(1)),
    'vistas_previas=' + m.vistas,
    'comprobaciones=' + m.comprobaciones,
    'ultima_comprobacion=' + m.ultimaComprobacion,
    'errores_validacion=' + errores.join(', '),
  ].join('\n') + '\n';
}

async function descargarEntrega() {
  const zip = new JSZip();
  Object.keys(ARCHIVOS).filter((n) => !ARCHIVOS[n].soloLectura).forEach((n) => zip.file(n, estado.docs[n].getValue()));
  zip.file('informe_entorno.txt', await informeEntorno(null));
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = NOMBRE_ENTREGA;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setEstado('Entrega descargada: ' + NOMBRE_ENTREGA + '. Súbela a la tarea del Aula Virtual.');
}

function restaurarPlantilla() {
  if (!ARCHIVOS[estado.activo] || ARCHIVOS[estado.activo].soloLectura) return;
  if (!confirm('Se perderán los cambios de ' + estado.activo + '. ¿Continuar?')) return;
  editor.setValue(estado.plantillas[estado.activo]);
}

// ---------- arranque ----------

function enlazarUI() {
  document.querySelectorAll('.pestana').forEach((p) => p.addEventListener('click', () => mostrarPanel(p.dataset.panel)));
  $('btn-vista').addEventListener('click', () => {
    if (!estado.vista.carpeta && carpetaActiva()) estado.vista.carpeta = carpetaActiva();
    actualizarVista();
  });
  $('btn-comprobar').addEventListener('click', accionComprobar);
  $('btn-diagnostico').addEventListener('click', accionDiagnostico);
  $('btn-copiar').addEventListener('click', copiarInforme);
  $('btn-descargar').addEventListener('click', descargarEntrega);
  $('btn-copiar-codigo').addEventListener('click', copiarCodigo);
  $('btn-plantilla').addEventListener('click', restaurarPlantilla);
  $('btn-reiniciar').addEventListener('click', () => location.reload());
  $('btn-atras').addEventListener('click', volverVista);
  $('marco-vista').addEventListener('load', alCargarVista);
  $('previa-ancho').addEventListener('change', aplicarAncho);
  if (window.ResizeObserver) new ResizeObserver(aplicarAncho).observe($('previa-lienzo'));
  // Incrustado en el cuestionario (iframe), el laboratorio puede ocupar toda
  // la pantalla si el iframe lo permite (atributo allowfullscreen)
  if (window.self !== window.top && document.fullscreenEnabled) {
    $('btn-pantalla-completa').hidden = false;
    $('btn-pantalla-completa').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => setEstado('El navegador no permite la pantalla completa.'));
    });
    document.addEventListener('fullscreenchange', () => {
      $('btn-pantalla-completa').textContent = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa';
    });
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && (ev.key === 's' || ev.key === 'S')) {
      ev.preventDefault();
      if (!$('btn-vista').disabled) actualizarVista();
      setEstado('Guardado automático activo: la vista previa se actualiza sola al escribir.');
    }
  });
}

function avisoPractica(aviso) {
  setEstado(aviso);
  $('contenedor-editor').innerHTML = '<p class="aviso-practica"></p>';
  document.querySelector('.aviso-practica').textContent = aviso;
}

async function iniciar() {
  document.body.classList.toggle('modo-profesor', MODO_PROFESOR);
  document.body.classList.toggle('entrega-zip', ENTREGA_ZIP);
  enlazarUI();
  mostrarPanel('problemas');
  pintarDiagnostico();
  registrar('incrustado', window.self !== window.top ? 'sí' : 'no (página abierta directamente)', 'ok');
  try {
    localStorage.setItem('lmsgi:prueba', '1');
    localStorage.removeItem('lmsgi:prueba');
    registrar('almacen', 'disponible', 'ok');
  } catch (e) {
    registrar('almacen', 'no disponible: el código se perderá al recargar (' + e.name + ')', 'aviso');
  }

  let practica = true;
  try {
    await cargarPractica();
  } catch (e) {
    practica = false;
    const aviso = e.sinPractica
      ? 'Abre el laboratorio desde el cuestionario o la tarea del Aula Virtual: falta indicar la práctica.'
      : e.noPublicada
        ? 'Esta práctica todavía no está disponible. Espera a que el profesor la abra y pulsa "Reiniciar entorno".'
        : 'No se pudo cargar la práctica (' + e.message + '). Pulsa "Reiniciar entorno" y, si sigue igual, avisa al profesor.';
    avisoPractica(aviso);
    if (!MODO_PROFESOR) return;
  }
  if (practica) {
    construirExplorador();
    try {
      await cargarFuentes();
    } catch (e) {
      setEstado('No se pudieron cargar los archivos del proyecto: ' + e.message);
      return;
    }
    crearEditor();
  }

  estado.modoVista = await prepararVista();
  registrar('modo', estado.modoVista === 'sw' ? 'service worker' : 'srcdoc (' + estado.errorVista + ')',
    estado.modoVista === 'sw' ? 'ok' : 'aviso');
  const segundos = (performance.now() - estado.inicioPagina) / 1000;
  estado.metricas.carga = segundos;
  registrar('carga', segundos.toFixed(1) + ' s', segundos <= 10 ? 'ok' : segundos <= 30 ? 'aviso' : 'fallo');
  estado.listo = true;
  if (practica) {
    abrirArchivo(estado.activo);
    if (!carpetaDe(estado.activo)) mostrarEnVista(PRACTICA.ejercicios[0].carpeta, PRACTICA.ejercicios[0].inicio);
    revisarEjercicio(carpetaActiva());
    pintarComprobaciones();
    setEstado('Entorno listo. Abre el enunciado de cada ejercicio en el explorador.');
  } else {
    setEstado('Modo diagnóstico sin práctica: pulsa "Diagnóstico automático".');
  }
  actualizarBotones();
}

iniciar();
