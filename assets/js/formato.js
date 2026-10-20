// ============================================================================
// formato.js — Formatos numéricos (convención es-CO: miles con punto, decimal
// con coma). Equivale a R/utils_format.R del tablero Shiny.
// Los montos del tablero están en miles de millones de pesos (la hoja
// Iniciativas es la excepción: allí van en millones, y lo advierte en pantalla).
// ============================================================================

const Formato = (() => {
  // Intl con locale fijo 'es-CO': no depende de la configuración del navegador,
  // así el tablero se ve igual en cualquier equipo.
  const cache = new Map();
  function crearFormato(opts) {
    // roundingMode 'halfEven' para empatar con R: formatC() redondea los
    // empates exactos al par (57/80 = 71,25 % sale "71,2 %"), mientras que
    // el default de Intl los expande ("71,3 %"). Sin esto el tablero web
    // mostraría un decimal distinto al Shiny en los empates.
    try { return new Intl.NumberFormat('es-CO', Object.assign({ roundingMode: 'halfEven' }, opts)); }
    catch (e) {
      try { return new Intl.NumberFormat('es-CO', opts); }        // navegador sin roundingMode
      catch (e2) { delete opts.signDisplay; return new Intl.NumberFormat('es-CO', opts); }  // ni signDisplay
    }
  }
  function nf(dec) {
    if (!cache.has(dec)) cache.set(dec, crearFormato({ minimumFractionDigits: dec, maximumFractionDigits: dec }));
    return cache.get(dec);
  }
  // Con signo explícito ("+25,0 %" / "−12,0 %"): para un índice de crecimiento, donde el signo
  // ES el dato (a diferencia de un % de participación, siempre positivo).
  function nfSigno(dec) {
    const k = 's' + dec;
    if (!cache.has(k)) cache.set(k, crearFormato({ minimumFractionDigits: dec, maximumFractionDigits: dec, signDisplay: 'exceptZero' }));
    return cache.get(k);
  }

  const finito = (x) => x !== null && x !== undefined && Number.isFinite(x);
  // Decimales de un valor expresado en % del PIB (0,45 % · 12,3 %): más decimales cuanto más pequeño
  const decPib = (x) => (Math.abs(x) >= 10 ? 1 : Math.abs(x) >= 1 ? 2 : 3);
  let modo = 'cop';      // (en el cierre, no en `this`: cop se pasa como callback, p. ej. etiquetasQuintiles(v, Formato.cop))

  return {
    // Modo de los valores medidos: 'cop' (miles de millones de pesos / pesos por habitante) o 'pib'
    // (% del PIB nominal). Lo fija cada hoja que usa Medida; app.js lo devuelve a 'cop' al cambiar de hoja.
    get modo() { return modo; },
    set modo(m) { modo = m; },
    // "$ 1.314.069" — o "0,452 %" cuando la medida es % del PIB. Con signo = true ("+$ 45.000" /
    // "−$ 12.000"): para una diferencia entre dos gobiernos, donde el signo ES el dato.
    cop(x, dec = 0, signo = false) {
      if (modo === 'pib') return finito(x) ? (signo ? nfSigno(decPib(x)) : nf(decPib(x))).format(x) + ' %' : '—';
      return finito(x) ? '$ ' + (signo ? nfSigno(dec) : nf(dec)).format(x) : '—';
    },
    // "1.314.069"; en % del PIB deja decimales (ejes y etiquetas)
    num(x, dec = 0) {
      if (modo === 'pib' && dec === 0) return finito(x) ? nf(Math.abs(x) >= 10 ? 0 : Math.abs(x) >= 1 ? 1 : 2).format(x) : '—';
      return finito(x) ? nf(dec).format(x) : '—';
    },
    // 0.286 → "28,6 %"; con signo = true (crecimiento): 0.286 → "+28,6 %", -0.1 → "−10,0 %"
    pct(x, dec = 1, signo = false) {
      return finito(x) ? (signo ? nfSigno(dec) : nf(dec)).format(100 * x) + ' %' : '—';
    },
    // PUNTOS PORCENTUALES — distinto de pct(): para la diferencia entre dos participaciones ya en %
    // (p. ej. 18 % en un gobierno y 15 % en otro → "+3,0 p.p.", NO "+3,0 %", que se leería como una
    // variación relativa). Mismo signo explícito por defecto: el signo ES el dato.
    pp(x, dec = 1, signo = true) {
      return finito(x) ? (signo ? nfSigno(dec) : nf(dec)).format(100 * x) + ' p.p.' : '—';
    },
    // Etiqueta de unidad de medida: "corriente" → "Corrientes",
    // "constante_2015" → "Constantes 2015" (igual que etiq_tipo_valor en R).
    unidad(tv) {
      return tv === 'corriente' ? 'Corrientes' : 'Constantes ' + tv.replace('constante_', '');
    },
    // Título legible de un indicador del cubo ("total_inversion" → "Total Inversion")
    indicador(x) {
      return x.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    },
    // Escapa texto para interpolarlo en HTML sin abrir un hueco de inyección:
    // los nombres de sectores/entidades vienen de Excel y pueden traer < > &.
    esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    }
  };
})();
