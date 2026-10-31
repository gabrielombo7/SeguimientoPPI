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
// fuente_general); «Programas» solo con UN sector elegido en «Sectores» — dimensión real del cubo
// («Por gobierno»: filtra todo el visor, como Sectores); al comparar gobiernos («Entre gobiernos»)
// el código de programa no es comparable entre ellos, así que ahí sigue siendo informativo, por
// NOMBRE, vía programas.js (aparte del cubo).
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
  // Ejecución (Compromisos/Obligaciones/Pagos) viaja partida en el cubo: _siif (PGN con SIIF, SIN
  // departamento) y _piip (PGN con PIIP, con departamento) — antes el cubo elegía solo según si la
  // consulta abría departamento; ahora esa regla se aplica aquí. SIIF por defecto (coincide con el
  // total nacional); PIIP solo cuando la consulta abre departamento (filtra uno puntual, o lo
  // desagrega para el mapa — ahí quien llama pasa porDepto=true explícito).
  const IND_EJECUCION = new Set(['Compromisos', 'Obligaciones', 'Pagos']);
  function indCubo(nombreInd, porDepto) {
    const base = IND_CUBO[nombreInd];
    return IND_EJECUCION.has(nombreInd) ? base + (porDepto ? '_piip' : '_siif') : base;
  }

  const MSG_MULTI = 'Elija 1 o 2 series para el mapa (o use Descargar Reportes)';
  const MSG_UNGOB = 'Seleccione otro gobierno para comparar';
  const DET_UNGOB = 'O cambie a "Por gobierno", o use la hoja Descargar Reportes.';

  const est = {
    ambito: 'Por gobierno',
    gobiernos: [], indicadores: ['Planeado PPI'],
    vista: 'Totales',
    sel: { sector: null, departamento: null, vigencia: null, fuente: null, fondo: null, linea: null, tema: null, estrategia: null, entidad: null, programa: null },
    filtrosOpen: false,     // «Filtros» (adicionales) — toggle inline, no es un filtro en sí
    fondoDe: null,          // fuente general a la que pertenece la fuente específica elegida
    // Vista activa de las cajas con selector (no son filtros, solo qué se muestra):
    vistaFuentes: 'sin_privados',     // 'total' | 'sin_privados' | 'especifica' — por defecto sin Privados
                                       // (es más de la mitad del PPI y tapa el resto de la torta)
    vistaSector: 'sectores',          // 'sectores' | 'programas' | 'entidad'
    vistaLinea: 'eje'                 // 'eje' | 'tema' | 'estrategia' — qué nivel del PND se muestra
  };

  const entreGob = () => est.ambito === 'Entre gobiernos';

  // Catálogo de fuente_general SIN Privados, para la vista «Sin privados»: se filtra por las
  // categorías finas que SÍ existen (permitido — cubo.js:niveles ya trae el catálogo completo),
  // nunca se deriva sumando un nivel MÁS FINO que fuente_general (eso sí rompería el total con un
  // gobierno cerrado — ver README «El cubo es cerrado»). Verificado en consola para 2027-2030 y
  // 2023-2026: la suma de estas categorías coincide con el total (menos Privados cuando aplica).
  const fuentesSinPrivados = () => Cubo.niveles('fuente_general').filter((c) => c !== 'Total' && c !== 'Privados');

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
        if (Cubo.unidadesDe(g, indCubo(n, false)).length) { presentes.add(n); break; }
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
    for (const g of gobs()) for (const n of inds()) pares.push([g, indCubo(n, false)]);
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
      const v = Cubo.agregar({ gobierno, tipo_dato: IND_TD[ind], indicador: indCubo(ind, false), vigencia: DES }, 'vigencia')
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
    // Sin selección explícita, la vista «Sin privados» del header de Fuentes actúa como filtro
    // de TODO el tablero (no solo de su propia caja): KPIs, Sectores, Vigencias y el mapa quedan
    // sin Privados hasta que se elija una fuente puntual o se pase a «Total».
    return Medida.aplicar({
      gobierno, tipo_dato: IND_TD[nombreInd], indicador: indCubo(nombreInd, !!est.sel.departamento),
      sector: est.sel.sector || 'Total',
      // programa ⊂ sector (ver el comentario en cubo.js:normalizar): solo se filtra «Por gobierno»
      // (código propio de CADA gobierno, no comparable entre ellos — al comparar se sigue viendo
      // el desglose por NOMBRE en programas.js, informativo, ver pintarProgramas). est.sel.programa
      // guarda NOMBRES (igual que filtroPrograma()): se traduce al código de ESTE gobierno aquí.
      programa: !entreGob() && est.sel.programa ? est.sel.programa.map((n) => Cubo.codigoPrograma(gobierno, n)) : 'Total',
      departamento: est.sel.departamento || 'Total',
      vigencia: vigSel(gobierno),
      fuente_general: est.sel.fuente || (est.vistaFuentes === 'sin_privados' ? fuentesSinPrivados() : 'Total'),
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
    // El Programa elegido pertenece a un Sector que acaba de cambiar (programa ⊂ sector).
    if (dim === 'sector') est.sel.programa = null;
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

    // Filtros dependientes (ver «Filtros» en pintarFiltros): Fuente específica y Entidad solo
    // existen con una fuente puntual elegida, Programa cambia de catálogo con el sector. Nodos
    // persistentes para poder repintar SOLO estos 3 cuando cambia la fuente/el sector — si se
    // reconstruyera todo el bloque «Filtros» (pintarFiltros entero) se cerraría de golpe
    // cualquier desplegable de selección múltiple que el usuario tuviera abierto a medio marcar.
    const contFiltroFondo = UI.h('div', {});
    const contFiltroEntidad = UI.h('div', {});
    const contFiltroPrograma = UI.h('div', {});

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

    // Fila 1: Fuentes, Eje/Tema/Estrategia y Vigencias — Fuentes y Eje/Tema/Estrategia con el mismo
    // ancho (col-t-igual), Vigencias más angosta (col-t). Entre gobiernos esa caja no aplica (se
    // oculta, ver pintarLineas): Fuentes y Vigencias pasan a col-7/col-5 —el mismo ancho que
    // Sectores/Departamentos en la fila de abajo— para no dejar un hueco donde iba esa caja.
    const colFuentes = UI.h('div', { class: 'col-t-igual' },
      UI.card(tituloFuentes, UI.h('div', {}, envFuentes, envFondo), { acciones: accFuentes }));
    const colLineas = UI.h('div', { class: 'col-t-igual' }, contLineas);
    const colVigencias = UI.h('div', { class: 'col-t' }, UI.card('Vigencias', contVigencias));

    raiz.append(UI.h('main', { class: 'container-xl dnp-main' },
      UI.h('div', { class: 'fila' },
        UI.colFiltrosColapsable(panelFiltros),
        UI.h('div', { class: 'col-contenido' },
          avisos, notaUnidad, kpis, chips,
          UI.h('div', { class: 'fila-graficas' }, colFuentes, colLineas, colVigencias),
          UI.h('div', { class: 'fila-graficas' },
            UI.h('div', { class: 'col-7' },
              UI.card(tituloSector, UI.h('div', {}, envSectores, envProgramas, envEntidad), { acciones: accSector })),
            UI.h('div', { class: 'col-5' }, UI.card('Departamentos',
              UI.h('div', {}, contMapa, contLeyenda))))))));

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
          : null,
        UI.h('hr', { class: 'divisor' }),
        // «Filtros»: las mismas dimensiones que ya se eligen con un clic en las gráficas (Fuentes,
        // Sectores…), pero por si en celular (o con la página larga) cuesta llegar hasta la caja
        // correspondiente para hacer ese clic. Toggle inline (no un popover flotante ni otra
        // pestaña): un botón que despliega el bloque hacia abajo, dentro del mismo panel.
        UI.h('button', {
          type: 'button', class: 'btn-toggle-filtros', 'aria-expanded': String(est.filtrosOpen),
          onclick: () => { est.filtrosOpen = !est.filtrosOpen; pintarFiltros(); }
        }, 'Filtros', UI.h('span', { class: 'icono-toggle', 'aria-hidden': 'true' }, est.filtrosOpen ? '▴' : '▾')),
        est.filtrosOpen ? UI.h('div', { class: 'filtros-extra' },
          filtroDim('Fuente', 'fuente_general', 'fuente', false, [pintarFiltroFondo, pintarFiltroEntidad]),
          contFiltroFondo,
          filtroVigencia(),
          filtroDim('Sector', 'sector', 'sector', true, [pintarFiltroPrograma]),
          contFiltroPrograma,
          contFiltroEntidad,
          filtroDim('Departamento', 'departamento', 'departamento', true),
          filtroLinea('Eje', 'linea'),
          filtroLinea('Tema', 'tema'),
          filtroLinea('Estrategia', 'estrategia')
        ) : null
      ), { clase: 'card-filtros' }));
      // Los 3 contenedores de arriba son persistentes (ver su declaración en render()): si el
      // bloque está desplegado, se llenan aquí (primer render o tras un cambio «grande», p. ej.
      // de gobierno) y además cada vez que cambia su dimensión de la que dependen (ver filtroDim).
      if (est.filtrosOpen) { pintarFiltroFondo(); pintarFiltroEntidad(); pintarFiltroPrograma(); }
    }

    // Picker de una dimensión del cubo, para «Filtros» — misma selección que un clic en la gráfica
    // correspondiente (est.sel[clave]), solo que desde un desplegable. No llama pintarFiltros() al
    // cambiar (solo actualizar()): si lo hiciera, cada casilla marcada en un picker de selección
    // múltiple reconstruiría el panel entero y se cerraría el propio desplegable a medio marcar.
    // `onDep`: repintados puntuales de OTROS pickers que dependen de este (ver contFiltroFondo
    // arriba) — esos sí son seguros de disparar en cada cambio porque no tocan este picker.
    function filtroDim(etiqueta, col, clave, buscar, onDep) {
      const ops = Cubo.niveles(col).filter((v) => v !== 'Total');
      // Igual que en el panel de Medida: en per cápita el departamento es de UNO a la vez.
      if (clave === 'departamento' && Medida.percapita) {
        return UI.picker({
          etiqueta: etiqueta + ' (uno)', opciones: ['Todos'].concat(ops), buscar,
          valor: (est.sel.departamento && est.sel.departamento[0]) || 'Todos',
          onCambio: (v) => { est.sel.departamento = v === 'Todos' ? null : [v]; actualizar(); }
        });
      }
      return UI.picker({
        etiqueta, opciones: ops, multiple: true, buscar,
        valor: est.sel[clave] || [], textoTodas: 'Todas',
        onCambio: (v) => { est.sel[clave] = v.length ? v : null; (onDep || []).forEach((f) => f()); actualizar(); }
      });
    }

    // Repintan SOLO su propio contenedor persistente (ver contFiltro* en render()) — a diferencia
    // de pintarFiltros() entero, no interrumpen ningún OTRO picker que el usuario tenga abierto.
    function pintarFiltroFondo() { UI.vaciar(contFiltroFondo).append(filtroFondo()); }
    function pintarFiltroEntidad() { UI.vaciar(contFiltroEntidad).append(filtroEntidad()); }
    function pintarFiltroPrograma() { UI.vaciar(contFiltroPrograma).append(filtroPrograma()); }

    // «Fuente específica» solo existe dentro de UNA fuente general elegida (ver sincronizarFondo):
    // el desplegable se habilita solo entonces, con el catálogo real de esa fuente (no una lista
    // fija — fuente_fondo tiene nombres que se repiten entre fuentes distintas).
    function filtroFondo() {
      const f = est.sel.fuente;
      if (!f || f.length !== 1) {
        return UI.h('p', { class: 'texto-suave' }, 'Fuente específica: elija una sola fuente arriba para habilitarlo.');
      }
      const cats = new Set();
      series().forEach((s) => {
        Cubo.agregar(serieQ(s, { fuente_general: f, fuente_fondo: DES }), 'fuente_fondo')
          .filter((d) => d.valor > 0).forEach((d) => cats.add(d.cat));
      });
      return UI.picker({
        etiqueta: 'Fuente específica', opciones: [...cats].sort(), multiple: true, buscar: true,
        valor: est.sel.fondo || [], textoTodas: 'Todas',
        onCambio: (v) => { est.sel.fondo = v.length ? v : null; actualizar(); }
      });
    }

    // «Entidad (PGN)» solo existe con PGN como única fuente elegida (ver sincronizarEntidad).
    function filtroEntidad() {
      const f = est.sel.fuente;
      if (!f || f.length !== 1 || f[0] !== 'PGN') {
        return UI.h('p', { class: 'texto-suave' }, 'Entidad (PGN): elija solo PGN en Fuente arriba para habilitarlo.');
      }
      const cats = new Set();
      series().forEach((s) => {
        Cubo.agregar(serieQ(s, { entidad: DES }), 'entidad').filter((d) => d.valor > 0).forEach((d) => cats.add(d.cat));
      });
      return UI.picker({
        etiqueta: 'Entidad (PGN)', opciones: [...cats].sort(), multiple: true, buscar: true,
        valor: est.sel.entidad || [], textoTodas: 'Todas',
        onCambio: (v) => { est.sel.entidad = v.length ? v : null; actualizar(); }
      });
    }

    // Vigencia: catálogo distinto según el ámbito — años calendario reales «Por gobierno»
    // (vigenciasDe, igual que el eje del gráfico), o «Año k» del periodo «Entre gobiernos» (no hay
    // un calendario común entre dos PPI; ver el comentario de porDim/vigencia más abajo).
    function filtroVigencia() {
      const ops = entreGob()
        ? Array.from({ length: Math.max(1, ...gobs().map((g) => vigenciasDe(g).length)) }, (_, i) => 'Año ' + (i + 1))
        : vigenciasDe(gobs()[0]);
      return UI.picker({
        etiqueta: 'Vigencia', opciones: ops, multiple: true, buscar: ops.length > 10,
        valor: est.sel.vigencia || [], textoTodas: 'Todas',
        onCambio: (v) => { est.sel.vigencia = v.length ? v : null; actualizar(); }
      });
    }

    // Programa: catálogo de los programas visibles ahora mismo en la caja Programas (mismos
    // filtros: sector, fuente, departamento, vigencia — ver pintarProgramas).
    function filtroPrograma() {
      const sectoresSel = est.sel.sector || [];
      const gs = gobs();
      const cats = new Set();
      gs.forEach((g) => {
        Programas.agregar(g, {
          sector: sectoresSel.length ? sectoresSel : null,
          fuente: est.sel.fuente || (est.vistaFuentes === 'sin_privados' ? fuentesSinPrivados() : null),
          departamento: est.sel.departamento,
          vigencia: est.sel.vigencia ? vigSel(g) : null
        }, Medida).forEach((d) => { if (d.cat !== 'Sin programa') cats.add(d.cat); });
      });
      const ops = [...cats].sort();
      if (!ops.length) return UI.h('p', { class: 'texto-suave' }, 'Programa: sin programas para esta combinación (o aún cargando).');
      return UI.picker({
        etiqueta: 'Programa', opciones: ops, multiple: true, buscar: true,
        valor: est.sel.programa || [], textoTodas: 'Todos',
        onCambio: (v) => { est.sel.programa = v.length ? v : null; actualizar(); }
      });
    }

    // Eje/Tema/Estrategia: códigos propios del PND de CADA gobierno — solo existen «Por gobierno»
    // con «Planeado PPI» (ver pintarLineas). Una sola consulta trae los 3 niveles (linea2/linea3 en
    // 'Total' no comparten fila con su desglose fino, así que cada nivel necesita el de ARRIBA
    // también desagregado — igual que pintarLineas()). Tema y Estrategia ya son únicos por sí
    // solos (incluyen a su padre, ver baseQ): no hace falta elegir antes el Eje para habilitarlos.
    function lineasPND() {
      // fuente_general explícito: ver el comentario igual en pintarLineas() — el marginal de Tema
      // no existe filtrando por la lista de «Sin privados», solo por el 'Total' real o una fuente puntual.
      const filas = Cubo.agregar(serieQ('Planeado PPI', { linea1: DES, linea2: null, linea3: null, fuente_general: est.sel.fuente || 'Total' }), ['linea1', 'linea2', 'linea3']);
      const n1 = new Set(), n2 = new Set(), n3 = new Set();
      filas.forEach(({ cats, valor }) => {
        if (!(valor > 0)) return;
        const [c1, c2, c3] = cats;
        if (c2 === 'Total') n1.add(c1);
        else if (c3 === 'Total') n2.add(c2);
        else n3.add(c3);
      });
      return { n1, n2, n3 };
    }
    function filtroLinea(etiqueta, clave) {
      if (entreGob() || series().length !== 1 || series()[0] !== 'Planeado PPI') {
        return UI.h('p', { class: 'texto-suave' },
          `${etiqueta}: solo con «Planeado PPI», un gobierno a la vez (no «Entre gobiernos»).`);
      }
      const gob = gobs()[0];
      const { n1, n2, n3 } = lineasPND();
      const cats = [...(clave === 'linea' ? n1 : clave === 'tema' ? n2 : n3)];
      if (!cats.length) return UI.h('p', { class: 'texto-suave' }, `${etiqueta}: sin datos para este gobierno.`);
      return UI.picker({
        etiqueta, opciones: cats.map((c) => ({ valor: c, texto: Cubo.etiqLinea(gob, c) })), multiple: true, buscar: true,
        valor: est.sel[clave] || [], textoTodas: 'Todas',
        onCambio: (v) => {
          est.sel[clave] = v.length ? v : null;
          if (clave === 'linea') { est.sel.tema = null; est.sel.estrategia = null; }
          if (clave === 'tema') est.sel.estrategia = null;
          actualizar();
        }
      });
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
      envFuentes.hidden = est.vistaFuentes === 'especifica';
      envFondo.hidden = est.vistaFuentes !== 'especifica';
      // Título corto (como Eje/Tema/Estrategia): el toggle de al lado ya dice el modo activo.
      const TITULOS_FUENTES = { total: 'Fuentes', sin_privados: 'Fuentes', especifica: 'Fuente específica' };
      UI.vaciar(tituloFuentes).append(TITULOS_FUENTES[est.vistaFuentes]);
      UI.vaciar(accFuentes).append(UI.grupoBotones({
        opciones: [{ valor: 'total', texto: 'Total' }, { valor: 'sin_privados', texto: 'Sin privados' },
                   { valor: 'especifica', texto: 'Específica' }],
        valor: est.vistaFuentes,
        // «Total»/«Sin privados» son filtros de TODO el tablero (ver baseQ): cambiar entre ellos
        // limpia cualquier fuente puntual elegida antes, para no dejar un filtro viejo escondido
        // debajo del nuevo — por eso actualizar() (re-pinta con el corte ya cargado), no pintar().
        onCambio: (v) => {
          if (v !== 'especifica') est.sel.fuente = null;
          est.vistaFuentes = v;
          actualizar();
        }
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
        // La razón/variación SIEMPRE en corrientes (Medida.enCorrientes): en % del PIB, s1/s2 pueden cubrir
        // distinto conjunto de años (p. ej. dos gobiernos) y por lo tanto distinto denominador — dividir
        // las cifras ya convertidas a % del PIB mezclaría dos denominadores distintos.
        const v1c = Cubo.total(Medida.enCorrientes(serieQ(s1))), v2c = Cubo.total(Medida.enCorrientes(serieQ(s2)));
        // Entre gobiernos: VARIACIÓN (crecimiento), misma fórmula que el mapa/leyenda en «Cambio en
        // totales» (ver pintarMapa) — no una razón: con s2 < s1 una razón <100 % se lee ambiguo («¿100
        // % de qué?»), mientras que una variación negativa dice directo "decreció X %". La fórmula no
        // cambia según cuál sea mayor: (s2 − s1) / s1 da signo correcto en ambos casos.
        // Respeta Corrientes/Constantes (crecimiento real vs nominal — verificado: Territorio 2023-2026→
        // 2027-2030 da +67,7 % en corrientes y +42,1 % en constantes 2026, antes se quedaba fijo en el
        // de corrientes). En % del PIB se deja en corrientes: mezclar %PIB de 2 gobiernos con periodos
        // distintos no tiene un único denominador (mismo motivo que la nota de % del PIB en pintar()).
        // Dentro de un mismo gobierno (2 indicadores, p. ej. Compromisos/Planeado) se deja la razón de
        // siempre: ahí el 2º valor normalmente es un subconjunto del 1º y el % es un avance, no un crecimiento.
        const [vBase1, vBase2] = Medida.pib ? [v1c, v2c] : [v1, v2];
        kpis.append(UI.filaKpis(
          UI.kpi(Formato.cop(v2), s2 + ' de la selección', 'dorado'),
          UI.kpi(Formato.cop(v1), s1 + ' de la selección'),
          entreGob()
            ? UI.kpi(Formato.pct(vBase1 > 0 ? (vBase2 - vBase1) / vBase1 : null, 1, true), 'Variación ' + s2 + ' vs ' + s1, 'acento')
            : UI.kpi(Formato.pct(v1c > 0 ? v2c / v1c : null), s2 + ' / ' + s1, 'acento')));
      } else if (m === 'multi') {
        const acentos = [null, 'dorado', 'acento'];       // con más de 3 series los colores se repiten; la fila se parte en renglones
        kpis.append(UI.filaKpis(...seriesVisual().map((s, i) =>
          UI.kpi(Formato.cop(Cubo.total(serieQ(s))), s + ' de la selección', acentos[i % acentos.length]))));
      } else {
        const totSel = Cubo.total(serieQ(s1));
        // Universo = el mismo indicador SIN la selección cruzada
        const qUni = Medida.aplicar(entreGob()
          ? { gobierno: s1, tipo_dato: IND_TD[inds()[0]], indicador: indCubo(inds()[0], false) }
          : { gobierno: gobs()[0], tipo_dato: IND_TD[s1], indicador: indCubo(s1, false) });
        const totUni = Cubo.total(qUni);
        // La razón SIEMPRE en corrientes (Medida.enCorrientes): en % del PIB, la selección y el universo
        // pueden cubrir distinto conjunto de años y por lo tanto distinto denominador.
        const razon = Cubo.total(Medida.enCorrientes(serieQ(s1))) / Cubo.total(Medida.enCorrientes(qUni));
        const etqPart = entreGob() ? '% del total de ' + s1
          : s1 === 'Planeado PPI' ? '% del total del PPI' : '% del total de ' + s1.toLowerCase();
        const etqUni = entreGob() ? 'Total de ' + s1
          : s1 === 'Planeado PPI' ? 'Total del PPI' : 'Total de ' + s1.toLowerCase();
        // Sin privados, de ese mismo total sin filtros: solo tiene sentido para Planeado PPI (es la
        // única medida donde Privados trae dato — no hay ejecución de privados). Se muestra el monto
        // SIN privados (no "de los cuales son privados"): es la cifra que de verdad se usa en el resto
        // del tablero (vista por defecto de Fuentes).
        const detalleUni = s1 === 'Planeado PPI'
          ? (() => {
              const totPriv = Cubo.total(Object.assign({}, qUni, { fuente_general: ['Privados'] }));
              if (!(totPriv > 0)) return null;
              const totSinPriv = totUni - totPriv;
              return `Sin privados: ${Formato.cop(totSinPriv)} (${Formato.pct(totSinPriv / totUni)})`;
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
        Entidad: est.sel.entidad, Programa: est.sel.programa
      };
      const claveDim = { Sector: 'sector', Departamento: 'departamento', Vigencia: 'vigencia', Fuente: 'fuente', 'Fuente específica': 'fondo', Eje: 'linea', Tema: 'tema', Estrategia: 'estrategia', Entidad: 'entidad', Programa: 'programa' };
      // pintarFiltros() además de actualizar(): si el bloque «Filtros» está desplegado, sus
      // desplegables (que leen est.sel directo) quedarían mostrando un valor viejo si no se
      // repinta — a diferencia de los propios desplegables (ver filtroDim), quitar un chip no
      // interrumpe ninguna selección múltiple a medio marcar, así que aquí sí es seguro.
      UI.vaciar(chips).append(UI.chips(etiquetas,
        (dim) => {
          est.sel[claveDim[dim]] = null;
          if (claveDim[dim] === 'fuente') { est.sel.fondo = null; est.sel.entidad = null; }
          if (claveDim[dim] === 'linea') { est.sel.tema = null; est.sel.estrategia = null; }
          if (claveDim[dim] === 'tema') est.sel.estrategia = null;
          if (claveDim[dim] === 'sector') est.sel.programa = null;
          pintarFiltros(); actualizar();
        },
        () => { limpiarSel(); pintarFiltros(); actualizar(); }));

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
      // `excluir`: categorías que se descartan antes de rankear/sumar (p. ej. Privados en la vista
      // «Sin privados» de Fuentes) — así el total y el top-n ya no cuentan con ellas.
      const porValidacion = (arg, n, excluir) => {
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
        if (excluir) excluir.forEach((c) => { den.delete(c); num.delete(c); });
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
      const pintarCambio = (cont, arg, clave, n, puntos, excluir) => {
        const { filas, otros } = porValidacion(arg, n, excluir);
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
      const sinPrivados = est.vistaFuentes === 'sin_privados';
      if (mb === 'aviso') vacio(contFuentes);
      else if (mb === 'cambio' || mb === 'participacion') {
        pintarCambio(contFuentes, 'fuente_general', 'fuente', 12, mb === 'participacion', sinPrivados ? ['Privados'] : null);
      } else {
        let d = porDim('fuente_general');
        if (sinPrivados) d = d.filter((x) => x.cat !== 'Privados');
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
        const badgePGN = () => contEntidad.append(UI.h('div', { class: 'fuente-esp-de' }, 'Fuente:', UI.h('span', {}, 'PGN')));
        badgePGN();
        const n = pintarTop(contEntidad, 'entidad', 'entidad', true, entreGob() ? 16 : 12);
        if (!n) {
          UI.vaciar(contEntidad);
          badgePGN();
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

    // --- Programas: desglose de UN sector elegido en «Sectores», solo para la programación
    //     («Planeado PPI» / «Monto inflexible»). «Por gobierno»: ya es una dimensión real del
    //     cubo (como Sector) — cruza con fuente, fuente específica, entidad, departamento,
    //     vigencia y las líneas del PND, y clic en una barra filtra todo el visor, igual que
    //     Sectores (solo exige un sector porque programa ⊂ sector — ver cubo.js:normalizar).
    //     «Entre gobiernos»: el código de programa es propio de CADA gobierno (no comparable
    //     entre ellos), así que aquí se sigue comparando por NOMBRE vía programas.js, informativo
    //     (no filtra) — igual que antes de esta migración.
    let tokProg = 0;
    async function pintarProgramas() {
      const mio = ++tokProg;
      UI.vaciar(contProgramas);
      const pistaP = (msg, det) => contProgramas.append(UI.h('div', { class: 'fuente-esp-vacia' },
        UI.h('div', { class: 'icono-aviso', 'aria-hidden': 'true' }, 'i'),
        UI.h('div', { class: 'msg' }, msg), UI.h('div', { class: 'det' }, det)));
      const sectoresSel = est.sel.sector || [];
      if (modoBarras() === 'aviso') return UI.vaciar(contProgramas).append(UI.estadoVacio(MSG_UNGOB, DET_UNGOB));
      if (IND_TD[inds()[0]] !== 'programación' || (!entreGob() && modo() !== 'simple')) return pistaP('Solo para la programación', 'El desglose por programa existe solo para «Planeado PPI» y «Monto inflexible»: deje elegido solo uno de esos.');
      if (Medida.percapita) return pistaP('Sin per cápita por programa', 'No hay población por programa: use Totales o % del PIB.');
      if (!entreGob()) {
        if (!sectoresSel.length) return pistaP('Elija un sector para ver sus programas', 'Haga clic en un sector del gráfico «Sectores»: aquí aparecerán sus programas (el cubo solo los desagrega dentro de un sector a la vez).');
        if (sectoresSel.length > 1) return pistaP(`Hay ${sectoresSel.length} sectores seleccionados`, 'El desglose es de un solo sector: deje uno elegido en «Sectores».');
        const g = gobs()[0], s1 = inds()[0];
        const filas = Cubo.agregar(serieQ(s1, { programa: DES }), 'programa');
        const datos = filas.map((d) => ({ cat: Cubo.etiqPrograma(g, d.cat), valor: d.valor }))
          .filter((d) => d.valor > 0).sort((a, b) => b.valor - a.valor);
        if (!datos.length) {
          return pistaP('Sin programas para esta combinación', 'Este sector no tiene programas con monto para los filtros elegidos.');
        }
        contProgramas.append(UI.h('div', { class: 'fuente-esp-de' }, 'Sector:', UI.h('span', {}, sectoresSel[0])));
        // est.sel.programa guarda NOMBRES (igual que filtroPrograma()): alternar() ya trabaja
        // directo con la etiqueta — Cubo.codigoPrograma() solo hace falta en baseQ(), al consultar.
        const alSel = (etq) => { alternar('programa', etq); actualizar(); };
        const r = Graficas.topOtros(datos, 12);
        contProgramas.append(Graficas.barrasLista(r.datos, { onClick: alSel, seleccion: est.sel.programa }));
        if (r.otros.length) {
          contProgramas.append(UI.h('div', { class: 'sectores-otros' }, UI.h('b', {}, `Otros (${r.otros.length}): `), r.otros.join(', ')));
        }
        contProgramas.append(UI.h('p', { class: 'texto-suave', style: { margin: '.5rem 0 0' } },
          'Clic en una barra para filtrar todo el visor por ese programa.'));
        return;
      }
      const gs = gobs();
      contProgramas.append(UI.cargando('Cargando los programas…'));
      try { await Promise.all(gs.map((g) => Programas.cargar(g))); } catch (e) {
        if (mio !== tokProg) return;
        UI.vaciar(contProgramas); return pistaP('No se pudieron cargar los programas', String(e.message || e));
      }
      if (mio !== tokProg) return;               // llegó una selección más nueva
      // Sin sector elegido se suman TODOS; con varios, los de esos varios (antes bloqueaba ambos
      // casos). fuente: igual que baseQ() — «Sin privados» filtra también los programas.
      const filtros = (g) => ({ sector: sectoresSel.length ? sectoresSel : null,
                                fuente: est.sel.fuente || (est.vistaFuentes === 'sin_privados' ? fuentesSinPrivados() : null),
                                departamento: est.sel.departamento,
                                vigencia: est.sel.vigencia ? vigSel(g) : null });      // «Año k» → año calendario de cada gobierno
      const porGob = gs.map((g) => [g, Programas.agregar(g, filtros(g), Medida)]);
      UI.vaciar(contProgramas);
      const solo = (ds) => !ds.length || (ds.length === 1 && ds[0].cat === 'Sin programa');
      if (porGob.every(([, ds]) => solo(ds))) {
        return pistaP('Sin programas para esta combinación', 'Ningún gobierno elegido trae programas para el sector y los filtros elegidos.');
      }
      const etiquetaSector = !sectoresSel.length ? 'Todos los sectores'
        : sectoresSel.length === 1 ? sectoresSel[0] : `${sectoresSel.length} sectores`;
      contProgramas.append(UI.h('div', { class: 'fuente-esp-de' }, 'Sector:', UI.h('span', {}, etiquetaSector)));
      const alClic = (c) => { alternar('programa', c); actualizar(); };
      let otros = [];
      if (modoBarras() === 'cambio') {
        // Diferencia como en Sectores: una barra por programa, coloreada por la magnitud del
        // cambio entre los dos gobiernos (ver pintarCambio en pintar(), arriba).
        const [g1, g2] = gs;   // gs = gobs(): cronológico, el más viejo primero = base
        const ds1 = new Map(porGob.find(([g]) => g === g1)[1].map((d) => [d.cat, d.valor]));
        const ds2 = new Map(porGob.find(([g]) => g === g2)[1].map((d) => [d.cat, d.valor]));
        let filas = [...new Set([...ds1.keys(), ...ds2.keys()])]
          .map((cat) => ({ cat, v1: ds1.get(cat) || 0, v2: ds2.get(cat) || 0 }));
        filas.sort((a, b) => (b.v1 + b.v2) - (a.v1 + a.v2));
        if (filas.length > 12) { otros = filas.slice(12).map((f) => f.cat); filas = filas.slice(0, 12); }
        const datos = filas.map((f) => {
          const valor = f.v2 - f.v1;
          const variacion = f.v1 > 0 ? valor / f.v1 : NaN;
          const color = colorCambio([variacion])[0];
          const tooltip = `<b>${Formato.esc(f.cat)}</b><br>${Formato.esc(g1)}: ${Formato.cop(f.v1)}<br>${Formato.esc(g2)}: ${Formato.cop(f.v2)}<br>` +
            `Diferencia: ${Formato.cop(valor, 0, true)}<br>Variación: ${Formato.pct(variacion, 1, true)}`;
          return { cat: f.cat, valor, color, tooltip };
        });
        contProgramas.append(Graficas.barrasCambio(datos, { onClick: alClic, seleccion: est.sel.programa, formatear: (v) => Formato.cop(v, 0, true) }));
        contProgramas.append(Mapa.leyenda(PAL_CAMBIO, ETIQ_CAMBIO, 'Magnitud de la variación'));
      } else {
        // «Totales» / «Cambio en % de participación»: una fila por programa con una barra por
        // gobierno — mismo orden de dibujo que el resto de cajas (seriesVisual(): el más reciente
        // primero), para que no quede al revés de Sectores/Fuentes/Vigencias.
        const porGobMap = new Map(porGob);
        const filas = seriesVisual().flatMap((g) =>
          (porGobMap.get(g) || []).map((d) => ({ cat: d.cat, serie: g, valor: d.valor })));
        const tot = new Map(); filas.forEach((x) => tot.set(x.cat, (tot.get(x.cat) || 0) + x.valor));
        const orden = [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
        const top = orden.slice(0, 12); otros = orden.slice(12);
        const rango = new Map(top.map((c, i) => [c, i]));
        const datos = filas.filter((x) => top.includes(x.cat)).sort((a, b) => rango.get(a.cat) - rango.get(b.cat))
          .concat(otros.length ? seriesVisual().map((g) => ({ cat: 'Otros', serie: g,
            valor: filas.filter((x) => otros.includes(x.cat) && x.serie === g).reduce((a, x) => a + x.valor, 0) })) : []);
        contProgramas.append(Graficas.barrasLista(datos, { pal: palSeries(), onClick: alClic, seleccion: est.sel.programa }),
          Graficas.leyenda(seriesVisual(), palSeries()));
      }
      if (otros.length) {
        contProgramas.append(UI.h('div', { class: 'sectores-otros' }, UI.h('b', {}, `Otros (${otros.length}): `), otros.join(', ')));
      }
      // Los programas (programas.js) viven en un shard aparte del cubo, al grano vigencia × fuente
      // general × sector × departamento × programa — SIN fuente específica ni líneas del PND, así
      // que esos filtros no tienen con qué cruzar aquí (antes esto bloqueaba toda la caja; ahora se
      // avisa y se sigue mostrando con lo que sí aplica).
      const sinCruce = [];
      if (est.sel.fondo) sinCruce.push('la fuente específica');
      if (est.sel.linea) sinCruce.push('el Eje');
      if (est.sel.tema) sinCruce.push('el Tema');
      if (est.sel.estrategia) sinCruce.push('la Estrategia');
      if (est.sel.entidad) sinCruce.push('la entidad');
      if (sinCruce.length) {
        contProgramas.append(UI.h('p', { class: 'texto-suave', style: { margin: '.5rem 0 0' } },
          `Nota: los programas no tienen ${sinCruce.join(', ')} como dato propio — ese filtro no se aplica en esta caja (sí respeta sector, fuente, departamento y vigencia).`));
      }
      contProgramas.append(UI.h('p', { class: 'texto-suave', style: { margin: '.5rem 0 0' } },
        'Clic en una barra para resaltarla (es informativo dentro de esta caja al comparar gobiernos: el código de programa es propio de cada uno, así que no filtra las demás). ' +
        'Los gobiernos se comparan por nombre de programa: un mismo programa puede llamarse distinto entre gobiernos (en 2011-2018 la numeración y los nombres son otros).'));
    }

    function pintarMapa(m, s1, s2) {
      const nombres = Mapa.departamentos;
      UI.vaciar(contLeyenda);

      if (m === 'balance') {
        // «Cambio en totales» (ver el selector «Comparación»): el mapa pasa de índice de crecimiento
        // (con signo) a la misma paleta por MAGNITUD que usan las barras — mismo pct, otro color.
        const porCambio = entreGob() && modoBarras() === 'cambio';
        // indicador: indCubo(..., true) — el mapa abre departamento, necesita la variante PIIP si
        // hay ejecución. Entre gobiernos s1/s2 son NOMBRES DE GOBIERNO (ver baseQ): el indicador
        // real es siempre inds()[0], igual que arma baseQ ahí.
        const indMapa = entreGob() ? () => inds()[0] : (s) => s;
        const ind1 = indCubo(indMapa(s1), true), ind2 = indCubo(indMapa(s2), true);
        const den = new Map(Cubo.agregar(serieQ(s1, { departamento: DES, indicador: ind1 }), 'departamento').map((d) => [d.cat, d.valor]));
        const num = new Map(Cubo.agregar(serieQ(s2, { departamento: DES, indicador: ind2 }), 'departamento').map((d) => [d.cat, d.valor]));
        const pl = nombres.map((d) => den.get(d) || 0);
        const ej = nombres.map((d) => num.get(d) || 0);
        // La razón/variación SIEMPRE en corrientes (Medida.enCorrientes): en % del PIB, s1/s2 pueden cubrir
        // distinto conjunto de años (p. ej. dos gobiernos) y por lo tanto distinto denominador — mezclarlos
        // en una sola razón ya convertida a % del PIB no tendría sentido.
        const denC = new Map(Cubo.agregar(Medida.enCorrientes(serieQ(s1, { departamento: DES, indicador: ind1 })), 'departamento').map((d) => [d.cat, d.valor]));
        const numC = new Map(Cubo.agregar(Medida.enCorrientes(serieQ(s2, { departamento: DES, indicador: ind2 })), 'departamento').map((d) => [d.cat, d.valor]));
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
        // 'simple' solo ocurre sin entreGob() (ver modo()): s1 ya es un nombre de indicador real.
        const d = new Map(Cubo.agregar(serieQ(s1, { departamento: DES, indicador: indCubo(s1, true) }), 'departamento').map((x) => [x.cat, x.valor]));
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
      // Entre gobiernos la caja de Eje/Tema/Estrategia no aplica (abajo, return temprano): se oculta
      // y Fuentes/Vigencias crecen al ancho de Sectores/Departamentos para no dejar un hueco.
      colLineas.hidden = entreGob();
      colFuentes.className = entreGob() ? 'col-7' : 'col-t-igual';
      colVigencias.className = entreGob() ? 'col-5' : 'col-t';
      const s = series();
      if (entreGob() || s.length !== 1 || s[0] !== 'Planeado PPI') {
        est.sel.linea = null; est.sel.tema = null; est.sel.estrategia = null;
        return;
      }
      const gob = gobs()[0];

      // Una sola consulta trae nivel 1 (linea2 == Total), nivel 2 (linea2 ≠ Total, linea3 == Total)
      // y nivel 3 —Estrategia— (linea3 ≠ Total).
      // fuente_general explícito: el cubo es cerrado y el marginal de nivel 2 (Tema, con linea3 en
      // 'Total') no es la suma de las filas finas — filtrar por la LISTA de fuentes de «Sin
      // privados» (el default de baseQ) lo dejaba en 0 filas, aunque Eje y Estrategia sí quedaban.
      // Con una fuente puntual elegida sí se respeta (igual que antes); sin ninguna, se usa el
      // marginal 'Total' real en vez de esa lista.
      const filas = Cubo.agregar(serieQ('Planeado PPI', { linea1: DES, linea2: null, linea3: null, fuente_general: est.sel.fuente || 'Total' }), ['linea1', 'linea2', 'linea3']);
      const n1 = new Map(), n2 = new Map(), n3 = new Map();
      filas.forEach(({ cats, valor }) => {
        const [c1, c2, c3] = cats;
        if (c2 === 'Total') { n1.set(c1, (n1.get(c1) || 0) + valor); return; }
        // «Sin categoría» (sin línea PND): el cubo repite el MISMO código en los 3 niveles en vez de
        // dejar Tema/Estrategia en 'Total' — un código real nunca se repite igual a su padre (el de
        // Tema siempre tiene más dígitos que el de su Eje), así que esto solo pasa en «Sin categoría».
        // No es un Tema ni una Estrategia real: se deja fuera de n2/n3 (si entrara, dominaría esas
        // vistas) — en «Sin categoría» ya se ve agregado, a nivel Eje.
        if (c2 === c1) return;
        if (c3 === 'Total') {
          if (!n2.has(c1)) n2.set(c1, new Map());
          n2.get(c1).set(c2, (n2.get(c1).get(c2) || 0) + valor);
          return;
        }
        if (c3 === c2) return;
        const kTema = c1 + '|' + c2;
        if (!n3.has(kTema)) n3.set(kTema, new Map());
        n3.get(kTema).set(c3, (n3.get(kTema).get(c3) || 0) + valor);
      });

      // «Sin privados» usó 'Total' arriba (no la lista) para no perder el marginal de Tema — eso deja
      // a Privados mezclado en «Sin categoría» (su único linea1, al no tener línea PND propia). Se
      // resta aparte su aporte a ese nodo para que «Sin categoría» no cuente a Privados cuando la
      // vista activa es «Sin privados» (antes se colaba completo ahí — bug reportado). Solo hace
      // falta a nivel Eje (n1): Tema/Estrategia ya quedan fuera arriba.
      if (!est.sel.fuente && est.vistaFuentes === 'sin_privados') {
        const totPriv = Cubo.total(Object.assign({}, serieQ('Planeado PPI'), { fuente_general: ['Privados'], linea1: 'Total', linea2: 'Total', linea3: 'Total' }));
        for (const [c1, v] of n1) {
          if (c1 !== 'Sin categoría') continue;
          const resto = v - totPriv;
          if (resto > 0) n1.set(c1, resto); else n1.delete(c1);
        }
      }

      // --- Selector Eje/Tema/Estrategia: un solo nivel a la vez (UI.grupoBotones arriba de la caja,
      // igual patrón que Fuentes/Sectores). Tema y Estrategia se aplanan —sus códigos ya son únicos
      // por sí solos, ver lineasPND() arriba— y se muestran top-N + Otros como Sectores: con hasta
      // ~60 estrategias una dona sería ilegible, así que solo Eje (6-7 categorías) va en dona.
      //
      // Si ya hay un Eje (o Tema) elegido, Tema (o Estrategia) se acota a sus hijos, no a TODOS —
      // antes se podía elegir un Eje y, aparte, un Tema de OTRO Eje (combinación imposible: el cubo
      // cruza linea1×linea2 a la vez, así que esa mezcla siempre daba cero filas en todo el visor,
      // no solo aquí). Un aviso arriba («Eje: …») deja claro a qué está acotada la caja, igual que
      // «Sector: …» en Programas.
      const ETQ_NIVEL = { eje: 'Eje', tema: 'Tema', estrategia: 'Estrategia' };
      const CLAVE_NIVEL = { eje: 'linea', tema: 'tema', estrategia: 'estrategia' };
      const aplanar = (mapaDeMapas) => {
        const m = new Map();
        for (const hijos of mapaDeMapas.values()) for (const [codigo, valor] of hijos) m.set(codigo, (m.get(codigo) || 0) + valor);
        return m;
      };
      const nivel = est.vistaLinea;
      let mapaNivel, contexto = null;
      if (nivel === 'eje') {
        mapaNivel = n1;
      } else if (nivel === 'tema') {
        if (est.sel.linea && est.sel.linea.length) {
          mapaNivel = new Map();
          for (const eje of est.sel.linea) for (const [tema, valor] of (n2.get(eje) || [])) mapaNivel.set(tema, (mapaNivel.get(tema) || 0) + valor);
          contexto = { etq: 'Eje', valor: est.sel.linea.map((c) => Cubo.etiqLinea(gob, c)).join(' · ') };
        } else mapaNivel = aplanar(n2);
      } else {
        if (est.sel.tema && est.sel.tema.length) {
          mapaNivel = new Map();
          for (const tema of est.sel.tema) {
            const eje = [...n2.entries()].find(([, hijos]) => hijos.has(tema))?.[0];
            const hijos = eje && n3.get(eje + '|' + tema);
            if (hijos) for (const [codigo, valor] of hijos) mapaNivel.set(codigo, (mapaNivel.get(codigo) || 0) + valor);
          }
          contexto = { etq: 'Tema', valor: est.sel.tema.map((c) => Cubo.etiqLinea(gob, c)).join(' · ') };
        } else if (est.sel.linea && est.sel.linea.length) {
          // Sin Tema elegido pero con Eje sí: TODAS las estrategias de ese Eje (de todos sus temas),
          // no solo las de un tema puntual.
          mapaNivel = new Map();
          for (const eje of est.sel.linea) {
            for (const tema of (n2.get(eje) || new Map()).keys()) {
              const hijos = n3.get(eje + '|' + tema);
              if (hijos) for (const [codigo, valor] of hijos) mapaNivel.set(codigo, (mapaNivel.get(codigo) || 0) + valor);
            }
          }
          contexto = { etq: 'Eje', valor: est.sel.linea.map((c) => Cubo.etiqLinea(gob, c)).join(' · ') };
        } else mapaNivel = aplanar(n3);
      }
      const clave = CLAVE_NIVEL[nivel];
      const datos = [...mapaNivel.entries()]
        .map(([codigo, valor]) => ({ cat: Cubo.etiqLinea(gob, codigo), valor, codigo }))
        .filter((d) => d.valor > 0)
        .sort((a, b) => b.valor - a.valor);
      const porEtiqueta = new Map(datos.map((d) => [d.cat, d.codigo]));
      const alSel = (etq) => { const c = porEtiqueta.get(etq); if (c) { alternar(clave, c); actualizar(); } };
      const seleccionEtq = (est.sel[clave] || []).map((c) => Cubo.etiqLinea(gob, c));

      let cuerpo;
      if (!datos.length) {
        cuerpo = UI.estadoVacio(`Sin ${ETQ_NIVEL[nivel].toLowerCase()}s del PND para esta combinación`,
          contexto ? `${contexto.etq} «${contexto.valor}» no tiene ${ETQ_NIVEL[nivel].toLowerCase()}s con monto.`
          : 'El cubo solo cruza las líneas del PND con la vigencia, la fuente, el sector y el departamento; ' +
            'al filtrar por una fuente específica (o combinar más filtros) esta caja puede quedar vacía.');
      } else if (nivel === 'eje') {
        // Mismo tamaño que la dona de Fuentes (ancho/alto/clase): las dos donas de la fila quedan iguales.
        const dona = Graficas.dona(datos, {
          onClick: alSel, seleccion: seleccionEtq, colores: palRotativa(datos.map((d) => d.cat)), ancho: 340, alto: 240
        });
        dona.classList.add('grafica-dona-chica');
        cuerpo = dona;
      } else {
        // Acotado por el nivel de arriba (Eje para Tema, Tema para Estrategia): ya es una lista
        // corta por sí sola, se muestra completa. Sin acotar, se limita a 7 + Otros —como el resto
        // del tablero (Sectores, Programas…)— para no disparar el alto de la caja.
        const r = Graficas.topOtros(datos, contexto ? Infinity : 7);
        cuerpo = UI.h('div', {}, Graficas.barrasLista(r.datos, { onClick: alSel, seleccion: seleccionEtq }),
          r.otros.length ? UI.h('div', { class: 'sectores-otros' }, UI.h('b', {}, `Otros (${r.otros.length}): `), r.otros.join(', ')) : null);
      }
      // Título corto (como Vigencias/Fuentes): la columna es angosta y una leyenda larga en el
      // encabezado empuja el selector hacia abajo. El «clic para filtrar» ya es la norma en todo
      // el visor (lo dice el aviso de arriba de la página); la nota de Estrategia va a pie de caja.
      const contenido = UI.h('div', {},
        contexto ? UI.h('div', { class: 'fuente-esp-de' }, contexto.etq + ':', UI.h('span', {}, contexto.valor)) : null,
        cuerpo,
        nivel === 'estrategia' ? UI.h('p', { class: 'texto-suave', style: { margin: '.5rem 0 0' } },
          'No todas las Estrategias tienen programa asociado: algunas no aparecen aquí por no tener monto.') : null);

      const accLineas = UI.grupoBotones({
        opciones: [{ valor: 'eje', texto: 'Eje' }, { valor: 'tema', texto: 'Tema' }, { valor: 'estrategia', texto: 'Estrategia' }],
        valor: est.vistaLinea,
        onCambio: (v) => { est.vistaLinea = v; pintarLineas(); }
      });
      contLineas.append(UI.card(ETQ_NIVEL[nivel] + ' del PND',
        contenido, { acciones: accLineas }));
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
