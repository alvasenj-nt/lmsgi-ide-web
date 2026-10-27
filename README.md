# Laboratorio web LMSGI

Entorno de trabajo en el navegador, sin servidor, para prácticas y exámenes de HTML y CSS de Lenguajes de marcas y sistemas de gestión de información (1º DAM, IES Pío Baroja). Es el equivalente del [laboratorio Java de PSP](https://github.com/alvasenj-nt/psp-ide-web) y comparte su formato: se incrusta en un cuestionario de Moodle con Safe Exam Browser y el alumnado entrega pegando su código en preguntas de ensayo.

- Explorador de archivos y editor con los colores de Visual Studio Code (cierre automático de etiquetas, `Ctrl+/` para comentar). En un archivo HTML, `!` o `html:5` seguido de Tab genera el esqueleto del documento igual que Emmet en VS Code, con `lang="en"` y `<title>Document</title>`, que el alumnado tiene que revisar.
- Vista previa que funciona como Live Server: un service worker (`sw.js`) sirve el código del editor y los archivos de la práctica, así que las rutas relativas, los enlaces entre páginas, las hojas de estilo enlazadas, el vídeo y sus subtítulos funcionan igual que en un servidor. Las rutas distinguen mayúsculas de minúsculas, como en GitHub Pages. Se actualiza sola al escribir y simula anchos de escritorio, tableta y móvil.
- Vista Problemas con la validación de HTML ([html-validate](https://html-validate.org)), CSS ([css-tree](https://github.com/csstree/csstree)) y XML (analizador del navegador), con mensajes en castellano y su línea.
- Comprobaciones visibles opcionales por ejercicio (botón Comprobar): requisitos que el alumnado puede verificar antes de entregar. La corrección se hace con más comprobaciones, ocultas, ejecutadas con el mismo motor (`js/comprobaciones.js`).
- Entrega por cuestionario: "Copiar código" copia todos los archivos editables del ejercicio, cada uno precedido de `<!-- ===== Archivo: <ruta> ===== -->` (o `/* ... */` en CSS), con un informe del entorno al final. Con `?entrega=zip` aparece además "Descargar entrega" (`.zip`) para tareas sin SEB.
- `?diagnostico` muestra un diagnóstico para el profesor: modo de la vista previa, página, CSS, imagen, enlaces, error 404, vídeo con subtítulos, validadores, comprobaciones y portapapeles. Funciona también sin `?p=`, para probar el entorno dentro de SEB.

Si el navegador no admite el service worker en el iframe, la vista previa pasa a un modo alternativo con `srcdoc` (menos fiel: el laboratorio intercepta los enlaces entre páginas). El diagnóstico y el informe del entorno indican el modo usado; `?vista=srcdoc` lo fuerza para probarlo.

## Prácticas

Cada práctica es una carpeta `practicas/<id>/` con un manifiesto `practica.json`, y se abre con `?p=<id>`. Sin parámetro, el laboratorio pide abrirse desde el cuestionario. La raíz no lista las prácticas.

```json
{
  "esquema": 1,
  "id": "lmsgi-ut2-ensayo-laboratorio",
  "version": 1,
  "titulo": "UT2 · Ensayo del laboratorio",
  "proyecto": "baroja-digital",
  "readme": "README.txt",
  "ejercicios": [
    { "carpeta": "ejercicio1", "inicio": "noticias/ciberseguridad.html", "comprobaciones": "comprobaciones.json",
      "archivos": [ { "nombre": "enunciado.txt" },
                    { "nombre": "noticias/ciberseguridad.html", "editable": true },
                    { "nombre": "img/logo-ies.jpg" } ] }
  ]
}
```

| Campo | Uso |
|---|---|
| `esquema` | Versión del formato del manifiesto. El motor admite todos los esquemas anteriores al suyo |
| `id` | Igual que el nombre de la carpeta: `lmsgi-ut<n>-<tema>` |
| `version` | Forma parte del prefijo del almacenamiento local (`<id>:v<version>:`) |
| `titulo`, `proyecto` | Subtítulo de la barra superior y nombre del proyecto en el explorador |
| `readme` | Archivo de texto de solo lectura en la raíz, abierto al entrar (opcional) |
| `ejercicios[].carpeta` | Carpeta del ejercicio: un proyecto web independiente con su vista previa |
| `ejercicios[].inicio` | Página que muestra la vista previa al abrir el ejercicio |
| `ejercicios[].archivos` | Rutas dentro de la carpeta, en minúsculas y sin espacios. Solo los de texto pueden ser `editable`; los binarios (imágenes, audio, vídeo) se muestran en un visor |
| `ejercicios[].comprobaciones` | Opcional: lista JSON de comprobaciones visibles (formato en `js/comprobaciones.js`). Sin ella, el botón Comprobar queda desactivado (examen) |

Una práctica usada con alumnado no se modifica: un cambio posterior se publica como práctica nueva (`<id>-v2`). Cada publicación lleva la etiqueta Git `practica/<id>`. Las prácticas se crean, validan, publican y corrigen con las herramientas de `scripts/laboratorio/` del repositorio del curso; la solución y los tests ocultos nunca se suben aquí.

## Publicación en GitHub Pages

1. Crear un repositorio público vacío en GitHub (`lmsgi-ide-web`).
2. Subir este directorio: `git remote add origin <url>` y `git push -u origin main`.
3. En el repositorio: Settings > Pages > Source: Deploy from a branch, rama `main`, carpeta `/ (root)`.
4. La página queda en `https://<usuario>.github.io/lmsgi-ide-web/`.

Las rutas se calculan a partir de la URL de la página, así que funciona en cualquier subdirectorio.

## Mantenimiento

- `index.html` carga `css/ide.css?v=N`, `js/*.js?v=N` y `lib/*.js?v=N`: subir N en cada cambio. En `sw.js`, subir `VERSION`.
- Antes de cada push: `node pruebas/regresion.js` (con `puppeteer-core` instalado fuera del repositorio y `NODE_PATH` apuntando a él). GitHub Actions la repite en cada push. Si una práctica publicada deja de pasar, se corrige el motor, nunca la práctica.
- `lib/html-validate.min.js` es `html-validate/browser` empaquetado con esbuild como IIFE (`--global-name=HtmlValidateLib`); `lib/csstree.min.js` es `dist/csstree.js` de css-tree. Versiones y licencias en `lib/LICENCIAS.txt`.

## Estructura

| Ruta | Contenido |
|---|---|
| `index.html`, `css/`, `js/app.js` | Interfaz y lógica del laboratorio |
| `js/validacion.js`, `js/comprobaciones.js` | Validación y comprobaciones, compartidas con el corrector del repositorio del curso |
| `sw.js` | Servidor de la vista previa (ámbito `vista/`) |
| `diag/` | Proyecto de prueba del diagnóstico |
| `lib/` | Validadores empaquetados y sus licencias |
| `practicas/<id>/` | Una práctica: manifiesto, `README.txt` y una carpeta por ejercicio |
| `pruebas/regresion.js`, `.github/workflows/` | Regresión de todas las prácticas en Chrome sin interfaz, en cada push |

## Licencias de terceros

| Componente | Origen | Licencia |
|---|---|---|
| html-validate 11.17.0 y dependencias empaquetadas | npm | MIT (ajv, semver ISC, fast-uri BSD-3-Clause, better-ajv-errors Apache-2.0) |
| css-tree 3.2.1 | npm | MIT (datos de mdn-data, CC0-1.0) |
| CodeMirror 5.65.16 (cargado desde cdnjs) | CodeMirror | MIT |
| JSZip 3.10.1 (cargado desde cdnjs) | Stuart Knightley | MIT o GPLv3 |
