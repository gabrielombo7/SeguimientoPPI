// ============================================================================
// app.js — Arranque y navegación. Equivale a app.R + www/dnp.js.
//
// Una hoja por pestaña (sin scroll entre hojas), con la hoja activa en el hash
// para que se pueda compartir el enlace de una vista concreta.
// ============================================================================

const App = (() => {
  const HOJAS = {
    inicio:      { titulo: 'Inicio',              render: (r) => HojaInicio.render(r, ir) },
    visor:       { titulo: 'Visor Interactivo',   render: (r) => HojaVisor.render(r) },
    ppi2027:     { titulo: 'PPI 2027-2030',       render: (r) => HojaPPI2027.render(r) },
    descargar:   { titulo: 'Descargar Reportes',  render: (r) => HojaDescargar.render(r) },
    iniciativas: { titulo: 'Iniciativas',         render: (r) => HojaIniciativas.render(r) },
    notas:       { titulo: 'Notas',               render: (r) => HojaNotas.render(r) }
  };

  let actual = null;
  const contenido = () => document.getElementById('contenido');

  function ir(hoja) {
    if (!HOJAS[hoja]) hoja = 'inicio';
    if (hoja === actual) return;
    actual = hoja;
    if (location.hash.slice(1) !== hoja) history.replaceState(null, '', '#' + hoja);
    document.querySelectorAll('.dnp-link').forEach((a) => {
      a.classList.toggle('active', a.dataset.hoja === hoja);
    });
    UI.cerrarZoom();
    Formato.modo = 'cop';                           // cada hoja que usa Medida fija el suyo al pintar
    document.getElementById('dnpNav').classList.remove('open');
    document.title = (hoja === 'inicio' ? '' : HOJAS[hoja].titulo + ' · ') +
      'PPI · Tablero de inversiones — DNP';
    window.scrollTo(0, 0);
    HOJAS[hoja].render(contenido());
  }

  function armarNav() {
    const links = document.getElementById('dnpLinks');
    Object.entries(HOJAS).forEach(([id, h]) => {
      if (id === 'inicio') return;                 // el inicio se abre por la marca
      links.append(UI.h('button', {
        class: 'dnp-link', type: 'button', dataset: { hoja: id },
        onclick: () => ir(id)
      }, h.titulo));
    });
    document.getElementById('dnpBrand').addEventListener('click', (e) => {
      e.preventDefault(); ir('inicio');
    });
    document.getElementById('dnpNavToggle').addEventListener('click', () => {
      document.getElementById('dnpNav').classList.toggle('open');
    });
    window.addEventListener('scroll', () => {
      document.getElementById('dnpNav').classList.toggle('scrolled', window.scrollY > 4);
    }, { passive: true });
    window.addEventListener('hashchange', () => ir(location.hash.slice(1) || 'inicio'));
  }

  async function iniciar() {
    const barra = UI.h('div', { class: 'barra-carga' });
    document.body.append(barra);
    try {
      await Cubo.init();
      // Se precargan en corrientes el PPI más reciente (default del Visor) y el vigente con
      // ejecución (default de Descargar): son los cortes por defecto de casi todas las hojas,
      // así la primera vista no espera.
      await Cubo.preparar([Cubo.meta.gob_prog[0], Cubo.meta.gob_actual], 'corriente');
      document.getElementById('anioPie').textContent =
        new Date(Cubo.meta.generado).toLocaleDateString('es-CO');
      armarNav();
      ir(location.hash.slice(1) || 'inicio');
    } catch (e) {
      UI.vaciar(contenido()).append(UI.h('main', { class: 'container-xl dnp-main' },
        UI.estadoVacio('No se pudieron cargar los datos',
          'Revise que la carpeta data/ esté junto al index.html y que el sitio se esté ' +
          'sirviendo por HTTP (abrir el archivo con doble clic no funciona). Detalle: ' + e.message)));
      console.error(e);
    } finally {
      barra.remove();
    }
  }

  return { iniciar, ir };
})();

document.addEventListener('DOMContentLoaded', App.iniciar);
