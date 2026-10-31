// ============================================================================
// ui.js — Componentes de interfaz compartidos. Equivale a R/ui_componentes.R.
// Todo se construye con DOM (no innerHTML con datos) para que los textos que
// vienen del Excel o del cubo no puedan inyectar marcado.
// ============================================================================

// h('div', {class:'x', onclick:fn}, hijo, hijo…) → HTMLElement
function h(tag, props, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;              // solo para marcado propio
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const vaciar = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// --- Zoom de tarjeta (equivale a full_screen = TRUE de bslib::card) ---------------------------
// Un botón abajo a la derecha de la tarjeta la agranda a (casi) toda la pantalla, con fondo
// oscurecido detrás; clic en el fondo, Esc o el mismo botón la devuelve a su tamaño. Las gráficas
// SVG usan viewBox (ver graficas.js), así que crecen nítidas solas: no hay que redibujarlas.
const ICONO_AMPLIAR = '⤢', ICONO_CERRAR = '✕';
let zoomBackdrop = null, zoomActual = null;
function zoomFondo() {
  if (!zoomBackdrop) {
    zoomBackdrop = h('div', { class: 'zoom-backdrop', hidden: true, onclick: zoomCerrar });
    document.body.append(zoomBackdrop);
  }
  return zoomBackdrop;
}
function zoomCerrar() {
  if (!zoomActual) return;
  zoomActual.classList.remove('zoom-abierto');
  const btn = zoomActual.querySelector('.btn-zoom');
  if (btn) { btn.textContent = ICONO_AMPLIAR; btn.title = 'Ampliar'; btn.setAttribute('aria-label', 'Ampliar'); }
  zoomFondo().hidden = true;
  zoomActual = null;
}
function zoomAbrir(el) {
  if (zoomActual && zoomActual !== el) zoomCerrar();
  el.classList.add('zoom-abierto');
  const btn = el.querySelector('.btn-zoom');
  if (btn) { btn.textContent = ICONO_CERRAR; btn.title = 'Cerrar'; btn.setAttribute('aria-label', 'Cerrar'); }
  zoomFondo().hidden = false;
  zoomActual = el;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') zoomCerrar(); });

const UI = {
  h, vaciar,
  // app.js la llama al cambiar de hoja: la tarjeta zoomeada desaparece del DOM con ese
  // cambio, pero el fondo oscuro vive aparte (en <body>) y quedaría huérfano tapando la hoja nueva.
  cerrarZoom: zoomCerrar,

  // --- Estructura de una hoja -------------------------------------------------
  hero(eyebrow, titulo, subtitulo) {
    return h('header', { class: 'dnp-hero hero-hoja' },
      h('div', { class: 'container-xl hero-inner' },
        h('p', { class: 'hero-eyebrow' }, eyebrow),
        h('h1', { class: 'hero-title' }, titulo),
        h('p', { class: 'hero-sub' }, subtitulo)));
  },

  card(titulo, cuerpo, opciones = {}) {
    const cabecera = titulo
      ? h('div', { class: 'card-dnp-header' },
          titulo instanceof Node ? titulo : h('span', {}, titulo),
          opciones.acciones || null)
      : null;
    const body = h('div', {
      class: 'card-dnp-body' + (opciones.sinPadding ? ' sin-padding' : ''),
      style: opciones.altoCuerpo ? { height: opciones.altoCuerpo + 'px' } : null
    });
    if (cuerpo) body.append(cuerpo);
    // Zoom: en todas las tarjetas de contenido, salvo que se pida lo contrario (opciones.sinZoom)
    // o sea una tarjeta de filtros (nunca hace falta agrandarla).
    const esFiltros = opciones.clase && opciones.clase.split(' ').includes('card-filtros');
    const conZoom = opciones.zoom !== undefined ? opciones.zoom : !esFiltros;
    const el = h('div', { class: 'card-dnp' + (opciones.clase ? ' ' + opciones.clase : '') },
      cabecera, body);
    if (conZoom) {
      el.append(h('button', {
        type: 'button', class: 'btn-zoom', title: 'Ampliar', 'aria-label': 'Ampliar',
        onclick: (e) => { e.stopPropagation(); el.classList.contains('zoom-abierto') ? zoomCerrar() : zoomAbrir(el); }
      }, ICONO_AMPLIAR));
    }
    return el;
  },

  kpi(valor, etiqueta, acento, detalle) {
    return h('div', { class: 'kpi-box' + (acento ? ' ' + acento : '') },
      h('div', { class: 'kpi-value' }, valor),
      h('div', { class: 'kpi-label' }, etiqueta),
      detalle ? h('div', { class: 'kpi-detalle' }, detalle) : null);
  },
  filaKpis(...kpis) { return h('div', { class: 'kpi-row' }, kpis); },

  estadoVacio(mensaje, detalle) {
    return h('div', { class: 'estado-vacio' },
      h('div', { class: 'estado-vacio-msg' }, mensaje),
      detalle ? h('div', { class: 'estado-vacio-detalle' }, detalle) : null);
  },

  cargando(texto = 'Cargando datos…') {
    return h('div', { class: 'cargando' }, h('div', { class: 'spinner' }), h('div', {}, texto));
  },

  nota(...partes) { return h('div', { class: 'nota-card' }, partes); },

  // --- Controles --------------------------------------------------------------
  // Grupo de botones tipo radio (equivale a radioGroupButtons)
  grupoBotones({ etiqueta, opciones, valor, vertical, onCambio }) {
    const cont = h('div', { class: 'grupo-btn' + (vertical ? ' vertical' : '') });
    opciones.forEach((op) => {
      const texto = typeof op === 'string' ? op : op.texto;
      const val = typeof op === 'string' ? op : op.valor;
      cont.append(h('button', {
        type: 'button', 'aria-pressed': String(val === valor),
        onclick: () => { if (val !== valor) onCambio(val); }
      }, texto));
    });
    return etiqueta
      ? h('div', { class: 'campo' }, h('span', { class: 'campo-titulo' }, etiqueta), cont)
      : cont;
  },

  // Radio buttons nativos (accesibles: flechas del teclado, lector de pantalla).
  //   opciones: ['texto'] o [{valor, texto, deshabilitada, titulo}]; `nombre` agrupa los radios.
  radio({ etiqueta, nombre, opciones, valor, onCambio }) {
    const grupo = h('div', { class: 'radio-grupo', role: 'radiogroup', 'aria-label': etiqueta || nombre });
    opciones.forEach((op) => {
      const val = typeof op === 'string' ? op : op.valor;
      const txt = typeof op === 'string' ? op : op.texto;
      const off = typeof op === 'string' ? false : !!op.deshabilitada;
      const id = 'rd-' + nombre + '-' + String(val).replace(/\W+/g, '_');
      grupo.append(h('label', {
        class: 'radio-op' + (off ? ' desactivada' : ''), for: id, title: (op && op.titulo) || null
      },
        h('input', {
          type: 'radio', name: nombre, id, value: val, checked: val === valor, disabled: off,
          onchange: () => { if (val !== valor) onCambio(val); }
        }),
        h('span', { class: 'radio-texto' }, txt)));
    });
    return etiqueta
      ? h('div', { class: 'campo' }, h('span', { class: 'campo-titulo' }, etiqueta), grupo)
      : grupo;
  },

  // Desplegable con selección simple o múltiple (equivale a pickerInput /
  // picker_dnp). `valor` es un string (simple) o un arreglo (múltiple).
  picker({ etiqueta, opciones, valor, multiple, buscar, onCambio, textoTodas }) {
    const sel = multiple ? [].concat(valor || []) : valor;
    const boton = h('button', { type: 'button', class: 'picker-boton' },
      h('span', { class: 'picker-texto' }));
    const menu = h('div', { class: 'picker-menu', hidden: true });
    const cont = h('div', { class: 'picker' }, boton, menu);

    function rotulo() {
      if (!multiple) return sel || '—';
      if (!sel.length) return 'Ninguna seleccionada';
      // Con muchas seleccionadas el nombre completo no cabe: se resume.
      if (sel.length === opciones.length && textoTodas) return textoTodas;
      return sel.length > 2 ? sel.length + ' seleccionadas' : sel.join(', ');
    }
    function pintarRotulo() { boton.firstChild.textContent = rotulo(); }

    function pintarMenu(filtro = '') {
      vaciar(menu);
      if (buscar) {
        const input = h('input', {
          class: 'picker-buscar', type: 'search', placeholder: 'Buscar…', value: filtro,
          oninput: (e) => { pintarMenu(e.target.value); menu.querySelector('.picker-buscar').focus(); }
        });
        menu.append(input);
      }
      if (multiple) {
        menu.append(h('div', { class: 'picker-acciones' },
          h('button', { type: 'button', onclick: () => aplicar(opciones.slice()) }, 'Todas'),
          h('button', { type: 'button', onclick: () => aplicar([]) }, 'Ninguna')));
      }
      const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const visibles = filtro ? opciones.filter((o) => norm(etiquetaDe(o)).includes(norm(filtro))) : opciones;
      visibles.forEach((op) => {
        const val = typeof op === 'string' ? op : op.valor;
        const txt = etiquetaDe(op);
        const activo = multiple ? sel.includes(val) : sel === val;
        menu.append(h('button', {
          type: 'button', class: 'picker-opcion', 'aria-selected': String(activo),
          onclick: () => {
            if (multiple) {
              const s = sel.includes(val) ? sel.filter((x) => x !== val) : sel.concat([val]);
              aplicar(s, true);
            } else { cerrar(); onCambio(val); }
          }
        },
          multiple ? h('input', { type: 'checkbox', checked: activo, tabindex: '-1' }) : null,
          h('span', {}, txt)));
      });
      if (!visibles.length) menu.append(h('div', { class: 'texto-suave', style: { padding: '.4rem .5rem' } }, 'Sin coincidencias'));
    }
    const etiquetaDe = (op) => (typeof op === 'string' ? op : op.texto);

    function aplicar(nuevos, mantenerAbierto) {
      sel.length = 0; sel.push(...nuevos);
      pintarRotulo();
      if (mantenerAbierto) pintarMenu(menu.querySelector('.picker-buscar')?.value || '');
      onCambio(sel.slice());
    }
    function abrir() {
      document.querySelectorAll('.picker-menu:not([hidden])').forEach((m) => { m.hidden = true; });
      pintarMenu(); menu.hidden = false;
      menu.querySelector('.picker-buscar')?.focus();
    }
    function cerrar() { menu.hidden = true; }

    boton.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden ? abrir() : cerrar(); });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', cerrar);
    pintarRotulo();

    return etiqueta
      ? h('div', { class: 'campo' }, h('span', { class: 'campo-titulo' }, etiqueta), cont)
      : cont;
  },

  // Envuelve el panel de filtros (columna izquierda) con un botón de acordeón para colapsarlo/
  // expandirlo. Toggle puramente visual (alterna una clase CSS y el ícono del botón): no vuelve a
  // pintar la hoja, así que no reinicia scroll ni dispara de nuevo las consultas del cubo. Usado por
  // las 4 hojas con panel de filtros (visor, ppi_2027, descargar, iniciativas).
  colFiltrosColapsable(contenido) {
    const boton = h('button', {
      type: 'button', class: 'btn-colapsar-filtros', 'aria-label': 'Ocultar filtros', title: 'Ocultar filtros'
    }, '‹');
    const col = h('div', { class: 'col-filtros' }, boton, contenido);
    boton.addEventListener('click', () => {
      const colapsado = col.classList.toggle('col-filtros-colapsado');
      boton.textContent = colapsado ? '›' : '‹';
      const etq = colapsado ? 'Mostrar filtros' : 'Ocultar filtros';
      boton.title = etq; boton.setAttribute('aria-label', etq);
    });
    return col;
  },

  // Chips del cross-filtering: una por dimensión con selección activa
  chips(seleccion, onQuitar, onLimpiar) {
    const activas = Object.entries(seleccion).filter(([, v]) => v && v.length);
    if (!activas.length) {
      return h('div', { class: 'chips-row vacia' },
        h('span', {}, 'Haga clic en una gráfica o en el mapa para filtrar'));
    }
    const fila = h('div', { class: 'chips-row' });
    activas.forEach(([dim, vals]) => {
      fila.append(h('span', { class: 'chip' },
        h('button', { class: 'chip-x', type: 'button', title: 'Quitar ' + dim, onclick: () => onQuitar(dim) }, '✕'),
        h('b', {}, dim + ': '), [].concat(vals).join(', ')));
    });
    fila.append(h('button', { class: 'limpiar-sel', type: 'button', onclick: onLimpiar }, 'Limpiar'));
    return fila;
  },

  // --- Tabla con paginación ---------------------------------------------------
  //   columnas: [{campo, titulo, num, ancho, render}]
  tabla(filas, columnas, opciones = {}) {
    const porPagina = opciones.porPagina || 12;
    const cont = h('div', {});
    let pagina = 0;

    function pintar() {
      vaciar(cont);
      const paginas = Math.max(1, Math.ceil(filas.length / porPagina));
      pagina = Math.min(pagina, paginas - 1);
      const visibles = opciones.sinPaginacion
        ? filas
        : filas.slice(pagina * porPagina, (pagina + 1) * porPagina);

      const thead = h('thead', {}, h('tr', {}, columnas.map((c) =>
        h('th', { class: c.num ? 'num' : null, style: c.ancho ? { width: c.ancho } : null }, c.titulo))));
      const tbody = h('tbody', {});

      visibles.forEach((fila) => {
        const tr = h('tr', {
          class: [opciones.onClickFila ? 'clicable' : '', opciones.filaSel && opciones.filaSel(fila) ? 'sel' : '']
            .filter(Boolean).join(' ') || null,
          onclick: opciones.onClickFila ? () => opciones.onClickFila(fila) : null
        }, columnas.map((c) => {
          const v = c.render ? c.render(fila[c.campo], fila) : fila[c.campo];
          return h('td', { class: c.num ? 'num' : null }, v instanceof Node ? v : String(v ?? ''));
        }));
        tbody.append(tr);
        // Fila de detalle desplegable (2.º nivel de las líneas del PND). Abierta de entrada si la
        // fila ya está seleccionada (filaSel): así seleccionar una fila también la despliega, y
        // quitar la selección (clic de nuevo) la vuelve a cerrar — sin esto, cada clic en la fila
        // dispara actualizar() y el repintado completo volvía a cerrar lo que el usuario acababa de abrir.
        if (opciones.detalle) {
          const det = opciones.detalle(fila);
          if (det) {
            const abierto = !!(opciones.filaSel && opciones.filaSel(fila));
            const trDet = h('tr', { class: 'fila-detalle', hidden: !abierto },
              h('td', { colspan: String(columnas.length) }, det));
            tbody.append(trDet);
            const btn = h('button', {
              class: 'btn-expandir', type: 'button', title: 'Desplegar',
              onclick: (e) => { e.stopPropagation(); trDet.hidden = !trDet.hidden; btn.textContent = trDet.hidden ? '▸' : '▾'; }
            }, abierto ? '▾' : '▸');
            tr.querySelector('td').prepend(btn);
          }
        }
      });

      cont.append(h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla-dnp' }, thead, tbody)));
      if (!opciones.sinPaginacion && paginas > 1) {
        cont.append(h('div', { class: 'paginacion' },
          h('button', { type: 'button', disabled: pagina === 0, onclick: () => { pagina--; pintar(); } }, 'Anterior'),
          h('span', {}, `${pagina + 1} / ${paginas}`),
          h('button', { type: 'button', disabled: pagina >= paginas - 1, onclick: () => { pagina++; pintar(); } }, 'Siguiente')));
      }
    }
    pintar();
    return cont;
  },

  // --- Acordeón ---------------------------------------------------------------
  acordeon(paneles, opciones = {}) {
    const cont = h('div', { class: 'acordeon' + (opciones.anidado ? ' acordeon-anidado' : '') });
    paneles.forEach((p, i) => {
      const abierto = opciones.abiertos ? opciones.abiertos.includes(p.id) : i === 0;
      const cuerpo = h('div', { class: 'acordeon-cuerpo' });
      let construido = false;
      const panel = h('div', { class: 'acordeon-panel' + (abierto ? ' abierto' : '') },
        h('button', {
          class: 'acordeon-boton', type: 'button',
          onclick: () => {
            panel.classList.toggle('abierto');
            // Contenido perezoso: solo se arma la primera vez que se abre
            if (!construido && panel.classList.contains('abierto')) {
              cuerpo.append(p.contenido()); construido = true;
            }
          }
        }, p.titulo), cuerpo);
      if (abierto) { cuerpo.append(p.contenido()); construido = true; }
      cont.append(panel);
    });
    return cont;
  },

  // --- Tooltip compartido -----------------------------------------------------
  tooltip: (() => {
    let el = null;
    const ocultar = () => { if (el) el.hidden = true; };
    // En móvil no hay "mouseleave" tras un tap (no hay un mouse real que se "vaya"): sin esto el
    // tooltip quedaba pegado en pantalla hasta el siguiente tap sobre otra barra/rebanada. Se
    // oculta en cualquier touch o scroll nuevo; si el toque cae sobre otro elemento con tooltip,
    // el mousemove sintético que dispara el navegador justo después lo vuelve a mostrar con su
    // propio contenido, así que esto nunca tapa un tooltip que sí debía aparecer.
    document.addEventListener('touchstart', ocultar, { passive: true, capture: true });
    document.addEventListener('scroll', ocultar, { passive: true, capture: true });
    return {
      mostrar(html, ev) {
        if (!el) { el = h('div', { class: 'tooltip-dnp' }); document.body.append(el); }
        el.innerHTML = html;   // marcado propio: quien llama ya escapó los datos
        el.hidden = false;
        const m = 14;
        const x = Math.min(ev.clientX + m, window.innerWidth - el.offsetWidth - 8);
        const y = Math.min(ev.clientY + m, window.innerHeight - el.offsetHeight - 8);
        el.style.left = Math.max(8, x) + 'px';
        el.style.top = Math.max(8, y) + 'px';
      },
      ocultar
    };
  })()
};
