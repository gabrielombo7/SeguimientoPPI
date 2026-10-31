// ============================================================================
// medida.js — Qué se mide y en qué unidad. Lo comparten el Visor y Descargar.
//
//   Medida  · Totales (miles de millones de pesos) | Per cápita (pesos por habitante) | % del PIB
//   Unidad  · Corrientes | Constantes de un AÑO BASE que elige el usuario (en % del PIB no se elige: siempre es constantes del año base)
//
// Per cápita se calcula AQUÍ, en el navegador (Cubo.recorrer con q.pc): cada fila del cubo en corrientes se
// divide por la población proyectada DANE de su departamento y vigencia (meta.poblacion); sin departamento
// elegido se divide por la población nacional. Es aditivo por todas las dimensiones menos el departamento
// (el per cápita de dos departamentos no es la suma de los dos): por eso, en per cápita, solo se elige UN
// departamento a la vez.
//
// Constantes se calculan AQUÍ, en el navegador, sobre cualquiera de las dos medidas:
// valor × índice[base] / índice[vigencia], SIEMPRE con el deflactor implícito del PIB del MFMP
// (meta.deflactores). Ver Cubo.recorrer.
//
// % del PIB se calcula AQUÍ: inversión(t) ÷ PIB nominal(t), en pesos del MISMO año t (sin deflactar, como lo reporta
// el DANE) cuando se mira un solo año; al agregar varios años (p. ej. «Totales») se suma la inversión y el PIB de
// esos mismos años, en precios comparables entre sí, y se divide al final — nunca se divide una suma de varios años
// por el PIB de uno solo. No hay año base en % del PIB: el resultado no depende de en qué año de precios se exprese
// la suma intermedia (se cancela algebraicamente). Ver Cubo.pesosPib/pesoPibPorAnio.
// ============================================================================

const Medida = (() => {
  const est = { modo: 'total', constantes: false, base: 2026 };   // modo: 'total' | 'pc' | 'pib'
  const SERIE = 'PIB';                                            // el único índice de precios: deflactor implícito del PIB
  const SERIES = { PIB: 'Deflactor del PIB' };

  const tipoValor = () => 'corriente';                            // el cubo solo trae corrientes; per cápita, constantes y % del PIB se calculan aquí
  const constantes = () => est.constantes && est.modo !== 'pib';

  // Etiqueta completa de la unidad (subtítulos, notas)
  function etiqueta() {
    if (est.modo === 'pib') return '% del PIB nominal (inversión y PIB del mismo año, o sumados si son varios)';
    const cifra = est.modo === 'pc' ? 'Pesos' : 'Miles de millones de pesos';
    const precio = constantes() ? ` constantes de ${est.base}` : ' corrientes';
    return cifra + precio + (est.modo === 'pc' ? ' por habitante' : '');
  }
  // Etiqueta corta para dentro de una frase: "corrientes", "constantes 2026 por habitante", "% del PIB"
  function corta() {
    if (est.modo === 'pib') return '% del PIB';
    return (constantes() ? `constantes ${est.base}` : 'corrientes') + (est.modo === 'pc' ? ' por habitante' : '');
  }

  return {
    get percapita() { return est.modo === 'pc'; },
    get pib() { return est.modo === 'pib'; },
    get constantes() { return constantes(); },
    get base() { return est.base; },
    get serie() { return SERIE; },
    SERIES,
    fijar(cambios) {
      if ('percapita' in cambios) est.modo = cambios.percapita ? 'pc' : 'total';
      if ('pib' in cambios) est.modo = cambios.pib ? 'pib' : 'total';
      Object.keys(cambios).filter((k) => k === 'constantes' || k === 'base').forEach((k) => { est[k] = cambios[k]; });
    },
    tipoValor, etiqueta, corta,

    // Añade a una consulta del cubo la unidad elegida (tipo_valor + deflactación o % del PIB)
    aplicar(q) {
      return Object.assign({}, q, {
        tipo_valor: tipoValor(),
        base: constantes() ? est.base : null,   // % del PIB ya no usa año base (Cubo.recorrer lo ignora en modo pib)
        deflactor: SERIE,
        pib: est.modo === 'pib',
        pc: est.modo === 'pc'
      });
    },
    // La misma consulta pero en CORRIENTES sin % del PIB ni per cápita: para razones entre valores (participaciones,
    // avance %), que no deben cambiar de denominador entre numerador y denominador.
    enCorrientes(q) { return Object.assign({}, q, { pib: false, pc: false, base: null }); },

    // ¿Hay población para calcular el per cápita? (meta.poblacion; no depende del gobierno ni del indicador)
    pcDisponible() { return Cubo.poblacionDisponible(); },

    // Año base válido: entero con índice de precios del deflactor del PIB
    validarBase(v) {
      const a = Number(v);
      const [min, max] = Cubo.rangoDeflactor(SERIE);
      return Number.isInteger(a) && a >= min && a <= max ? a : null;
    },

    // Controles de la unidad, para el panel de filtros de cada hoja.
    //   pcDisponible: si el per cápita no existe para la selección, la opción queda deshabilitada
    //   pibDisponible: si es undefined la hoja no ofrece «% del PIB»; false lo deja deshabilitado (con el motivo en `motivoPib`)
    //   onCambio(qué): 'medida' | 'unidad' | 'base' → la hoja se repinta
    controles({ pcDisponible, pibDisponible, motivoPib, onCambio, prefijo }) {
      const p = prefijo || 'medida';
      const [min, max] = Cubo.rangoDeflactor(SERIE);
      const ofrecePib = pibDisponible !== undefined && Cubo.pibDisponible();

      const opcionesMedida = [
        { valor: 'total', texto: 'Totales' },
        { valor: 'pc', texto: 'Per cápita', deshabilitada: !pcDisponible,
          titulo: pcDisponible ? 'Pesos por habitante (población proyectada DANE)' : 'No hay per cápita para esta selección' }];
      if (ofrecePib) {
        opcionesMedida.push({ valor: 'pib', texto: '% del PIB', deshabilitada: !pibDisponible,
          titulo: pibDisponible ? 'Inversión ÷ PIB nominal, en pesos del mismo año (o sumados si son varios años)' : (motivoPib || 'No disponible para esta selección') });
      }
      const radioMedida = UI.radio({
        etiqueta: 'Medida', nombre: p + '-medida', valor: est.modo, opciones: opcionesMedida,
        onCambio: (v) => { est.modo = v; onCambio('medida'); }
      });

      // La unidad (corrientes / constantes) no aplica a «% del PIB»: siempre es constantes del año base ÷ PIB nominal de ese año
      let radioUnidad = null, extra = null;
      if (est.modo !== 'pib') {
        radioUnidad = UI.radio({
          etiqueta: 'Unidad de medida', nombre: p + '-unidad', valor: est.constantes ? 'constante' : 'corriente',
          opciones: [
            { valor: 'corriente', texto: 'Corrientes' },
            { valor: 'constante', texto: 'Constantes (año base)' }
          ],
          onCambio: (v) => { est.constantes = v === 'constante'; onCambio('unidad'); }
        });
      }

      // Año base: SOLO para «Constantes» (el usuario elige a qué año de precios llevar la cifra).
      // % del PIB ya no usa año base: cada año se compara contra el PIB de ESE mismo año (Cubo.pesosPib);
      // al agregar varios años se suman ambos lados antes de dividir, y el resultado no depende de en qué
      // año de precios se exprese esa suma intermedia — por eso no hay nada que el usuario tenga que elegir aquí.
      const corte = ((Cubo.meta.deflactores || {}).corte || '');
      if (est.constantes) {
        const aviso = UI.h('div', { class: 'campo-aviso', role: 'status', hidden: true });
        const entrada = UI.h('input', {
          class: 'input-anio', type: 'number', inputmode: 'numeric', step: '1',
          min: String(min), max: String(max), value: String(est.base), 'aria-label': 'Año base de los precios constantes'
        });
        const aplicar = () => {
          const v = Medida.validarBase(entrada.value);
          if (v === null) {
            aviso.textContent = `Escriba un año entre ${min} y ${max}.`;
            aviso.hidden = false;
            entrada.value = String(est.base);
            return;
          }
          aviso.hidden = true;
          if (v !== est.base) { est.base = v; onCambio('base'); }
        };
        entrada.addEventListener('change', aplicar);
        entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aplicar(); } });
        extra = UI.h('div', { class: 'sub-campo' },
          UI.h('label', { class: 'sub-campo-fila' },
            UI.h('span', { class: 'campo-titulo' }, 'Año base'), entrada),
          aviso,
          UI.h('p', { class: 'texto-suave nota-constantes' },
            'Constantes calculadas aquí con el deflactor implícito del PIB del MFMP ' + corte +
            ': valor × índice del año base ÷ índice de la vigencia. En revisión.'));
      } else if (est.modo === 'pib') {
        extra = UI.h('div', { class: 'sub-campo' },
          UI.h('p', { class: 'texto-suave nota-constantes' },
            'Un año: inversión corriente de ese año ÷ PIB nominal de ese mismo año, sin deflactar. ' +
            'Varios años (o el total del periodo): se suma la inversión y el PIB de esos mismos años, a precios ' +
            `comparables entre sí (deflactor implícito del PIB del MFMP ${corte}), y se divide al final.`));
      }
      return UI.h('div', { class: 'grupo-medida' }, radioMedida, radioUnidad, extra);
    }
  };
})();
