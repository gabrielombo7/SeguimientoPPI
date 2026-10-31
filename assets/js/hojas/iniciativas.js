// ============================================================================
// hojas/iniciativas.js — Hoja "Iniciativas". Equivale a modules/mod_iniciativas.R.
//
// Iniciativas del Balance PPI 2024-2026 por departamento. NO viene del cubo: es
// un dataset propio, acotado a esta hoja (ver scripts/preparar_iniciativas.R).
// Montos SOLO de ValorComprometidoPeriodo, agregados por año.
//
// OJO con la unidad: esta hoja va en MILLONES (el resto del tablero, en miles de
// millones); por iniciativa las cifras son chicas y en miles de millones
// redondeaban a $0. La nota del panel de filtros lo advierte.
// ============================================================================

const HojaIniciativas = (() => {
  let D = null;                 // dataset decodificado
  let cats = [], vigencias = [], sectores = [], entidades = [], deptos = [];

  // Estado de los filtros
  const est = {
    metrica: 'Monto comprometido',   // por defecto el mapa muestra montos
    departamento: '',                // '' = todos
    categoria: null, vigencia: null, sector: null, entidad: null
  };

  async function cargar() {
    if (D) return D;
    const j = await Carga.global('data/iniciativas.js', '__PPI_INICIATIVAS');
    // Los textos vienen codificados como índices: se resuelven una sola vez
    const dec = (col) => j[col].map((i) => j.niveles[col][i]);
    D = {
      n: j.filas,
      id: j.id_iniciativa,
      nombre: dec('nombre'),
      categoria: dec('categoria'),
      categoriaOrden: j.categoria_orden,
      sector: dec('sector'),
      entidad: dec('entidad'),
      departamento: dec('departamento'),
      vigencia: dec('vigencia'),
      monto: j.monto,
      tieneProyecto: j.tiene_proyecto
    };

    // Categorías en el orden del documento (1, 2, 3), no alfabético
    const porOrden = new Map();
    for (let i = 0; i < D.n; i++) porOrden.set(D.categoria[i], D.categoriaOrden[i]);
    cats = [...porOrden.keys()].sort((a, b) => porOrden.get(a) - porOrden.get(b));

    const unicos = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b, 'es'));
    vigencias = unicos(D.vigencia);
    sectores = unicos(D.sector);
    entidades = unicos(D.entidad);
    deptos = unicos(D.departamento);

    est.categoria = cats.slice();
    est.vigencia = vigencias.slice();
    est.sector = sectores.slice();
    est.entidad = entidades.slice();
    return D;
  }

  // Índices que pasan los filtros. `conDepartamento` incluye el de departamento;
  // el mapa necesita la versión SIN él (necesita el desglose por departamento).
  function filtrar(conDepartamento) {
    const cS = new Set(est.categoria), vS = new Set(est.vigencia);
    const sS = new Set(est.sector), eS = new Set(est.entidad);
    const out = [];
    for (let i = 0; i < D.n; i++) {
      if (!cS.has(D.categoria[i]) || !vS.has(D.vigencia[i])) continue;
      if (!sS.has(D.sector[i]) || !eS.has(D.entidad[i])) continue;
      if (conDepartamento && est.departamento && D.departamento[i] !== est.departamento) continue;
      out.push(i);
    }
    return out;
  }

  function render(raiz) {
    UI.vaciar(raiz);
    raiz.append(UI.hero('Iniciativas', 'Iniciativas del PPI por departamento',
      'Iniciativas del Balance PPI 2024-2026, con o sin proyecto de inversión asociado. ' +
      'Elija un departamento en el mapa o en el filtro para ver su listado. ' +
      'Montos: ValorComprometidoPeriodo, agregado anual.'));

    const main = UI.h('main', { class: 'container-xl dnp-main' }, UI.cargando());
    raiz.append(main);

    cargar().then(() => Mapa.init()).then(() => {
      UI.vaciar(main);
      const panelFiltros = UI.h('div', { class: 'panel-fijo' });
      const kpis = UI.h('div', {});
      const contMapa = UI.h('div', { style: { height: '460px' } });
      const contTabla = UI.h('div', {});

      main.append(UI.h('div', { class: 'fila' },
        UI.colFiltrosColapsable(panelFiltros),
        UI.h('div', { class: 'col-contenido' },
          kpis,
          UI.h('div', { class: 'fila-graficas' },
            UI.h('div', { class: 'col-5' }, UI.card('Departamentos', contMapa)),
            UI.h('div', { class: 'col-7' }, UI.card('Iniciativas', contTabla))))));

      const mapa = Mapa.crear(contMapa, {
        onClick: (dep) => {
          // Un clic en el mapa alterna: si ya estaba, lo suelta
          est.departamento = est.departamento === dep ? '' : dep;
          pintarFiltros(); actualizar();
        }
      });

      function pintarFiltros() {
        UI.vaciar(panelFiltros);
        panelFiltros.append(
          UI.card('Filtros', UI.h('div', {},
            UI.grupoBotones({
              etiqueta: 'Mapa por', vertical: true,
              opciones: ['Número de iniciativas', 'Monto comprometido'],
              valor: est.metrica,
              onCambio: (v) => { est.metrica = v; pintarFiltros(); actualizar(); }
            }),
            UI.picker({
              etiqueta: 'Departamento', buscar: true,
              opciones: [{ valor: '', texto: 'Todos' }].concat(deptos.map((d) => ({ valor: d, texto: d }))),
              valor: est.departamento,
              onCambio: (v) => { est.departamento = v; pintarFiltros(); actualizar(); }
            }),
            campoMultiple('Categoría', cats, 'categoria'),
            campoMultiple('Vigencia', vigencias, 'vigencia'),
            campoMultiple('Sector', sectores, 'sector', true),
            campoMultiple('Entidad', entidades, 'entidad', true)
          ), { clase: 'card-filtros' }),
          UI.nota('Montos en ', UI.h('strong', {}, 'millones'), ' de pesos en esta hoja',
            ' (el resto del tablero usa miles de millones).'));
      }

      function campoMultiple(etiqueta, opciones, campo, buscar) {
        return UI.picker({
          etiqueta, opciones, multiple: true, buscar,
          valor: est[campo], textoTodas: 'Todas',
          onCambio: (v) => { est[campo] = v; actualizar(); }
        });
      }

      function actualizar() {
        const base = filtrar(false);      // sin departamento: alimenta el mapa
        const sel = filtrar(true);        // selección completa: KPIs y tabla

        // --- KPIs de la selección
        const vistas = new Map();
        sel.forEach((i) => { if (!vistas.has(D.id[i])) vistas.set(D.id[i], D.tieneProyecto[i]); });
        const totalInic = vistas.size;
        const conProy = [...vistas.values()].filter(Boolean).length;
        const monto = sel.reduce((a, i) => a + D.monto[i], 0);

        UI.vaciar(kpis).append(UI.filaKpis(
          UI.kpi(Formato.num(totalInic), 'Total de iniciativas'),
          UI.kpi(totalInic ? Formato.pct(conProy / totalInic) : '—', 'Con proyecto asociado', 'dorado'),
          UI.kpi(Formato.cop(monto), 'Monto comprometido de la selección (millones)', 'acento')));

        // --- Mapa: conteo de iniciativas o monto, según el toggle
        const porMonto = est.metrica === 'Monto comprometido';
        const acum = new Map();
        base.forEach((i) => {
          const d = D.departamento[i];
          if (porMonto) acum.set(d, (acum.get(d) || 0) + D.monto[i]);
          else {
            if (!acum.has(d)) acum.set(d, new Set());
            acum.get(d).add(D.id[i]);
          }
        });
        const nombres = Mapa.departamentos;
        const valores = nombres.map((d) => {
          const v = acum.get(d);
          return v === undefined ? 0 : (porMonto ? v : v.size);
        });
        const fills = coloresValor(valores);
        mapa.pintar(nombres.map((d, k) => ({
          departamento: d,
          fill: est.departamento && d !== est.departamento ? GRIS_INACTIVO : fills[k],
          etiqueta: `<b>${Formato.esc(d)}</b><br>` + (porMonto
            ? `${Formato.cop(valores[k])} (millones)`
            : `${valores[k]} iniciativa${valores[k] === 1 ? '' : 's'}`)
        })));

        // --- Tabla del departamento elegido
        UI.vaciar(contTabla);
        if (!est.departamento) {
          contTabla.append(UI.estadoVacio('Elija un departamento',
            'Selecciónelo en el mapa o en el filtro de la izquierda para ver sus iniciativas.'));
          return;
        }
        const porIniciativa = new Map();
        sel.forEach((i) => {
          const k = D.id[i];
          if (!porIniciativa.has(k)) porIniciativa.set(k, { id: k, nombre: D.nombre[i], monto: 0 });
          porIniciativa.get(k).monto += D.monto[i];
        });
        const filas = [...porIniciativa.values()].sort((a, b) => b.monto - a.monto);
        contTabla.append(UI.tabla(filas, [
          { campo: 'id', titulo: 'ID', ancho: '60px' },
          { campo: 'nombre', titulo: 'Nombre de iniciativa' },
          { campo: 'monto', titulo: 'Monto', num: true, ancho: '110px', render: (v) => Formato.cop(v) }
        ], { porPagina: 12 }));
      }

      pintarFiltros();
      actualizar();
    });
  }

  return { render };
})();
