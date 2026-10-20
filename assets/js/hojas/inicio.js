// ============================================================================
// hojas/inicio.js — Portada. Equivale al bloque inicio_ui de app.R.
// Los totales salen del cubo (meta.totales), nunca se recalculan aquí.
// ============================================================================

const HojaInicio = (() => {

  const HOJAS = [
    ['visor', 'Visor Interactivo',
      'Explorador interactivo con cross-filtering: mapa, sectores, vigencias y fuentes cruzados entre sí. Compare Planeado PPI, Compromisos, Obligaciones y Pagos, y entre gobiernos.'],
    ['ppi2027', 'PPI 2027-2030',
      'El mismo explorador, fijo en el PPI 2027-2030: una vista simple para consultar solo ese PPI y descargar su base completa.'],
    ['descargar', 'Descargar Reportes',
      'Arme su propio corte combinando todos los filtros y descárguelo en CSV o como imagen PNG.'],
    ['iniciativas', 'Iniciativas',
      'Iniciativas del Balance PPI 2024-2026 por departamento: tarjetas, mapa y listado con o sin proyecto asociado.'],
    ['notas', 'Notas', 'Notas metodológicas · Registros administrativos · Glosario']
  ];

  function render(raiz, irA) {
    const meta = Cubo.meta;
    const t = meta.totales;                      // PPI vigente (con ejecución): solo para decir desde cuándo hay seguimiento
    const p = meta.totales_portada;              // PPI más reciente con programación (hoy 2027-2030)

    UI.vaciar(raiz);

    // Cifras de la portada: SIEMPRE el PPI más reciente (2027-2030). Constantes 2026 y % del PIB 2026 con la regla del PPI.
    const cop = (x) => Formato.cop(x);
    const pct1 = (x) => Formato.pct(x / 100);

    raiz.append(UI.h('header', { class: 'dnp-hero' },
      UI.h('div', { class: 'container-xl hero-inner' },
        UI.h('p', { class: 'hero-eyebrow' }, 'Departamento Nacional de Planeación · DPIP'),
        UI.h('h1', { class: 'hero-title' },
          'Plan Plurianual de Inversiones ',
          UI.h('span', { class: 'acento' }, p.gobierno.replace(/^PPI /, ''))),
        UI.h('p', { class: 'hero-sub' },
          `En esta página puede ver la inversión pública y privada de los próximos cuatro años, por fuente, ` +
          `sector, departamento y línea del PND — dato preliminar. El tablero también sigue la ejecución ` +
          `del ${meta.gob_actual} (vigente) desde ${t.ejec_desde}. Montos en miles de millones de pesos.`),
        UI.h('ul', { class: 'hero-stats' },
          UI.h('li', {},
            UI.h('strong', { class: 'hero-stats-num' }, cop(p.total.const26)),
            ` miles de millones constantes de ${p.base} — total programado `,
            UI.h('span', { class: 'texto-suave' },
              `(${pct1(p.total.pct_pib)} del PIB ${p.base} · ${cop(p.total.corriente)} corrientes)`)),
          UI.h('li', {},
            UI.h('strong', { class: 'hero-stats-num' }, cop(p.sin_privados.const26)),
            ` es inversión pública (sin sector privado) `,
            UI.h('span', { class: 'texto-suave' }, `— ${pct1(p.sin_privados.pct_pib)} del PIB ${p.base}`)),
          UI.h('li', {},
            UI.h('strong', { class: 'hero-stats-num' }, cop(p.privados.const26)),
            ` es inversión privada `,
            UI.h('span', { class: 'texto-suave' }, `— ${pct1(p.privados.pct_pib)} del PIB ${p.base}`))))));

    raiz.append(UI.h('main', { class: 'container-xl dnp-main' },
      UI.h('div', { class: 'grid-inicio' },
        HOJAS.map(([id, titulo, desc]) =>
          UI.h('button', { class: 'card-inicio', type: 'button', onclick: () => irA(id) },
            UI.h('div', { class: 'card-inicio-titulo' }, titulo),
            UI.h('p', { class: 'card-inicio-desc' }, desc),
            UI.h('div', { class: 'card-inicio-cta' }, 'Explorar →'))))));
  }

  return { render };
})();
