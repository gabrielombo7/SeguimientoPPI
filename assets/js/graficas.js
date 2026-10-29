// ============================================================================
// graficas.js — Gráficas en SVG. Equivale a R/utils_plot.R (que usaba plotly).
//
// Se dibujan a mano en SVG en vez de traer una librería: los tipos que usa el
// tablero son pocos (dona, barras horizontales/verticales, agrupadas y
// superpuestas) y así el sitio no depende de ningún CDN ni archivo externo.
//
// Todas aceptan `onClick` y `seleccion` para el cross-filtering: al haber
// selección activa, lo no seleccionado se atenúa en vez de desaparecer.
// ============================================================================

const Graficas = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  function s(tag, props, ...hijos) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of hijos.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const ATENUADO = '#D8D8E2';
  // Color efectivo de una categoría según la selección activa
  function colorDe(cat, color, seleccion) {
    if (!seleccion || !seleccion.length) return color;
    return seleccion.includes(cat) ? color : ATENUADO;
  }

  // Recorta una etiqueta larga para que quepa en el eje
  function recortar(txt, max) {
    return txt.length > max ? txt.slice(0, max - 1) + '…' : txt;
  }

  function conTooltip(el, htmlFn) {
    el.addEventListener('mousemove', (ev) => UI.tooltip.mostrar(htmlFn(), ev));
    el.addEventListener('mouseleave', () => UI.tooltip.ocultar());
    return el;
  }

  // Ticks "redondos" para el eje de valores
  function ticks(max, n = 4) {
    if (!(max > 0)) return [0];
    const paso0 = max / n;
    const mag = Math.pow(10, Math.floor(Math.log10(paso0)));
    const paso = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= paso0) || mag * 10;
    const out = [];
    for (let v = 0; v <= max * 1.0001; v += paso) out.push(v);
    return out;
  }

  // --- Dona (fuentes de financiación) ----------------------------------------
  //   datos: [{cat, valor}]
  function dona(datos, opciones = {}) {
    const { onClick, seleccion, colores = {}, ancho = 420, alto = 260 } = opciones;
    const total = datos.reduce((a, d) => a + d.valor, 0);
    const svg = s('svg', { class: 'grafica', viewBox: `0 0 ${ancho} ${alto}`, role: 'img' });
    if (!(total > 0)) return svg;

    const r = Math.min(alto * 0.42, ancho * 0.22);
    const cx = ancho * 0.28, cy = alto / 2;
    const rInt = r * 0.58;
    let ang = -Math.PI / 2;

    datos.forEach((d) => {
      const frac = d.valor / total;
      const avance = frac * Math.PI * 2;
      const fin = ang + avance;
      // Una sola categoría (o una que, por los filtros, queda con el 100 %): el ángulo de inicio y
      // de fin coinciden exactamente y el arco SVG no puede dibujar un círculo completo así (sale
      // vacío, sin rebanada). Se recorta un pelo —imperceptible— el ángulo con el que se DIBUJA,
      // sin tocar `fin` (que sigue avanzando el ángulo real para la próxima categoría).
      const finDib = frac >= 0.9999 ? ang + avance * 0.9999 : fin;
      const color = colorDe(d.cat, colores[d.cat] || DNP.primario, seleccion);
      const p = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
      const [x1, y1] = p(r, ang), [x2, y2] = p(r, finDib);
      const [x3, y3] = p(rInt, finDib), [x4, y4] = p(rInt, ang);
      const grande = frac > 0.5 ? 1 : 0;
      const path = s('path', {
        class: 'rebanada', fill: color,
        d: `M${x1} ${y1}A${r} ${r} 0 ${grande} 1 ${x2} ${y2}L${x3} ${y3}A${rInt} ${rInt} 0 ${grande} 0 ${x4} ${y4}Z`,
        onclick: onClick ? () => onClick(d.cat) : null
      });
      conTooltip(path, () => `<b>${Formato.esc(d.cat)}</b><br>${Formato.cop(d.valor)}<br>${Formato.pct(frac)}`);
      svg.append(path);

      // Porcentaje dentro de la rebanada, solo si hay espacio
      if (frac > 0.05) {
        const [tx, ty] = p((r + rInt) / 2, (ang + finDib) / 2);
        svg.append(s('text', {
          x: tx, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          'font-size': 11, 'font-weight': 600, fill: textoContraste(color),
          'pointer-events': 'none'
        }, Formato.pct(frac)));
      }
      ang = fin;
    });

    // Leyenda a la derecha
    const x0 = ancho * 0.55;
    const paso = Math.min(20, (alto - 20) / Math.max(1, datos.length));
    const y0 = cy - (datos.length * paso) / 2 + paso / 2;
    datos.forEach((d, i) => {
      const g = s('g', { onclick: onClick ? () => onClick(d.cat) : null, style: 'cursor:pointer' });
      g.append(s('rect', { x: x0, y: y0 + i * paso - 5, width: 10, height: 10, rx: 2, fill: colorDe(d.cat, colores[d.cat] || DNP.primario, seleccion) }));
      g.append(s('text', { x: x0 + 16, y: y0 + i * paso, 'dominant-baseline': 'middle', 'font-size': 11, fill: DNP.gris }, recortar(d.cat, 22)));
      svg.append(g);
    });
    return svg;
  }

  // --- Barras horizontales ----------------------------------------------------
  function barrasH(datos, opciones = {}) {
    const { onClick, seleccion, colores, ancho = 560, altoFila = 24, margenIzq = 150 } = opciones;
    const alto = Math.max(120, datos.length * altoFila + 34);
    const max = Math.max(0, ...datos.map((d) => d.valor));
    const x0 = margenIzq, x1 = ancho - 58;
    const esc = (v) => (max > 0 ? (v / max) * (x1 - x0) : 0);
    const svg = s('svg', { class: 'grafica', viewBox: `0 0 ${ancho} ${alto}` });

    ticks(max).forEach((t) => {
      svg.append(s('line', { class: 'eje', x1: x0 + esc(t), x2: x0 + esc(t), y1: 6, y2: alto - 22 }));
      svg.append(s('text', { class: 'tick', x: x0 + esc(t), y: alto - 8, 'text-anchor': 'middle' }, Formato.num(t)));
    });

    datos.forEach((d, i) => {
      const y = 8 + i * altoFila;
      const alt = altoFila - 7;
      const color = colorDe(d.cat, (colores && colores[d.cat]) || DNP.primario, seleccion);
      // "Otros" es un agregado sintético del gráfico: no filtra nada
      const clicable = onClick && d.cat !== 'Otros';
      const rect = s('rect', {
        class: 'barra', x: x0, y, width: Math.max(1, esc(d.valor)), height: alt, rx: 2, fill: color,
        onclick: clicable ? () => onClick(d.cat) : null,
        style: clicable ? null : 'cursor:default'
      });
      conTooltip(rect, () => `<b>${Formato.esc(d.cat)}</b><br>${Formato.cop(d.valor)}`);
      svg.append(rect);
      svg.append(s('text', {
        class: 'tick tick-cat', x: x0 - 6, y: y + alt / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle',
        onclick: clicable ? () => onClick(d.cat) : null
      }, recortar(d.cat, Math.floor(margenIzq / 6))));
      svg.append(s('text', { class: 'valor-barra', x: x0 + esc(d.valor) + 5, y: y + alt / 2, 'dominant-baseline': 'middle' }, Formato.num(d.valor)));
    });
    return svg;
  }

  // --- Barras en lista: la etiqueta va ENCIMA de cada barra ---------------------
  // Para categorías de nombre largo (fuentes específicas: "Asignación para la inversión
  // local según NBI y cuarta, quinta y sexta categoría") que en barrasH se recortan hasta
  // volverse idénticas. La etiqueta se parte en hasta 2 líneas. Mismo contrato que las demás:
  // onClick / seleccion; "Otros" no filtra. Con `serie` en los datos ([{cat, serie, valor}])
  // dibuja una barra por serie bajo cada etiqueta (comparar gobiernos); el llamador pone la leyenda.
  function barrasLista(datos, opciones = {}) {
    const { onClick, seleccion, colores, pal = {}, ancho = 440, maxLinea = 56 } = opciones;
    const conSerie = datos.some((d) => d.serie !== undefined);
    const cats = [...new Set(datos.map((d) => d.cat))];
    const series = conSerie ? [...new Set(datos.map((d) => d.serie))] : [null];
    const valor = (c, se) => (datos.find((d) => d.cat === c && (!conSerie || d.serie === se)) || {}).valor || 0;
    const max = Math.max(0, ...datos.map((d) => d.valor));

    // Etiqueta en ≤ 2 líneas de `maxLinea` caracteres (la segunda se recorta con "…")
    const partir = (txt) => {
      const pal_ = String(txt).split(' ');
      const lineas = [''];
      for (const w of pal_) {
        const l = lineas[lineas.length - 1];
        if ((l + ' ' + w).trim().length <= maxLinea || !l) lineas[lineas.length - 1] = (l + ' ' + w).trim();
        else lineas.push(w);
      }
      return lineas.length > 2 ? [lineas[0], recortar(lineas.slice(1).join(' '), maxLinea)] : lineas;
    };

    const hBarra = conSerie ? Math.max(6, Math.floor(20 / series.length)) : 12;
    const filas = cats.map((c) => ({ c, lin: partir(c) }));
    let y = 4;
    const pos = filas.map((f) => {
      const top = y; y += f.lin.length * 12 + series.length * (hBarra + 1) + 9; return top;
    });
    const alto = Math.max(60, y + 2);
    const x0 = 2, x1 = ancho - 66;
    const esc = (v) => (max > 0 ? (v / max) * (x1 - x0) : 0);
    const svg = s('svg', { class: 'grafica', viewBox: `0 0 ${ancho} ${alto}` });

    filas.forEach((f, i) => {
      const clicable = onClick && f.c !== 'Otros';
      const alClic = clicable ? () => onClick(f.c) : null;
      f.lin.forEach((l, k) => svg.append(s('text', {
        class: 'tick tick-cat', x: x0, y: pos[i] + 8 + k * 12, 'text-anchor': 'start', 'dominant-baseline': 'middle', onclick: alClic
      }, l)));
      series.forEach((se, j) => {
        const v = valor(f.c, se);
        const yb = pos[i] + f.lin.length * 12 + 2 + j * (hBarra + 1);
        const base = conSerie ? (pal[se] || PAL_GRAFICAS[j % PAL_GRAFICAS.length]) : ((colores && colores[f.c]) || DNP.primario);
        const rect = s('rect', {
          class: 'barra', x: x0, y: yb, width: Math.max(1, esc(v)), height: hBarra, rx: 2,
          fill: colorDe(f.c, base, seleccion), onclick: alClic, style: clicable ? null : 'cursor:default'
        });
        conTooltip(rect, () => `<b>${Formato.esc(f.c)}</b><br>${conSerie ? Formato.esc(se) + ': ' : ''}${Formato.cop(v)}`);
        svg.append(rect);
        if (v > 0) svg.append(s('text', { class: 'valor-barra', x: x0 + esc(v) + 5, y: yb + hBarra / 2, 'dominant-baseline': 'middle' }, Formato.num(v)));
      });
    });
    return svg;
  }

  // --- Barras verticales ------------------------------------------------------
  function barrasV(datos, opciones = {}) {
    const { onClick, seleccion, colores, ancho = 420, alto = 250 } = opciones;
    const max = Math.max(0, ...datos.map((d) => d.valor));
    const y0 = alto - 30, y1 = 14, x0 = 52;
    const esc = (v) => (max > 0 ? (v / max) * (y0 - y1) : 0);
    const paso = (ancho - x0 - 10) / Math.max(1, datos.length);
    const svg = s('svg', { class: 'grafica', viewBox: `0 0 ${ancho} ${alto}` });

    ticks(max).forEach((t) => {
      svg.append(s('line', { class: 'eje', x1: x0 - 4, x2: ancho - 6, y1: y0 - esc(t), y2: y0 - esc(t) }));
      svg.append(s('text', { class: 'tick', x: x0 - 8, y: y0 - esc(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, Formato.num(t)));
    });

    datos.forEach((d, i) => {
      const w = Math.min(46, paso * 0.62);
      const x = x0 + i * paso + (paso - w) / 2;
      const alt = Math.max(1, esc(d.valor));
      const color = colorDe(d.cat, (colores && colores[d.cat]) || DNP.dorado, seleccion);
      const rect = s('rect', {
        class: 'barra', x, y: y0 - alt, width: w, height: alt, rx: 2, fill: color,
        onclick: onClick ? () => onClick(d.cat) : null
      });
      conTooltip(rect, () => `<b>${Formato.esc(d.cat)}</b><br>${Formato.cop(d.valor)}`);
      svg.append(rect);
      svg.append(s('text', {
        class: 'tick tick-cat', x: x + w / 2, y: alto - 12, 'text-anchor': 'middle',
        onclick: onClick ? () => onClick(d.cat) : null
      }, recortar(d.cat, 10)));
    });
    return svg;
  }

  // --- Barras agrupadas (varias series lado a lado) ---------------------------
  //   datos: [{cat, serie, valor}]
  function barrasAgrupadas(datos, opciones = {}) {
    const { onClick, seleccion, pal = {}, orientacion = 'h', ancho = 560, altoFila = 30, alto: altoFijo, margenIzq = 150 } = opciones;
    const cats = [...new Set(datos.map((d) => d.cat))];
    const series = [...new Set(datos.map((d) => d.serie))];
    const max = Math.max(0, ...datos.map((d) => d.valor));
    const dato = (c, se) => datos.find((d) => d.cat === c && d.serie === se) || {};
    const valor = (c, se) => dato(c, se).valor || 0;
    // `nota` opcional por dato (p. ej. el año calendario cuando la categoría es «Año 1»): va entre paréntesis en el tooltip
    const etiqSerie = (c, se) => { const n = dato(c, se).nota; return Formato.esc(se) + (n ? ' (' + Formato.esc(n) + ')' : ''); };

    if (orientacion === 'h') {
      const alto = Math.max(140, cats.length * altoFila + 34);
      const x0 = margenIzq, x1 = ancho - 20;
      const esc = (v) => (max > 0 ? (v / max) * (x1 - x0) : 0);
      const svg = s('svg', { class: 'grafica', viewBox: `0 0 ${ancho} ${alto}` });
      ticks(max).forEach((t) => {
        svg.append(s('line', { class: 'eje', x1: x0 + esc(t), x2: x0 + esc(t), y1: 6, y2: alto - 22 }));
        svg.append(s('text', { class: 'tick', x: x0 + esc(t), y: alto - 8, 'text-anchor': 'middle' }, Formato.num(t)));
      });
      cats.forEach((c, i) => {
        const yBase = 8 + i * altoFila;
        const hSerie = (altoFila - 8) / series.length;
        const clicable = onClick && c !== 'Otros';
        series.forEach((se, j) => {
          const v = valor(c, se);
          const rect = s('rect', {
            class: 'barra', x: x0, y: yBase + j * hSerie, width: Math.max(1, esc(v)), height: Math.max(2, hSerie - 1),
            rx: 2, fill: colorDe(c, pal[se] || PAL_GRAFICAS[j % PAL_GRAFICAS.length], seleccion),
            onclick: clicable ? () => onClick(c) : null
          });
          conTooltip(rect, () => `<b>${Formato.esc(c)}</b><br>${etiqSerie(c, se)}: ${Formato.cop(v)}`);
          svg.append(rect);
        });
        svg.append(s('text', {
          class: 'tick tick-cat', x: x0 - 6, y: yBase + (altoFila - 8) / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle',
          onclick: clicable ? () => onClick(c) : null
        }, recortar(c, Math.floor(margenIzq / 6.2))));
      });
      return { svg, series, pal };
    }

    const alto = altoFijo || 250;
    const y0 = alto - 30, y1 = 14, x0 = 52;
    const esc = (v) => (max > 0 ? (v / max) * (y0 - y1) : 0);
    const paso = (ancho - x0 - 10) / Math.max(1, cats.length);
    const svg = s('svg', { class: 'grafica', viewBox: `0 0 ${ancho} ${alto}` });
    ticks(max).forEach((t) => {
      svg.append(s('line', { class: 'eje', x1: x0 - 4, x2: ancho - 6, y1: y0 - esc(t), y2: y0 - esc(t) }));
      svg.append(s('text', { class: 'tick', x: x0 - 8, y: y0 - esc(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, Formato.num(t)));
    });
    cats.forEach((c, i) => {
      const wGrupo = Math.min(52, paso * 0.7);
      const w = wGrupo / series.length;
      const xBase = x0 + i * paso + (paso - wGrupo) / 2;
      series.forEach((se, j) => {
        const v = valor(c, se);
        const a = Math.max(1, esc(v));
        const rect = s('rect', {
          class: 'barra', x: xBase + j * w, y: y0 - a, width: Math.max(2, w - 1), height: a, rx: 2,
          fill: colorDe(c, pal[se] || PAL_GRAFICAS[j % PAL_GRAFICAS.length], seleccion),
          onclick: onClick ? () => onClick(c) : null
        });
        conTooltip(rect, () => `<b>${Formato.esc(c)}</b><br>${etiqSerie(c, se)}: ${Formato.cop(v)}`);
        svg.append(rect);
      });
      svg.append(s('text', {
        class: 'tick tick-cat', x: xBase + wGrupo / 2, y: alto - 12, 'text-anchor': 'middle',
        onclick: onClick ? () => onClick(c) : null
      }, recortar(c, 10)));
    });
    return { svg, series, pal };
  }

  // --- Barras de balance (planeado de fondo, ejecutado encima + % de avance) --
  function barrasBalance(datos, opciones = {}) {
    const { onClick, seleccion, nombrePlan, nombreEjec, orientacion = 'h', ancho = 560, altoFila = 26, margenIzq = 150 } = opciones;
    const max = Math.max(0, ...datos.map((d) => Math.max(d.planeado, d.ejecutado)));

    if (orientacion === 'h') {
      const alto = Math.max(140, datos.length * altoFila + 34);
      const x0 = margenIzq, x1 = ancho - 60;
      const esc = (v) => (max > 0 ? (v / max) * (x1 - x0) : 0);
      const svg = s('svg', { class: 'grafica', viewBox: `0 0 ${ancho} ${alto}` });
      ticks(max).forEach((t) => {
        svg.append(s('line', { class: 'eje', x1: x0 + esc(t), x2: x0 + esc(t), y1: 6, y2: alto - 22 }));
        svg.append(s('text', { class: 'tick', x: x0 + esc(t), y: alto - 8, 'text-anchor': 'middle' }, Formato.num(t)));
      });
      datos.forEach((d, i) => {
        const y = 8 + i * altoFila, a = altoFila - 8;
        const clicable = onClick && d.cat !== 'Otros';
        const pct = d.planeado > 0 ? d.ejecutado / d.planeado : null;
        const at = (c) => colorDe(d.cat, c, seleccion);
        const g = s('g', { onclick: clicable ? () => onClick(d.cat) : null, style: clicable ? 'cursor:pointer' : null });
        g.append(s('rect', { class: 'barra', x: x0, y, width: Math.max(1, esc(d.planeado)), height: a, rx: 2, fill: at(DNP.primarioClaro) }));
        g.append(s('rect', { class: 'barra', x: x0, y: y + a * 0.2, width: Math.max(1, esc(d.ejecutado)), height: a * 0.6, rx: 2, fill: at(DNP.primario) }));
        conTooltip(g, () => `<b>${Formato.esc(d.cat)}</b><br>${Formato.esc(nombrePlan)}: ${Formato.cop(d.planeado)}<br>${Formato.esc(nombreEjec)}: ${Formato.cop(d.ejecutado)}<br>${Formato.esc(nombreEjec)} / ${Formato.esc(nombrePlan)}: ${Formato.pct(pct)}`);
        svg.append(g);
        svg.append(s('text', { class: 'valor-barra', x: x0 + Math.max(esc(d.planeado), esc(d.ejecutado)) + 5, y: y + a / 2, 'dominant-baseline': 'middle' }, Formato.pct(pct)));
        svg.append(s('text', {
          class: 'tick tick-cat', x: x0 - 6, y: y + a / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle',
          onclick: clicable ? () => onClick(d.cat) : null
        }, recortar(d.cat, Math.floor(margenIzq / 6.2))));
      });
      return svg;
    }

    const alto = 250, y0 = alto - 30, y1 = 14, x0 = 52;
    const esc = (v) => (max > 0 ? (v / max) * (y0 - y1) : 0);
    const paso = (ancho - x0 - 10) / Math.max(1, datos.length);
    const svg = s('svg', { class: 'grafica', viewBox: `0 0 ${ancho} ${alto}` });
    ticks(max).forEach((t) => {
      svg.append(s('line', { class: 'eje', x1: x0 - 4, x2: ancho - 6, y1: y0 - esc(t), y2: y0 - esc(t) }));
      svg.append(s('text', { class: 'tick', x: x0 - 8, y: y0 - esc(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, Formato.num(t)));
    });
    datos.forEach((d, i) => {
      const w = Math.min(46, paso * 0.62);
      const x = x0 + i * paso + (paso - w) / 2;
      const pct = d.planeado > 0 ? d.ejecutado / d.planeado : null;
      const at = (c) => colorDe(d.cat, c, seleccion);
      const g = s('g', { onclick: onClick ? () => onClick(d.cat) : null, style: 'cursor:pointer' });
      g.append(s('rect', { class: 'barra', x, y: y0 - Math.max(1, esc(d.planeado)), width: w, height: Math.max(1, esc(d.planeado)), rx: 2, fill: at(DNP.primarioClaro) }));
      g.append(s('rect', { class: 'barra', x: x + w * 0.2, y: y0 - Math.max(1, esc(d.ejecutado)), width: w * 0.6, height: Math.max(1, esc(d.ejecutado)), rx: 2, fill: at(DNP.primario) }));
      conTooltip(g, () => `<b>${Formato.esc(d.cat)}</b><br>${Formato.esc(nombrePlan)}: ${Formato.cop(d.planeado)}<br>${Formato.esc(nombreEjec)}: ${Formato.cop(d.ejecutado)}<br>${Formato.pct(pct)}`);
      svg.append(g);
      svg.append(s('text', { class: 'tick tick-cat', x: x + w / 2, y: alto - 12, 'text-anchor': 'middle', onclick: onClick ? () => onClick(d.cat) : null }, recortar(d.cat, 10)));
    });
    return svg;
  }

  // --- Barra divergente (positivo a la derecha del cero, negativo a la izquierda) ---------------
  // Para los indicadores de VALIDACIÓN al comparar 2 gobiernos (cambio en totales, cambio en % de
  // participación): una sola barra por categoría, que crece hacia un lado u otro del cero según el
  // signo. A diferencia de las demás gráficas, el color NO viene de la serie/categoría sino de la
  // MAGNITUD del cambio (ver tema.js:colorCambio) — por eso cada dato ya trae su propio `color`
  // resuelto: esta función solo dibuja, no decide colores.
  //   datos: [{cat, valor, color, tooltip}] — valor puede ser negativo; tooltip es HTML ya armado
  //   (cada indicador arma el suyo: pesos+% para «cambio en totales», puntos+% para «participación»).
  //   opciones.formatear: Formato.cop (pesos) o Formato.pp (puntos porcentuales) — con signo explícito.
  function barrasCambio(datos, opciones = {}) {
    const { onClick, seleccion, ancho = 560, altoFila = 24, margenIzq = 150, formatear = (v) => Formato.cop(v, 0, true) } = opciones;
    const alto = Math.max(120, datos.length * altoFila + 34);
    const maxAbs = Math.max(1e-9, ...datos.map((d) => Math.abs(d.valor)));
    const x0 = margenIzq, x1 = ancho - 58;
    const mitad = (x1 - x0) / 2, xCero = x0 + mitad;
    const esc = (v) => (v / maxAbs) * mitad;
    const svg = s('svg', { class: 'grafica', viewBox: `0 0 ${ancho} ${alto}` });

    svg.append(s('line', { class: 'eje eje-cero', x1: xCero, x2: xCero, y1: 6, y2: alto - 22 }));

    datos.forEach((d, i) => {
      const y = 8 + i * altoFila, alt = altoFila - 7;
      const w = Math.max(1, Math.abs(esc(d.valor)));
      const x = d.valor >= 0 ? xCero : xCero - w;
      const clicable = onClick && d.cat !== 'Otros';
      const color = colorDe(d.cat, d.color, seleccion);
      const rect = s('rect', {
        class: 'barra', x, y, width: w, height: alt, rx: 2, fill: color,
        onclick: clicable ? () => onClick(d.cat) : null, style: clicable ? null : 'cursor:default'
      });
      conTooltip(rect, () => d.tooltip);
      svg.append(rect);
      svg.append(s('text', {
        class: 'tick tick-cat', x: x0 - 6, y: y + alt / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle',
        onclick: clicable ? () => onClick(d.cat) : null
      }, recortar(d.cat, Math.floor(margenIzq / 6.2))));
      // Con la barra en o cerca del máximo (negativa), su punta llega casi hasta x0 — justo donde
      // está la etiqueta de categoría. Por eso, si la barra es suficientemente larga, el valor se
      // mete ADENTRO (cerca de la punta, con el color de texto que sí se lea sobre el fondo); si es
      // corta, se deja afuera como siempre (ahí nunca choca con nada).
      const adentro = w > 55;
      const xTxt = adentro
        ? (d.valor >= 0 ? x + w - 5 : x + 5)
        : (d.valor >= 0 ? x + w + 5 : x - 5);
      const colorTxt = adentro ? textoContraste(color) : color;
      svg.append(s('text', {
        class: 'valor-barra', x: xTxt, y: y + alt / 2, 'dominant-baseline': 'middle',
        'text-anchor': adentro ? (d.valor >= 0 ? 'end' : 'start') : (d.valor >= 0 ? 'start' : 'end'),
        style: 'fill:' + colorTxt
      }, formatear(d.valor)));
    });
    return svg;
  }

  // --- Líneas (series conectadas sobre un eje X de AÑOS CALENDARIO compartido) -----------------
  // Para comparar 2 gobiernos con periodos distintos: a diferencia de barrasAgrupadas (que alinea
  // por posición relativa dentro del periodo — «Año 1», «Año 2», …), aquí el eje X es el año
  // calendario real y cada serie dibuja SOLO sus propios años; el otro gobierno no aparece "en
  // cero" donde no tiene dato — sencillamente no se dibuja ningún punto ni tramo ahí.
  //   datos: [{cat (año calendario, string), serie, valor}]
  function lineas(datos, opciones = {}) {
    const { onClick, pal = {}, ancho = 420, alto = 250, formatear = (v) => Formato.cop(v) } = opciones;
    const anios = [...new Set(datos.map((d) => d.cat))].sort();
    const series = [...new Set(datos.map((d) => d.serie))];
    const max = Math.max(0, ...datos.map((d) => d.valor));
    const y0 = alto - 30, y1 = 14, x0 = 52;
    const escY = (v) => (max > 0 ? (v / max) * (y0 - y1) : 0);
    const paso = (ancho - x0 - 10) / Math.max(1, anios.length - 1);
    const x = (a) => x0 + anios.indexOf(a) * paso;
    const svg = s('svg', { class: 'grafica', viewBox: `0 0 ${ancho} ${alto}` });

    ticks(max).forEach((t) => {
      svg.append(s('line', { class: 'eje', x1: x0 - 4, x2: ancho - 6, y1: y0 - escY(t), y2: y0 - escY(t) }));
      svg.append(s('text', { class: 'tick', x: x0 - 8, y: y0 - escY(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, Formato.num(t)));
    });
    anios.forEach((a) => {
      svg.append(s('text', { class: 'tick tick-cat', x: x(a), y: alto - 12, 'text-anchor': 'middle' }, a));
    });

    series.forEach((se, j) => {
      const color = pal[se] || PAL_GRAFICAS[j % PAL_GRAFICAS.length];
      const puntos = datos.filter((d) => d.serie === se).sort((a, b) => a.cat.localeCompare(b.cat));
      if (puntos.length > 1) {
        const pts = puntos.map((p) => `${x(p.cat)},${y0 - escY(p.valor)}`).join(' ');
        svg.append(s('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': 2.5 }));
      }
      puntos.forEach((p) => {
        const cx = x(p.cat), cy = y0 - escY(p.valor);
        const circ = s('circle', {
          cx, cy, r: 5, fill: color, stroke: '#fff', 'stroke-width': 1.5,
          onclick: onClick ? () => onClick(p.cat, se) : null, style: onClick ? 'cursor:pointer' : null
        });
        conTooltip(circ, () => `<b>${Formato.esc(se)} — ${Formato.esc(p.cat)}</b><br>${formatear(p.valor)}`);
        svg.append(circ);
      });
    });
    return { svg, series, pal };
  }

  // Leyenda HTML para las gráficas de varias series
  function leyenda(series, pal) {
    return UI.h('div', { class: 'leyenda' }, series.map((se, i) => UI.h('span', { class: 'leyenda-item' },
      UI.h('span', { class: 'leyenda-color', style: { background: pal[se] || PAL_GRAFICAS[i % PAL_GRAFICAS.length] } }),
      se)));
  }

  // Top N + "Otros" (equivale a top_otros de R): SIEMPRE ordena de mayor a menor, incluso cuando
  // caben todas y no hace falta agrupar en "Otros" (antes, con n >= datos.length, se devolvía tal
  // cual llegaba del cubo, sin ordenar). Devuelve también qué quedó dentro de "Otros".
  function topOtros(datos, n = 12) {
    const orden = [...datos].sort((a, b) => b.valor - a.valor);
    if (orden.length <= n) return { datos: orden, otros: [] };
    const top = orden.slice(0, n);
    const resto = orden.slice(n);
    return {
      datos: top.concat([{ cat: 'Otros', valor: resto.reduce((a, d) => a + d.valor, 0) }]),
      otros: resto.map((d) => d.cat)
    };
  }

  return { s, dona, barrasH, barrasLista, barrasV, barrasAgrupadas, barrasBalance, barrasCambio, lineas, leyenda, topOtros, ticks };
})();
