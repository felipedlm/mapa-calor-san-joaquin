// =====================================================================
//  Configuración del mapa. Es el único archivo que deberían tener que
//  tocar para cambiar de dónde salen los datos.
// =====================================================================
window.CONFIG = {
  // Puntos fijos de medición (id, nombre, lat, lon, zona, superficie, sombra, descripcion)
  PUNTOS_URL: "data/puntos.csv",

  // Mediciones (una fila por medición). Por defecto, el CSV del repositorio.
  MEDICIONES_URL: "data/mediciones.csv",

  // OPCIONAL: link "Publicar en la web > CSV" de la planilla de respuestas de un
  // Google Form. Si lo completan, el mapa lee las mediciones desde ahí (se
  // actualiza solo cada vez que alguien responde el formulario) y además suma
  // las del CSV del repositorio. Déjenlo vacío ("") para no usarlo.
  // Ejemplo: "https://docs.google.com/spreadsheets/d/e/XXXX/pub?gid=0&single=true&output=csv"
  MEDICIONES_GOOGLE_URL: "",

  // Geometría del campus descargada de OpenStreetMap (scripts/descargar_osm.py)
  CAMPUS_URL: "data/campus.geojson",

  // Interpolación IDW (superficie de calor entre puntos)
  IDW: {
    potencia: 2,         // más alto = cada punto influye más localmente
    distanciaMaxM: 110,   // no se pinta nada a más de esta distancia de un punto
    celdaM: 4,           // tamaño de cada celda de cálculo, en metros
  },
};
