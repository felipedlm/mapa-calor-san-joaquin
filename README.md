# San Joaquín Bajo el Sol · Mapa Interactivo de Calor

Proyecto del curso **GEO624 Empoderamiento Climático** (UC, 2026).
Mapa web que muestra la sensación de calor en distintos puntos del Campus San Joaquín y la relaciona con el tipo de superficie (concreto, asfalto, pasto) y la sombra.

> Mientras no haya mediciones reales, el mapa usa **datos de ejemplo** (inventados) y lo avisa con un recuadro amarillo.

---

## Qué hay en esta carpeta

```
Proyecto/
├── index.html                 ← la página del mapa
├── ver_mapa.bat               ← doble clic para abrir el mapa en tu computador
├── css/estilos.css            ← diseño
├── js/config.js               ← de dónde salen los datos (único archivo de configuración)
├── js/mapa.js                 ← lógica del mapa (Leaflet)
├── data/puntos.csv            ← los puntos fijos de medición
├── data/mediciones.csv        ← las mediciones (hoy: datos de ejemplo)
├── data/campus.geojson        ← edificios, áreas verdes, árboles y caminos (OpenStreetMap)
└── scripts/
    ├── descargar_osm.py       ← vuelve a descargar data/campus.geojson
    └── generar_datos_ejemplo.py ← crea mediciones falsas para probar
```

Herramientas: **Leaflet** (mapa), **OpenStreetMap** (mapa base y geometría del campus), imagen satelital de **Esri**, **PapaParse** (lee los CSV) y **Python** solo con la librería estándar (no hay que instalar nada).

---

## Ver el mapa en tu computador

Haz doble clic en **`ver_mapa.bat`**. Se abre el navegador en `http://localhost:8000`. Para cerrarlo, cierra la ventana negra.

(Si abres `index.html` directo con doble clic, el mapa sale vacío: los navegadores no dejan leer los CSV desde un archivo local. Por eso existe el `.bat`.)

Equivalente a mano, desde esta carpeta: `python -m http.server 8000`

---

## Cómo actualizar los datos

### Opción A — Editar el CSV (la más simple)

Cada fila de `data/mediciones.csv` es **una medición en un punto**:

| columna | qué va | ejemplo |
|---|---|---|
| `fecha` | AAAA-MM-DD | `2026-11-20` |
| `momento` | `manana`, `mediodia` o `tarde` | `mediodia` |
| `hora` | HH:MM (opcional) | `13:15` |
| `id_punto` | id del punto en `puntos.csv` | `P04` |
| `sensacion` | **1 a 7** (1 = fresco, 4 = neutro, 7 = muy caluroso) | `6` |
| `temp_aire_c` | temperatura en °C (opcional, se puede dejar vacía) | `29.5` |
| `medido_por` | quién midió (opcional) | `Josefa` |
| `notas` | comentario (opcional) | `mucho viento` |
| `ejemplo` | `si` solo para datos de prueba; vacío para datos reales | |

- **En GitHub**: abre `data/mediciones.csv` → ícono del lápiz → agrega filas al final → *Commit changes*. El mapa publicado se actualiza solo en ~1 minuto.
- **En Excel**: se puede, pero al guardar elige **"CSV UTF-8 (delimitado por comas)"**, si no se rompen las tildes. Ojo con que Excel no cambie los decimales a coma.

**Para pasar a datos reales:** borra todas las filas de ejemplo (deja solo la primera línea, los títulos) y agrega las tuyas. El aviso amarillo desaparece solo.

### Opción B — Google Form (para cargar desde el celular, en terreno)

1. Crea un Google Form con estas preguntas (los títulos pueden variar un poco; el mapa los reconoce por palabras clave):
   - **Punto de medición** (lista desplegable con opciones tipo `P01 - Acceso Metro San Joaquín`)
   - **Momento del día** (Mañana / Mediodía / Tarde)
   - **Sensación de calor (1 a 7)** (escala lineal 1–7)
   - **Temperatura** (respuesta corta, opcional)
   - **Nombre** (opcional)
2. En la planilla de respuestas: *Archivo → Compartir → Publicar en la web* → elegir la hoja de respuestas → formato **CSV** → Publicar. Copia el link.
3. Pega el link en `js/config.js`, en `MEDICIONES_GOOGLE_URL`.

Desde ahí, cada respuesta del formulario aparece en el mapa al recargarlo (Google puede demorar unos minutos en actualizar el CSV publicado). La fecha se toma de la "Marca temporal". El mapa suma las mediciones del formulario y las del CSV.

### Agregar o mover puntos de medición

Edita `data/puntos.csv`. Para saber las coordenadas, **haz clic en el mapa** donde va el punto: aparece `lat,lon` con un botón para copiar.

Columnas: `id` (P22, P23…), `nombre`, `lat`, `lon`, `zona`, `superficie` (`concreto`, `asfalto`, `pasto`, `mixto`, `tierra`), `sombra` (`sol`, `parcial`, `sombra`), `descripcion`.

Para revisar que ningún punto quedó encima de un edificio o fuera del campus: `python scripts/generar_datos_ejemplo.py` muestra avisos (**ojo: ese script también sobrescribe `mediciones.csv` con datos falsos**, úsenlo solo mientras estén en modo ejemplo).

---

## Publicar en GitHub Pages (link público y gratis)

1. Crea un repositorio público en GitHub (por ejemplo `mapa-calor-san-joaquin`).
2. Sube todo el contenido de esta carpeta (botón *Add file → Upload files*, arrastrando los archivos y carpetas).
3. En el repositorio: *Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)`* → Save.
4. En 1–2 minutos queda en `https://<tu-usuario>.github.io/mapa-calor-san-joaquin/`. Ese es el link para el grupo y la profesora.

Para que el resto del grupo pueda editar los datos: *Settings → Collaborators → Add people*.

---

## Qué muestra el mapa

- **Puntos de medición**: círculos con el promedio (sensación 1–7 o temperatura) según los filtros. Clic = detalle por momento del día.
- **Superficie interpolada (IDW)**: estima los valores entre puntos (ponderación por distancia inversa). Solo se pinta hasta ~110 m de un punto medido y dentro del campus, para no inventar zonas sin datos. Se ajusta en `js/config.js`.
- **Superficies del campus**: edificios, áreas verdes, árboles, caminos y estacionamientos de OpenStreetMap, para relacionar el calor con el entorno.
- **Filtros**: variable, momento del día y fecha.
- **Resumen**: promedio por tipo de superficie y por exposición al sol, y ranking de puntos más calurosos.
- Mapa base intercambiable: **Mapa** (OpenStreetMap) o **Satélite** (Esri).

## Flujo de datos (pipeline)

```
Medición en un punto fijo (sensación 1–7, opcional °C)
   → registro (CSV en GitHub o Google Form desde el celular)
   → el mapa lee los CSV al abrirse (Leaflet + PapaParse)
   → promedios por punto, superficie interpolada (IDW) recortada al campus
   → link público en GitHub Pages
   → comparación por tipo de superficie, sombra y momento del día
```

## Volver a descargar la geometría del campus

```
python scripts/descargar_osm.py
```

Consulta OpenStreetMap (Overpass API) y regenera `data/campus.geojson`. Si OSM mejora (más árboles o edificios mapeados), basta con correrlo de nuevo.

## Créditos y licencias

- Mapa base y geometría: © colaboradores de OpenStreetMap, licencia ODbL.
- Imagen satelital: Esri, Maxar, Earthstar Geographics.
- Leaflet (BSD-2), PapaParse (MIT).
