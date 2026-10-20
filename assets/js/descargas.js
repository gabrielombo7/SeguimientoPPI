// ============================================================================
// descargas.js — Exportar el corte visible a CSV o PNG, sin servidor.
//
// DIFERENCIA CON EL TABLERO SHINY: la "Ficha" se generaba como .docx en el
// servidor (R/ficha_docx.R, con officer). Un sitio estático no tiene servidor,
// así que aquí la ficha se imprime con el diálogo del navegador —que permite
// "Guardar como PDF"— usando la hoja de estilo de impresión. Es lo único de la
// migración que cambia de formato de salida.
// ============================================================================

const Descargas = (() => {

  function bajar(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = UI.h('a', { href: url, download: nombre });
    document.body.append(a);
    a.click();
    a.remove();
    // Se revoca en el siguiente tick: revocarlo de inmediato cancela la descarga
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Matriz (arreglo de arreglos) → CSV. Con BOM para que Excel en Windows
  // reconozca el UTF-8 y no rompa las tildes.
  function csv(matriz, nombre) {
    const escapar = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const texto = matriz.map((fila) => fila.map(escapar).join(',')).join('\r\n');
    bajar(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }), nombre);
  }

  // SVG → PNG por canvas. Se serializa el SVG, se le inyectan los estilos
  // mínimos (dentro del canvas no aplica el CSS de la página) y se rasteriza.
  function png(svg, nombre, escala = 2) {
    const clon = svg.cloneNode(true);
    const vb = (svg.getAttribute('viewBox') || '0 0 800 600').split(/\s+/).map(Number);
    const ancho = vb[2], alto = vb[3];
    clon.setAttribute('width', ancho);
    clon.setAttribute('height', alto);
    clon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const estilo = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    estilo.textContent = `
      text { font-family: 'Space Grotesk', sans-serif; }
      .tick { font-size: 11px; fill: ${DNP.gris}; }
      .valor-barra { font-size: 10px; fill: ${DNP.gris}; }
      .eje { stroke: ${DNP.borde}; }
      .depto { stroke: #fff; stroke-width: .8; }
      .recuadro { fill: none; stroke: ${DNP.gris}; stroke-width: 1; stroke-dasharray: 3 3; opacity: .45; }
    `;
    clon.prepend(estilo);

    const fondo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    fondo.setAttribute('width', '100%'); fondo.setAttribute('height', '100%');
    fondo.setAttribute('fill', '#FFFFFF');
    clon.insertBefore(fondo, clon.firstChild.nextSibling);

    const texto = new XMLSerializer().serializeToString(clon);
    // encodeURIComponent + unescape maneja los acentos al pasar a base64
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(texto)));

    const img = new Image();
    img.onload = () => {
      const canvas = UI.h('canvas', { width: ancho * escala, height: alto * escala });
      const ctx = canvas.getContext('2d');
      ctx.scale(escala, escala);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => bajar(blob, nombre), 'image/png');
    };
    img.onerror = () => alert('No se pudo generar la imagen PNG.');
    img.src = url;
  }

  // Imprime la hoja actual (el navegador ofrece "Guardar como PDF")
  function ficha() { window.print(); }

  // Descarga un archivo ESTÁTICO que ya existe en el sitio (a diferencia de bajar(), que
  // arma el blob en memoria): navegación directa por <a href download>, SIN fetch. fetch()
  // no puede leer un archivo local cuando el sitio se abre como file:// (misma razón por la
  // que el cubo viaja en base64 dentro de .js en vez de JSON — ver cubo.js); un <a> normal
  // sí puede, porque el navegador maneja la descarga él mismo, no JS.
  function archivo(ruta, nombre) {
    const a = UI.h('a', { href: ruta, download: nombre });
    document.body.append(a);
    a.click();
    a.remove();
  }

  const hoy = () => new Date().toISOString().slice(0, 10);
  const limpio = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '_');

  return { csv, png, ficha, bajar, archivo, hoy, limpio };
})();
