// ============================================================================
// hojas/visor.js — Hoja "Visor Interactivo". Equivale a modules/mod_consulta.R.
//
// Explorador con cross-filtering global: mapa + sectores + vigencias + fuentes,
// todos cruzados entre sí (un clic en cualquiera filtra a los demás).
//   1 serie  → vista simple (montos)
//   2 series → balance: % de la segunda sobre la primera
//   3 o más  → las gráficas se agrupan y el mapa no aplica (use Descargar)
// Las series son los INDICADORES elegidos (modo "Por gobierno") o los GOBIERNOS
// (modo "Entre gobiernos").
//
// Medida y unidad (Totales | Per cápita, Corrientes | Constantes de un año base) las
// resuelve el módulo Medida (medida.js): per cápita viene precalculado en el cubo y las
// constantes (siempre con el deflactor del PIB) y el % del PIB se calculan en el navegador. «Fuente
// específica» solo se abre con UNA fuente elegida en «Fuentes» (el cubo cruza fuente_fondo con su
// fuente_general); «Programas» solo con UN sector elegido en «Sectores» (programas.js, aparte del cubo).
// ============================================================================

const HojaVisor = (() => {

  // Indicadores en jerarquía de MAYOR a MENOR: al elegir dos, el de mayor
  // jerarquía es la base (denominador) y el otro el numerador.
  // «Monto inflexible» es la parte de lo planeado que ya está comprometida (vigencias futuras, etc.): solo existe donde la fuente la entregó
  // (PPI 2019-2022 y 2023-2026); dos indicadores → el % inflexible = inflexible ÷ planeado.
  const IND_ORDEN = ['Planeado PPI', 'Monto inflexible', 'Compromisos', 'Obligaciones', 'Pagos'];
  const IND_CUBO = {
    'Planeado PPI': 'total_inversion', 'Monto inflexible': 'monto_inflexible', 'Compromisos': 'compromisos_ejecucion',
    'Obligaciones': 'obligaciones_ejecucion', 'Pagos': 'pagos_ejecucion'
  };
  const IND_TD = {
    'Planeado PPI': 'programación', 'Monto inflexible': 'programación', 'Compromisos': 'ejecución',
    'Obligaciones': 'ejecución', 'Pagos': 'ejecución'
  };

  const MSG_MULTI = 'Elija 1 o 2 series para el mapa (o use Descargar Reportes)';
  const MSG_UNGOB = 'Seleccione otro gobierno para comparar';
  const DET_UNGOB = 'O cambie a "Por gobierno", o use la hoja Descargar Reportes.';

  const est = {
    ambito: 'Por gobierno',
    gobiernos: [], indicadores: ['Planeado PPI'],
    vista: 'Totales',
    sel: { sector: null, departamento: null, vigencia: null, fuente: null, fondo: null, linea: null, tema: null, estrategia: null, entidad: null },
    fondoDe: null,          // fuente general a la que pertenece la fuente específica elegida
    // Vista activa de las cajas con selector (no son filtros, solo qué se muestra):
    vistaFuentes: 'fuentes',          // 'fuentes' | 'especifica'
    vistaSector: 'sectores'           // 'sectores' | 'programas' | 'entidad'
  };

  const entreGob = () => est.ambito === 'Entre gobiernos';

  // Gobiernos activos, en orden CRONOLÓGICO (el más viejo primero = base del %)
  function gobs() {
    const g = Cubo.meta.gobiernos.filter((x) => est.gobiernos.includes(x));
    if (!g.length) return [Cubo.meta.gob_prog[0]];
    return entreGob() ? g.slice().sort() : [g[0]];
  }

  // Indicadores realmente presentes para los gobiernos activos
  function indsDisp() {
    const presentes = new Set();
    IND_ORDEN.forEach((n) => {
      for (const g of gobs()) {
        if (Cubo.unidadesDe(g, IND_CUBO[n]).length) { presentes.add(n); break; }
      }
    });
    const d = IND_ORDEN.filter((n) => presentes.has(n));
    return d.length ? d : ['Planeado PPI'];
  }

  function inds() {
    const disp = indsDisp();
    let s = IND_ORDEN.filter((x) => est.indicadores.includes(x) && disp.includes(x));
    if (!s.length) s = [disp[0]];
    return entreGob() ? [s[0]] : s;
  }

  const series = () => (entreGob() ? gobs() : inds());
  function modo() {
    const n = series().length;
    if (entreGob() && n === 1) return 'un_gob';
    return n === 1 ? 'simple' : n === 2 ? 'balance' : 'multi';
  }
  // 'Totales' es el default de ambos modos; «Avance %» solo existe en «Por gobierno» (2 indicadores) y
  // «Cambio en…» solo en «Entre gobiernos» (2 gobiernos) — pintarFiltros() resetea est.vista a 'Totales'
  // al cambiar de ámbito, así que nunca queda un valor del otro modo seleccionado por error.
  const vista = () => est.vista;
  function modoBarras() {
    const m = modo();
    if (m === 'un_gob') return 'aviso';
    if (m === 'simple') return 'simple';
    if (m === 'balance' && !entreGob() && vista() === 'Avance %') return 'overlay';
    if (m === 'balance' && entreGob() && vista() === 'Cambio en totales') return 'cambio';
    if (m === 'balance' && entreGob() && vista() === 'Cambio en % de participación') return 'participacion';
    return 'grupo';
  }
  const palSeries = () => (entreGob() ? palRotativa(series()) : PAL_IND);
  // Orden de RENDER cuando se comparan 3+ series agrupadas (Fuentes/Vigencias/Sectores/Fuente
  // específica): el gobierno más reciente primero — es el dato que más se consulta. Solo cambia
  // el orden de dibujo/leyenda; palSeries() sigue coloreando por nombre, no por posición.
  const seriesVisual = () => (entreGob() ? gobs().slice().reverse() : series());

  // ¿Existe el per cápita para todas las combinaciones gobierno × indicador elegidas?
  function pcDisponible() {
    const pares = [];
    for (const g of gobs()) for (const n of inds()) pares.push([g, IND_CUBO[n]]);
    return Medida.pcDisponible(pares);
  }

  // Años (vigencias) de un gobierno, en orden, para el indicador activo y SIN selección cruzada. Al comparar
  // gobiernos el gráfico de vigencias alinea por AÑO DEL PERIODO («Año 1»…«Año n») y no por año calendario:
  // con periodos distintos (2023-2026 vs 2027-2030) cada año calendario existe en un solo gobierno y el
  // gráfico quedaba lleno de barras en cero.
  const _vigGob = new Map();
  function vigenciasDe(gobierno) {
    const ind = inds()[0], clave = gobierno + '|' + ind;
    if (!_vigGob.has(clave)) {
      const v = Cubo.agregar({ gobierno, tipo_dato: IND_TD[ind], indicador: IND_CUBO[ind], vigencia: DES }, 'vigencia')
        .filter((d) => d.valor > 0).map((d) => String(d.cat)).sort();
      if (!v.length) return v;               // shard sin cargar todavía: no cachear el vacío
      _vigGob.set(clave, v);
    }
    return _vigGob.get(clave);
  }
  // Selección de vigencia → filtro del cubo. Al comparar gobiernos las categorías son «Año k» (el k-ésimo año
  // del periodo de CADA gobierno) y se traducen al año calendario de ese gobierno.
  function vigSel(gobierno) {
    const sel = est.sel.vigencia;
    if (!sel) return 'Totales';
    if (!entreGob()) return sel;
    const vigs = vigenciasDe(gobierno);
    const anios = sel.map((x) => { const m = /^Año (\d+)$/.exec(x); return m ? vigs[Number(m[1]) - 1] : x; }).filter(Boolean);
    return anios.length ? anios : ['—'];     // ese gobierno no tiene ese año del periodo → sin datos
  }

  // Consulta base de una serie, con la selección cruzada activa aplicada
  function baseQ(gobierno, nombreInd) {
    return Medida.aplicar({
      gobierno, tipo_dato: IND_TD[nombreInd], indicador: IND_CUBO[nombreInd],
      sector: est.sel.sector || 'Total',
      departamento: est.sel.departamento || 'Total',
      vigencia: vigSel(gobierno),
      fuente_general: est.sel.fuente || 'Total',
      fuente_fondo: est.sel.fondo || 'Total',
      // linea1 (Eje) · linea2 (Tema) · linea3 (Estrategia): CADA nivel tiene su propia fila marginal
      // (el nivel siguiente en 'Total') que ya trae su gran total — y ADEMÁS cada hijo vive en su
      // propia fila (nivel siguiente = código). Dejar un nivel sin restringir cuenta el marginal Y
      // sus hijos a la vez (doble conteo), así que cada nivel fija el SIGUIENTE a 'Total' salvo que
      // haya algo elegido ahí. Los códigos de Tema y Estrategia (p. ej. "3.1", "3.1.2") ya son
      // únicos por sí solos (incluyen a su padre), así que basta con dejar los niveles de ARRIBA sin
      // fijar (DES) cuando no hay nada explícito elegido en ellos.
      linea1: est.sel.linea || (est.sel.tema || est.sel.estrategia ? DES : 'Total'),
      linea2: est.sel.estrategia ? DES : (est.sel.tema || 'Total'),
      linea3: est.sel.estrategia || 'Total',
      // entidad: SOLO existe desagregada dentro de fuente_general="PGN" (el resto del cubo la
      // trae en 'Total'); no es jerárquica con nada más, así que no necesita el patrón DES de
      // arriba — basta con no fijarla cuando no hay nada elegido (normalizar() en cubo.js ya
      // pone 'Total' por defecto).
      entidad: est.sel.entidad || 'Total'
    });
  }
  function serieQ(s, extra) {
    const q = entreGob() ? baseQ(s, inds()[0]) : baseQ(gobs()[0], s);
    return Object.assign(q, extra || {});
  }

  // ¿Aplica el orden especial de empresas? Solo «Fuente específica» (fuente_fondo), entre 2 gobiernos,
  // con «Empresas Públicas» como única fuente elegida en «Fuentes».
  const esEmpresasEntreGob = (arg) => arg === 'fuente_fondo' && entreGob() && gobs().length === 2 &&
    est.sel.fuente && est.sel.fuente.length === 1 && est.sel.fuente[0] === 'Empresas Públicas';
  // Orden pedido para comparar TODAS las empresas entre 2 gobiernos (nada de «Otros»): 1) las 5 más
  // grandes en el PPI 2027-2030 (o en el más reciente de los 2 elegidos, si 2027-2030 no es uno de
  // ellos); 2) el resto de empresas con monto en AMBOS gobiernos; 3) las que solo tienen monto en UNO.
  function ordenEmpresas() {
    const [gViejo, gNuevo] = gobs();   // gobs() ya viene cronológico: el más viejo primero
    const conMonto = (g) => new Set(Cubo.agregar(serieQ(g, { fuente_fondo: DES }), 'fuente_fondo')
      .filter((d) => d.valor > 0).map((d) => d.cat));
    const setViejo = conMonto(gViejo), setNuevo = conMonto(gNuevo);
    const gRef = gobs().includes('PPI 2027-2030') ? 'PPI 2027-2030' : gNuevo;
    const top5 = Cubo.agregar(serieQ(gRef, { fuente_fondo: DES }), 'fuente_fondo')
      .filter((d) => d.valor > 0).sort((a, b) => b.valor - a.valor).slice(0, 5).map((d) => d.cat);
    const resto = [...new Set([...setViejo, ...setNuevo])].filter((c) => !top5.includes(c));
    const compartidas = resto.filter((c) => setViejo.has(c) && setNuevo.has(c));
    const exclusivas = resto.filter((c) => !(setViejo.has(c) && setNuevo.has(c)));
    return top5.concat(compartidas, exclusivas);
  }

  // % REGIONALIZADO = 1 − (lo asignado a 'Nacional' ÷ el total), con la selección cruzada activa
  // (sector, fuente, vigencia, línea) pero SIN fijar departamento — es un indicador del universo
  // que se está mirando, no de un departamento en particular. Siempre en pesos CORRIENTES: el
  // per cápita no calcula un valor para 'Nacional' (no hay con qué dividir) y el % no depende del
  // año base de las constantes, así que se ignora la medida/unidad activa para este cálculo.
  function pctRegionalizado(s) {
    const q = Object.assign({}, serieQ(s), { departamento: 'Total', tipo_valor: 'corriente', base: null, pib: false });
    const total = Cubo.total(q);
    if (!(total > 0)) return null;
    const nacional = Cubo.total(Object.assign({}, q, { departamento: ['Nacional'] }));
    return 1 - nacional / total;
  }
  // En % del PIB la misma idea en la unidad de la pantalla: cuánto del total (en % del PIB) cae en departamentos (lo que pinta el mapa)
  // y cuánto es nacional o sin departamento (no se pinta). Devuelve { total, nacional } en % del PIB, o null.
  function pibRegional(s) {
    const q = Object.assign({}, serieQ(s), { departamento: 'Total' });
    const total = Cubo.total(q);
    if (!(total > 0)) return null;
    return { total, nacional: Cubo.total(Object.assign({}, q, { departamento: ['Nacional'] })) };
  }
  // Línea de nota con el % regionalizado de 1 o 2 series (según el modo del mapa)
  function notaRegional(seriesMapa) {
    if (Medida.pib) {
      const partes = seriesMapa.map((s) => {
        const r = pibRegional(s); if (!r) return null;
        return `${Formato.esc(s)}: de ${Formato.cop(r.total)} del PIB, ${Formato.cop(r.total - r.nacional)} está en departamentos (lo que pinta el mapa) ` +
               `y ${Formato.cop(r.nacional)} es nacional o sin departamento asignado (no se pinta)`;
      }).filter(Boolean);
      // El denominador (PIB de B) es siempre el PIB NACIONAL y no cambia con el departamento elegido —
      // no existe un "PIB departamental" en el tablero. Filtrar por departamento solo acota el numerador.
      return partes.length
        ? partes.join('. ') + '. El denominador es siempre el PIB nacional del año base (nunca uno departamental): ' +
          'al elegir un departamento se acota el numerador —su inversión— y el % baja, pero no se divide entre el PIB de ese departamento.'
        : null;
    }
    const partes = seriesMapa
      .map((s) => { const p = pctRegionalizado(s); return p === null ? null : `${Formato.esc(s)}: ${Formato.pct(p)}`; })
      .filter(Boolean);
    return partes.length
      ? `% regionalizado — ${partes.join(' · ')}. Es el % del total ya asignado a un departamento; ` +
        'el resto es inversión nacional o sin departamento asignado, y no aparece en el mapa.'
      : null;
  }

  // Selección múltiple por dimensión: un clic agrega y, si ya estaba, quita.
  // Excepción: en per cápita el departamento es de UNO a la vez (el per cápita de dos
  // departamentos no es la suma de los dos; ver medida.js).
  function alternar(dim, valor) {
    if (valor === 'Otros') return;              // agregado sintético: no filtra
    // El Tema elegido pertenece a UN Eje y la Estrategia a UN Tema: si el padre cambia, el hijo de
    // antes deja de tener sentido (y, sin esto, podría quedar fijando un nivel que ya no coincide).
    if (dim === 'linea') { est.sel.tema = null; est.sel.estrategia = null; }
    if (dim === 'tema') est.sel.estrategia = null;
    const actual = est.sel[dim];
    if (dim === 'departamento' && Medida.percapita) {
      est.sel[dim] = actual && actual.length === 1 && actual[0] === valor ? null : [valor];
      return;
    }
    if (!actual) est.sel[dim] = [valor];
    else if (actual.includes(valor)) {
      const resto = actual.filter((x) => x !== valor);
      est.sel[dim] = resto.length ? resto : null;
    } else est.sel[dim] = actual.concat([valor]);
  }
  const limpiarSel = () => { for (const k of Object.keys(est.sel)) est.sel[k] = null; est.fondoDe = null; };

  // La fuente específica pertenece a UNA fuente general: si la selección de fuentes deja de
  // ser esa sola fuente, la específica se descarta.
  function sincronizarFondo() {
    const f = est.sel.fuente;
    const unica = f && f.length === 1 ? f[0] : null;
    if (unica !== est.fondoDe) { est.sel.fondo = null; est.fondoDe = unica; }
  }

  // La entidad solo existe dentro de PGN: si «Fuentes» deja de ser exactamente PGN, se descarta.
  function sincronizarEntidad() {
    const f = est.sel.fuente;
    const esPGN = f && f.length === 1 && f[0] === 'PGN';
    if (!esPGN) est.sel.entidad = null;
    // vistaSector solo vuelve a «sectores» cuando REALMENTE se deja de tener PGN (transición, igual
    // que fondoDe arriba) — comparar "esPGN" a secas en cada pintar() nunca dejaría LLEGAR a la
    // vista Entidad sin tener PGN ya elegido (el botón quedaría roto: no pasaría nada al tocarlo,
    // porque este mismo chequeo la regresaría a «sectores» antes de pintarla).
    if (est.vistaSector === 'entidad' && est.huboPGN && !esPGN) est.vistaSector = 'sectores';
    est.huboPGN = esPGN;
  }

  // --------------------------------------------------------------------------
  function render(raiz) {
    if (!est.gobiernos.length) est.gobiernos = [Cubo.meta.gob_prog[0]];   // default: el PPI más reciente (hoy 2027-2030)

    UI.vaciar(raiz);
    raiz.append(UI.hero('Visor Interactivo', 'Explorador interactivo',
      'Cruce libre de la Tabla de indicadores: cada clic en el mapa o en las gráficas filtra ' +
      'todas las demás vistas y resalta lo seleccionado. Compare indicadores dentro de un ' +
      'gobierno o el mismo indicador entre gobiernos; con dos series verá el % de avance. ' +
      'Cifras en miles de millones de pesos, o en pesos por habitante si elige Per cápita.'));

    const panelFiltros = UI.h('div', { class: 'panel-fijo' });
    const avisos = UI.h('div', {});
    const kpis = UI.h('div', {});
    const chips = UI.h('div', {});
    const notaUnidad = UI.h('div', {});
    const contFuentes = UI.h('div', {});
    const contFondo = UI.h('div', {});
    const contVigencias = UI.h('div', {});
    const contSectores = UI.h('div', {});
    const contProgramas = UI.h('div', {});
    const contEntidad = UI.h('div', {});
    const contMapa = UI.h('div', { style: { height: '420px' } });
    const contLeyenda = UI.h('div', {});
    const contLineas = UI.h('div', {});

    // Envoltorios de las dos cajas con selector de vista (Fuentes↔Fuente específica,
    // Sectores↔Programas↔Entidad): cada contenedor de contenido sigue siendo el mismo de
    // siempre (pintar() los sigue llenando exactamente igual), solo se oculta el que no
    // corresponde a la vista activa — ver pintar(). Título y acciones del header son nodos
    // persistentes para poder repintarlos cada ciclo (texto distinto, botón activo distinto).
    const envFuentes = UI.h('div', {}, contFuentes);
    const envFondo = UI.h('div', {}, contFondo);
    const tituloFuentes = UI.h('span', {});
    const accFuentes = UI.h('div', {});
    const envSectores = UI.h('div', {}, contSectores);
    const envProgramas = UI.h('div', {}, contProgramas);
    const envEntidad = UI.h('div', {}, contEntidad);
    const tituloSector = UI.h('span', {});
    const accSector = UI.h('div', {});

    raiz.append(UI.h('main', { class: 'container-xl dnp-main' },
      UI.h('div', { class: 'fila' },
        UI.h('div', { class: 'col-filtros' }, panelFiltros),
        UI.h('div', { class: 'col-contenido' },
          avisos, notaUnidad, kpis, chips,
          // Fila 1: dos cajas · Fila 2: sector y departamento (mapa) lado a lado
          UI.h('div', { class: 'fila-graficas' },
            UI.h('div', { class: 't col-t-ancha' },
              UI.card(tituloFuentes, UI.h('div', {}, envFuentes, envFondo), { acciones: accFuentes })),
            UI.h('div', { class: 't col-t' }, UI.card('Vigencias', contVigencias))),
          UI.h('div', { class: 'fila-graficas' },
            UI.h('div', { class: 'col-7' },
              UI.card(tituloSector, UI.h('div', {}, envSectores, envProgramas, envEntidad), { acciones: accSector })),
            UI.h('div', { class: 'col-5' }, UI.card('Departamentos',
              UI.h('div', {}, contMapa, contLeyenda)))),
          contLineas))));

    // Se crea abajo, cuando la geometría ya esté cargada
    let mapa = null;

    // --- Panel de filtros -----------------------------------------------------
    function pintarFiltros() {
      const disp = indsDisp();
      // Si el per cápita no existe para la selección, se vuelve a totales
      const pc = pcDisponible();
      if (!pc && Medida.percapita) Medida.fijar({ percapita: false });
      // «% del PIB» no aplica al comparar dos indicadores del mismo gobierno (el avance % ya es una razón)
      const pibOk = entreGob() || series().length !== 2;
      if (!pibOk && Medida.pib) Medida.fijar({ pib: false });
      UI.vaciar(panelFiltros);
      panelFiltros.append(UI.card('Filtros', UI.h('div', {},
        UI.grupoBotones({
          etiqueta: 'Comparar', opciones: ['Por gobierno', 'Entre gobiernos'], valor: est.ambito,
          onCambio: (v) => {
            est.ambito = v;
            // Al pasar a "Entre gobiernos" se proponen los dos PPI programados
            // más recientes (sin hardcodear cuáles son).
            if (v === 'Entre gobiernos' && est.gobiernos.length < 2) {
              est.gobiernos = Cubo.meta.gob_prog.slice(0, 2).sort();
            } else if (v === 'Por gobierno') {
              est.gobiernos = [gobs()[0]];
            }
            est.vista = 'Totales';   // las opciones de «Comparación» son distintas en cada ámbito
            limpiarSel(); pintarFiltros(); actualizar();
          }
        }),
        entreGob()
          ? UI.picker({
              etiqueta: 'Gobiernos / PPI', opciones: Cubo.meta.gobiernos, multiple: true,
              valor: est.gobiernos, textoTodas: 'Todos',
              onCambio: (v) => { est.gobiernos = v; limpiarSel(); pintarFiltros(); actualizar(); }
            })
          : UI.picker({
              etiqueta: 'Gobierno / PPI', opciones: Cubo.meta.gobiernos, valor: gobs()[0],
              onCambio: (v) => { est.gobiernos = [v]; limpiarSel(); pintarFiltros(); actualizar(); }
            }),
        entreGob()
          ? UI.picker({
              etiqueta: 'Indicador', opciones: disp, valor: inds()[0],
              onCambio: (v) => { est.indicadores = [v]; pintarFiltros(); actualizar(); }
            })
          : UI.picker({
              etiqueta: 'Indicadores', opciones: disp, multiple: true, valor: inds(),
              onCambio: (v) => { est.indicadores = v; pintarFiltros(); actualizar(); }
            }),
        UI.h('hr', { class: 'divisor' }),
        // Antes vivían en el popover «Filtros adicionales»; ahora van directo en el panel.
        Medida.controles({
          prefijo: 'visor', pcDisponible: pc, pibDisponible: pibOk,
          motivoPib: 'No aplica al comparar dos indicadores: el avance % ya es una razón',
          onCambio: (que) => {
            // En per cápita el departamento es de uno a la vez
            if (que === 'medida' && Medida.percapita && est.sel.departamento && est.sel.departamento.length > 1) {
              est.sel.departamento = [est.sel.departamento[0]];
            }
            pintarFiltros(); actualizar();
          }
        }),
        // 'Avance %' solo aplica comparando 2 indicadores del MISMO gobierno:
        // entre gobiernos no es un avance sino una razón.
        (!entreGob() && series().length === 2)
          ? UI.grupoBotones({
              etiqueta: 'Comparación', opciones: ['Totales', 'Avance %'], valor: vista(),
              onCambio: (v) => { est.vista = v; pintarFiltros(); actualizar(); }
            })
          // Entre 2 gobiernos: indicadores de validación — diferencia en totales o en participación,
          // con color por la MAGNITUD del cambio (verde chico, rojo grande; ver tema.js:colorCambio).
          : (entreGob() && gobs().length === 2)
          ? UI.grupoBotones({
              etiqueta: 'Comparación', vertical: true,
              opciones: ['Totales', 'Cambio en totales', 'Cambio en % de participación'], valor: vista(),
              onCambio: (v) => { est.vista = v; pintarFiltros(); actualizar(); }
            })
          : null
      ), { clase: 'card-filtros' }));
    }

    // --- Actualización de todas las vistas -------------------------------------
    let token = 0;
    async function actualizar() {
      const mio = ++token;
      kpis.replaceChildren(UI.cargando('Cargando el corte…'));
      await Cubo.preparar(gobs(), Medida.tipoValor());
      if (mio !== token) return;              // llegó una selección más nueva
      pintar();
    }

    function pintar() {
      const m = modo(), mb = modoBarras();
      const s1 = series()[0], s2 = series()[1];
      Formato.modo = Medida.pib ? 'pib' : 'cop';        // «% del PIB» se muestra con decimales y sin «$»
      sincronizarFondo();
      sincronizarEntidad();

      // --- Selector de vista de las dos cajas fusionadas: cambia qué sub-caja se ve, nunca
      // dispara una nueva consulta (por eso el botón llama pintar(), no actualizar()).
      envFuentes.hidden = est.vistaFuentes !== 'fuentes';
      envFondo.hidden = est.vistaFuentes !== 'especifica';
      UI.vaciar(tituloFuentes).append(est.vistaFuentes === 'fuentes'
        ? 'Fuentes'
        : UI.h('span', {}, 'Fuente específica ',
            UI.h('span', { class: 'texto-suave' }, '— desglose de la fuente elegida en «Fuentes»')));
      UI.vaciar(accFuentes).append(UI.grupoBotones({
        opciones: [{ valor: 'fuentes', texto: 'Fuentes' }, { valor: 'especifica', texto: 'Específica' }],
        valor: est.vistaFuentes,
        onCambio: (v) => { est.vistaFuentes = v; pintar(); }
      }));

      envSectores.hidden = est.vistaSector !== 'sectores';
      envProgramas.hidden = est.vistaSector !== 'programas';
      envEntidad.hidden = est.vistaSector !== 'entidad';
      const TITULOS_SECTOR = {
        sectores: 'Sectores',
        programas: UI.h('span', {}, 'Programas ',
          UI.h('span', { class: 'texto-suave' }, '— desglose del sector elegido en «Sectores»')),
        entidad: UI.h('span', {}, 'Entidad ',
          UI.h('span', { class: 'texto-suave' }, '— desglose por entidad del PGN'))
      };
      UI.vaciar(tituloSector).append(TITULOS_SECTOR[est.vistaSector]);
      UI.vaciar(accSector).append(UI.grupoBotones({
        opciones: [{ valor: 'sectores', texto: 'Sectores' }, { valor: 'programas', texto: 'Programas' },
                   { valor: 'entidad', texto: 'Entidad (PGN)' }],
        valor: est.vistaSector,
        onCambio: (v) => { est.vistaSector = v; pintar(); }
      }));

      // --- Aviso de cobertura: un PPI "preliminar" (p. ej. 2027-2030, que hoy no trae PGN, SGR,
      // Cooperación ni Privados) no es comparable con los completos; se dice en pantalla.
      // El texto viene del catálogo de gobiernos (estado / cobertura), no está escrito aquí.
      UI.vaciar(avisos);
      gobs().map((g) => Cubo.infoGobierno(g)).filter((i) => i.estado && i.estado !== 'completo')
        .forEach((i) => avisos.append(UI.h('div', { class: 'aviso-cobertura', role: 'note' },
          UI.h('strong', {}, i.ppi_gobierno + ' · ' + i.estado + '. '),
          i.cobertura || '')));

      // --- Nota de unidad: qué se está mostrando y cómo se calculó
      UI.vaciar(notaUnidad);
      {
        const partes = [UI.h('b', {}, 'Unidad: '), Medida.etiqueta() + '.'];
        if (Medida.percapita) {
          partes.push(' Valor ÷ población proyectada DANE del departamento (nacional si no hay uno elegido); ' +
            'el cuatrienio suma los per cápita de cada año. En per cápita se elige un departamento a la vez ' +
            'y lo no regionalizado solo entra al total nacional.');
        }
        if (Medida.constantes) {
          const d = Cubo.meta.deflactores || {};
          partes.push(` Constantes calculadas en el navegador con el deflactor implícito del PIB del MFMP ` +
            `${d.corte || ''} (año base ${Medida.base}); en revisión.`);
        }
        if (Medida.pib) {
          partes.push(' Inversión ÷ PIB nominal, en pesos del mismo año; con varios años (o el total del periodo) se suma la ' +
            'inversión y el PIB de esos mismos años, en precios comparables entre sí, y se divide al final — nunca se divide ' +
            'una suma de varios años entre el PIB de uno solo. Todos los gráficos de una misma selección comparten el mismo ' +
            'periodo, así que cada año, departamento, sector o fuente es su aporte al % del PIB y las partes suman el total.');
        }
        notaUnidad.append(UI.h('div', { class: 'nota-unidad', role: 'note' }, partes));
      }

      // --- KPIs. Entre gobiernos: el más reciente SIEMPRE primero (seriesVisual(), igual que barras/leyendas).
      UI.vaciar(kpis);
      if (m === 'balance') {
        const v1 = Cubo.total(serieQ(s1)), v2 = Cubo.total(serieQ(s2));
        // La razón SIEMPRE en corrientes (Medida.enCorrientes): en % del PIB, s1/s2 pueden cubrir distinto
        // conjunto de años (p. ej. dos gobiernos) y por lo tanto distinto denominador — dividir las cifras ya
        // convertidas a % del PIB mezclaría dos denominadores distintos.
        const v1c = Cubo.total(Medida.enCorrientes(serieQ(s1))), v2c = Cubo.total(Medida.enCorrientes(serieQ(s2)));
        kpis.append(UI.filaKpis(
          UI.kpi(Formato.cop(v2), s2 + ' de la selección', 'dorado'),
          UI.kpi(Formato.cop(v1), s1 + ' de la selección'),
          UI.kpi(Formato.pct(v1c > 0 ? v2c / v1c : null), s2 + ' / ' + s1, 'acento')));
      } else if (m === 'multi') {
        const acentos = [null, 'dorado', 'acento'];       // con más de 3 series los colores se repiten; la fila se parte en renglones
        kpis.append(UI.filaKpis(...seriesVisual().map((s, i) =>
          UI.kpi(Formato.cop(Cubo.total(serieQ(s))), s + ' de la selección', acentos[i % acentos.length]))));
      } else {
        const totSel = Cubo.total(serieQ(s1));
        // Universo = el mismo indicador SIN la selección cruzada
        const qUni = Medida.aplicar(entreGob()
          ? { gobierno: s1, tipo_dato: IND_TD[inds()[0]], indicador: IND_CUBO[inds()[0]] }
          : { gobierno: gobs()[0], tipo_dato: IND_TD[s1], indicador: IND_CUBO[s1] });
        const totUni = Cubo.total(qUni);
        // La razón SIEMPRE en corrientes (Medida.enCorrientes): en % del PIB, la selección y el universo
        // pueden cubrir distinto conjunto de años y por lo tanto distinto denominador.
        const razon = Cubo.total(Medida.enCorrientes(serieQ(s1))) / Cubo.total(Medida.enCorrientes(qUni));
        const etqPart = entreGob() ? '% del total de ' + s1
          : s1 === 'Planeado PPI' ? '% del total del PPI' : '% del total de ' + s1.toLowerCase();
        const etqUni = entreGob() ? 'Total de ' + s1
          : s1 === 'Planeado PPI' ? 'Total del PPI' : 'Total de ' + s1.toLowerCase();
        // Privados, de ese mismo total sin filtros: solo tiene sentido para Planeado PPI (es la única
        // medida donde Privados trae dato — no hay ejecución de privados).
        const detalleUni = s1 === 'Planeado PPI'
          ? (() => {
              const totPriv = Cubo.total(Object.assign({}, qUni, { fuente_general: ['Privados'] }));
              return totPriv > 0 ? `de los cuales ${Formato.cop(totPriv)} son privados (${Formato.pct(totPriv / totUni)})` : null;
            })()
          : null;
        kpis.append(UI.filaKpis(
          UI.kpi(Formato.cop(totSel), `${s1} de la selección (${Medida.corta()})`),
          UI.kpi(Formato.pct(totUni > 0 ? razon : null), etqPart, 'dorado'),
          UI.kpi(Formato.cop(totUni), etqUni + ' (sin filtros)', 'acento', detalleUni)));
      }

      // --- Chips de la selección cruzada
      const etiquetas = {
        Sector: est.sel.sector, Departamento: est.sel.departamento,
        Vigencia: est.sel.vigencia, Fuente: est.sel.fuente, 'Fuente específica': est.sel.fondo,
        Eje: est.sel.linea ? est.sel.linea.map((c) => Cubo.etiqLinea(gobs()[0], c)) : null,
        Tema: est.sel.tema ? est.sel.tema.map((c) => Cubo.etiqLinea(gobs()[0], c)) : null,
        Estrategia: est.sel.estrategia ? est.sel.estrategia.map((c) => Cubo.etiqLinea(gobs()[0], c)) : null,
        Entidad: est.sel.entidad
      };
      const claveDim = { Sector: 'sector', Departamento: 'departamento', Vigencia: 'vigencia', Fuente: 'fuente', 'Fuente específica': 'fondo', Eje: 'linea', Tema: 'tema', Estrategia: 'estrategia', Entidad: 'entidad' };
      UI.vaciar(chips).append(UI.chips(etiquetas,
        (dim) => {
          est.sel[claveDim[dim]] = null;
          if (claveDim[dim] === 'fuente') { est.sel.fondo = null; est.sel.entidad = null; }
          if (claveDim[dim] === 'linea') { est.sel.tema = null; est.sel.estrategia = null; }
          if (claveDim[dim] === 'tema') est.sel.estrategia = null;
          actualizar();
        },
        () => { limpiarSel(); actualizar(); }));

      // --- Datos por dimensión, según el modo
      //   'simple'  → una serie
      //   'overlay' → planeado de fondo + ejecutado encima con el %
      //   'grupo'   → una barra por serie
      const porDim = (arg) => {
        if (mb === 'overlay') {
          const den = new Map(Cubo.agregar(serieQ(s1, { [arg]: DES }), arg).map((d) => [d.cat, d.valor]));
          const num = new Map(Cubo.agregar(serieQ(s2, { [arg]: DES }), arg).map((d) => [d.cat, d.valor]));
          return [...new Set([...den.keys(), ...num.keys()])].map((cat) => ({
            cat, planeado: den.get(cat) || 0, ejecutado: num.get(cat) || 0
          }));
        }
        if (mb === 'grupo') {
          if (entreGob() && arg === 'vigencia') {
            // una sola barra (con el color de cada gobierno) por AÑO DEL PERIODO; el año calendario va en el tooltip
            return seriesVisual().flatMap((s) => {
              const vigs = vigenciasDe(s);
              return Cubo.agregar(serieQ(s, { vigencia: DES }), 'vigencia').map((d) =>
                ({ cat: 'Año ' + (vigs.indexOf(String(d.cat)) + 1), serie: s, valor: d.valor, nota: String(d.cat) }));
            });
          }
          return seriesVisual().flatMap((s) =>
            Cubo.agregar(serieQ(s, { [arg]: DES }), arg).map((d) => ({ cat: d.cat, serie: s, valor: d.valor })));
        }
        return Cubo.agregar(serieQ(s1, { [arg]: DES }), arg);
      };

      const vacio = (cont) => {
        UI.vaciar(cont).append(UI.estadoVacio(MSG_UNGOB, DET_UNGOB));
      };

      // --- Indicadores de validación (solo entre 2 gobiernos, mb 'cambio'/'participacion'): por cada
      // categoría de `arg`, compara s1 (viejo) contra s2 (nuevo) — en pesos (cambio en totales) o en
      // participación (valor ÷ total de esa misma dimensión en ese gobierno; cambio en puntos). El color
      // es por la MAGNITUD de la variación relativa (tema.js:colorCambio), no por el signo. `vigencia` se
      // alinea por «Año k» del periodo (como porDim) porque los calendarios de los 2 gobiernos no coinciden.
      const porValidacion = (arg, n) => {
        if (arg === 'vigencia') {
          // Por vigencia, «cambio en totales»/«participación» compara cada año CON EL SIGUIENTE, en
          // una sola serie cronológica continua con los años de los 2 gobiernos (incluida la
          // transición entre ambos) — no el Año k de un gobierno contra el Año k del otro (esa
          // alineación por año DEL PERIODO es la que usa el gráfico de Vigencias en modo normal).
          const mapa1 = new Map(Cubo.agregar(serieQ(s1, { vigencia: DES }), 'vigencia').map((d) => [String(d.cat), d.valor]));
          const mapa2 = new Map(Cubo.agregar(serieQ(s2, { vigencia: DES }), 'vigencia').map((d) => [String(d.cat), d.valor]));
          const anios = [...new Set([...mapa1.keys(), ...mapa2.keys()])].sort();
          const valorDe = (a) => mapa1.get(a) ?? mapa2.get(a) ?? 0;
          const totCombinado = anios.reduce((acc, a) => acc + valorDe(a), 0);
          const pDe = (a) => (totCombinado > 0 ? valorDe(a) / totCombinado : 0);
          const filas = [];
          for (let i = 1; i < anios.length; i++) {
            const a0 = anios[i - 1], a1 = anios[i];
            filas.push({ cat: a0 + ' → ' + a1, v1: valorDe(a0), v2: valorDe(a1), p1: pDe(a0), p2: pDe(a1) });
          }
          return { filas, otros: [] };
        }
        const den = new Map(Cubo.agregar(serieQ(s1, { [arg]: DES }), arg).map((d) => [d.cat, d.valor]));
        const num = new Map(Cubo.agregar(serieQ(s2, { [arg]: DES }), arg).map((d) => [d.cat, d.valor]));
        const tot1 = [...den.values()].reduce((a, b) => a + b, 0), tot2 = [...num.values()].reduce((a, b) => a + b, 0);
        let filas = [...new Set([...den.keys(), ...num.keys()])].map((cat) => {
          const v1 = den.get(cat) || 0, v2 = num.get(cat) || 0;
          return { cat, v1, v2, p1: tot1 > 0 ? v1 / tot1 : 0, p2: tot2 > 0 ? v2 / tot2 : 0 };
        });
        let otros = [];
        if (esEmpresasEntreGob(arg)) {
          const orden = ordenEmpresas();
          const rango = new Map(orden.map((c, i) => [c, i]));
          filas = filas.filter((f) => rango.has(f.cat)).sort((a, b) => rango.get(a.cat) - rango.get(b.cat));
        } else {
          filas.sort((a, b) => (b.v1 + b.v2) - (a.v1 + a.v2));
          if (filas.length > n) { otros = filas.slice(n).map((f) => f.cat); filas = filas.slice(0, n); }
        }
        return { filas, otros };
      };
      const pintarCambio = (cont, arg, clave, n, puntos) => {
        const { filas, otros } = porValidacion(arg, n);
        const esVig = arg === 'vigencia';   // año → año siguiente: "cat" ya no es un valor de filtro válido
        const datos = filas.map((f) => {
          const base = puntos ? f.p1 : f.v1, actual = puntos ? f.p2 : f.v2;
          const valor = actual - base;
          const variacion = base > 0 ? valor / base : NaN;
          const color = colorCambio([variacion])[0];
          const [etq1, etq2] = esVig ? f.cat.split(' → ') : [s1, s2];
          const tooltip = puntos
            ? `<b>${Formato.esc(f.cat)}</b><br>${Formato.esc(etq1)}: ${Formato.pct(f.p1)}<br>${Formato.esc(etq2)}: ${Formato.pct(f.p2)}<br>` +
              `Diferencia: ${Formato.pp(valor)}<br>Variación de la participación: ${Formato.pct(variacion, 1, true)}`
            : `<b>${Formato.esc(f.cat)}</b><br>${Formato.esc(etq1)}: ${Formato.cop(f.v1)}<br>${Formato.esc(etq2)}: ${Formato.cop(f.v2)}<br>` +
              `Diferencia: ${Formato.cop(valor, 0, true)}<br>Variación: ${Formato.pct(variacion, 1, true)}`;
          return { cat: f.cat, valor, color, tooltip };
        });
        cont.append(Graficas.barrasCambio(datos, {
          onClick: esVig ? null : (c) => { alternar(clave, c); actualizar(); }, seleccion: esVig ? null : est.sel[clave],
          formatear: puntos ? (v) => Formato.pp(v) : (v) => Formato.cop(v, 0, true)
        }));
        // Leyenda de color por magnitud (mismos cortes y colores del mapa en modo «cambio»), debajo
        // de la gráfica como la del mapa — el color no indica creció/decreció, sino qué tan grande
        // fue el cambio (ver colorCambio en tema.js).
        cont.append(Mapa.leyenda(PAL_CAMBIO, ETIQ_CAMBIO, 'Magnitud de la variación'));
        if (otros.length) {
          cont.append(UI.h('div', { class: 'sectores-otros' },
            UI.h('b', {}, `Otros (${otros.length}): `), otros.join(', ')));
        }
        return datos.length;
      };

      // --- Fuentes
      UI.vaciar(contFuentes);
      if (mb === 'aviso') vacio(contFuentes);
      else if (mb === 'cambio' || mb === 'participacion') pintarCambio(contFuentes, 'fuente_general', 'fuente', 12, mb === 'participacion');
      else {
        const d = porDim('fuente_general');
        // Fuentes de MAYOR a MENOR: por lo planeado (balance) o por el total de las series (una o varias, también entre gobiernos)
        if (mb === 'overlay') d.sort((a, b) => b.planeado - a.planeado);
        else if (mb === 'grupo') { const tot = new Map(); d.forEach((x) => tot.set(x.cat, (tot.get(x.cat) || 0) + x.valor)); d.sort((a, b) => tot.get(b.cat) - tot.get(a.cat)); }
        if (mb === 'overlay') {
          contFuentes.append(Graficas.barrasBalance(d, {
            onClick: (c) => { alternar('fuente', c); actualizar(); }, seleccion: est.sel.fuente,
            nombrePlan: s1, nombreEjec: s2, orientacion: 'h', ancho: 360, margenIzq: 108
          }));
        } else if (mb === 'grupo') {
          const g = Graficas.barrasAgrupadas(d, {
            onClick: (c) => { alternar('fuente', c); actualizar(); }, seleccion: est.sel.fuente,
            pal: palSeries(), orientacion: 'h', ancho: 360, margenIzq: 108
          });
          contFuentes.append(g.svg, Graficas.leyenda(g.series, g.pal));
        } else {
          const dona = Graficas.dona(d.sort((a, b) => b.valor - a.valor), {
            onClick: (c) => { alternar('fuente', c); actualizar(); },
            seleccion: est.sel.fuente, colores: PAL_FUENTES, ancho: 340, alto: 240
          });
          dona.classList.add('grafica-dona-chica');
          contFuentes.append(dona);
        }
      }

      // --- Vigencias (siempre en orden cronológico)
      UI.vaciar(contVigencias);
      if (mb === 'aviso') vacio(contVigencias);
      else if (mb === 'cambio' || mb === 'participacion') pintarCambio(contVigencias, 'vigencia', 'vigencia', 20, mb === 'participacion');
      else {
        const d = porDim('vigencia');
        const orden = (a, b) => String(a.cat).localeCompare(String(b.cat), 'es', { numeric: true });
        if (mb === 'overlay') {
          contVigencias.append(Graficas.barrasBalance(d.sort(orden), {
            onClick: (c) => { alternar('vigencia', c); actualizar(); }, seleccion: est.sel.vigencia,
            nombrePlan: s1, nombreEjec: s2, orientacion: 'v', ancho: 320
          }));
        } else if (mb === 'grupo' && entreGob()) {
          // Entre gobiernos, eje X = AÑO CALENDARIO real (no «Año k»): cada gobierno dibuja solo
          // sus propios años, así los periodos distintos no se solapan ni aparecen en cero.
          const datosLin = seriesVisual().flatMap((s) =>
            Cubo.agregar(serieQ(s, { vigencia: DES }), 'vigencia').map((x) => ({ cat: String(x.cat), serie: s, valor: x.valor })));
          const g = Graficas.lineas(datosLin, {
            pal: palSeries(), ancho: 320, alto: 240,
            onClick: (anio, s) => {
              const idx = vigenciasDe(s).indexOf(anio);
              if (idx >= 0) { alternar('vigencia', 'Año ' + (idx + 1)); actualizar(); }
            }
          });
          contVigencias.append(g.svg, Graficas.leyenda(g.series, g.pal));
        } else if (mb === 'grupo') {
          const g = Graficas.barrasAgrupadas(d.sort(orden), {
            onClick: (c) => { alternar('vigencia', c); actualizar(); }, seleccion: est.sel.vigencia,
            pal: palSeries(), orientacion: 'v', ancho: 320
          });
          contVigencias.append(g.svg, Graficas.leyenda(g.series, g.pal));
        } else {
          contVigencias.append(Graficas.barrasV(d.sort(orden), {
            onClick: (c) => { alternar('vigencia', c); actualizar(); }, seleccion: est.sel.vigencia,
            ancho: 320, alto: 240
          }));
        }
      }

      // --- Barras horizontales «top 12 + Otros», para que lo visible cuadre con el total.
      //     Las usan Sectores y Fuente específica (mismo comportamiento, otra dimensión).
      //   arg: dimensión del cubo · clave: llave de selección cruzada (est.sel[clave])
      const pintarTop = (cont, arg, clave, lista, n = 12) => {
        if (mb === 'cambio' || mb === 'participacion') return pintarCambio(cont, arg, clave, n, mb === 'participacion');
        const d = porDim(arg);
        let otros = [];
        const alSel = (c) => { alternar(clave, c); actualizar(); };
        if (mb === 'overlay') {
          const orden = d.sort((a, b) => b.planeado - a.planeado);
          let datos = orden;
          if (orden.length > n) {
            const resto = orden.slice(n);
            otros = resto.map((x) => x.cat);
            datos = orden.slice(0, n).concat([{
              cat: 'Otros',
              planeado: resto.reduce((a, x) => a + x.planeado, 0),
              ejecutado: resto.reduce((a, x) => a + x.ejecutado, 0)
            }]);
          }
          cont.append(Graficas.barrasBalance(datos, {
            onClick: alSel, seleccion: est.sel[clave],
            nombrePlan: s1, nombreEjec: s2, orientacion: 'h'
          }));
        } else if (mb === 'grupo') {
          // Empresas Públicas, entre 2 gobiernos: orden especial pedido — 5 más grandes del PPI
          // 2027-2030, luego compartidas, luego exclusivas. TODAS las empresas, sin «Otros».
          const especial = esEmpresasEntreGob(arg);
          // El ranking usa el total sumado de todas las series, igual que en R
          const tot = new Map();
          d.forEach((x) => tot.set(x.cat, (tot.get(x.cat) || 0) + x.valor));
          const orden = especial ? ordenEmpresas().filter((c) => tot.has(c)) : [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
          const top = especial ? orden : orden.slice(0, n);
          otros = especial ? [] : orden.slice(n);
          // OJO: filter() conserva el orden de `d` (el del cubo), NO el de `top` — hay que reordenar
          // explícito por el ranking, si no las barras salen filtradas pero sin ordenar de mayor a menor.
          const rango = new Map(top.map((c, i) => [c, i]));
          const datos = d.filter((x) => top.includes(x.cat))
            .sort((a, b) => rango.get(a.cat) - rango.get(b.cat))
            .concat(otros.length ? seriesVisual().map((s) => ({
              cat: 'Otros', serie: s,
              valor: d.filter((x) => otros.includes(x.cat) && x.serie === s).reduce((a, x) => a + x.valor, 0)
            })) : []);
          if (lista) {
            // nombres largos + varias series (gobiernos): etiqueta encima y una barra por serie
            cont.append(Graficas.barrasLista(datos, { onClick: alSel, seleccion: est.sel[clave], pal: palSeries() }),
              Graficas.leyenda(seriesVisual(), palSeries()));
          } else {
            const g = Graficas.barrasAgrupadas(datos, {
              onClick: alSel, seleccion: est.sel[clave], pal: palSeries(), orientacion: 'h'
            });
            cont.append(g.svg, Graficas.leyenda(g.series, g.pal));
          }
        } else {
          const r = Graficas.topOtros(d, n);
          otros = r.otros;
          // lista = etiqueta encima de la barra (nombres largos, como las fuentes específicas)
          cont.append(lista
            ? Graficas.barrasLista(r.datos, { onClick: alSel, seleccion: est.sel[clave] })
            : Graficas.barrasH(r.datos, { onClick: alSel, seleccion: est.sel[clave] }));
        }
        if (otros.length) {
          cont.append(UI.h('div', { class: 'sectores-otros' },
            UI.h('b', {}, `Otros (${otros.length}): `), otros.join(', ')));
        }
        return d.length;
      };

      // --- Sectores
      UI.vaciar(contSectores);
      if (mb === 'aviso') vacio(contSectores);
      else pintarTop(contSectores, 'sector', 'sector', false, 20);   // los 20 mayores + «Otros» (el resto, listado debajo)

      // Pista «sin datos», reutilizada por «Fuente específica» y «Entidad» — cada una pasa su
      // propio contenedor (antes estaba fija a contFondo: los avisos de Entidad se pintaban ahí
      // sin que nadie los viera, nunca en su propia caja). Es un aviso informativo, no un error:
      // sin flecha (ya no hay una caja vecina a la que apuntar, ambas viven en cajas con selector).
      const pista = (cont, msg, det) => cont.append(UI.h('div', { class: 'fuente-esp-vacia' },
        UI.h('div', { class: 'icono-aviso', 'aria-hidden': 'true' }, 'i'),
        UI.h('div', { class: 'msg' }, msg), UI.h('div', { class: 'det' }, det)));

      // --- Fuente específica: desglose de UNA fuente general elegida en «Fuentes».
      //     Por defecto (sin fuente) queda vacía, con una pista que apunta a «Fuentes».
      UI.vaciar(contFondo);
      const fuentesSel = est.sel.fuente || [];
      if (mb === 'aviso') {
        vacio(contFondo);
      } else if (!fuentesSel.length) {
        pista(contFondo, 'Elija una fuente para ver su desglose',
          'Haga clic en una fuente del gráfico «Fuentes»: aquí aparecerán sus fuentes específicas.');
      } else if (fuentesSel.length > 1) {
        pista(contFondo, `Hay ${fuentesSel.length} fuentes seleccionadas`,
          'El desglose es de una sola fuente: deje una sola elegida en «Fuentes».');
      } else if (est.sel.linea) {
        pista(contFondo, 'Sin cruce con las líneas del PND',
          'El cubo no cruza la fuente específica con las líneas del PND: quite la línea elegida para ver el desglose.');
      } else {
        contFondo.append(UI.h('div', { class: 'fuente-esp-de' }, 'Fuente:', UI.h('span', {}, fuentesSel[0])));
        const n = pintarTop(contFondo, 'fuente_fondo', 'fondo', true, entreGob() ? 16 : 12);
        if (!n) {
          UI.vaciar(contFondo);
          pista(contFondo, 'Sin desglose para esta combinación',
            'Esta fuente no tiene fuente específica con los filtros elegidos, o el cubo no cruza esa combinación.');
        } else {
          contFondo.append(UI.h('p', { class: 'texto-suave', style: { margin: '.5rem 0 0' } },
            'Clic en una barra para filtrar todo el visor por esa fuente específica.' +
            (entreGob() ? ' Las fuentes específicas están homologadas para poder compararlas entre gobiernos; ' +
                          'cuando un gobierno no las desagrega (p. ej. el SGR de Santos y Duque) su monto aparece en una sola categoría genérica.' : '')));
        }
      }

      // --- Entidad: desglose por entidad, SOLO existe dentro de PGN (ver baseQ/entidad). A
      //     diferencia de «Fuente específica», sí cruza con las líneas del PND (en programación).
      //     Tarjeta siempre visible (igual que Programas): con una pista cuando no aplica.
      UI.vaciar(contEntidad);
      const esPGN = fuentesSel.length === 1 && fuentesSel[0] === 'PGN';
      if (mb === 'aviso') {
        vacio(contEntidad);
      } else if (!esPGN) {
        pista(contEntidad, 'Elija PGN en «Fuentes» para ver el desglose por entidad',
          'La entidad solo existe dentro del PGN: haga clic en «PGN» en el gráfico «Fuentes» (y deje esa sola fuente elegida).');
      } else {
        const n = pintarTop(contEntidad, 'entidad', 'entidad', true, entreGob() ? 16 : 12);
        if (!n) {
          UI.vaciar(contEntidad);
          pista(contEntidad, 'Sin desglose para esta combinación',
            'El PGN no tiene entidades con los filtros elegidos, o el cubo no cruza esa combinación.');
        } else {
          contEntidad.append(UI.h('p', { class: 'texto-suave', style: { margin: '.5rem 0 0' } },
            'Clic en una barra para filtrar todo el visor por esa entidad. En PPI 2027-2030 el PGN es ' +
            'solo funcionamiento, así que el ranking de entidades no se parece al de gobiernos anteriores.'));
        }
      }

      // --- Programas del sector elegido
      pintarProgramas();

      // --- Mapa
      pintarMapa(m, s1, s2);

      // --- Líneas estratégicas del PND
      pintarLineas();
    }

    // --- Programas: desglose de UN sector elegido en «Sectores», solo para «Planeado PPI».
    //     Un gobierno → top 12 programas + Otros. Varios gobiernos («Entre gobiernos») → los 12 programas mayores
    //     en conjunto, con una barra por gobierno (se comparan por NOMBRE de programa: los de 2011-2018 usan otra numeración).
    //     Informativa (el cubo no cruza programas con las demás dimensiones): las barras no filtran.
    //     Respeta fuente, departamento, vigencia y la unidad (corrientes, constantes o % del PIB). Ver programas.js.
    let tokProg = 0;
    async function pintarProgramas() {
      const mio = ++tokProg;
      UI.vaciar(contProgramas);
      const pistaP = (msg, det) => contProgramas.append(UI.h('div', { class: 'fuente-esp-vacia' },
        UI.h('div', { class: 'icono-aviso', 'aria-hidden': 'true' }, 'i'),
        UI.h('div', { class: 'msg' }, msg), UI.h('div', { class: 'det' }, det)));
      const sectoresSel = est.sel.sector || [];
      if (modoBarras() === 'aviso') return UI.vaciar(contProgramas).append(UI.estadoVacio(MSG_UNGOB, DET_UNGOB));
      if (inds()[0] !== 'Planeado PPI' || (!entreGob() && modo() !== 'simple')) return pistaP('Solo para «Planeado PPI»', 'El desglose por programa existe solo para la programación: deje elegido solo ese indicador.');
      if (Medida.percapita) return pistaP('Sin per cápita por programa', 'No hay población por programa: use Totales o % del PIB.');
      if (!sectoresSel.length) return pistaP('Elija un sector para ver sus programas', 'Haga clic en un sector del gráfico «Sectores»: aquí aparecerán sus programas.');
      if (sectoresSel.length > 1) return pistaP(`Hay ${sectoresSel.length} sectores seleccionados`, 'El desglose es de un solo sector: deje uno elegido en «Sectores».');
      if (est.sel.linea) return pistaP('Sin cruce con las líneas del PND', 'El desglose por programa no se cruza con las líneas del PND: quite la línea elegida.');
      if (est.sel.fondo) return pistaP('Sin cruce con la fuente específica', 'El desglose por programa no se cruza con la fuente específica: quite la elegida en «Fuente específica».');
      const gs = gobs();
      contProgramas.append(UI.cargando('Cargando los programas…'));
      try { await Promise.all(gs.map((g) => Programas.cargar(g))); } catch (e) {
        if (mio !== tokProg) return;
        UI.vaciar(contProgramas); return pistaP('No se pudieron cargar los programas', String(e.message || e));
      }
      if (mio !== tokProg) return;               // llegó una selección más nueva
      const filtros = (g) => ({ sector: sectoresSel, fuente: est.sel.fuente, departamento: est.sel.departamento,
                                vigencia: est.sel.vigencia ? vigSel(g) : null });      // «Año k» → año calendario de cada gobierno
      const porGob = gs.map((g) => [g, Programas.agregar(g, filtros(g), Medida)]);
      UI.vaciar(contProgramas);
      const solo = (ds) => !ds.length || (ds.length === 1 && ds[0].cat === 'Sin programa');
      if (porGob.every(([, ds]) => solo(ds))) {
        return pistaP('Sin programas para esta combinación', gs.length > 1 ? 'Ningún gobierno elegido trae programas para el sector y los filtros elegidos.' : 'Este gobierno no trae programas para el sector y los filtros elegidos.');
      }
      contProgramas.append(UI.h('div', { class: 'fuente-esp-de' }, 'Sector:', UI.h('span', {}, sectoresSel[0])));
      let otros = [];
      if (gs.length === 1) {
        const r = Graficas.topOtros(porGob[0][1], 12);
        otros = r.otros;
        contProgramas.append(Graficas.barrasLista(r.datos, {}));
      } else {
        const filas = porGob.flatMap(([g, ds]) => ds.map((d) => ({ cat: d.cat, serie: g, valor: d.valor })));
        const tot = new Map(); filas.forEach((x) => tot.set(x.cat, (tot.get(x.cat) || 0) + x.valor));
        const orden = [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
        const top = orden.slice(0, 12); otros = orden.slice(12);
        const rango = new Map(top.map((c, i) => [c, i]));
        const datos = filas.filter((x) => top.includes(x.cat)).sort((a, b) => rango.get(a.cat) - rango.get(b.cat))
          .concat(otros.length ? gs.map((g) => ({ cat: 'Otros', serie: g,
            valor: filas.filter((x) => otros.includes(x.cat) && x.serie === g).reduce((a, x) => a + x.valor, 0) })) : []);
        contProgramas.append(Graficas.barrasLista(datos, { pal: palSeries() }), Graficas.leyenda(seriesVisual(), palSeries()));
      }
      if (otros.length) {
        contProgramas.append(UI.h('div', { class: 'sectores-otros' }, UI.h('b', {}, `Otros (${otros.length}): `), otros.join(', ')));
      }
      contProgramas.append(UI.h('p', { class: 'texto-suave', style: { margin: '.5rem 0 0' } },
        'Informativo: el cubo no cruza programas con las demás dimensiones, así que las barras no filtran. Respeta la fuente, el departamento y la vigencia elegidos.' +
        (gs.length > 1 ? ' Los gobiernos se comparan por nombre de programa: un mismo programa puede llamarse distinto entre gobiernos (en 2011-2018 la numeración y los nombres son otros).' : '')));
    }

    function pintarMapa(m, s1, s2) {
      const nombres = Mapa.departamentos;
      UI.vaciar(contLeyenda);

      if (m === 'balance') {
        // «Cambio en totales» (ver el selector «Comparación»): el mapa pasa de índice de crecimiento
        // (con signo) a la misma paleta por MAGNITUD que usan las barras — mismo pct, otro color.
        const porCambio = entreGob() && modoBarras() === 'cambio';
        const den = new Map(Cubo.agregar(serieQ(s1, { departamento: DES }), 'departamento').map((d) => [d.cat, d.valor]));
        const num = new Map(Cubo.agregar(serieQ(s2, { departamento: DES }), 'departamento').map((d) => [d.cat, d.valor]));
        const pl = nombres.map((d) => den.get(d) || 0);
        const ej = nombres.map((d) => num.get(d) || 0);
        // La razón/variación SIEMPRE en corrientes (Medida.enCorrientes): en % del PIB, s1/s2 pueden cubrir
        // distinto conjunto de años (p. ej. dos gobiernos) y por lo tanto distinto denominador — mezclarlos
        // en una sola razón ya convertida a % del PIB no tendría sentido.
        const denC = new Map(Cubo.agregar(Medida.enCorrientes(serieQ(s1, { departamento: DES })), 'departamento').map((d) => [d.cat, d.valor]));
        const numC = new Map(Cubo.agregar(Medida.enCorrientes(serieQ(s2, { departamento: DES })), 'departamento').map((d) => [d.cat, d.valor]));
        const plC = nombres.map((d) => denC.get(d) || 0);
        const ejC = nombres.map((d) => numC.get(d) || 0);
        // Entre gobiernos: ÍNDICE DE CRECIMIENTO (s2 frente a s1, el más viejo) — no una razón, así
        // el color y la cifra dicen directo "creció/decreció X %". Dentro de un mismo gobierno
        // (2 indicadores, p. ej. Compromisos/Planeado) se deja el % de avance de siempre.
        const pct = entreGob()
          ? plC.map((p, i) => (p > 0 ? (ejC[i] - p) / p : NaN))
          : plC.map((p, i) => (p > 0 ? ejC[i] / p : NaN));
        const fills = porCambio ? colorCambio(pct) : coloresPct(pct, entreGob() ? 'razon' : 'avance');
        mapa.aviso(null);
        mapa.pintar(nombres.map((d, i) => ({
          departamento: d,
          fill: est.sel.departamento && !est.sel.departamento.includes(d) ? GRIS_INACTIVO : fills[i],
          etiqueta: entreGob()
            ? `<b>${Formato.esc(d)}</b><br>${Formato.esc(s1)}: ${Formato.cop(pl[i])}<br>` +
              `${Formato.esc(s2)}: ${Formato.cop(ej[i])}<br>Diferencia: ${Formato.cop(ejC[i] - plC[i])}<br>Variación: ${Formato.pct(pct[i], 1, true)}`
            : `<b>${Formato.esc(d)}</b><br>${Formato.esc(s1)}: ${Formato.cop(pl[i])}<br>` +
              `${Formato.esc(s2)}: ${Formato.cop(ej[i])}<br>${Formato.esc(s2)} / ${Formato.esc(s1)}: ${Formato.pct(pct[i])}`
        })));
        contLeyenda.append(
          Mapa.leyenda(porCambio ? PAL_CAMBIO : entreGob() ? PAL_CREC : PAL_EJEC, porCambio ? ETIQ_CAMBIO : entreGob() ? ETIQ_CREC : ETIQ_EJEC,
            entreGob() ? `Variación de ${s2} frente a ${s1}` : `${s2} / ${s1}`),
          Mapa.nota(porCambio
            ? 'El color indica qué tan grande fue el cambio (verde chico, rojo grande), sin importar si creció o decreció — eso lo dice el signo en el tooltip.'
            : entreGob()
            ? 'Nota: Los rangos de color describe el crecimiento de la inversión, siendo amarillo los crecimientos positivos y azul los negativos.'
            : `${s2} como % de ${s1} en cada departamento. En blanco quedan los departamentos sin ${s1}.`));
        const notaReg1 = notaRegional([s1, s2]);
        if (notaReg1) contLeyenda.append(Mapa.nota(notaReg1));
      } else if (m === 'simple') {
        const d = new Map(Cubo.agregar(serieQ(s1, { departamento: DES }), 'departamento').map((x) => [x.cat, x.valor]));
        const v = nombres.map((n) => (d.has(n) ? d.get(n) : NaN));
        const fills = coloresValor(v);
        const ok = v.filter(Number.isFinite);
        const tot = ok.reduce((a, b) => a + b, 0);
        mapa.aviso(null);
        mapa.pintar(nombres.map((n, i) => ({
          departamento: n,
          fill: est.sel.departamento && !est.sel.departamento.includes(n) ? GRIS_INACTIVO : fills[i],
          etiqueta: Number.isFinite(v[i])
            ? `<b>${Formato.esc(n)}</b><br>${Formato.esc(s1)}: ${Formato.cop(v[i])}` +
              (tot > 0 && !Medida.percapita && !Medida.pib ? ` (${Formato.pct(v[i] / tot)})` : '')   // en % del PIB el valor ya ES el aporte al PIB: sin 2.º porcentaje
            : `<b>${Formato.esc(n)}</b><br>Sin dato`
        })));
        if (ok.length) {
          contLeyenda.append(
            Mapa.leyenda(PAL_VALOR, etiquetasQuintiles(v, Formato.cop), s1),
            Mapa.nota('Quintiles: Se determinan por el mismo número de departamentos, los tonos de color se asignan por quintil.'));
          const notaReg2 = notaRegional([s1]);
          if (notaReg2) contLeyenda.append(Mapa.nota(notaReg2));
        }
      } else {
        // 'multi' o 'un_gob': el mapa no puede comparar más de dos series
        mapa.aviso(m === 'un_gob' ? MSG_UNGOB : MSG_MULTI);
        mapa.pintar(nombres.map((n) => ({ departamento: n, fill: GRIS_MAPA, etiqueta: `<b>${Formato.esc(n)}</b>` })));
      }
    }

    // Solo en 'Por gobierno' con 'Planeado PPI': los códigos de línea son
    // propios del PND de cada gobierno, así que no se comparan entre gobiernos.
    function pintarLineas() {
      UI.vaciar(contLineas);
      const s = series();
      if (entreGob() || s.length !== 1 || s[0] !== 'Planeado PPI') {
        est.sel.linea = null; est.sel.tema = null; est.sel.estrategia = null;
        return;
      }
      const gob = gobs()[0];

      // Una sola consulta trae nivel 1 (linea2 == Total), nivel 2 (linea2 ≠ Total, linea3 == Total)
      // y nivel 3 —Estrategia— (linea3 ≠ Total).
      const filas = Cubo.agregar(serieQ('Planeado PPI', { linea1: DES, linea2: null, linea3: null }), ['linea1', 'linea2', 'linea3']);
      const n1 = new Map(), n2 = new Map(), n3 = new Map();
      filas.forEach(({ cats, valor }) => {
        const [c1, c2, c3] = cats;
        if (c2 === 'Total') { n1.set(c1, (n1.get(c1) || 0) + valor); return; }
        if (c3 === 'Total') {
          if (!n2.has(c1)) n2.set(c1, new Map());
          n2.get(c1).set(c2, (n2.get(c1).get(c2) || 0) + valor);
          return;
        }
        const kTema = c1 + '|' + c2;
        if (!n3.has(kTema)) n3.set(kTema, new Map());
        n3.get(kTema).set(c3, (n3.get(kTema).get(c3) || 0) + valor);
      });

      // Columnas de monto/% compartidas por los 3 niveles de la tabla.
      const COLS_MONTO = (titulo) => [
        { campo: 'valor', titulo, num: true, ancho: titulo ? '150px' : undefined, render: (v) => Formato.cop(v) },
        { campo: 'pct', titulo: titulo ? '% del total' : '', num: true, ancho: titulo ? '100px' : undefined, render: (v) => Formato.pct(v) }
      ];
      // Fila → tabla de sus hijos (mismo patrón en los 3 niveles): hijos ordenados de mayor a menor,
      // onClickFila filtra por ese código y filaSel lo marca seleccionado (y, vía el fix de UI.tabla,
      // lo mantiene desplegado). Los códigos de Tema/Estrategia ya son únicos por sí solos (incluyen a
      // su padre, ver baseQ), así que un clic ahí NO necesita que el nivel de arriba esté elegido.
      const tablaHijos = (hijos, padreValor, dim, tituloCol, detalleHijo) => {
        const filas = [...hijos.entries()].sort((a, b) => b[1] - a[1]).map(([codigo, valor]) => ({
          codigo, linea: Cubo.etiqLinea(gob, codigo), valor, pct: padreValor > 0 ? valor / padreValor : null
        }));
        return UI.tabla(filas, [{ campo: 'linea', titulo: tituloCol }, ...COLS_MONTO()], {
          sinPaginacion: true,
          onClickFila: (f) => { alternar(dim, f.codigo); actualizar(); },
          filaSel: (f) => est.sel[dim] && est.sel[dim].includes(f.codigo),
          detalle: detalleHijo
        });
      };

      let contenido;
      if (!n1.size) {
        contenido = UI.estadoVacio('Sin líneas del PND para esta combinación',
          'El cubo solo cruza las líneas del PND con la vigencia, la fuente, el sector y el departamento; ' +
          'al filtrar por una fuente específica (o combinar más filtros) esta tabla puede quedar vacía.');
      } else {
        const total = [...n1.values()].reduce((a, b) => a + b, 0);
        const tabla = [...n1.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
          .map(([codigo, valor]) => ({
            codigo, linea: Cubo.etiqLinea(gob, codigo), valor, pct: total > 0 ? valor / total : null
          }));
        contenido = UI.tabla(tabla, [{ campo: 'linea', titulo: 'Eje' }, ...COLS_MONTO(`Monto (${Medida.corta()})`)], {
          sinPaginacion: true,
          onClickFila: (f) => { alternar('linea', f.codigo); actualizar(); },
          filaSel: (f) => est.sel.linea && est.sel.linea.includes(f.codigo),
          detalle: (f) => {
            const hijos = n2.get(f.codigo);
            if (!hijos || !hijos.size) return null;
            return tablaHijos(hijos, f.valor, 'tema', 'Tema', (sf) => {
              const nietos = n3.get(f.codigo + '|' + sf.codigo);
              return nietos && nietos.size ? tablaHijos(nietos, sf.valor, 'estrategia', 'Estrategia', null) : null;
            });
          }
        });
      }
      contLineas.append(UI.card(
        UI.h('span', {}, 'Eje, Tema y Estrategia del PND ',
          UI.h('span', { class: 'texto-suave' },
            '— clic en un Eje o un Tema: lo filtra y despliega sus hijos; clic de nuevo lo quita y los ' +
            'vuelve a ocultar. ▸ solo despliega sin filtrar. Clic en un Tema o Estrategia filtra sin ' +
            'necesidad de elegir su padre. No todas las Estrategias tienen programa asociado: algunas no ' +
            'aparecen en esta tabla por no tener monto.')),
        contenido));
    }

    Mapa.init().then(() => {
      mapa = Mapa.crear(contMapa, {
        onClick: (dep) => { alternar('departamento', dep); actualizar(); }
      });
      pintarFiltros();
      actualizar();
    });
  }

  return { render };
})();
