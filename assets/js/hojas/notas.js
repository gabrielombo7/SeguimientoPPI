// ============================================================================
// hojas/notas.js — Hoja "Notas". Equivale a modules/mod_documentacion.R.
//
// Tres capítulos desplegables, con el contenido SIEMPRE desde el Excel de
// interfaz (exportado a meta.json): Notas metodológicas (abierto por defecto),
// Registros administrativos (solo tipo RRAA, sin catálogos ni calidad) y
// Glosario. La app no duplica estos textos.
// ============================================================================

const HojaNotas = (() => {

  // Campos de la ficha por RRAA. Sin "Calidad" ni catálogos: se dejan fuera a
  // pedido (mismo criterio que CAMPOS_RRAA en R).
  const CAMPOS_RRAA = [
    ['universo', 'Universo'],
    ['unidad_observacion', 'Unidad de observación'],
    ['cortes', 'Cortes y frecuencia'],
    ['desagregaciones', 'Desagregaciones'],
    ['tecnica', 'Aspectos técnicos']
  ];

  // Respeta los saltos de línea del Excel sin usar innerHTML con datos
  function conSaltos(texto) {
    const partes = String(texto).split(/\r?\n/);
    const frag = document.createDocumentFragment();
    partes.forEach((p, i) => {
      if (i) frag.append(UI.h('br', {}));
      frag.append(document.createTextNode(p));
    });
    return frag;
  }

  function bloquesNotas() {
    const meta = Cubo.meta;
    return UI.h('div', {}, (meta.notas || []).map((b) =>
      UI.h('div', { class: 'bloque-notas' },
        UI.h('h4', {}, b.titulo),
        UI.h('ul', {}, [].concat(b.items || []).map((i) => UI.h('li', {}, i))))));
  }

  function registrosRraa() {
    const meta = Cubo.meta;
    const filas = (meta.meta_datos || []).filter((r) => r.tipo === 'RRAA');
    if (!filas.length) {
      return UI.h('p', { class: 'texto-suave' }, 'No hay registros administrativos disponibles.');
    }
    return UI.h('div', {},
      UI.h('p', { class: 'texto-suave' },
        'Despliegue cada registro para ver universo, cortes, desagregaciones y aspectos técnicos.'),
      UI.acordeon(filas.map((r) => ({
        id: r.id,
        titulo: UI.h('span', {}, UI.h('b', {}, r.id + ' '), r.rraa),
        contenido: () => UI.h('dl', { class: 'meta-campos' },
          CAMPOS_RRAA.map(([campo, rotulo]) => [
            UI.h('dt', {}, rotulo),
            UI.h('dd', {}, r[campo] ? conSaltos(r[campo]) : '—')
          ]))
      })), { abiertos: [], anidado: true }));
  }

  function glosario() {
    const meta = Cubo.meta;
    return UI.h('div', {}, (meta.glosario || []).map((sec) =>
      UI.h('div', { class: 'glosario-seccion' },
        UI.h('h4', {}, sec.titulo),
        UI.h('dl', {}, [].concat(sec.items || []).map((it) => [
          UI.h('dt', {}, it.termino),
          UI.h('dd', {}, it.definicion || '—')
        ])))));
  }

  function render(raiz) {
    UI.vaciar(raiz);
    raiz.append(UI.hero('Notas', 'Notas metodológicas',
      'Alcance, cobertura, fuentes de cada componente y advertencias de comparabilidad del tablero.'));
    raiz.append(UI.h('main', { class: 'container-xl dnp-main' },
      UI.acordeon([
        { id: 'notas', titulo: 'Notas metodológicas', contenido: bloquesNotas },
        { id: 'registros', titulo: 'Registros administrativos', contenido: registrosRraa },
        { id: 'glosario', titulo: 'Glosario', contenido: glosario }
      ], { abiertos: ['notas'] })));
  }

  return { render };
})();
