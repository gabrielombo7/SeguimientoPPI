// ============================================================================
// programas.js — Desglose por PROGRAMA del sector elegido (caja «Programas» del Visor).
//
// El cubo no tiene dimensión de programa, así que va aparte: un shard por gobierno con la programación
// (Planeado PPI, pesos corrientes en miles de millones) al grano
//   vigencia × fuente general × sector × departamento × programa.
// A diferencia del cubo NO es «cerrado»: son filas finas de una sola medida aditiva, así que aquí SÍ se
// suman en el navegador, con los mismos filtros que el resto del visor (sector, fuente, departamento,
// vigencia) y la misma unidad (corrientes, constantes del deflactor del PIB, % del PIB).
//
// Layout del bloque binario (pipeline/exportar_web.R, sección 2b): 6 columnas Uint8 de n bytes
// (vigencia, fuente_general, sector, departamento, programa_lo, programa_hi), el relleno que alinea a 8
// bytes y n valores Float64. El programa viaja en DOS bytes (índice = lo + 256·hi: hasta 65.535 programas).
// Solo existe para «Planeado PPI»; per cápita no aplica (no hay población por programa).
// ============================================================================

const Programas = (() => {
  let indice = null;
  const shards = new Map();
  const COLS = ['vigencia', 'fuente_general', 'sector', 'departamento', 'programa_lo', 'programa_hi'];

  async function init() {
    if (!indice) indice = await Carga.global('data/programas/index.js', '__PPI_PROG_INDICE');
    return indice;
  }
  const hay = (gobierno) => !!indice && indice.shards.some((s) => s.gobierno === gobierno);

  async function cargar(gobierno) {
    await init();
    if (shards.has(gobierno)) return shards.get(gobierno);
    const info = indice.shards.find((s) => s.gobierno === gobierno);
    if (!info) { const v = { n: 0 }; shards.set(gobierno, v); return v; }
    await Carga.script('data/programas/' + info.archivo);
    const nombre = info.archivo.replace(/\.js$/, '');
    const b64 = (window.__PPI_PROG || {})[nombre];
    if (!b64) throw new Error('El shard de programas ' + info.archivo + ' no trajo datos');
    const buf = Carga.base64ABuffer(b64), n = info.filas, cols = {};
    COLS.forEach((c, i) => { cols[c] = new Uint8Array(buf, i * n, n); });
    const bytes = COLS.length * n, relleno = (8 - (bytes % 8)) % 8;
    const shard = { n, cols, valor: new Float64Array(buf, bytes + relleno, n) };
    delete window.__PPI_PROG[nombre];
    shards.set(gobierno, shard);
    return shard;
  }

  const mascara = (niveles, spec) => {          // spec: null/undefined = todos · lista de nombres
    const m = new Uint8Array(niveles.length);
    if (spec === null || spec === undefined) { m.fill(1); return m; }
    for (const v of [].concat(spec)) { const i = niveles.indexOf(v); if (i >= 0) m[i] = 1; }
    return m;
  };

  // Suma por programa. f = { sector: [..] (obligatorio), fuente: [..]|null, departamento: [..]|null, vigencia: [..]|null }
  // medida = Medida (para constantes y % del PIB). Devuelve [{cat, valor}] sin ceros.
  function agregar(gobierno, f, medida) {
    const sh = shards.get(gobierno);
    if (!sh || !sh.n) return [];
    const N = indice.niveles;
    const mV = mascara(N.vigencia, f.vigencia), mF = mascara(N.fuente_general, f.fuente),
          mS = mascara(N.sector, f.sector), mD = mascara(N.departamento, f.departamento);
    const c = sh.cols, esAnio = (v) => /^\d{4}$/.test(v);
    // Peso por nivel de vigencia (mismo peso que Cubo.recorrer, reconstruido aquí porque este shard no
    // comparte niveles con el cubo principal): 1 · deflactación al año base · % del PIB vía
    // Cubo.pesoPibPorAnio (una sola fórmula compartida con cubo.js — ver su comentario para el porqué).
    let w;
    if (medida.pib) {
      const peso = Cubo.pesoPibPorAnio(gobierno, f.vigencia && f.vigencia.filter(esAnio));
      w = Float64Array.from(N.vigencia, (v) => (esAnio(v) ? peso(v) : 0));
    } else if (medida.constantes) {
      const pB = Cubo.indiceDe(medida.serie, medida.base);
      w = Float64Array.from(N.vigencia, (v) => { const pv = esAnio(v) ? Cubo.indiceDe(medida.serie, Number(v)) : null; return pB && pv ? pB / pv : 0; });
    } else w = Float64Array.from(N.vigencia, (v) => (esAnio(v) ? 1 : 0));
    const acum = new Map();
    for (let i = 0; i < sh.n; i++) {
      if (!mV[c.vigencia[i]] || !mF[c.fuente_general[i]] || !mS[c.sector[i]] || !mD[c.departamento[i]]) continue;
      const peso = w[c.vigencia[i]]; if (!peso) continue;
      const p = c.programa_lo[i] | (c.programa_hi[i] << 8);
      acum.set(p, (acum.get(p) || 0) + sh.valor[i] * peso);
    }
    return [...acum].filter(([, v]) => v !== 0).map(([p, valor]) => ({ cat: N.programa[p], valor }));
  }

  return { init, cargar, agregar, hay };
})();
