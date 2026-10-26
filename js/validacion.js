'use strict';

// Validación de HTML, CSS y XML en el navegador, con mensajes en castellano.
// La usan el laboratorio (vista Problemas y comprobaciones) y el corrector
// (scripts/laboratorio/corregir_web.js del repositorio del curso), así que
// el alumnado y la corrección ven los mismos errores.
//
// - HTML: html-validate (lib/html-validate.min.js) con las reglas de
//   conformidad del estándar. No es el validador del W3C: coincide en lo
//   esencial (cierre y anidamiento, contenido permitido, atributos
//   obligatorios, etiquetas obsoletas), pero no en todos los mensajes.
// - CSS: css-tree (lib/csstree.min.js): sintaxis, propiedades desconocidas y
//   valores no válidos.
// - XML (y RSS, SVG): analizador del navegador, que solo comprueba que el
//   documento esté bien formado.
//
// Validacion.validar(nombre, texto) devuelve una promesa con una lista de
// { linea, columna, tipo: 'error' | 'aviso', mensaje, regla }.
const Validacion = (() => {
  const CONFIG_HTML = {
    extends: ['html-validate:standard', 'html-validate:document'],
    rules: {
      // El W3C exige el texto alternativo; el preset estándar no lo incluye
      'wcag/h37': 'error',
      // Buenas prácticas de la unidad que el W3C no trata como error
      'input-missing-label': 'warn',
      'heading-level': 'warn',
    },
  };

  let html = null;
  function validadorHtml() {
    if (!html) {
      const { HtmlValidate, StaticConfigLoader } = HtmlValidateLib;
      html = new HtmlValidate(new StaticConfigLoader(CONFIG_HTML));
    }
    return html;
  }

  const extension = (nombre) => (nombre.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
  const lenguaje = (nombre) => {
    const ext = extension(nombre);
    if (ext === 'html' || ext === 'htm') return 'html';
    if (ext === 'css') return 'css';
    if (['xml', 'rss', 'atom', 'svg', 'xsd', 'xsl', 'xslt'].includes(ext)) return 'xml';
    return null;
  };

  // ---------- HTML ----------

  const etiqueta = (t) => (t ? (t.startsWith('<') ? t : '<' + t + '>') : 'el elemento');

  // Atributos que el estándar recomienda pero cuya ausencia el W3C solo
  // señala como aviso
  const SOLO_AVISO = new Set(['lang']);

  function traducirHtml(m) {
    const c = m.context || {};
    let tipo = m.severity === 2 ? 'error' : 'aviso';
    let texto = null;
    let x;
    switch (m.ruleId) {
      case 'missing-doctype':
        texto = 'Falta la declaración <!DOCTYPE html> al principio del documento';
        break;
      case 'doctype-html':
        texto = 'La declaración de tipo de documento de HTML5 es <!DOCTYPE html>';
        break;
      case 'element-required-attributes':
        texto = 'A ' + etiqueta(c.tagName) + ' le falta el atributo obligatorio «' + c.attr + '»';
        if (SOLO_AVISO.has(c.attr)) tipo = 'aviso';
        break;
      case 'wcag/h37':
        texto = /empty/.test(m.message)
          ? 'El texto alternativo («alt») de la imagen está vacío'
          : 'La imagen no tiene texto alternativo (atributo «alt»)';
        break;
      case 'close-order':
        if ((x = m.message.match(/Unclosed element '(<[^']+>)'/))) texto = 'Falta cerrar ' + x[1];
        else if ((x = m.message.match(/End tag '<\/([^>']+)>' seen but there were open elements/))) {
          texto = 'Se cierra </' + x[1] + '> pero aún hay elementos abiertos dentro: revisa el orden de cierre';
        } else if ((x = m.message.match(/Stray end tag '<\/([^>']+)>'/))) {
          texto = 'Etiqueta de cierre </' + x[1] + '> sobrante: no hay ningún <' + x[1] + '> abierto';
        } else if ((x = m.message.match(/Element '?(<[^']+>)'? is closed by '?(<\/[^']+>)'?/))) {
          texto = x[1] + ' se cierra con ' + x[2] + ': revisa el orden de cierre';
        }
        break;
      case 'element-permitted-content':
        texto = etiqueta(c.child) + ' no puede ir dentro de ' + etiqueta(c.parent);
        break;
      case 'element-permitted-parent':
        texto = etiqueta(c.child) + ' tiene que estar dentro de ' + (c.rules || []).map(etiqueta).join(' o ');
        break;
      case 'element-required-ancestor':
        texto = etiqueta(c.child) + ' tiene que estar dentro de ' + (c.ancestor || []).map(etiqueta).join(' o ');
        break;
      case 'element-required-content':
        texto = etiqueta(c.element) + ' tiene que contener ' + etiqueta(c.missing);
        break;
      case 'element-permitted-occurrences':
        if ((x = m.message.match(/(<[^>]+>)/))) texto = x[1] + ' solo puede aparecer una vez en este lugar';
        break;
      case 'element-permitted-order':
        if ((x = m.message.match(/(<[^>]+>)/))) texto = x[1] + ' está en un orden no permitido dentro de su elemento padre';
        break;
      case 'element-name':
        if ((x = m.message.match(/(<[^>]+>)/))) texto = x[1] + ' no es una etiqueta de HTML';
        break;
      case 'deprecated':
        texto = etiqueta(c.tagName) + ' es una etiqueta obsoleta de versiones antiguas de HTML: el aspecto se da con CSS';
        break;
      case 'no-deprecated-attr':
        if ((x = m.message.match(/"([^"]+)" is deprecated on (<[^>]+>)/))) {
          texto = 'El atributo «' + x[1] + '» de ' + x[2] + ' es obsoleto: el aspecto se da con CSS';
        }
        break;
      case 'heading-level':
        if (/Multiple <h1>/.test(m.message)) texto = 'Hay más de un <h1> en la página';
        else if ((x = m.message.match(/expected (<h\d>) but got (<h\d>)/))) {
          texto = 'Salto de nivel de encabezado: después del anterior se esperaba ' + x[1] + ' y aparece ' + x[2];
        } else if (/Initial heading level/.test(m.message)) texto = 'El primer encabezado de la página debería ser <h1>';
        break;
      case 'no-dup-id':
        if ((x = m.message.match(/Duplicate ID "([^"]*)"/))) texto = 'El identificador «' + x[1] + '» está repetido: cada id debe ser único';
        break;
      case 'no-raw-characters':
        if ((x = m.message.match(/Raw "(.)" must be encoded as "([^"]+)"/))) {
          texto = 'El carácter «' + x[1] + '» tiene significado especial en HTML: escríbelo como ' + x[2];
        }
        break;
      case 'unrecognized-char-ref':
        if ((x = m.message.match(/"([^"]+)"/))) texto = 'Entidad desconocida: ' + x[1];
        break;
      case 'input-missing-label':
        texto = 'El campo de formulario no tiene una etiqueta <label> asociada';
        break;
      case 'attribute-allowed-values':
        texto = 'Valor no válido para el atributo «' + c.attribute + '» de ' + etiqueta(c.element) + ': «' + c.value + '»';
        break;
      case 'attribute-misuse':
        texto = 'El atributo no tiene sentido aquí: ' + m.message;
        break;
      case 'void-content':
        if ((x = m.message.match(/(<[^>]+>)/))) texto = x[1] + ' es un elemento vacío: no lleva contenido ni etiqueta de cierre';
        break;
      case 'close-attr':
        texto = 'Una etiqueta de cierre no puede llevar atributos';
        break;
      case 'empty-title':
        texto = 'El título de la página (<title>) está vacío';
        break;
      case 'empty-heading':
        if ((x = m.message.match(/(<h\d>)/))) texto = 'El encabezado ' + x[1] + ' está vacío';
        break;
      case 'no-dup-attr':
        if ((x = m.message.match(/"([^"]+)"/))) texto = 'El atributo «' + x[1] + '» está repetido en la misma etiqueta';
        break;
      case 'attr-delimiter':
      case 'attr-spacing':
        texto = 'Falta un espacio o sobra un carácter entre los atributos';
        break;
      case 'parser-error':
        texto = 'Error de sintaxis: ' + m.message;
        break;
      default:
        break;
    }
    return { tipo, mensaje: texto || m.message, regla: m.ruleId };
  }

  async function validarHtml(nombre, texto) {
    const r = await validadorHtml().validateString(texto, nombre);
    const salida = [];
    const vistos = new Set();
    r.results.forEach((res) => res.messages.forEach((m) => {
      const t = traducirHtml(m);
      // html-validate repite a veces el mismo aviso en la misma línea
      const clave = (m.line || 1) + '|' + t.mensaje;
      if (vistos.has(clave)) return;
      vistos.add(clave);
      salida.push({ linea: m.line || 1, columna: m.column || 1, tipo: t.tipo, mensaje: t.mensaje, regla: t.regla });
    }));
    return salida;
  }

  // ---------- CSS ----------

  function validarCss(nombre, texto) {
    const salida = [];
    let ast;
    try {
      ast = csstree.parse(texto, {
        positions: true,
        onParseError: (e) => salida.push({
          linea: e.line || 1, columna: e.column || 1, tipo: 'error', regla: 'css-sintaxis',
          mensaje: 'Error de sintaxis en el CSS: revisa que no falten llaves, dos puntos o puntos y coma',
        }),
      });
    } catch (e) {
      return [{ linea: 1, columna: 1, tipo: 'error', regla: 'css-sintaxis', mensaje: 'No se puede leer el CSS: ' + e.message }];
    }
    csstree.walk(ast, {
      visit: 'Declaration',
      enter(nodo) {
        if (nodo.property.startsWith('--')) return;
        const r = csstree.lexer.matchProperty(nodo.property, nodo.value);
        if (!r.error) return;
        // css-tree no comprueba los valores que usan var(): no es un error
        if (/var\(\) is not supported/.test(r.error.message)) return;
        const pos = nodo.loc ? nodo.loc.start : { line: 1, column: 1 };
        const valor = csstree.generate(nodo.value);
        const mensaje = r.error.name === 'SyntaxReferenceError'
          ? 'Propiedad desconocida: «' + nodo.property + '»'
          : 'Valor no válido para «' + nodo.property + '»: «' + valor + '»';
        salida.push({ linea: pos.line, columna: pos.column, tipo: 'error', regla: 'css-valor', mensaje });
      },
    });
    salida.sort((a, b) => a.linea - b.linea || a.columna - b.columna);
    return salida;
  }

  // ---------- XML ----------

  const TRADUCCIONES_XML = [
    [/Opening and ending tag mismatch: (\S+) line (\d+) and (\S+)/, (x) => 'La etiqueta <' + x[1] + '> de la línea ' + x[2] + ' se cierra con </' + x[3] + '>'],
    [/Premature end of data in tag (\S+) line (\d+)/, (x) => 'Falta cerrar <' + x[1] + '> (abierta en la línea ' + x[2] + ')'],
    [/Extra content at the end of the document/, () => 'Hay contenido después del elemento raíz: un documento XML tiene un único elemento raíz'],
    [/EntityRef: expecting ';'/, () => 'El carácter & tiene significado especial: escríbelo como &amp;'],
    [/Entity '([^']+)' not defined/, (x) => 'La entidad &' + x[1] + '; no existe en XML (solo &lt; &gt; &amp; &quot; &apos;)'],
    [/AttValue: " or ' expected/, () => 'El valor del atributo tiene que ir entre comillas'],
    [/attributes construct error/, () => 'Atributo mal escrito: falta el signo = o las comillas'],
    [/Attribute (\S+) redefined/, (x) => 'El atributo «' + x[1] + '» está repetido en la misma etiqueta'],
    [/XML declaration allowed only at the start of the document/, () => 'La declaración <?xml ...?> tiene que estar al principio, sin nada antes (ni espacios)'],
    [/StartTag: invalid element name/, () => 'Nombre de etiqueta no válido'],
    [/Start tag expected, '<' not found/, () => 'El documento no empieza con un elemento'],
    [/Couldn't find end of Start Tag (\S+)/, (x) => 'La etiqueta de apertura <' + x[1] + '> está incompleta'],
    [/Specification mandates value for attribute (\S+)/, (x) => 'El atributo «' + x[1] + '» necesita un valor entre comillas'],
    [/xmlParseCharRef: invalid xmlChar value/, () => 'Referencia a un carácter no válido'],
  ];

  function validarXml(nombre, texto) {
    const doc = new DOMParser().parseFromString(texto, 'application/xml');
    const error = doc.getElementsByTagName('parsererror')[0];
    if (!error) return [];
    const bruto = error.textContent;
    const pos = bruto.match(/line (\d+) at column (\d+): ([^\n]*)/) || bruto.match(/(\d+):(\d+): ([^\n]*)/);
    const original = pos ? pos[3].trim() : bruto.trim().split('\n')[0];
    let mensaje = null;
    for (const [re, f] of TRADUCCIONES_XML) {
      const x = original.match(re);
      if (x) { mensaje = f(x); break; }
    }
    return [{
      linea: pos ? Number(pos[1]) : 1,
      columna: pos ? Number(pos[2]) : 1,
      tipo: 'error',
      regla: 'xml-bien-formado',
      mensaje: (mensaje || original) + ' (el documento XML no está bien formado)',
    }];
  }

  async function validar(nombre, texto) {
    switch (lenguaje(nombre)) {
      case 'html': return validarHtml(nombre, texto);
      case 'css': return validarCss(nombre, texto);
      case 'xml': return validarXml(nombre, texto);
      default: return [];
    }
  }

  return { validar, lenguaje };
})();

if (typeof window !== 'undefined') window.Validacion = Validacion;
