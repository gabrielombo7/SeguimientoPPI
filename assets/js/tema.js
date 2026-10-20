// ============================================================================
// tema.js — Paleta institucional DNP. Espejo de R/theme_dnp.R.
// Fuente única de color del tablero web: ningún módulo define colores sueltos.
// ============================================================================

const DNP = {
  primario:      '#2D2E5A',   // navy — color de marca
  primarioOsc:   '#1C1D3D',
  primarioClaro: '#E9E9F2',
  dorado:        '#F0A830',
  doradoClaro:   '#F8D9A5',
  acento:        '#69717E',
  tinta:         '#2D2E5A',
  gris:          '#767B85',
  fondo:         '#F7F3F0',
  borde:         '#E4E2E8'
};

// Orden pedido: azul, amarillo, rojo, "el otro amarillo" (ocre) y gris — sin
// morado. Con más categorías se repiten en ese orden.
const PAL_GRAFICAS = ['#2D2E5A', '#F0A830', '#D80025', '#8B5804', '#69717E'];

// Colores por fuente de financiación. Cooperación usa un azul CLARO: el amarillo/ocre
// se confundía con SGP y SGR, y el azul de marca con PGN.
const AZUL_CLARO = '#7CC4F0';
// Privados: un vino oscuro, distinto del rojo vivo de Territorio (PAL_GRAFICAS[2]) y del ámbar de SGP.
const ROJO_PRIVADOS = '#7A1F2B';
const PAL_FUENTES = {
  'PGN': PAL_GRAFICAS[0],
  'SGP': PAL_GRAFICAS[1],
  'Territorio': PAL_GRAFICAS[2],
  'SGR': PAL_GRAFICAS[3],
  'Descentralizado': PAL_GRAFICAS[4],
  'Empresas Públicas': PAL_GRAFICAS[4],
  'Cooperación': AZUL_CLARO,
  'Privado': ROJO_PRIVADOS,
  'Privados': ROJO_PRIVADOS
};

// Color de cada indicador en las comparaciones
const PAL_IND = {
  'Planeado PPI': PAL_GRAFICAS[0],
  'Monto inflexible': PAL_GRAFICAS[4],
  'Compromisos':  PAL_GRAFICAS[1],
  'Obligaciones': PAL_GRAFICAS[2],
  'Pagos':        PAL_GRAFICAS[3]
};

// Paleta rotativa para categorías arbitrarias (gobiernos, sectores…)
function palRotativa(categorias) {
  const m = {};
  categorias.forEach((c, i) => { m[c] = PAL_GRAFICAS[i % PAL_GRAFICAS.length]; });
  return m;
}

// --- Escalas del mapa --------------------------------------------------------
const GRIS_MAPA     = '#EFEFF3';   // departamento sin dato
const GRIS_INACTIVO = '#DCDCE4';   // departamento fuera de la selección activa

// Rangos de ejecución (avance 0 → 100 %). Escala semántica rojo→verde, no ligada
// a la marca; se conserva igual entre plantillas.
const BINS_EJEC = [0, 0.3, 0.5, 0.7, 1, Infinity];
const PAL_EJEC  = ['#C4383A', '#E8823A', '#F2C230', '#8FCB6B', '#2E9E8F'];
const ETIQ_EJEC = ['0 % – 30 %', '30 % – 50 %', '50 % – 70 %', '70 % – 100 %', '> 100 %'];

// Comparación entre DOS gobiernos: ÍNDICE DE CRECIMIENTO — (más_reciente − más_viejo) / más_viejo —
// no una razón (leer "125 %" obliga a restarle 100 % de cabeza). 4 franjas, 2 tonos por lado de 0 %:
// dorado = creció (más oscuro = creció más), navy = decreció (más oscuro = decreció más).
const BINS_CREC = [-Infinity, -0.25, 0, 0.25, Infinity];
const PAL_CREC  = ['#1C1D3D', '#4D4E75', '#F8D9A5', '#F0A830'];
const ETIQ_CREC = ['< –25 %', '–25 % – 0 %', '0 % – 25 %', '> 25 %'];

// Interpola un color dentro de una rampa (equivale a colorNumeric de leaflet).
function interpolar(rampa, t) {
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  t = Math.max(0, Math.min(1, t));
  const pos = t * (rampa.length - 1);
  const i = Math.min(Math.floor(pos), rampa.length - 2);
  const f = pos - i;
  const a = hex(rampa[i]), b = hex(rampa[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

const RAMPA_VALOR = [DNP.primarioClaro, '#A9AAC7', DNP.primario, DNP.primarioOsc];

// Escala de un vector de MONTOS: por QUINTILES (5 franjas con la MISMA CANTIDAD de departamentos
// cada una), no una escala continua ni de rango parejo. Los montos del PPI tienen cola larga (Bogotá/
// Antioquia valen muchísimo más que el resto): con una escala continua o de rangos iguales casi todo
// el mapa queda en el tono más claro y un par de departamentos acaparan el resto de la rampa. El
// quintil es el estándar cartográfico para esto (igual "cantidad de casos" en cada color).
const N_VALOR = 5;
const PAL_VALOR = Array.from({ length: N_VALOR }, (_, i) => interpolar(RAMPA_VALOR, i / (N_VALOR - 1)));

// Cortes (N_VALOR - 1) + mínimo/máximo reales, sobre los valores FINITOS. null si no hay ninguno.
function cortesQuintiles(valores, n = N_VALOR) {
  const ok = valores.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!ok.length) return null;
  const cortes = [];
  for (let i = 1; i < n; i++) {
    const pos = (i / n) * (ok.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos), frac = pos - lo;
    cortes.push(ok[lo] + (ok[hi] - ok[lo]) * frac);
  }
  return { min: ok[0], max: ok[ok.length - 1], cortes };
}

// Color de un vector de montos, por quintil. Sin dato → gris.
function coloresValor(valores) {
  const q = cortesQuintiles(valores);
  if (!q) return valores.map(() => GRIS_MAPA);
  const bins = [-Infinity, ...q.cortes, Infinity];
  return valores.map((v) => {
    if (!Number.isFinite(v)) return GRIS_MAPA;
    for (let i = 0; i < PAL_VALOR.length; i++) if (v >= bins[i] && v < bins[i + 1]) return PAL_VALOR[i];
    return PAL_VALOR[PAL_VALOR.length - 1];
  });
}

// Etiquetas de leyenda para esos MISMOS quintiles (mismos cortes que coloresValor de arriba, para
// que la leyenda y el color del mapa siempre coincidan): "$ min1 – $ max1", "$ min2 – $ max2", …
function etiquetasQuintiles(valores, formatear, n = N_VALOR) {
  const q = cortesQuintiles(valores, n);
  if (!q) return [];
  const bordes = [q.min, ...q.cortes, q.max];
  return bordes.slice(0, -1).map((b, i) => `${formatear(b)} – ${formatear(bordes[i + 1])}`);
}

// Validación entre gobiernos: color por MAGNITUD del cambio (no por signo) — verde si el cambio es
// chico, rojo si es grande. A diferencia de BINS_CREC (que distingue creció/decreció con 2 colores de
// cada lado de 0 %), aquí el signo no pinta: lo dice el propio número, el color solo avisa "qué tan
// grande fue el salto". Arranca en 0 como BINS_EJEC — por eso coloresPct('cambio') SIEMPRE espera el
// valor absoluto (ver colorCambio): si se le pasa un negativo sin convertir, cae todo al último color.
const BINS_CAMBIO = [0, 0.25, 0.5, Infinity];
const PAL_CAMBIO  = ['#3FA172', '#F2C230', '#C4383A'];
const ETIQ_CAMBIO = ['< 25 %', '25 % – 50 %', '> 50 %'];

// Color por rangos (avance, razón entre gobiernos, o magnitud de cambio)
function coloresPct(pcts, escala = 'avance') {
  const bins   = escala === 'razon' ? BINS_CREC : escala === 'cambio' ? BINS_CAMBIO : BINS_EJEC;
  const paleta = escala === 'razon' ? PAL_CREC  : escala === 'cambio' ? PAL_CAMBIO  : PAL_EJEC;
  return pcts.map((p) => {
    if (!Number.isFinite(p)) return GRIS_MAPA;
    for (let i = 0; i < paleta.length; i++) {
      if (p >= bins[i] && p < bins[i + 1]) return paleta[i];
    }
    return paleta[paleta.length - 1];
  });
}

// Azúcar sobre coloresPct(·, 'cambio'): aplica el valor absoluto ANTES de buscar el color, así quien
// llama nunca se puede olvidar de hacerlo (un negativo sin convertir caería todo al rojo, por error).
function colorCambio(pcts) {
  return coloresPct(pcts.map((p) => (Number.isFinite(p) ? Math.abs(p) : p)), 'cambio');
}

// Color de texto legible sobre un fondo dado (luminancia relativa WCAG).
// Se usa en las etiquetas de porcentaje dentro de la dona.
function textoContraste(fondo) {
  const c = [1, 3, 5].map((i) => parseInt(fondo.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return L > 0.55 ? DNP.tinta : '#FFFFFF';
}
