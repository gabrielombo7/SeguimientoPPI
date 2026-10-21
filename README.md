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

**Ya no hay control de versiones (git)** en esta carpeta ni en `01. Estimación`: el historial de
cambios vive en las bitácoras de `00. Documentación/` (por ronda y fecha), no en `git log`.

## Capas de indicadores

| Capa | Dónde se calcula | Qué hace |
|---|---|---|
| **Per cápita** (pre-tablero) | R, en el cubo (`tipo_valor = corriente_pc`) | pesos corrientes por habitante = monto ÷ población proyectada DANE del departamento y la vigencia; sin departamento ÷ población nacional; el cuatrienio suma los per cápita anuales |
| **Constantes** (post-tablero) | Navegador (`assets/js/medida.js` + `Cubo.recorrer`) | `corriente × índice[año base] ÷ índice[vigencia]` con el deflactor implícito del PIB del MFMP (`meta.deflactores`); el usuario escribe el año base |
| **Fuente específica** | R (`fuente_fondo` del cubo) + `visor.js` | desglose de UNA fuente elegida en «Fuentes»; clic filtra todo el visor |

Por qué el per cápita va en el cubo y las constantes no: el per cápita depende de la población
(un insumo que no cambia con el usuario), mientras que las constantes dependen de un parámetro que
sí elige el usuario (el año base). El per cápita **no es aditivo por departamento** (el de dos
departamentos no es la suma de los dos): por eso con per cápita se elige un departamento a la vez.

Las constantes se calculan año a año (el `Totales` del cubo ya es una suma en corrientes y no se
puede deflactar con un solo factor). Con año base 2026 coinciden exactamente con el
`constante_2026` del cubo de R; los constantes de ejecución difieren ~0,1 % porque el pipeline de
ejecución todavía deflacta con el corte de junio (el sitio usa el de agosto; dato sin reverificar
tras la última ronda).

## Cómo se guardan los datos

El cubo completo tiene ~2 M filas (con constantes y per cápita); el sitio exporta solo las
alcanzables desde la interfaz y solo las unidades `corriente` y `corriente_pc` (~1 M filas, 22 MB).
Cada fila son 9 columnas de nivel (`Uint8`) + relleno a 8 bytes + un `Float64` en base64, y va
**shardeada por gobierno × unidad**: al abrir solo se baja el gobierno vigente en corrientes; el
per cápita se baja al elegirlo. `Float64` y no `Float32` para que las cifras salgan idénticas a R.

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
  exportar_base_wide.R      arma descargas/PPI_2027-2030.csv desde 1. Consulta/datos_PPI.xlsx —
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
- **Sectores**: se muestran los 20 mayores + «Otros». **Programas**: caja nueva que se abre al elegir UN sector; shards propios en `data/programas/`
  (`pipeline/exportar_web.R`, sección 2b, desde `base_ppi.rds`), módulo `assets/js/programas.js`. Solo Planeado PPI, un gobierno a la vez; informativa.
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
