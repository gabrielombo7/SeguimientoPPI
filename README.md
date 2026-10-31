# Tablero PPI v2 — sitio web estático

Versión web del tablero del Plan Plurianual de Inversiones: **HTML + CSS + JavaScript sin
dependencias y sin servidor** (ni R Shiny ni shinyapps.io). El tablero Shiny
(`../PPI-Tablero`) no se toca; esta carpeta es independiente y **la raíz es el sitio**.

## Cómo se abre

Doble clic en `index.html` (funciona desde el disco y desde OneDrive) o, para servirlo en local:

```bash
python3 -m http.server 7656
```

Para publicarlo se sube la carpeta completa (menos `pipeline/`) a cualquier hosting de archivos.
**En vivo**: GitHub Pages, desde el repo [`gabrielombo7/SeguimientoPPI`](https://github.com/gabrielombo7/SeguimientoPPI) —
<https://gabrielombo7.github.io/SeguimientoPPI/>. Publicar es `git push` a `main`: GitHub Pages
reconstruye el sitio solo, no hace falta correr nada aparte.

## Cómo se actualiza (4 pasos)

Los datos nacen en el pipeline de R (`01. Estimación`) y el sitio solo los lee:

```bash
# 1. PPI 2027-2030: consolida SGP + SGR + Territorio + Empresas Públicas
Rscript "2. PPI/2027-2030/00_master.R"
# 2. Tabla plana de los 5 gobiernos, cubo (con el per cápita) y validación
Rscript "4. Consolidar/00_master.R"
# 3. Desde esta carpeta: trae cubo, catálogos y deflactores a pipeline/insumos/
Rscript pipeline/actualizar_insumos.R
# 4. Regenera data/*.js (y sube el ?v= de index.html para romper la caché)
Rscript pipeline/exportar_web.R
```

Los catálogos de supuestos (deflactores del MFMP y población DANE) se arman una vez con
`1. Fuentes/Supuestos/Código/01_catalogos_supuestos.R` y quedan en
`1. Fuentes/Supuestos/`.

Las fechas de corte que se ven en Notas (SIIF, SGR, PGN Regionalizado) y las cifras de las notas 4,
6 y 8 de `meta.js` no viven en el Excel de interfaz: se arman en `pipeline/exportar_web.R` con
marcadores (`{PORT_C26}`, `{F23}`, `{F27}`…) que el mismo script rellena desde el cubo, protegidos
con un `stopifnot` que hace fallar el export si el marcador no aparece. Para cambiar ese texto, se
edita ahí (no en el Excel) y se respetan los marcadores.

## Reparto de trabajo y protocolo entre sesiones

Esta carpeta la tocan dos frentes en paralelo, cada uno responsable de lo suyo:

| Frente | Qué toca |
|---|---|
| **Datos y pipeline R** | `2. PPI` a `4. Consolidar/4. Publicar`, y aquí dentro `pipeline/actualizar_insumos.R`, `pipeline/exportar_web.R`, `pipeline/insumos/` y `data/` (generado) |
| **Visualización** | `assets/`, `index.html` y este README |

El contrato entre los dos es `data/meta.js` (sus campos) y la forma de los shards de `data/cubo/` y
`data/programas/`: si un lado cambia esa forma, avisa al otro antes de tocarla. Protocolo de export:
quien va a regenerar `data/` avisa antes (qué va a tocar) y después (qué cambió, con cifras), para no
pisar ediciones a medio hacer ni leer datos a medio escribir.

**Esta carpeta sí tiene git** (a diferencia de `01. Estimación`, que no lo usa): es el repo
`gabrielombo7/SeguimientoPPI`, publicado en GitHub Pages — ver «Cómo se abre». El resto de
`01. Estimación` (el pipeline de R) no tiene control de versiones; su historial de cambios vive en
`0. Documentación/Historial.md` (por ronda y fecha), no en `git log`.

## Capas de indicadores

| Capa | Dónde se calcula | Qué hace |
|---|---|---|
| **Per cápita** (post-tablero, 31-oct) | Navegador (`Cubo.recorrer` con `q.pc`) | `corriente × 1e9 ÷ población DANE` (`meta.poblacion`) del departamento y la vigencia de cada fila; sin departamento ÷ población nacional. Se compone con constantes; queda fuera de % del PIB y de los montos fijos. `Cubo.poblacionDisponible()` dice si ya hay población cargada |
| **Constantes** (post-tablero) | Navegador (`assets/js/medida.js` + `Cubo.recorrer`) | `corriente × índice[año base] ÷ índice[vigencia]` con el deflactor implícito del PIB del MFMP (`meta.deflactores`); el usuario escribe el año base |
| **Fuente específica** | R (`fuente_fondo` del cubo) + `visor.js` | desglose de UNA fuente elegida en «Fuentes»; clic filtra todo el visor; cruza con las líneas del PND |
| **Programa** | R (`programa` del cubo) + `visor.js`/`ppi_2027.js` | desglose de UN sector elegido en «Sectores»; solo existe desagregado junto a un sector (`programa ⊂ sector`), pero una vez fijado cruza con fuente, fuente específica, entidad, departamento, vigencia y líneas del PND. «Por gobierno»: clic filtra todo el visor, igual que Sectores. «Entre gobiernos»: el código es propio de cada gobierno (no comparable entre ellos), así que ahí sigue siendo informativa, comparando por nombre (`data/programas/`, `programas.js`) |

Las constantes dependen de un parámetro que elige el usuario (el año base), por eso se calculan en
el navegador y no en el cubo. El per cápita **no es aditivo por departamento** (el de dos
departamentos no es la suma de los dos): por eso con per cápita se elige un departamento a la vez.

Las constantes se calculan año a año (el `Totales` del cubo ya es una suma en corrientes y no se
puede deflactar con un solo factor). Con año base 2026 coinciden exactamente con el
`constante_2026` del cubo de R; los constantes de ejecución difieren ~0,1 % porque el pipeline de
ejecución todavía deflacta con el corte de junio (el sitio usa el de agosto; dato sin reverificar
tras la última ronda).

## Cómo se guardan los datos

El cubo nuevo (30-oct, 15 columnas) viaja **solo en corrientes** — constantes, % del PIB, per
cápita y las comparaciones se calculan del lado del tablero (ver «Capas de indicadores»); el sitio
exporta solo las filas alcanzables desde la interfaz. Cada fila son columnas de nivel (`Uint8`,
recompuestas a `Uint16` con un par `_lo`/`_hi` cuando una dimensión pasa de 255 valores distintos —
caso de `programa`) + un `Float64` en base64, y va **shardeada por gobierno**: al abrir solo se baja
el gobierno vigente. `Float64` y no `Float32` para que las cifras salgan idénticas a R.

Los datos son `.js` que asignan un global (no `.json`) porque los navegadores bloquean `fetch()`
sobre `file://`; por lo mismo el sitio usa scripts clásicos y no módulos ES.

**El cubo es «cerrado»**: sus marginales vienen pre-calculados y **no son la suma de las filas
finas** (p. ej. la ejecución por departamento va ~-25 % contra el gran total, brecha conocida de la
fuente). `cubo.js` solo **filtra** filas existentes; nunca deriva agregados sumando un nivel más fino.

## Estructura

```
index.html
assets/css/estilos.css      identidad DNP sin Bootstrap
assets/js/
  carga.js                  carga por <script> (funciona en file://; reintenta una vez)
  formato.js                formatos es-CO
  tema.js                   paleta DNP
  cubo.js                   motor de consulta + deflactación en el navegador
  medida.js                 medida (totales / per cápita) y unidad (corrientes / constantes) compartidas
  ui.js                     componentes (incluye UI.radio)
  graficas.js               gráficas SVG (dona, barras, lista, agrupadas, superpuestas)
  mapa.js                   mapa coroplético SVG
  descargas.js              CSV y PNG
  hojas/                    una por pestaña (inicio, visor, ppi_2027, descargar, iniciativas, notas)
  app.js                    navegación
data/                       GENERADO por pipeline/exportar_web.R (no editar)
descargas/                  PPI_2027-2030.csv — archivo ESTÁTICO (no lo genera exportar_web.R,
                             ver pipeline/exportar_base_wide.R), botón «Descargar base de datos» de ppi_2027.js
pipeline/
  actualizar_insumos.R      copia los insumos desde 4. Consolidar y 1. Fuentes/Supuestos
  exportar_web.R            convierte los insumos en data/*.js
  exportar_base_wide.R      arma descargas/PPI_2027-2030.csv desde 1. Consulta/Datos/PPI.xlsx —
                             PPI 2027-2030 sin transformar, misma estructura que en Consulta
                             (correr a mano cuando ese Excel cambie; no depende de exportar_web.R)
  insumos/                  cubo, catálogos, geo, iniciativas, Excel de interfaz (no se publica)
```

## Sin dependencias externas

Ni Bootstrap, plotly, leaflet ni ningún CDN de JavaScript: desplegables, gráficas, tablas y mapa
están escritos a mano (el mapa es SVG con la geometría ya proyectada desde R). Lo único externo es
la tipografía Space Grotesk de Google Fonts, con respaldo a la del sistema.

## Diferencias frente al Shiny

- **Ficha**: se imprime con el diálogo del navegador ("Guardar como PDF") en vez de generar un `.docx`.
- **Unidades**: corrientes y constantes de un año base elegido en pantalla (el Shiny ofrecía las
  bases fijas de cada gobierno). Además, medida per cápita y el gráfico de fuente específica.

## Verificación

Las cifras del sitio se compararon contra el cubo de R: gran total, per cápita (nacional y por
departamento), fuente específica y constantes (base 2026 igual a `constante_2026`, base 2015
recalculada independientemente). Todas coinciden a la precisión de `Float64`.

## Cambios del 6-oct (medidas y programas)
- **Constantes**: siempre con el deflactor implícito del PIB (MFMP); se quitó la opción de IPC. Se conserva la nota «En revisión».
- **% del PIB** (Visor): tercera opción de «Medida». Valor corriente ÷ PIB nominal del MFMP (`meta.pib_nominal`, de la hoja «Deflactor PIB» del archivo de
  deflactores; lo carga `1. Fuentes/Supuestos/Código/01_catalogos_supuestos.R`). No aplica al comparar dos indicadores del mismo gobierno ni en Descargar.
- **Sectores**: se muestran los 20 mayores + «Otros». **Programas**: caja que se abre al elegir UN sector (ver «Capas de indicadores» — desde el
  30-oct es dimensión real del cubo «Por gobierno»; `data/programas/`/`programas.js` quedan para la comparación «Entre gobiernos», informativa por nombre).
- **Colores**: Cooperación pasa a azul claro (`AZUL_CLARO` en `tema.js`).

## Cambios del 9-oct (portada, % del PIB, inflexible)
- **% del PIB — nueva regla**: valor en **constantes del año base** (deflactor implícito del PIB) ÷ **PIB nominal de ese mismo año** (`Cubo.pesosPib`; por defecto 2026).
  Mismo denominador en todos los gráficos, así cada año/departamento/sector/fuente suma al total (847.356.000 millones ctes 2026 ÷ 2.012.485.100 millones de PIB 2026 = 42,1 %).
  Por eso en «% del PIB» ya no se elige Corrientes/Constantes: solo el año base. El mapa muestra un solo porcentaje (el aporte al PIB) y la nota de regionalizado dice
  cuánto del total está en departamentos y cuánto es nacional.
- **Portada** = PPI más reciente con programación (hoy 2027-2030): `meta.totales_portada` (de `pipeline/exportar_web.R`), con y sin la inversión privada.
- **Monto inflexible**: nuevo indicador del Visor y de Descargar (solo PPI 2023-2026 trae dato); con «Planeado PPI» elegido el % de avance es el % inflexible.
- **Fuente específica del PGN**: «Inversión» / «Funcionamiento» (la cuota Nación/Propios queda solo en las bases de consulta, columna «Cuota PGN»).
- **Privados PPI 2023-2026**: fila fija de 949,7 billones (solo pie de Fuentes y fuente específica «Privados»; no está en el gran total ni en constantes).
- **10-oct**: Privados con amarillo propio (mostaza); Privados 2023-26 entra en constantes y % del PIB (monto en precios de 2022 convertido con el deflactor del PIB; `montos_fijos` en meta); fuente específica del PGN homologada (Inversión / Funcionamiento, incl. «Transferencias para Inversión» 2023-26); fuentes ordenadas de mayor a menor.

## Cambios del 30-oct (cubo nuevo de 15 columnas)
- **Cubo regenerado** contra `4. Consolidar/3. Cubo/Cubo/tabla_indicadores.rds` (pipeline de R): ejecución (Compromisos/Obligaciones/Pagos) llega partida en `_siif` (PGN con SIIF, sin departamento) y `_piip` (PGN con PIIP, con departamento) — antes esa regla vivía en el cubo de R, ahora la decide quien consulta (`indCubo()` en `cubo.js`/`ppi_2027.js`/`visor.js`: SIIF por defecto, PIIP cuando la consulta abre departamento). `corriente_pc` ya no existe: el per cápita se calcula en el navegador desde el 31-oct (ver «Capas de indicadores»).
- **`programa` es dimensión real del cubo** (antes vivía aparte, en `data/programas/`, sin cruzar con nada): cruza con fuente, fuente específica, entidad, departamento, vigencia y las líneas del PND, siempre que haya un sector elegido (`programa ⊂ sector`, igual que `entidad ⊂ PGN`). «Por gobierno»: la caja Programas filtra todo el visor, igual que Sectores. «Entre gobiernos»: el código de programa no es comparable entre gobiernos, así que ahí se sigue comparando por nombre con `data/programas/`/`programas.js` (informativa, sin cambios). `Cubo.etiqPrograma()`/`Cubo.codigoPrograma()` traducen código ↔ nombre por gobierno.
- **Fuente específica ya cruza con las líneas del PND** (el cubo nuevo lo trae; se quitó el aviso «sin cruce» que había en `ppi_2027.js`/`visor.js`).
- **Fix: Privados 2023-2026 no se sumaba en corrientes sin filtrar fuente.** El monto fijo de Privados (949,7 miles de millones corrientes) solo se inyectaba en constantes/%PIB; en corrientes, pedir la fuente puntual (`['Privados']`) sí lo traía (fila real del cubo), pero el total sin filtrar fuente (`'Total'`) no — daba el mismo número que «Sin privados». Corregido en `cubo.js` (`recorrer`): la inyección de montos fijos ahora se activa en corrientes solo cuando `fuente_general` queda sin acotar (`'Total'`, el caso que de verdad lo necesita) y, para esa fila, el filtro de `fuente_general`/`fuente_fondo` del monto fijo se trata como «sin acotar» en vez de exigir el valor literal `'Total'` (que nunca calzaría con la fuente real del monto, p. ej. `Privados`). Verificado: corrientes sin filtro 1.314.068,79 → 2.263.768,79 (= «Sin privados» + Privados exacto, sin doble conteo); constantes y % del PIB sin cambios; PPI 2027-2030 (sin monto fijo) sin cambios.

## Cambios del 31-oct (per cápita en el navegador, re-exportación)
- **Per cápita (Fase 3)**: ya no depende del cubo de R (`corriente_pc` no vuelve a existir); se calcula en el navegador con la población DANE (`meta.poblacion`, nueva en `data/meta.js`) — ver «Capas de indicadores». La caja Programas ya no bloquea per cápita «Por gobierno» (antes avisaba «sin per cápita por programa»: ya no aplica, programa cruza con departamento en el cubo nuevo); en «Entre gobiernos» sigue sin per cápita porque esa comparación lee el shard aparte de `programas.js`, sin población.
- **Re-exportación de datos** (pipeline): PPI 2027-2030 pasa de $2.733.498 a $3.089.863 sin filtros — ya incluye la inversión del PGN (antes solo traía funcionamiento). El aviso de cobertura de 2027-2030 todavía dice «falta la inversión del PGN»: por confirmar con el pipeline si ya debe actualizarse.
- **Fix: variación del mapa entre gobiernos no respetaba Constantes** (mismo bug que el KPI equivalente, corregido el 30-oct): en «Entre gobiernos», `pintarMapa()` siempre comparaba en corrientes; ahora usa la unidad activa (Constantes = crecimiento real), salvo en % del PIB, que se queda en corrientes por tener denominadores no comparables entre gobiernos.
