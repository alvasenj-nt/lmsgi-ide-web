'use strict';

// Comprobaciones de un ejercicio sobre la página tal como la dibuja el
// navegador. Las usan el laboratorio (botón Comprobar, cuando el ejercicio
// tiene comprobaciones visibles) y el corrector con los tests ocultos
// (scripts/laboratorio/corregir_web.js del repositorio del curso).
//
// Cada comprobación es un objeto JSON con un identificador, el texto que ve
// el alumnado y un tipo. Siempre que se pueda, se comprueba el efecto y no
// la técnica: "las tres noticias están en la misma fila a 1200 px" admite
// Flexbox y Grid; "el enlace lleva a la portada" admite cualquier ruta
// relativa correcta.
//
// Campos comunes:
//   id, texto       identificador y descripción para el alumnado
//   tipo            ver TIPOS
//   pagina          página del ejercicio sobre la que se comprueba (por
//                   defecto, la de inicio), ya dibujada con su CSS
//   archivo         alternativa a pagina: se analiza el código fuente del
//                   archivo (HTML sin dibujar o XML, p. ej. un canal RSS)
//   ancho           ancho de la ventana en píxeles (por defecto, 1200)
//   todos           true: todos los elementos cumplen (por defecto, alguno)
//
// Tipos:
//   existe      selector, min (1), max
//   no-existe   selector
//   texto       selector, contiene | patron (expresión regular)
//   atributo    selector, atributo, valor | patron (sin ellos, que exista)
//   estilo      selector, propiedad, valores (lista) | patron | distinto
//               (lista de valores no admitidos); pseudo (p. ej. "::before")
//   fila        selector: los elementos (al menos 2) están en la misma fila
//   columna     selector: los elementos están uno debajo de otro
//   enlace      selector, destino: algún enlace lleva a esa página del
//               ejercicio (ruta relativa a la carpeta del ejercicio);
//               contiene: solo cuentan los enlaces con ese texto
//   sin-errores archivo: la validación no da errores (los avisos no cuentan)
//   codigo      archivo, patron, flags ("i"), min (1) | no: true
//   funcion     codigo: cuerpo de una función (doc, win, entorno) que
//               devuelve true, false o { ok, detalle }
//
// El entorno que recibe ejecutar() aporta:
//   marco          iframe del mismo origen donde se cargan las páginas
//   cargar(pagina) carga la página del ejercicio en el marco
//   texto(archivo) promesa con el código fuente de un archivo, o null
//   inicio         página de inicio del ejercicio
const Comprobaciones = (() => {
  const ANCHO = 1200;
  const ALTO = 900;
  const TOLERANCIA = 8;

  const normalizar = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const minusculas = (s) => normalizar(s).toLocaleLowerCase('es');
  // Sin requestAnimationFrame: Chrome lo detiene en los marcos de otro sitio
  // que quedan fuera de la pantalla (el laboratorio incrustado en Moodle). Las
  // lecturas de estilos y posiciones ya obligan a recalcular el diseño. El
  // temporizador es el de esta página: el corrector carga la del alumno sin
  // JavaScript, y en ella los temporizadores no se ejecutan.
  const esperarFotograma = () => new Promise((r) => setTimeout(r, 50));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };

  function documentoFuente(archivo, texto) {
    const tipo = /\.html?$/i.test(archivo) ? 'text/html' : 'application/xml';
    return new DOMParser().parseFromString(texto, tipo);
  }

  // Ruta de un enlace relativa a la carpeta del ejercicio, o null si sale de
  // ella (enlace externo, otra carpeta, mailto:...)
  function rutaEnEjercicio(enlace, baseEjercicio) {
    const href = enlace.getAttribute('href');
    if (href === null || (/^[a-z][a-z0-9+.-]*:/i.test(href.trim()) && !/^https?:/i.test(href.trim()))) return null;
    let url;
    try { url = new URL(href, enlace.ownerDocument.baseURI); } catch (e) { return null; }
    if (!url.href.startsWith(baseEjercicio)) return null;
    return decodeURIComponent(url.pathname.slice(new URL(baseEjercicio).pathname.length));
  }

  async function ejecutar(lista, entorno) {
    const marco = entorno.marco;
    let cargada = null;
    let anchoActual = null;

    async function rendered(pagina, ancho) {
      if (anchoActual !== ancho) {
        marco.style.width = ancho + 'px';
        marco.style.height = ALTO + 'px';
        anchoActual = ancho;
      }
      if (cargada !== pagina) {
        await entorno.cargar(pagina);
        cargada = pagina;
      }
      const win = marco.contentWindow;
      await esperarFotograma();
      return { doc: marco.contentDocument, win };
    }

    const resultados = [];
    for (const c of lista) {
      let r;
      try {
        r = await evaluar(c);
      } catch (e) {
        r = { ok: false, detalle: 'no se pudo comprobar: ' + e.message };
      }
      resultados.push({ id: c.id, texto: c.texto, ok: !!r.ok, detalle: r.detalle || '' });
    }
    return resultados;

    async function contexto(c) {
      if (c.archivo) {
        const texto = await entorno.texto(c.archivo);
        if (texto === null) throw new Error('no existe ' + c.archivo);
        return { doc: documentoFuente(c.archivo, texto), win: null, texto };
      }
      return rendered(c.pagina || entorno.inicio, c.ancho || ANCHO);
    }

    function elementos(doc, c) {
      return Array.from(doc.querySelectorAll(c.selector));
    }

    function cuantificar(c, lista, cumple) {
      if (!lista.length) return { ok: false, detalle: 'no hay ningún elemento que comprobar' };
      const buenos = lista.filter(cumple).length;
      const ok = c.todos ? buenos === lista.length : buenos > 0;
      return { ok, detalle: buenos + ' de ' + lista.length + ' elementos cumplen' };
    }

    async function evaluar(c) {
      switch (c.tipo) {
        case 'existe': {
          const { doc } = await contexto(c);
          const n = elementos(doc, c).length;
          const min = c.min === undefined ? 1 : c.min;
          return { ok: n >= min && (c.max === undefined || n <= c.max), detalle: n + ' encontrados' };
        }
        case 'no-existe': {
          const { doc } = await contexto(c);
          const n = elementos(doc, c).length;
          return { ok: n === 0, detalle: n + ' encontrados' };
        }
        case 'texto': {
          const { doc } = await contexto(c);
          const re = c.patron ? new RegExp(c.patron, c.flags === undefined ? 'i' : c.flags) : null;
          const buscado = c.contiene !== undefined ? minusculas(c.contiene) : null;
          return cuantificar(c, elementos(doc, c), (el) => {
            const t = normalizar(el.textContent);
            return re ? re.test(t) : t.toLocaleLowerCase('es').includes(buscado);
          });
        }
        case 'atributo': {
          const { doc } = await contexto(c);
          const re = c.patron ? new RegExp(c.patron, c.flags === undefined ? 'i' : c.flags) : null;
          return cuantificar(c, elementos(doc, c), (el) => {
            if (!el.hasAttribute(c.atributo)) return false;
            const v = el.getAttribute(c.atributo).trim();
            if (c.valor !== undefined && v !== c.valor) return false;
            return !re || re.test(v);
          });
        }
        case 'estilo': {
          const { doc, win } = await contexto(c);
          const re = c.patron ? new RegExp(c.patron, c.flags === undefined ? 'i' : c.flags) : null;
          return cuantificar(c, elementos(doc, c), (el) => {
            const v = win.getComputedStyle(el, c.pseudo || null).getPropertyValue(c.propiedad).trim();
            if (c.valores && !c.valores.includes(v)) return false;
            if (c.distinto && c.distinto.includes(v)) return false;
            return !re || re.test(v);
          });
        }
        case 'fila':
        case 'columna': {
          const { doc } = await contexto(c);
          const els = elementos(doc, c).filter(visible);
          const min = c.min === undefined ? 2 : c.min;
          if (els.length < min) return { ok: false, detalle: els.length + ' elementos visibles' };
          const cajas = els.map((el) => el.getBoundingClientRect());
          if (c.tipo === 'fila') {
            const altos = cajas.map((b) => b.top);
            const ok = Math.max(...altos) - Math.min(...altos) <= TOLERANCIA;
            return { ok, detalle: ok ? 'en la misma fila' : 'no están en la misma fila' };
          }
          const ordenadas = cajas.slice().sort((a, b) => a.top - b.top);
          const ok = ordenadas.every((b, i) => i === 0 || b.top >= ordenadas[i - 1].bottom - TOLERANCIA);
          return { ok, detalle: ok ? 'uno debajo de otro' : 'hay elementos uno al lado de otro' };
        }
        case 'enlace': {
          const { doc, win } = await contexto(c);
          if (!win) throw new Error('la comprobación de enlaces necesita una página dibujada');
          const raiz = baseEjercicio(doc.baseURI, c.pagina || entorno.inicio);
          const buscado = c.contiene !== undefined ? minusculas(c.contiene) : null;
          const destinos = elementos(doc, c)
            .filter((a) => buscado === null || minusculas(a.textContent).includes(buscado))
            .map((a) => rutaEnEjercicio(a, raiz));
          const ok = destinos.includes(c.destino);
          return { ok, detalle: ok ? 'enlace correcto' : 'ningún enlace lleva a ' + c.destino };
        }
        case 'sin-errores': {
          const texto = await entorno.texto(c.archivo);
          if (texto === null) return { ok: false, detalle: 'no existe ' + c.archivo };
          const errores = (await Validacion.validar(c.archivo, texto)).filter((p) => p.tipo === 'error');
          return {
            ok: errores.length === 0,
            detalle: errores.length ? errores.length + ' errores; el primero, en la línea ' + errores[0].linea
              + ': ' + errores[0].mensaje : 'sin errores',
          };
        }
        case 'codigo': {
          const texto = await entorno.texto(c.archivo);
          if (texto === null) return { ok: false, detalle: 'no existe ' + c.archivo };
          const flags = (c.flags === undefined ? 'i' : c.flags).replace('g', '') + 'g';
          const n = (texto.match(new RegExp(c.patron, flags)) || []).length;
          const min = c.min === undefined ? 1 : c.min;
          return { ok: c.no ? n === 0 : n >= min, detalle: n + ' apariciones' };
        }
        case 'funcion': {
          const { doc, win } = await contexto(c);
          // eslint-disable-next-line no-new-func
          const r = new Function('doc', 'win', 'entorno', c.codigo)(doc, win, entorno);
          return typeof r === 'object' && r !== null ? r : { ok: r === true };
        }
        default:
          throw new Error('tipo de comprobación desconocido: ' + c.tipo);
      }
    }

    // Carpeta del ejercicio: la URL de la página cargada sin la ruta de la
    // propia página (que puede estar en una subcarpeta, p. ej. noticias/)
    function baseEjercicio(urlPagina, pagina) {
      const niveles = pagina.split('/').length - 1;
      let url = new URL('./', urlPagina);
      for (let i = 0; i < niveles; i++) url = new URL('../', url);
      return url.href;
    }
  }

  return { ejecutar, ANCHO };
})();

if (typeof window !== 'undefined') window.Comprobaciones = Comprobaciones;
