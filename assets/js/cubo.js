// ============================================================================
// cubo.js — Consulta de la Tabla de indicadores. Espejo de R/utils_cubo.R.
//
// Toda hoja lee de aquí: ninguna toca los .bin directamente. La convención del
// cubo es SDMX:
//   'Total'   = dimensión no desagregada en esa fila
//   'Totales' = vigencia agregada del cuatrienio completo
//
// El cubo viene shardeado por gobierno × unidad de medida (ver
// pipeline/exportar_web.R). Los shards se cargan bajo demanda y quedan en
// memoria: al arrancar solo se baja el del gobierno vigente en corrientes.
// Unidades que viajan: 'corriente' y 'corriente_pc' (pesos por habitante, precalculado
// en R). Las CONSTANTES se calculan aquí: con q.base (año) las filas de corriente se
// multiplican por índice[base] / índice[vigencia] (ver pesosVigencia). Con q.pib las filas de corriente
// se pasan primero a constantes del año base y luego a % del PIB NOMINAL de ESE año base (ver pesosPib).
//
// IMPORTANTE: el cubo es "cerrado". Los marginales vienen pre-calculados del
// pipeline y NO son la suma de las filas finas (hay brechas conocidas de la
// fuente, p. ej. ejecución por departamento ~-25% contra el gran total). Por eso
// aquí solo se FILTRAN filas existentes; nunca se derivan agregados sumando un
// nivel más fino.
// ============================================================================

// Centinelas para los argumentos de consulta (equivalen a DES/CONST en R)
const DES = '@des';       // solo filas desagregadas en esa dimensión
const CONST = '@const';   // (heredado de R; el sitio ya no trae tipo_valor constante)

const Cubo = (() => {
  let meta = null;
  let indice = null;
  const shards = new Map();     // "gobierno||tipo_valor" → shard cargado
  const pendientes = new Map(); // promesas en vuelo, para no bajar dos veces lo mismo

  // arg de consulta → columna del cubo
  const ARG_COL = {
    indicador: 'indicador', tipo_dato: 'tipo_dato', vigencia: 'vigencia',
    fuente_general: 'fuente_general', fuente_fondo: 'fuente_fondo', sector: 'sector',
    departamento: 'departamento', linea1: 'linea1_pnd', linea2: 'linea2_pnd', linea3: 'linea3_pnd'
  };
  // El marginal de vigencia se llama 'Totales'; el de las demás, 'Total'
  const totalDe = (col) => (col === 'vigencia' ? 'Totales' : 'Total');

  const clave = (gob, tv) => gob + '||' + tv;

  async function init() {
    const [m, ix] = await Promise.all([
      Carga.global('data/meta.js', '__PPI_META'),
      Carga.global('data/cubo/index.js', '__PPI_INDICE')
    ]);
    meta = m; indice = ix;
    return meta;
  }

  // Descarga y mapea un shard. El bloque es: las columnas Uint8 (n bytes cada una,
  // en el orden de meta.columnas), el relleno que alinea a 8 bytes y luego n valores
  // Float64. Se leen como vistas sobre el mismo ArrayBuffer, sin copiar.
  function cargar(gobierno, tipoValor) {
    const k = clave(gobierno, tipoValor);
    if (shards.has(k)) return Promise.resolve(shards.get(k));
    if (pendientes.has(k)) return pendientes.get(k);

    const info = indice.shards.find(
      (s) => s.gobierno === gobierno && s.tipo_valor === tipoValor
    );
    // Combinación que no existe en el cubo (p. ej. un gobierno sin esa base de
    // precios): shard vacío, para que las hojas muestren su estado vacío en vez
    // de romperse.
    if (!info) {
      const vacio = { n: 0, cols: {}, valor: new Float64Array(0) };
      // meta.columnas es la lista FÍSICA (…_lo/…_hi incluidos): usar nombres lógicos aquí
      // también, para que coincida con lo que arma el shard real más abajo.
      meta.columnas.forEach((c) => {
        if (c.endsWith('_hi')) return;
        vacio.cols[c.endsWith('_lo') ? c.slice(0, -3) : c] = new Uint8Array(0);
      });
      shards.set(k, vacio);
      return Promise.resolve(vacio);
    }

    // El shard llega como base64 dentro de un .js (ver carga.js): se decodifica
    // una sola vez y las columnas quedan como vistas sobre el mismo buffer.
    const nombreClave = info.archivo.replace(/\.js$/, '');
    const p = Carga.script('data/cubo/' + info.archivo)
      .then(() => {
        const b64 = (window.__PPI_SHARD || {})[nombreClave];
        if (!b64) throw new Error('El shard ' + info.archivo + ' no trajo datos');
        const buf = Carga.base64ABuffer(b64);
        const n = info.filas;
        const fisicas = {};
        meta.columnas.forEach((c, i) => { fisicas[c] = new Uint8Array(buf, i * n, n); });
        const bytesCols = meta.columnas.length * n;
        const relleno = (8 - (bytesCols % 8)) % 8;      // Float64Array exige offset múltiplo de 8
        // Columnas que superan 255 niveles (hoy linea3_pnd/Estrategia) viajan partidas en
        // dos físicas de 1 byte (…_lo/…_hi, ver pipeline/exportar_web.R): se recomponen
        // aquí en una columna lógica de 16 bits, así el resto del motor (mascara/recorrer/
        // agregar) las trata igual que cualquier otra — no sabe que venían en dos bytes.
        const cols = {};
        for (const c of meta.columnas) {
          if (c.endsWith('_lo') || c.endsWith('_hi')) continue;
          cols[c] = fisicas[c];
        }
        for (const c of meta.columnas) {
          if (!c.endsWith('_lo')) continue;
          const base = c.slice(0, -3), lo = fisicas[c], hi = fisicas[base + '_hi'];
          const combinada = new Uint16Array(n);
          for (let i = 0; i < n; i++) combinada[i] = lo[i] | (hi[i] << 8);
          cols[base] = combinada;
        }
        const shard = { n, cols, valor: new Float64Array(buf, bytesCols + relleno, n) };
        shards.set(k, shard);
        pendientes.delete(k);
        // Libera la cadena base64: ya está decodificada en el buffer
        delete window.__PPI_SHARD[nombreClave];
        return shard;
      });
    pendientes.set(k, p);
    return p;
  }

  // Asegura en memoria todos los shards de una consulta (uno o varios gobiernos)
  function preparar(gobiernos, tipoValor) {
    return Promise.all([].concat(gobiernos).map((g) => cargar(g, tipoValor)));
  }

  // Máscara 0/1 sobre los índices de nivel de una columna. Traducir el filtro a
  // una máscara una sola vez evita comparar cadenas dentro del bucle de filas.
  function mascara(col, spec) {
    const niveles = meta.niveles[col];
    const m = new Uint8Array(niveles.length);
    if (spec === null || spec === undefined) { m.fill(1); return m; }
    if (spec === DES) {
      const tot = niveles.indexOf(totalDe(col));
      m.fill(1);
      if (tot >= 0) m[tot] = 0;
      return m;
    }
    for (const v of [].concat(spec)) {
      const i = niveles.indexOf(v);
      if (i >= 0) m[i] = 1;
    }
    return m;
  }

  // Defaults de R: la consulta sin argumentos devuelve la fila más agregada.
  function normalizar(q) {
    const r = {
      indicador: null, tipo_dato: null, vigencia: 'Totales',
      fuente_general: 'Total', fuente_fondo: 'Total', sector: 'Total', departamento: 'Total',
      // linea3 default 'Total' (no null): a diferencia de linea2 —seguro en null porque linea1
      // por defecto ya es 'Total' y ahí no hay filas de linea2 específico—, un caller que fije
      // linea2 a un Tema concreto sin tocar linea3 SÍ tiene ahora filas de Estrategia debajo; con
      // null sumaría el marginal del Tema Y sus Estrategias (doble conteo). Ver baseQ() en visor.js.
      linea1: 'Total', linea2: null, linea3: 'Total'
    };
    for (const k of Object.keys(r)) {
      if (Object.prototype.hasOwnProperty.call(q, k)) r[k] = q[k];
    }
    return r;
  }

  // Deflactación en el navegador. Con q.base (año) el corriente se pasa a constantes de ese
  // año: valor × índice[base] / índice[vigencia de la fila], con el índice de precios de
  // meta.deflactores (q.deflactor: 'IPC' o 'PIB'). Devuelve un peso por NIVEL de vigencia
  // (0 para lo que no es un año, como 'Totales').
  const cachePesos = new Map();
  function indiceDe(serie, anio) {
    const d = meta.deflactores;
    const k = d ? d.anios.indexOf(anio) : -1;
    const v = k >= 0 ? d[serie][k] : null;
    return v === null || v === undefined ? null : v;
  }
  function pesosVigencia(base, serie) {
    const k = serie + '|' + base;
    if (cachePesos.has(k)) return cachePesos.get(k);
    const pB = indiceDe(serie, Number(base));
    const w = Float64Array.from(meta.niveles.vigencia, (v) => {
      if (!/^\d{4}$/.test(v) || !pB) return 0;
      const pv = indiceDe(serie, Number(v));
      return pv ? pB / pv : 0;
    });
    cachePesos.set(k, w);
    return w;
  }
  // Rango de años con índice para una serie (para validar el año base que escribe el usuario)
  function rangoDeflactor(serie) {
    const d = meta.deflactores;
    const ok = d.anios.filter((a, i) => d[serie][i] !== null && d[serie][i] !== undefined);
    return [Math.min(...ok), Math.max(...ok)];
  }

  // % del PIB = inversión(t) ÷ PIB NOMINAL(t), SIEMPRE en pesos del mismo año t — sin año base, sin deflactar
  // (así lo reporta el DANE: FBKF/PIB en pesos corrientes de cada año). Al agregar VARIOS años (p. ej. «Totales»,
  // o 2+ años elegidos), no se puede dividir por el PIB de un solo año (una suma de 4 años ÷ el PIB de 1 año
  // puede superar el 100 % sin que signifique nada): se suma la inversión y el PIB de esos MISMOS años, ambos
  // llevados a precios de un año cualquiera (el resultado no depende de cuál, se cancela algebraicamente), y se
  // divide al final. Una sola fórmula cubre los dos casos — ver pesoPibPorAnio.
  //   peso(t) = (1/índice[t]) ÷ Σ_{t' ∈ años} PIB_nominal(t')/índice[t']
  // Con un solo año en la lista, índice[t] se cancela solo y queda corriente(t)÷PIB_nominal(t) sin deflactar.
  // El cubo va en miles de millones de pesos y meta.pib_nominal en MILLONES: valor × 1e9 / (PIB × 1e6) × 100 = valor × 1e5 / PIB,
  // por eso el 1e5 en pesoPibPorAnio.
  function pibDe(anio) {
    const p = meta.pib_nominal;
    const k = p ? p.anios.indexOf(Number(anio)) : -1;
    const v = k >= 0 ? p.millones[k] : null;
    return v ? v : null;
  }
  // Años con Planeado PPI (sin filtrar nada más) de un gobierno: ancla el período completo cuando una
  // consulta de % del PIB no fija vigencia — SIEMPRE el mismo indicador (total_inversion/programación),
  // para que Compromisos/Obligaciones/etc. del mismo gobierno compartan denominador con Planeado PPI.
  const cacheAnios = new Map();
  function aniosActivos(gobierno) {
    if (cacheAnios.has(gobierno)) return cacheAnios.get(gobierno);
    const v = agregar({
      gobierno, tipo_dato: 'programación', indicador: 'total_inversion', tipo_valor: 'corriente', vigencia: DES
    }, 'vigencia').filter((d) => d.valor > 0).map((d) => String(d.cat));
    cacheAnios.set(gobierno, v);
    return v;
  }
  // Devuelve una función año(string) → peso, para el conjunto de años `aniosSel` (o el período completo del
  // gobierno si no se fija ninguno). Primitivo reutilizable por cualquier shard con su propia indexación de
  // niveles de vigencia (lo usa también programas.js, que no comparte niveles con el cubo principal).
  function pesoPibPorAnio(gobierno, aniosSel) {
    const lista = (aniosSel && aniosSel.length) ? aniosSel.map(String) : aniosActivos(gobierno);
    let denom = 0;
    for (const t of lista) {
      const idx = indiceDe('PIB', Number(t)), p = pibDe(t);
      if (idx && p) denom += p / idx;
    }
    return (anioStr) => { const idx = denom && indiceDe('PIB', Number(anioStr)); return idx ? (1e5 / idx) / denom : 0; };
  }
  const cachePesosPib = new Map();
  function pesosPib(gobierno, aniosSel) {
    const k = gobierno + '|' + ((aniosSel && aniosSel.length) ? aniosSel.slice().sort().join(',') : '*');
    if (!cachePesosPib.has(k)) {
      const peso = pesoPibPorAnio(gobierno, aniosSel);
      cachePesosPib.set(k, Float64Array.from(meta.niveles.vigencia, (v) => (/^\d{4}$/.test(v) ? peso(v) : 0)));
    }
    return cachePesosPib.get(k);
  }

  // Núcleo: recorre las filas de los shards pedidos aplicando las máscaras.
  // `visita(shard, fila, gobierno, peso)` se llama por cada fila que pasa el filtro; `peso` es 1, el factor de
  // deflactación de la vigencia de la fila si la consulta trae q.base (constantes), o el peso de % del PIB de esa
  // fila si trae q.pib (pesosPib: depende del GOBIERNO y de qué años entran en la agregación, no de un año base).
  // Con q.base o q.pib la consulta se hace AÑO POR AÑO (el 'Totales' es una suma ya hecha, en corrientes,
  // y no se puede deflactar con un solo factor); la suma de los años = 'Totales' en corrientes.
  function recorrer(q, visita, opc) {
    const f = normalizar(q);
    const tv = q.tipo_valor || 'corriente';
    const pib = !!q.pib;
    const base = pib ? null : q.base;                      // % del PIB ya no usa año base
    const pesosC = base ? pesosVigencia(base, q.deflactor || 'PIB') : null;
    const vigTodas = f.vigencia === 'Totales' || f.vigencia === null;          // ¿sin acotar la vigencia? (solo entonces entran los montos fijos)
    // Años EXPLÍCITOS que trae la consulta (antes de que el DES los pise), solo para % del PIB: determinan qué
    // años entran a la suma del denominador cuando el usuario fija uno o varios años concretos.
    const vigenciaSel = (pib && !vigTodas) ? [].concat(f.vigencia).map(String).filter((v) => /^\d{4}$/.test(v)) : null;
    if ((pesosC || pib) && vigTodas) f.vigencia = DES;
    const masks = Object.keys(ARG_COL).map((arg) => [ARG_COL[arg], mascara(ARG_COL[arg], f[arg])]);
    // MONTOS FIJOS (meta.montos_fijos): un monto cerrado en constantes de un año (Privados del PPI 2023-2026: 949,7 billones de 2022), sin vigencia, sector ni
    // departamento. Vive en la fila «Totales» y en corrientes se muestra tal cual; en constantes / % del PIB se trata como un valor de ESE año de precios
    // (peso del nivel de vigencia de su año), así se puede comparar con otros gobiernos. No tiene año: no entra al agrupar por vigencia.
    const fijosDe = (gob) => (meta.montos_fijos || []).filter((m) => m.ppi_gobierno === gob);
    const fijosActivos = (pesosC || pib) && vigTodas && !(opc && opc.anual) && tv === 'corriente';
    const masksFijo = fijosActivos ? Object.keys(ARG_COL).map((arg) => [ARG_COL[arg], mascara(ARG_COL[arg], arg === 'vigencia' ? 'Totales' : f[arg])]) : null;

    for (const gob of [].concat(q.gobierno)) {
      const shard = shards.get(clave(gob, tv));
      if (!shard || !shard.n) continue;
      const cols = masks.map(([c, m]) => [shard.cols[c], m]);
      const vig = shard.cols.vigencia;
      const pesos = pib ? pesosPib(gob, vigenciaSel) : pesosC;
      for (let i = 0; i < shard.n; i++) {
        let ok = true;
        for (let j = 0; j < cols.length; j++) {
          if (!cols[j][1][cols[j][0][i]]) { ok = false; break; }
        }
        if (!ok) continue;
        const w = pesos ? pesos[vig[i]] : 1;
        if (w) visita(shard, i, gob, w);
      }
      // montos fijos de este gobierno (solo en constantes / % del PIB)
      const fijos = fijosActivos ? fijosDe(gob) : [];
      if (fijos.length) {
        const nivV = meta.niveles.vigencia, nivFG = meta.niveles.fuente_general, nivFF = meta.niveles.fuente_fondo;
        const jTot = nivV.indexOf('Totales');
        for (const m of fijos) {
          const j = nivV.indexOf(String(m.anio_precios)), wF = j >= 0 ? pesos[j] : 0;
          const iFG = nivFG.indexOf(m.fuente), iFF = nivFF.indexOf(m.fuente);
          if (!wF) continue;
          const colsF = masksFijo.map(([c, mk]) => [shard.cols[c], mk]);
          for (let i = 0; i < shard.n; i++) {
            if (vig[i] !== jTot || (shard.cols.fuente_general[i] !== iFG && shard.cols.fuente_fondo[i] !== iFF)) continue;
            let ok = true;
            for (let k = 0; k < colsF.length; k++) { if (!colsF[k][1][colsF[k][0][i]]) { ok = false; break; } }
            if (ok) visita(shard, i, gob, wF);
          }
        }
      }
    }
  }

  // Suma de la selección (equivale a sum(cubo(...)$valor))
  function total(q) {
    let s = 0;
    recorrer(q, (shard, i, gob, w) => { s += shard.valor[i] * w; });
    return s;
  }

  // Agrupa por una o varias dimensiones y suma. Devuelve [{cat, valor}] con una
  // sola dimensión, o [{cats:[...], valor}] con varias.
  //   dims: nombre de argumento ('sector', 'departamento', …) o arreglo de ellos
  function agregar(q, dims) {
    const lista = [].concat(dims);
    const cols = lista.map((d) => ARG_COL[d] || d);
    const acum = new Map();
    recorrer(q, (shard, i, gob, w) => {
      // Clave compuesta CON separador: sin el, los indices de dos digitos
      // colisionarian (1+12 y 11+2 darian la misma clave).
      let k = String(shard.cols[cols[0]][i]);
      for (let j = 1; j < cols.length; j++) k += ':' + shard.cols[cols[j]][i];
      acum.set(k, (acum.get(k) || 0) + shard.valor[i] * w);
    }, { anual: lista.includes('vigencia') });
    const salida = [];
    for (const [k, valor] of acum) {
      const cats = k.split(':').map((v, j) => meta.niveles[cols[j]][Number(v)]);
      salida.push(lista.length === 1
        ? { cat: cats[0], valor }
        : { cats, valor });
    }
    return salida;
  }

  // 'Gobierno' es la única dimensión que no vive dentro del shard (es su clave),
  // así que agrupar por gobierno se resuelve consultando shard por shard.
  function agregarPorGobierno(q) {
    return [].concat(q.gobierno).map((g) => ({
      cat: g, valor: total(Object.assign({}, q, { gobierno: g }))
    }));
  }

  return {
    init, cargar, preparar, total, agregar, agregarPorGobierno, rangoDeflactor, pibDe, indiceDe, pesosPib, pesoPibPorAnio,
    pibDisponible() { return !!(meta && meta.pib_nominal && meta.pib_nominal.anios.length); },
    get meta() { return meta; },
    niveles(col) { return meta.niveles[col] || []; },
    // Unidades de medida realmente disponibles para un gobierno × indicador
    unidadesDe(gobierno, indicador) {
      return (meta.unidades[gobierno + '||' + indicador] || []).slice();
    },
    // Ficha de un gobierno en el catálogo (nombre del PND, ley, periodo)
    infoGobierno(gob) {
      const f = (meta.cat_gobiernos || []).find((x) => x.ppi_gobierno === gob);
      return f || { ppi_gobierno: gob, nombre_pnd: gob, ley: '', periodo_pnd: '' };
    },
    // Etiqueta de una línea del PND: "2.A. Nombre" (el catálogo trae el código
    // de nivel 2 con punto final, se recorta para no duplicarlo).
    etiqLinea(gob, codigo) {
      const f = (meta.cat_lineas || []).find(
        (x) => x.ppi_gobierno === gob && x.codigo === codigo
      );
      if (!f) return codigo;
      return codigo.replace(/[. ]+$/, '') + '. ' + f.nombre;
    }
  };
})();
