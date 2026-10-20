// ============================================================================
// mapa.js — Mapa coroplético departamental en SVG. Equivale a R/utils_mapa.R.
//
// La geometría llega ya proyectada (Web Mercator) desde scripts/exportar_web.R,
// con San Andrés y Prov. reubicado y ampliado en su recuadro: aquí solo se
// pintan paths. Por eso no hace falta Leaflet ni ninguna librería de mapas.
//
// Igual que en el tablero Shiny, el mapa es un lienzo FIJO de clic-para-filtrar:
// sin pan ni zoom (no hay controles para volver al encuadre si uno se aleja).
// ============================================================================

const Mapa = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  let geo = null;

  async function init() {
    if (!geo) geo = await Carga.global('data/geo.js', '__PPI_GEO');
    return geo;
  }

  // Crea el lienzo una sola vez; después solo se cambian color y etiqueta
  // (mismo criterio de eficiencia que el leafletProxy del tablero Shiny).
  function crear(contenedor, opciones = {}) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'mapa-svg');
    svg.setAttribute('viewBox', `0 0 ${geo.ancho} ${geo.alto}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Marco del recuadro insular: va debajo de los departamentos y no
    // intercepta clics, para no tapar el que encierra.
    if (geo.recuadro) {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('class', 'recuadro');
      r.setAttribute('x', geo.recuadro.x); r.setAttribute('y', geo.recuadro.y);
      r.setAttribute('width', geo.recuadro.w); r.setAttribute('height', geo.recuadro.h);
      r.setAttribute('pointer-events', 'none');
      svg.append(r);
    }

    const paths = new Map();
    geo.departamentos.forEach((d) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('class', 'depto');
      p.setAttribute('d', d.path);
      p.setAttribute('fill', GRIS_MAPA);
      if (opciones.onClick) p.addEventListener('click', () => opciones.onClick(d.nombre));
      p.addEventListener('mousemove', (ev) => {
        const et = paths.get(d.nombre).etiqueta;
        if (et) UI.tooltip.mostrar(et, ev);
      });
      p.addEventListener('mouseleave', () => UI.tooltip.ocultar());
      paths.set(d.nombre, { el: p, etiqueta: null });
      svg.append(p);
    });

    UI.vaciar(contenedor).append(svg);

    return {
      svg,
      // estilos: [{departamento, fill, etiqueta}]
      pintar(estilos) {
        estilos.forEach((e) => {
          const p = paths.get(e.departamento);
          if (!p) return;                       // 'Nacional' no está en la geometría
          p.el.setAttribute('fill', e.fill);
          p.etiqueta = e.etiqueta;
        });
      },
      // Aviso sobre el mapa (p. ej. "Elija 1 o 2 series para el mapa")
      aviso(texto) {
        contenedor.querySelector('.mapa-aviso')?.remove();
        if (texto) contenedor.prepend(UI.h('div', { class: 'mapa-aviso' }, texto));
      }
    };
  }

  // Leyenda por rangos (comparación de dos series, o crecimiento entre dos gobiernos)
  function leyenda(colores, etiquetas, titulo) {
    return UI.h('div', { class: 'mapa-leyenda' },
      titulo ? UI.h('div', { style: { fontWeight: '700' } }, titulo) : null,
      colores.map((c, i) => UI.h('div', { class: 'mapa-leyenda-fila' },
        UI.h('span', { class: 'leyenda-color', style: { background: c } }),
        etiquetas[i])));
  }

  // Nota explicativa breve bajo la leyenda (qué significan los colores / el blanco)
  function nota(texto) {
    return UI.h('p', { class: 'mapa-nota texto-suave' }, texto);
  }

  return {
    init, crear, leyenda, nota,
    get departamentos() { return geo ? geo.departamentos.map((d) => d.nombre) : []; }
  };
})();
