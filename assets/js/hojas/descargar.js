// ============================================================================
// hojas/descargar.js — Hoja "Descargar Reportes". Equivale a modules/mod_descarga.R.
//
// El usuario elige un Eje 1 (dimensión) y, opcionalmente, un Eje 2 para comparar
// —otra categoría o los indicadores—, lo que convierte la vista en una tabla
// cruzada. Combina filtros simultáneos y descarga el corte en CSV o PNG.
// ============================================================================

const HojaDescargar = (() => {

  // Dimensiones usables como eje o categoría, EN EL ORDEN pedido.
  // 'Gobierno' es especial: no vive dentro del shard (es su clave), así que se
  // resuelve consultando shard por shard.
  const DIMS = {
    'Gobierno': 'gobierno',
    'Vigencia': 'vigencia',
    'Fuente de financiación': 'fuente_general',
    'Sector': 'sector',
    'Eje del PND': 'linea1',
    'Departamento': 'departamento'
  };
  const TOTAL_DE = { vigencia: 'Totales', fuente_general: 'Total', sector: 'Total', linea1: 'Total', departamento: 'Total' };

  const IND_CUBO = {
    'Planeado PPI': 'total_inversion', 'Monto inflexible': 'monto_inflexible', 'Compromisos': 'compromisos_ejecucion',
    'Obligaciones': 'obligaciones_ejecucion', 'Pagos': 'pagos_ejecucion'
  };
  const IND_NOMBRE = Object.fromEntries(Object.entries(IND_CUBO).map(([k, v]) => [v, k]));
  const ORDEN_IND = Object.values(IND_CUBO);

  const est = {
    modoComp: 'Categoría',
    eje: 'Sector',
    categoria: 'Ninguna',
    indicadores: ['total_inversion'],
    vista: 'Tabla',                    // por defecto la tabla, no la gráfica
    gobiernos: [],
    f: { vigencia: [], fuente_general: [], sector: [], linea1: [], departamento: [] },
    filtrosOpen: false                 // «Filtros adicionales» — toggle inline, no es un filtro en sí
  };

  const indMulti = () => est.modoComp === 'Indicadores';
  const ejeArg = () => DIMS[est.eje];
  const serieArg = () => (indMulti() ? 'indicador' : (est.categoria === 'Ninguna' ? null : DIMS[est.categoria]));
  const etiqSerie = () => (indMulti() ? 'Indicador' : est.categoria);
  const gobsSel = () => (est.gobiernos.length ? est.gobiernos : Cubo.meta.gobiernos);

  // Si Gobierno es el eje o la serie, un filtro de un solo gobierno lo
  // colapsaría a una sola columna: en ese caso se comparan TODOS.
  function gobsCorte() {
    const esComparacion = ejeArg() === 'gobierno' || serieArg() === 'gobierno';
    return esComparacion && est.gobiernos.length <= 1 ? Cubo.meta.gobiernos : gobsSel();
  }

  function indicadoresDisp() {
    const out = [];
    for (const cod of ORDEN_IND) {
      if (gobsSel().some((g) => Cubo.unidadesDe(g, cod).length)) out.push(cod);
    }
    return out.length ? out : [ORDEN_IND[0]];
  }
  // ¿Existe el per cápita para todos los gobiernos e indicadores del corte?
  function pcDisponible() {
    const pares = [];
    for (const g of gobsSel()) for (const i of est.indicadores) pares.push([g, i]);
    return Medida.pcDisponible(pares);
  }

  // Valores disponibles de una dimensión, para los filtros simultáneos
  function valoresDim(arg) {
    const col = { vigencia: 'vigencia', fuente_general: 'fuente_general', sector: 'sector', linea1: 'linea1_pnd', departamento: 'departamento' }[arg];
    return Cubo.niveles(col).filter((v) => v !== TOTAL_DE[arg]);
  }

  // --- Corte: categoria · serie · valor ---------------------------------------
  function corte() {
    const ef = ejeArg(), sf = serieArg();
    if (sf && ef === sf) return { conflicto: true, filas: [] };

    const esEjeSerie = (a) => a === ef || a === sf;
    // Un filtro vacío significa 'Todos' → el marginal 'Total' de esa dimensión,
    // salvo que sea el eje o la serie, donde se desagrega (DES).
    const argVal = (arg) => {
      const filtro = est.f[arg] || [];
      if (esEjeSerie(arg)) return filtro.length ? filtro : DES;
      return filtro.length ? filtro : TOTAL_DE[arg];
    };

    // En per cápita el departamento es de UNO a la vez (ver medida.js): se toma el primero
    if (Medida.percapita && (est.f.departamento || []).length > 1) est.f.departamento = est.f.departamento.slice(0, 1);

    const q = Medida.aplicar({
      tipo_dato: null,
      indicador: indMulti() ? est.indicadores : est.indicadores[0],
      vigencia: argVal('vigencia'),
      fuente_general: argVal('fuente_general'),
      sector: argVal('sector'),
      departamento: argVal('departamento'),
      linea1: argVal('linea1'),
      // Nivel 1 del PND solamente: sin esto, al desagregar linea1 entrarían
      // también las filas de nivel 2 y se contaría doble.
      linea2: 'Total'
    });

    const agrupar = [ef, sf].filter((a) => a && a !== 'gobierno');
    const filas = [];
    for (const g of gobsCorte()) {
      const res = agrupar.length
        ? Cubo.agregar(Object.assign({}, q, { gobierno: g }), agrupar)
        : [{ cat: null, valor: Cubo.total(Object.assign({}, q, { gobierno: g })) }];
      res.forEach((r) => {
        const vals = agrupar.length > 1 ? r.cats : [r.cat];
        const de = (arg) => (arg === 'gobierno' ? g : vals[agrupar.indexOf(arg)]);
        let categoria = de(ef);
        let serie = sf ? de(sf) : 'valor';
        if (ef === 'linea1') categoria = Cubo.etiqLinea(gobsSel()[0], categoria);
        if (sf === 'linea1') serie = Cubo.etiqLinea(gobsSel()[0], serie);
        if (sf === 'indicador') serie = IND_NOMBRE[serie] || Formato.indicador(serie);
        filas.push({ categoria, serie, valor: r.valor });
      });
    }

    // Agrega duplicados (varios gobiernos pueden traer la misma categoría)
    // Mapa anidado y no una clave concatenada: los nombres de sector,
    // departamento o linea traen espacios y separadores invisibles.
    const acum = new Map();
    filas.forEach((f) => {
      if (!acum.has(f.categoria)) acum.set(f.categoria, new Map());
      const m = acum.get(f.categoria);
      m.set(f.serie, (m.get(f.serie) || 0) + f.valor);
    });
    const salida = [];
    for (const [categoria, m] of acum) {
      for (const [serie, valor] of m) salida.push({ categoria, serie, valor });
    }
    // La vigencia se ordena cronológicamente; el resto, por monto
    salida.sort((a, b) => (ef === 'vigencia'
      ? String(a.categoria).localeCompare(String(b.categoria), 'es')
      : b.valor - a.valor));
    return { conflicto: false, filas: salida };
  }

  // Corte pivoteado a ANCHO — lo comparten la tabla y el CSV, para que lo que se
  // descarga sea exactamente lo que se ve en pantalla.
  function corteAncho() {
    const { conflicto, filas } = corte();
    const sf = serieArg();
    if (conflicto) return { conflicto: true };
    if (!filas.length) return { columnas: [], filas: [] };

    if (!sf) {
      const total = filas.reduce((a, f) => a + f.valor, 0);
      return {
        columnas: ['categoria', 'valor', 'pct'],
        titulos: [est.eje, `Monto (${Medida.corta()})`, '%'],
        filas: filas.map((f) => ({ categoria: f.categoria, valor: f.valor, pct: total > 0 ? f.valor / total : null }))
      };
    }

    let series = [...new Set(filas.map((f) => f.serie))];
    if (indMulti()) {
      const canon = ORDEN_IND.map((c) => IND_NOMBRE[c] || c);
      series = canon.filter((s) => series.includes(s)).concat(series.filter((s) => !canon.includes(s)));
    } else if (sf === 'vigencia') {
      series.sort((a, b) => String(a).localeCompare(String(b), 'es'));
    }

    const porCat = new Map();
    filas.forEach((f) => {
      if (!porCat.has(f.categoria)) porCat.set(f.categoria, {});
      porCat.get(f.categoria)[f.serie] = f.valor;
    });

    const out = [...porCat.entries()].map(([categoria, vals]) => {
      const fila = { categoria };
      let tot = 0;
      series.forEach((s) => { fila[s] = vals[s] || 0; tot += fila[s]; });
      if (!indMulti()) fila.Total = tot;
      fila.__tot = tot;
      return fila;
    });
    out.sort((a, b) => (ejeArg() === 'vigencia'
      ? String(a.categoria).localeCompare(String(b.categoria), 'es')
      : b.__tot - a.__tot));

    const columnas = ['categoria'].concat(series, indMulti() ? [] : ['Total']);
    return { columnas, titulos: [est.eje].concat(series, indMulti() ? [] : ['Total']), filas: out };
  }

  function textoFiltros() {
    const partes = [];
    const rot = { vigencia: 'Vigencia', fuente_general: 'Fuente', sector: 'Sector', linea1: 'Eje PND', departamento: 'Depto.' };
    for (const [arg, vals] of Object.entries(est.f)) {
      if (vals.length) {
        partes.push(rot[arg] + ': ' + (arg === 'linea1' ? vals.length + ' sel.' : vals.join(', ')));
      }
    }
    return partes.length ? partes.join(' · ') : 'sin filtros adicionales';
  }

  function titulo() {
    const gc = gobsCorte();
    const gobTxt = gc.length > 1 ? gc.length + ' gobiernos' : gc[0];
    const indTxt = indMulti() && est.indicadores.length > 1
      ? est.indicadores.length + ' indicadores'
      : (IND_NOMBRE[est.indicadores[0]] || Formato.indicador(est.indicadores[0]));
    let t = `${indTxt} · ${gobTxt} · por ${est.eje.toLowerCase()}`;
    if (serieArg()) t += ' × ' + etiqSerie().toLowerCase();
    return `${t} (${Medida.corta()})  —  ${textoFiltros()}`;
  }

  // --------------------------------------------------------------------------
  function render(raiz) {
    if (!est.gobiernos.length) est.gobiernos = [Cubo.meta.gob_actual];

    UI.vaciar(raiz);
    raiz.append(UI.hero('Descargar Reportes', 'Consulta y descarga personalizada',
      'Arme su propio corte: elija la dimensión de la gráfica y compárela contra los ' +
      'indicadores o contra otra categoría para obtener tablas cruzadas a la medida. ' +
      'Combine filtros y descargue el corte en CSV o la imagen en PNG.'));

    const panelFiltros = UI.h('div', { class: 'panel-fijo' });
    const contTitulo = UI.h('span', {});
    const contVista = UI.h('div', {});
    const acciones = UI.h('div', { class: 'panel-iconos' });

    raiz.append(UI.h('main', { class: 'container-xl dnp-main' },
      UI.h('div', { class: 'fila' },
        UI.colFiltrosColapsable(panelFiltros),
        UI.h('div', { class: 'col-contenido' },
          UI.card(contTitulo, contVista, { acciones })))));

    function pintarFiltros() {
      const indDisp = indicadoresDisp();
      const pc = pcDisponible();
      if (!pc && Medida.percapita) Medida.fijar({ percapita: false });
      if (Medida.pib) Medida.fijar({ pib: false });      // esta hoja no ofrece «% del PIB» (solo el Visor)
      UI.vaciar(panelFiltros);
      panelFiltros.append(UI.card('Filtros', UI.h('div', {},
        UI.grupoBotones({
          etiqueta: 'Comparar por', opciones: ['Categoría', 'Indicadores'], valor: est.modoComp,
          onCambio: (v) => { est.modoComp = v; pintarFiltros(); actualizar(); }
        }),
        UI.picker({
          etiqueta: 'Eje 1 · Dimensión', opciones: Object.keys(DIMS), valor: est.eje,
          onCambio: (v) => { est.eje = v; pintarFiltros(); actualizar(); }
        }),
        indMulti() ? null : UI.picker({
          etiqueta: 'Eje 2 · Categorías', opciones: ['Ninguna'].concat(Object.keys(DIMS)), valor: est.categoria,
          onCambio: (v) => { est.categoria = v; pintarFiltros(); actualizar(); }
        }),
        indMulti()
          ? UI.picker({
              etiqueta: 'Eje 2 · Indicadores', multiple: true,
              opciones: indDisp.map((c) => ({ valor: c, texto: IND_NOMBRE[c] || Formato.indicador(c) })),
              valor: est.indicadores,
              onCambio: (v) => { est.indicadores = v.length ? v : [indDisp[0]]; pintarFiltros(); actualizar(); }
            })
          : UI.picker({
              etiqueta: 'Indicador',
              opciones: indDisp.map((c) => ({ valor: c, texto: IND_NOMBRE[c] || Formato.indicador(c) })),
              valor: est.indicadores[0],
              onCambio: (v) => { est.indicadores = [v]; pintarFiltros(); actualizar(); }
            }),
        UI.h('hr', { class: 'divisor' }),
        Medida.controles({
          prefijo: 'desc', pcDisponible: pc,
          onCambio: (que) => {
            if (que === 'medida' && Medida.percapita && est.f.departamento.length > 1) est.f.departamento = est.f.departamento.slice(0, 1);
            pintarFiltros(); actualizar();
          }
        }),
        UI.h('hr', { class: 'divisor' }),
        // «Filtros adicionales»: mismo patrón inline que el Visor Interactivo (no un popover flotante)
        // — un botón que despliega el bloque hacia abajo, dentro del mismo panel.
        UI.h('button', {
          type: 'button', class: 'btn-toggle-filtros', 'aria-expanded': String(est.filtrosOpen),
          onclick: () => { est.filtrosOpen = !est.filtrosOpen; pintarFiltros(); }
        }, 'Filtros adicionales', UI.h('span', { class: 'icono-toggle', 'aria-hidden': 'true' }, est.filtrosOpen ? '▴' : '▾')),
        est.filtrosOpen ? UI.h('div', { class: 'filtros-extra' },
          UI.picker({
            etiqueta: 'Gobierno / PPI', opciones: Cubo.meta.gobiernos, multiple: true,
            valor: est.gobiernos, textoTodas: 'Todos',
            onCambio: (v) => { est.gobiernos = v; pintarFiltros(); actualizar(); }
          }),
          filtroDim('Vigencia', 'vigencia'),
          filtroDim('Fuente de financiación', 'fuente_general'),
          filtroDim('Sector', 'sector', true),
          filtroDim('Eje del PND', 'linea1'),
          filtroDim('Departamento', 'departamento', true),
          UI.h('button', {
            class: 'btn-secundario', type: 'button',
            onclick: () => {
              est.gobiernos = [Cubo.meta.gob_actual];
              for (const k of Object.keys(est.f)) est.f[k] = [];
              pintarFiltros(); actualizar();
            }
          }, 'Limpiar filtros')
        ) : null
      ), { clase: 'card-filtros' }));

      panelFiltros.append(UI.card('Descargar', UI.h('div', { class: 'campo' },
        UI.h('button', { class: 'btn-primario', type: 'button', onclick: descargarCsv }, 'Descargar CSV'),
        UI.h('button', { class: 'btn-secundario', type: 'button', onclick: descargarPng }, 'Descargar PNG')),
        { zoom: false }));   // 2 botones: no hay nada que agrandar
    }

    function filtroDim(etiqueta, arg, buscar) {
      const ops = valoresDim(arg);
      const conEtiqueta = arg === 'linea1'
        ? ops.map((c) => ({ valor: c, texto: Cubo.etiqLinea(gobsSel()[0], c) }))
        : ops;
      // Per cápita: el departamento es de UNO a la vez (medida.js), así que el filtro pasa a selección simple
      if (arg === 'departamento' && Medida.percapita) {
        return UI.picker({
          etiqueta: etiqueta + ' (uno)', opciones: ['Todos'].concat(ops), buscar,
          valor: est.f[arg][0] || 'Todos',
          onCambio: (v) => { est.f[arg] = v === 'Todos' ? [] : [v]; actualizar(); }
        });
      }
      return UI.picker({
        etiqueta, opciones: conEtiqueta, multiple: true, buscar,
        valor: est.f[arg], textoTodas: 'Todas',
        onCambio: (v) => { est.f[arg] = v; actualizar(); }
      });
    }

    let token = 0;
    async function actualizar() {
      const mio = ++token;
      UI.vaciar(contVista).append(UI.cargando('Armando el corte…'));
      await Cubo.preparar(gobsCorte(), Medida.tipoValor());
      if (mio !== token) return;
      pintar();
    }

    function pintar() {
      UI.vaciar(contTitulo).append(titulo());
      UI.vaciar(acciones).append(UI.h('div', { class: 'grupo-btn' },
        ['Barras', 'Dona', 'Tabla'].map((v) => UI.h('button', {
          type: 'button', 'aria-pressed': String(v === est.vista),
          onclick: () => { est.vista = v; pintar(); }
        }, v))));

      const ancho = corteAncho();
      UI.vaciar(contVista);
      if (ancho.conflicto) {
        contVista.append(UI.estadoVacio('El Eje 1 y el Eje 2 son la misma dimensión',
          'Elija una categoría distinta para comparar, o "Ninguna".'));
        return;
      }
      if (!ancho.filas.length) {
        contVista.append(UI.estadoVacio('Sin datos para esta combinación',
          'El cubo no cruza todas las dimensiones entre sí; pruebe con menos filtros.'));
        return;
      }

      if (est.vista === 'Tabla') {
        contVista.append(UI.tabla(ancho.filas, ancho.columnas.map((c, i) => ({
          campo: c, titulo: ancho.titulos[i], num: c !== 'categoria',
          render: c === 'categoria' ? null : (v) => (c === 'pct' ? Formato.pct(v) : Formato.cop(v))
        })), { porPagina: 20 }));
        return;
      }

      const { filas } = corte();
      const sf = serieArg();
      if (est.vista === 'Dona') {
        const datos = ancho.filas.map((f) => ({
          cat: f.categoria, valor: sf ? f.__tot : f.valor
        })).sort((a, b) => b.valor - a.valor);
        const r = Graficas.topOtros(datos, 12);
        contVista.append(Graficas.dona(r.datos, { colores: palRotativa(r.datos.map((d) => d.cat)), ancho: 620, alto: 380 }));
      } else if (sf) {
        const datos = filas.map((f) => ({ cat: f.categoria, serie: f.serie, valor: f.valor }));
        const g = Graficas.barrasAgrupadas(datos, { pal: palRotativa([...new Set(datos.map((d) => d.serie))]), orientacion: 'h', ancho: 800, altoFila: 30 });
        contVista.append(g.svg, Graficas.leyenda(g.series, g.pal));
      } else {
        const datos = ancho.filas.map((f) => ({ cat: f.categoria, valor: f.valor }));
        contVista.append(Graficas.barrasH(datos, { ancho: 800, altoFila: 26 }));
      }
    }

    function nombreArchivo(ext) {
      const base = (IND_NOMBRE[est.indicadores[0]] || 'consulta') + '_' +
        Descargas.limpio(gobsSel().join('-')) + (serieArg() ? '_x_' + Descargas.limpio(etiqSerie()) : '');
      return Descargas.limpio(base) + '_' + Descargas.hoy() + '.' + ext;
    }

    function descargarCsv() {
      const ancho = corteAncho();
      if (ancho.conflicto || !ancho.filas.length) return;
      const matriz = [ancho.titulos].concat(ancho.filas.map((f) => ancho.columnas.map((c) => f[c])));
      Descargas.csv(matriz, nombreArchivo('csv'));
    }
    function descargarPng() {
      const svg = contVista.querySelector('svg');
      if (!svg) { alert('Cambie a Barras o Dona para descargar la imagen.'); return; }
      Descargas.png(svg, nombreArchivo('png'));
    }

    pintarFiltros();
    actualizar();
  }

  return { render };
})();
