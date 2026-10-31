// ============================================================================
// hojas/ppi_2027.js — Hoja "PPI 2027-2030". Copia simplificada de hojas/visor.js,
// fija en el PPI 2027-2030: mismo motor de cross-filtering completo, pero con el
// panel de filtros reducido a la unidad de medida (sin selector de Comparar,
// Gobierno/PPI ni Indicadores — quedan fijos y ocultos, no deshabilitados).
// Agrega un botón para descargar la base completa de este gobierno en CSV.
//
// Es independiente de HojaVisor: cada hoja es su propio módulo con su propio
// `est` (ver README, sección «Reparto de trabajo»); lo único que comparten es
// el singleton Medida (medida.js), igual que ya comparten Visor y Descargar.
// ============================================================================

const HojaPPI2027 = (() => {

  const GOBIERNO = 'PPI 2027-2030';

  // Indicadores en jerarquía de MAYOR a MENOR (igual que visor.js; aquí solo se usa el primero).
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

  const est = {
    ambito: 'Por gobierno',
    gobiernos: [GOBIERNO], indicadores: ['Planeado PPI'],
    vista: 'Totales',
    sel: { sector: null, departamento: null, vigencia: null, fuente: null, fondo: null, linea: null, tema: null, estrategia: null, programa: null },
    fondoDe: null,
    // Vista activa de las cajas con selector (no son filtros, solo qué se muestra):
    vistaFuentes: 'sin_privados',     // 'total' | 'sin_privados' | 'especifica' — por defecto sin Privados
                                       // (es más de la mitad del PPI y tapa el resto de la torta)
    vistaSector: 'sectores',          // 'sectores' | 'programas'
    vistaLinea: 'eje'                 // 'eje' | 'tema' | 'estrategia' — qué nivel del PND se muestra
  };

  const entreGob = () => false;                  // esta hoja nunca compara gobiernos

  // Catálogo de fuente_general SIN Privados (ver el comentario equivalente en hojas/visor.js).
  const fuentesSinPrivados = () => Cubo.niveles('fuente_general').filter((c) => c !== 'Total' && c !== 'Privados');

  function gobs() { return [GOBIERNO]; }

  function indsDisp() {
    const presentes = IND_ORDEN.filter((n) => Cubo.unidadesDe(GOBIERNO, indCubo(n, false)).length);
    return presentes.length ? presentes : ['Planeado PPI'];
  }

  function inds() {
    const disp = indsDisp();
    let s = IND_ORDEN.filter((x) => est.indicadores.includes(x) && disp.includes(x));
    if (!s.length) s = [disp[0]];
    return s;
  }

  const series = () => inds();
  function modo() {
    const n = series().length;
    return n === 1 ? 'simple' : n === 2 ? 'balance' : 'multi';
  }
  const vista = () => est.vista;
  function modoBarras() {
    const m = modo();
    if (m === 'simple') return 'simple';
    if (m === 'balance' && vista() === 'Avance %') return 'overlay';
    return 'grupo';
  }
  const palSeries = () => PAL_IND;
  const seriesVisual = () => series();

  function pcDisponible() {
    return Medida.pcDisponible(inds().map((n) => [GOBIERNO, indCubo(n, false)]));
  }

  function vigenciasDe() { return []; }           // sin uso: esta hoja nunca compara gobiernos

  function vigSel() { return est.sel.vigencia || 'Totales'; }

  function baseQ(gobierno, nombreInd) {
    return Medida.aplicar({
      gobierno, tipo_dato: IND_TD[nombreInd], indicador: indCubo(nombreInd, !!est.sel.departamento),
      sector: est.sel.sector || 'Total',
      // programa ⊂ sector: solo existe desagregado junto a un sector elegido (ver el comentario
      // equivalente en cubo.js:normalizar) — por eso también se limpia al cambiar de sector (alternar).
      programa: est.sel.programa || 'Total',
      departamento: est.sel.departamento || 'Total',
      vigencia: vigSel(),
      // Ver el comentario equivalente en hojas/visor.js: «Sin privados» filtra TODO el tablero.
      fuente_general: est.sel.fuente || (est.vistaFuentes === 'sin_privados' ? fuentesSinPrivados() : 'Total'),
      fuente_fondo: est.sel.fondo || 'Total',
      // Ver el comentario equivalente en hojas/visor.js: cada nivel (Eje/Tema/Estrategia) fija el
      // SIGUIENTE a 'Total' salvo que haya algo elegido ahí (si no, cuenta el marginal Y sus hijos
      // a la vez); los niveles de ARRIBA se dejan sin fijar (DES) cuando no hay nada explícito en
      // ellos, porque los códigos de Tema/Estrategia ya son únicos por sí solos.
      linea1: est.sel.linea || (est.sel.tema || est.sel.estrategia ? DES : 'Total'),
      linea2: est.sel.estrategia ? DES : (est.sel.tema || 'Total'),
      linea3: est.sel.estrategia || 'Total'
    });
  }
  function serieQ(s, extra) {
    const q = baseQ(GOBIERNO, s);
    return Object.assign(q, extra || {});
  }

  function pctRegionalizado(s) {
    const q = Object.assign({}, serieQ(s), { departamento: 'Total', tipo_valor: 'corriente', base: null, pib: false, pc: false });
    const total = Cubo.total(q);
    if (!(total > 0)) return null;
    const nacional = Cubo.total(Object.assign({}, q, { departamento: ['Nacional'] }));
    return 1 - nacional / total;
  }
  function pibRegional(s) {
    const q = Object.assign({}, serieQ(s), { departamento: 'Total' });
    const total = Cubo.total(q);
    if (!(total > 0)) return null;
    return { total, nacional: Cubo.total(Object.assign({}, q, { departamento: ['Nacional'] })) };
  }
  function notaRegional(seriesMapa) {
    if (Medida.pib) {
      const partes = seriesMapa.map((s) => {
        const r = pibRegional(s); if (!r) return null;
        return `${Formato.esc(s)}: de ${Formato.cop(r.total)} del PIB, ${Formato.cop(r.total - r.nacional)} está en departamentos (lo que pinta el mapa) ` +
               `y ${Formato.cop(r.nacional)} es nacional o sin departamento asignado (no se pinta)`;
      }).filter(Boolean);
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

  function alternar(dim, valor) {
    if (valor === 'Otros') return;
    // El Tema elegido pertenece a un Eje y la Estrategia a un Tema que acaban de cambiar.
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

  function sincronizarFondo() {
    const f = est.sel.fuente;
    const unica = f && f.length === 1 ? f[0] : null;
    if (unica !== est.fondoDe) { est.sel.fondo = null; est.fondoDe = unica; }
  }

  // Descarga la base de PPI 2027-2030 (Planeado PPI, corrientes), desagregada por las 5 dimensiones
  // que el cubo SÍ cruza todas a la vez: vigencia, fuente general, fuente específica, sector y
  // departamento — la suma de estas filas da exactamente el total (22.858 filas, verificado). Las
  // líneas del PND (linea1/linea2) quedan fuera: el cubo no las cruza con la fuente específica (0 filas
  // si se agregan las 7 juntas), así que van en una descarga aparte si hace falta.
  // Descarga la base OFICIAL de consulta (1. Consulta/Datos/PPI.xlsx, no el cubo del tablero),
  // filtrada a PPI 2027-2030, SIN transformar: misma estructura de columnas y misma fila por
  // vigencia que en Consulta. Es un archivo estático que arma pipeline/exportar_base_wide.R — si
  // ese Excel cambia, ese script hay que volver a correrlo a mano (no pasa solo con exportar_web.R).
  // SIN fetch (ver Descargas.archivo): el sitio se abre como file:// y fetch() no puede leer
  // un archivo local ahí — con fetch, el botón parecía funcionar al probarlo por http:// (el
  // único protocolo donde fetch SÍ lee archivos locales) pero fallaba en el uso real.
  function descargarBase() {
    Descargas.archivo('descargas/PPI_2027-2030.csv', 'PPI_2027-2030.csv');
  }

  // --------------------------------------------------------------------------
  function render(raiz) {
    UI.vaciar(raiz);
    raiz.append(UI.hero('PPI 2027-2030', 'Visor del PPI 2027-2030',
      'La misma Tabla de indicadores del Visor Interactivo, fija en el PPI 2027-2030: cruce libre entre mapa, ' +
      'sectores, vigencias, fuentes y programas. Solo cambia la unidad de medida (el resto de los filtros del ' +
      'Visor Interactivo completo no aplican aquí). Cifras en miles de millones de pesos.'));

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
    const contMapa = UI.h('div', { style: { height: '420px' } });
    const contLeyenda = UI.h('div', {});
    const contLineas = UI.h('div', {});

    // Envoltorios de las dos cajas con selector de vista — ver el comentario equivalente en
    // hojas/visor.js. Aquí Sectores/Programas es un selector de 2, no de 3 (no hay Entidad).
    const envFuentes = UI.h('div', {}, contFuentes);
    const envFondo = UI.h('div', {}, contFondo);
    const tituloFuentes = UI.h('span', {});
    const accFuentes = UI.h('div', {});
    const envSectores = UI.h('div', {}, contSectores);
    const envProgramas = UI.h('div', {}, contProgramas);
    const tituloSector = UI.h('span', {});
    const accSector = UI.h('div', {});

    raiz.append(UI.h('main', { class: 'container-xl dnp-main' },
      UI.h('div', { class: 'fila' },
        UI.colFiltrosColapsable(panelFiltros),
        UI.h('div', { class: 'col-contenido' },
          avisos, notaUnidad, kpis, chips,
          // Fuentes, Eje/Tema/Estrategia y Vigencias en una sola fila: Fuentes y Eje/Tema/Estrategia
          // con el mismo ancho (col-t-igual), Vigencias más angosta (col-t) — esta hoja nunca compara
          // gobiernos, así que esta fila es siempre de 3 cajas (a diferencia de hojas/visor.js).
          UI.h('div', { class: 'fila-graficas' },
            UI.h('div', { class: 'col-t-igual' },
              UI.card(tituloFuentes, UI.h('div', {}, envFuentes, envFondo), { acciones: accFuentes })),
            UI.h('div', { class: 'col-t-igual' }, contLineas),
            UI.h('div', { class: 'col-t' }, UI.card('Vigencias', contVigencias))),
          UI.h('div', { class: 'fila-graficas' },
            UI.h('div', { class: 'col-7' },
              UI.card(tituloSector, UI.h('div', {}, envSectores, envProgramas), { acciones: accSector })),
            UI.h('div', { class: 'col-5' }, UI.card('Departamentos',
              UI.h('div', {}, contMapa, contLeyenda))))))));

    let mapa = null;

    // --- Panel de filtros: SOLO unidad de medida + Ficha + Descargar. El gobierno (PPI 2027-2030) y
    // el indicador (Planeado PPI) quedan fijos arriba, sin selector — a diferencia del Visor
    // Interactivo completo, que sí deja elegirlos.
    function pintarFiltros() {
      const pc = pcDisponible();
      if (!pc && Medida.percapita) Medida.fijar({ percapita: false });
      UI.vaciar(panelFiltros);
      panelFiltros.append(UI.card('Filtros', UI.h('div', {},
        Medida.controles({
          prefijo: 'ppi2027', pcDisponible: pc, pibDisponible: true,
          onCambio: (que) => {
            if (que === 'medida' && Medida.percapita && est.sel.departamento && est.sel.departamento.length > 1) {
              est.sel.departamento = [est.sel.departamento[0]];
            }
            pintarFiltros(); actualizar();
          }
        }),
        UI.h('hr', { class: 'divisor' }),
        UI.h('p', { class: 'texto-suave' },
          'La ficha se imprime con los filtros activos; en el diálogo puede elegir "Guardar como PDF".'),
        UI.h('button', { class: 'btn-primario', type: 'button', onclick: Descargas.ficha }, 'Ficha'),
        UI.h('button', {
          class: 'btn-secundario', type: 'button', style: { marginTop: '.5rem' },
          title: 'Descarga todas las filas de PPI 2027-2030, igual que en la base de Consulta (sin agregar)',
          onclick: descargarBase
        }, 'Descargar base de datos')
      ), { clase: 'card-filtros' }));
    }

    let token = 0;
    async function actualizar() {
      const mio = ++token;
      kpis.replaceChildren(UI.cargando('Cargando el corte…'));
      await Cubo.preparar(gobs(), Medida.tipoValor());
      if (mio !== token) return;
      pintar();
    }

    function pintar() {
      const m = modo(), mb = modoBarras();
      const s1 = series()[0], s2 = series()[1];
      Formato.modo = Medida.pib ? 'pib' : 'cop';
      sincronizarFondo();

      // --- Selector de vista de las dos cajas fusionadas — ver el comentario equivalente en
      // hojas/visor.js. pintar() (no actualizar()): cambiar de vista no dispara una consulta nueva.
      envFuentes.hidden = est.vistaFuentes === 'especifica';
      envFondo.hidden = est.vistaFuentes !== 'especifica';
      // Título corto (como Eje/Tema/Estrategia): el toggle de al lado ya dice el modo activo.
      const TITULOS_FUENTES = { total: 'Fuentes', sin_privados: 'Fuentes', especifica: 'Fuente específica' };
      UI.vaciar(tituloFuentes).append(TITULOS_FUENTES[est.vistaFuentes]);
      UI.vaciar(accFuentes).append(UI.grupoBotones({
        opciones: [{ valor: 'total', texto: 'Total' }, { valor: 'sin_privados', texto: 'Sin privados' },
                   { valor: 'especifica', texto: 'Específica' }],
        valor: est.vistaFuentes,
        // «Total»/«Sin privados» filtran TODO el tablero (ver baseQ): limpiar cualquier fuente
        // puntual elegida antes de cambiar entre ellos, y actualizar() en vez de pintar().
        onCambio: (v) => {
          if (v !== 'especifica') est.sel.fuente = null;
          est.vistaFuentes = v;
          actualizar();
        }
      }));

      envSectores.hidden = est.vistaSector !== 'sectores';
      envProgramas.hidden = est.vistaSector !== 'programas';
      UI.vaciar(tituloSector).append(est.vistaSector === 'sectores'
        ? 'Sectores'
        : UI.h('span', {}, 'Programas ',
            UI.h('span', { class: 'texto-suave' }, '— desglose del sector elegido en «Sectores»')));
      UI.vaciar(accSector).append(UI.grupoBotones({
        opciones: [{ valor: 'sectores', texto: 'Sectores' }, { valor: 'programas', texto: 'Programas' }],
        valor: est.vistaSector,
        onCambio: (v) => { est.vistaSector = v; pintar(); }
      }));

      UI.vaciar(avisos);
      gobs().map((g) => Cubo.infoGobierno(g)).filter((i) => i.estado && i.estado !== 'completo')
        .forEach((i) => avisos.append(UI.h('div', { class: 'aviso-cobertura', role: 'note' },
          UI.h('strong', {}, i.ppi_gobierno + ' · ' + i.estado + '. '),
          i.cobertura || '')));

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

      UI.vaciar(kpis);
      if (m === 'balance') {
        const v1 = Cubo.total(serieQ(s1)), v2 = Cubo.total(serieQ(s2));
        const v1c = Cubo.total(Medida.enCorrientes(serieQ(s1))), v2c = Cubo.total(Medida.enCorrientes(serieQ(s2)));
        kpis.append(UI.filaKpis(
          UI.kpi(Formato.cop(v1), s1 + ' de la selección'),
          UI.kpi(Formato.cop(v2), s2 + ' de la selección', 'dorado'),
          UI.kpi(Formato.pct(v1c > 0 ? v2c / v1c : null), s2 + ' / ' + s1, 'acento')));
      } else if (m === 'multi') {
        const acentos = [null, 'dorado', 'acento'];
        kpis.append(UI.filaKpis(...series().map((s, i) =>
          UI.kpi(Formato.cop(Cubo.total(serieQ(s))), s + ' de la selección', acentos[i % acentos.length]))));
      } else {
        const totSel = Cubo.total(serieQ(s1));
        const qUni = Medida.aplicar({ gobierno: GOBIERNO, tipo_dato: IND_TD[s1], indicador: indCubo(s1, false) });
        const totUni = Cubo.total(qUni);
        const razon = Cubo.total(Medida.enCorrientes(serieQ(s1))) / Cubo.total(Medida.enCorrientes(qUni));
        const etqPart = s1 === 'Planeado PPI' ? '% del total del PPI' : '% del total de ' + s1.toLowerCase();
        const etqUni = s1 === 'Planeado PPI' ? 'Total del PPI' : 'Total de ' + s1.toLowerCase();
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

      const etiquetas = {
        Sector: est.sel.sector, Departamento: est.sel.departamento,
        Vigencia: est.sel.vigencia, Fuente: est.sel.fuente, 'Fuente específica': est.sel.fondo,
        Eje: est.sel.linea ? est.sel.linea.map((c) => Cubo.etiqLinea(GOBIERNO, c)) : null,
        Tema: est.sel.tema ? est.sel.tema.map((c) => Cubo.etiqLinea(GOBIERNO, c)) : null,
        Estrategia: est.sel.estrategia ? est.sel.estrategia.map((c) => Cubo.etiqLinea(GOBIERNO, c)) : null,
        Programa: est.sel.programa ? est.sel.programa.map((c) => Cubo.etiqPrograma(GOBIERNO, c)) : null,
      };
      const claveDim = { Sector: 'sector', Departamento: 'departamento', Vigencia: 'vigencia', Fuente: 'fuente', 'Fuente específica': 'fondo', Eje: 'linea', Tema: 'tema', Estrategia: 'estrategia', Programa: 'programa' };
      UI.vaciar(chips).append(UI.chips(etiquetas,
        (dim) => {
          est.sel[claveDim[dim]] = null;
          if (claveDim[dim] === 'fuente') est.sel.fondo = null;
          if (claveDim[dim] === 'linea') { est.sel.tema = null; est.sel.estrategia = null; }
          if (claveDim[dim] === 'tema') est.sel.estrategia = null;
          if (claveDim[dim] === 'sector') est.sel.programa = null;
          actualizar();
        },
        () => { limpiarSel(); actualizar(); }));

      const porDim = (arg) => {
        if (mb === 'overlay') {
          const den = new Map(Cubo.agregar(serieQ(s1, { [arg]: DES }), arg).map((d) => [d.cat, d.valor]));
          const num = new Map(Cubo.agregar(serieQ(s2, { [arg]: DES }), arg).map((d) => [d.cat, d.valor]));
          return [...new Set([...den.keys(), ...num.keys()])].map((cat) => ({
            cat, planeado: den.get(cat) || 0, ejecutado: num.get(cat) || 0
          }));
        }
        if (mb === 'grupo') {
          return seriesVisual().flatMap((s) =>
            Cubo.agregar(serieQ(s, { [arg]: DES }), arg).map((d) => ({ cat: d.cat, serie: s, valor: d.valor })));
        }
        return Cubo.agregar(serieQ(s1, { [arg]: DES }), arg);
      };

      // --- Fuentes
      UI.vaciar(contFuentes);
      {
        let d = porDim('fuente_general');
        if (est.vistaFuentes === 'sin_privados') d = d.filter((x) => x.cat !== 'Privados');
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

      // --- Vigencias
      UI.vaciar(contVigencias);
      {
        const d = porDim('vigencia');
        const orden = (a, b) => String(a.cat).localeCompare(String(b.cat), 'es', { numeric: true });
        if (mb === 'overlay') {
          contVigencias.append(Graficas.barrasBalance(d.sort(orden), {
            onClick: (c) => { alternar('vigencia', c); actualizar(); }, seleccion: est.sel.vigencia,
            nombrePlan: s1, nombreEjec: s2, orientacion: 'v', ancho: 320
          }));
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

      const pintarTop = (cont, arg, clave, lista, n = 12) => {
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
          const tot = new Map();
          d.forEach((x) => tot.set(x.cat, (tot.get(x.cat) || 0) + x.valor));
          const orden = [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
          const top = orden.slice(0, n);
          otros = orden.slice(n);
          const rango = new Map(top.map((c, i) => [c, i]));
          const datos = d.filter((x) => top.includes(x.cat))
            .sort((a, b) => rango.get(a.cat) - rango.get(b.cat))
            .concat(otros.length ? seriesVisual().map((s) => ({
              cat: 'Otros', serie: s,
              valor: d.filter((x) => otros.includes(x.cat) && x.serie === s).reduce((a, x) => a + x.valor, 0)
            })) : []);
          if (lista) {
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
      pintarTop(contSectores, 'sector', 'sector', false, 20);

      // --- Fuente específica
      UI.vaciar(contFondo);
      const pista = (msg, det) => contFondo.append(UI.h('div', { class: 'fuente-esp-vacia' },
        UI.h('div', { class: 'icono-aviso', 'aria-hidden': 'true' }, 'i'),
        UI.h('div', { class: 'msg' }, msg), UI.h('div', { class: 'det' }, det)));
      const fuentesSel = est.sel.fuente || [];
      if (!fuentesSel.length) {
        pista('Elija una fuente para ver su desglose',
          'Haga clic en una fuente del gráfico «Fuentes»: aquí aparecerán sus fuentes específicas.');
      } else if (fuentesSel.length > 1) {
        pista(`Hay ${fuentesSel.length} fuentes seleccionadas`,
          'El desglose es de una sola fuente: deje una sola elegida en «Fuentes».');
      } else {
        contFondo.append(UI.h('div', { class: 'fuente-esp-de' }, 'Fuente:', UI.h('span', {}, fuentesSel[0])));
        const n = pintarTop(contFondo, 'fuente_fondo', 'fondo', true, 12);
        if (!n) {
          UI.vaciar(contFondo);
          pista('Sin desglose para esta combinación',
            'Esta fuente no tiene fuente específica con los filtros elegidos, o el cubo no cruza esa combinación.');
        } else {
          contFondo.append(UI.h('p', { class: 'texto-suave', style: { margin: '.5rem 0 0' } },
            'Clic en una barra para filtrar todo el visor por esa fuente específica.'));
        }
      }

      pintarProgramas();
      pintarMapa(m, s1, s2);
      pintarLineas();
    }

    // Programa ya es una dimensión real del cubo (como Sector): cruza con fuente, fuente
    // específica, departamento, vigencia y las líneas del PND, pero solo DESAGREGADA junto a un
    // sector elegido (programa ⊂ sector — ver el comentario en cubo.js:normalizar), así que esta
    // caja sigue exigiendo un solo sector. Clic en una barra filtra todo el visor, igual que Sectores.
    function pintarProgramas() {
      UI.vaciar(contProgramas);
      const pistaP = (msg, det) => contProgramas.append(UI.h('div', { class: 'fuente-esp-vacia' },
        UI.h('div', { class: 'icono-aviso', 'aria-hidden': 'true' }, 'i'),
        UI.h('div', { class: 'msg' }, msg), UI.h('div', { class: 'det' }, det)));
      const sectoresSel = est.sel.sector || [];
      const s1 = series()[0];
      if (IND_TD[s1] !== 'programación' || modo() !== 'simple') return pistaP('Solo para la programación', 'El desglose por programa existe solo para «Planeado PPI» y «Monto inflexible»: deje elegido solo uno de esos.');
      if (!sectoresSel.length) return pistaP('Elija un sector para ver sus programas', 'Haga clic en un sector del gráfico «Sectores»: aquí aparecerán sus programas (el cubo solo los desagrega dentro de un sector a la vez).');
      if (sectoresSel.length > 1) return pistaP(`Hay ${sectoresSel.length} sectores seleccionados`, 'El desglose es de un solo sector: deje uno elegido en «Sectores».');
      const filas = Cubo.agregar(serieQ(s1, { programa: DES }), 'programa');
      const datos = filas.map((d) => ({ cat: Cubo.etiqPrograma(GOBIERNO, d.cat), valor: d.valor, codigo: d.cat }))
        .filter((d) => d.valor > 0).sort((a, b) => b.valor - a.valor);
      if (!datos.length) {
        return pistaP('Sin programas para esta combinación', 'Este sector no tiene programas con monto para los filtros elegidos.');
      }
      contProgramas.append(UI.h('div', { class: 'fuente-esp-de' }, 'Sector:', UI.h('span', {}, sectoresSel[0])));
      const porEtiqueta = new Map(datos.map((d) => [d.cat, d.codigo]));
      const alSel = (etq) => { const c = porEtiqueta.get(etq); if (c) { alternar('programa', c); actualizar(); } };
      const seleccionEtq = (est.sel.programa || []).map((c) => Cubo.etiqPrograma(GOBIERNO, c));
      const r = Graficas.topOtros(datos, 12);
      contProgramas.append(Graficas.barrasLista(r.datos, { onClick: alSel, seleccion: seleccionEtq }));
      if (r.otros.length) {
        contProgramas.append(UI.h('div', { class: 'sectores-otros' }, UI.h('b', {}, `Otros (${r.otros.length}): `), r.otros.join(', ')));
      }
      contProgramas.append(UI.h('p', { class: 'texto-suave', style: { margin: '.5rem 0 0' } },
        'Clic en una barra para filtrar todo el visor por ese programa.'));
    }

    function pintarMapa(m, s1, s2) {
      const nombres = Mapa.departamentos;
      UI.vaciar(contLeyenda);

      if (m === 'balance') {
        // indicador: indCubo(s, true) — el mapa abre departamento, así que la ejecución (si hay)
        // necesita la variante PIIP (SIIF no tiene filas por departamento).
        const den = new Map(Cubo.agregar(serieQ(s1, { departamento: DES, indicador: indCubo(s1, true) }), 'departamento').map((d) => [d.cat, d.valor]));
        const num = new Map(Cubo.agregar(serieQ(s2, { departamento: DES, indicador: indCubo(s2, true) }), 'departamento').map((d) => [d.cat, d.valor]));
        const pl = nombres.map((d) => den.get(d) || 0);
        const ej = nombres.map((d) => num.get(d) || 0);
        const denC = new Map(Cubo.agregar(Medida.enCorrientes(serieQ(s1, { departamento: DES, indicador: indCubo(s1, true) })), 'departamento').map((d) => [d.cat, d.valor]));
        const numC = new Map(Cubo.agregar(Medida.enCorrientes(serieQ(s2, { departamento: DES, indicador: indCubo(s2, true) })), 'departamento').map((d) => [d.cat, d.valor]));
        const plC = nombres.map((d) => denC.get(d) || 0);
        const ejC = nombres.map((d) => numC.get(d) || 0);
        const pct = plC.map((p, i) => (p > 0 ? ejC[i] / p : NaN));
        const fills = coloresPct(pct, 'avance');
        mapa.aviso(null);
        mapa.pintar(nombres.map((d, i) => ({
          departamento: d,
          fill: est.sel.departamento && !est.sel.departamento.includes(d) ? GRIS_INACTIVO : fills[i],
          etiqueta: `<b>${Formato.esc(d)}</b><br>${Formato.esc(s1)}: ${Formato.cop(pl[i])}<br>` +
            `${Formato.esc(s2)}: ${Formato.cop(ej[i])}<br>${Formato.esc(s2)} / ${Formato.esc(s1)}: ${Formato.pct(pct[i])}`
        })));
        contLeyenda.append(
          Mapa.leyenda(PAL_EJEC, ETIQ_EJEC, `${s2} / ${s1}`),
          Mapa.nota(`${s2} como % de ${s1} en cada departamento. En blanco quedan los departamentos sin ${s1}.`));
        const notaReg1 = notaRegional([s1, s2]);
        if (notaReg1) contLeyenda.append(Mapa.nota(notaReg1));
      } else if (m === 'simple') {
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
              (tot > 0 && !Medida.percapita && !Medida.pib ? ` (${Formato.pct(v[i] / tot)})` : '')
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
        mapa.aviso(MSG_MULTI);
        mapa.pintar(nombres.map((n) => ({ departamento: n, fill: GRIS_MAPA, etiqueta: `<b>${Formato.esc(n)}</b>` })));
      }
    }

    function pintarLineas() {
      UI.vaciar(contLineas);
      const s = series();
      if (s.length !== 1 || s[0] !== 'Planeado PPI') {
        est.sel.linea = null; est.sel.tema = null; est.sel.estrategia = null;
        return;
      }

      // Una sola consulta trae nivel 1 (linea2 == Total), nivel 2 (linea2 ≠ Total, linea3 == Total)
      // y nivel 3 —Estrategia— (linea3 ≠ Total). fuente_general explícito: el marginal de Tema no
      // existe filtrando por la lista de «Sin privados» (ver el comentario equivalente en
      // hojas/visor.js), solo por el 'Total' real o una fuente puntual elegida.
      const filas = Cubo.agregar(serieQ('Planeado PPI', { linea1: DES, linea2: null, linea3: null, fuente_general: est.sel.fuente || 'Total' }), ['linea1', 'linea2', 'linea3']);
      const n1 = new Map(), n2 = new Map(), n3 = new Map();
      filas.forEach(({ cats, valor }) => {
        const [c1, c2, c3] = cats;
        if (c2 === 'Total') { n1.set(c1, (n1.get(c1) || 0) + valor); return; }
        // «Sin categoría» (sin línea PND): el cubo repite el MISMO código en los 3 niveles en vez de
        // dejar Tema/Estrategia en 'Total' — un código real nunca se repite igual a su padre (el de
        // Tema siempre tiene más dígitos que el de su Eje), así que esto solo pasa en «Sin categoría».
        // No es un Tema ni una Estrategia real: se deja fuera de n2/n3 (si entrara, dominaría esas
        // vistas — ver «Cómo se actualiza» — y en «Sin categoría» ya se ve agregado, a nivel Eje).
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
      // a Privados mezclado en «Sin categoría» (su único linea1, al no tener línea PND propia: ver el
      // aviso de cobertura). Se resta aparte su aporte a ese nodo para que «Sin categoría» no cuente a
      // Privados cuando la vista activa es «Sin privados» (antes se colaba completo ahí — bug
      // reportado). Solo hace falta a nivel Eje (n1): Tema/Estrategia ya quedan fuera arriba.
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
      // por sí solos, ver el comentario de lineasPND() en hojas/visor.js— y se muestran top-N + Otros
      // como Sectores: con hasta ~60 estrategias una dona sería ilegible, así que solo Eje (6-7
      // categorías) va en dona; Tema (hasta ~26) y Estrategia en barras.
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
          contexto = { etq: 'Eje', valor: est.sel.linea.map((c) => Cubo.etiqLinea(GOBIERNO, c)).join(' · ') };
        } else mapaNivel = aplanar(n2);
      } else {
        if (est.sel.tema && est.sel.tema.length) {
          mapaNivel = new Map();
          for (const tema of est.sel.tema) {
            const eje = [...n2.entries()].find(([, hijos]) => hijos.has(tema))?.[0];
            const hijos = eje && n3.get(eje + '|' + tema);
            if (hijos) for (const [codigo, valor] of hijos) mapaNivel.set(codigo, (mapaNivel.get(codigo) || 0) + valor);
          }
          contexto = { etq: 'Tema', valor: est.sel.tema.map((c) => Cubo.etiqLinea(GOBIERNO, c)).join(' · ') };
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
          contexto = { etq: 'Eje', valor: est.sel.linea.map((c) => Cubo.etiqLinea(GOBIERNO, c)).join(' · ') };
        } else mapaNivel = aplanar(n3);
      }
      const clave = CLAVE_NIVEL[nivel];
      const datos = [...mapaNivel.entries()]
        .map(([codigo, valor]) => ({ cat: Cubo.etiqLinea(GOBIERNO, codigo), valor, codigo }))
        .filter((d) => d.valor > 0)
        .sort((a, b) => b.valor - a.valor);
      const porEtiqueta = new Map(datos.map((d) => [d.cat, d.codigo]));
      const alSel = (etq) => { const c = porEtiqueta.get(etq); if (c) { alternar(clave, c); actualizar(); } };
      const seleccionEtq = (est.sel[clave] || []).map((c) => Cubo.etiqLinea(GOBIERNO, c));

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
      contLineas.append(UI.card(ETQ_NIVEL[nivel] + ' del PND', contenido, { acciones: accLineas }));
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
