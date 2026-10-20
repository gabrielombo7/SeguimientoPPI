// ============================================================================
// carga.js — Carga de datos por <script>, no por fetch().
//
// POR QUÉ: los navegadores bloquean fetch()/XHR sobre file://, así que un
// index.html abierto con doble clic no puede leer .json. Un <script> sí carga
// en file://, de modo que el tablero funciona igual servido por HTTP o abierto
// directamente desde el disco (o desde una carpeta compartida en OneDrive).
//
// Por eso scripts/exportar_web.R escribe .js que asignan un global
// (window.__PPI_META, __PPI_GEO, __PPI_INICIATIVAS, __PPI_INDICE, __PPI_SHARD)
// en vez de .json, y los shards del cubo van en base64.
// ============================================================================

const Carga = (() => {
  const pendientes = new Map();   // evita pedir dos veces el mismo archivo

  // Inserta un <script> y resuelve cuando termina de ejecutarse. Si falla (red inestable,
  // OneDrive sin hidratar), se reintenta una vez y NO se deja el fallo en caché: así una caída
  // pasajera no deja el shard inservible hasta recargar la página.
  function script(src, intentos = 2) {
    if (pendientes.has(src)) return pendientes.get(src);
    const p = new Promise((resolver, rechazar) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => resolver();
      el.onerror = () => {
        el.remove(); pendientes.delete(src);
        if (intentos > 1) script(src, intentos - 1).then(resolver, rechazar);
        else rechazar(new Error('No se pudo cargar ' + src));
      };
      document.head.append(el);
    });
    pendientes.set(src, p);
    return p;
  }

  // Carga `src` y devuelve el global que ese archivo define
  async function global(src, nombre) {
    if (window[nombre] === undefined) await script(src);
    if (window[nombre] === undefined) {
      throw new Error(src + ' no definió ' + nombre);
    }
    return window[nombre];
  }

  // base64 → ArrayBuffer. atob da una cadena binaria; se copia byte a byte.
  function base64ABuffer(b64) {
    const bin = atob(b64);
    const buf = new ArrayBuffer(bin.length);
    const vista = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) vista[i] = bin.charCodeAt(i);
    return buf;
  }

  return { script, global, base64ABuffer };
})();
