"""
Genera mediciones FALSAS (de ejemplo) para probar el mapa mientras no
haya mediciones reales.

Uso (desde la carpeta Proyecto):
    python scripts/generar_datos_ejemplo.py

Lee:     data/puntos.csv   (los puntos de medición)
Escribe: data/mediciones.csv  (¡sobrescribe el archivo!)

Cada fila generada lleva ejemplo=si, y el mapa muestra un aviso de
"datos de ejemplo" mientras exista alguna fila así. Cuando tengan
mediciones reales, borren estas filas (o el archivo completo) y
carguen las suyas.

La lógica del modelo falso es simple y está a la vista: la sensación
depende del momento del día, del tipo de superficie y de la sombra,
más un poco de ruido. No es un resultado, es solo para probar el mapa.

Además revisa que cada punto quede dentro del campus y no encima de
un edificio (usa data/campus.geojson si existe).
"""

import csv
import json
import random
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PUNTOS = RAIZ / "data" / "puntos.csv"
MEDICIONES = RAIZ / "data" / "mediciones.csv"
CAMPUS = RAIZ / "data" / "campus.geojson"

FECHAS = ["2026-11-10", "2026-11-12", "2026-11-14"]
MOMENTOS = {  # momento: (hora, sensación base 1-7, temperatura base °C)
    "manana": ("09:30", 2.6, 21.0),
    "mediodia": ("13:30", 4.9, 29.5),
    "tarde": ("16:30", 4.5, 30.5),
}
AJUSTE_SUPERFICIE = {"asfalto": 1.3, "concreto": 0.9, "mixto": 0.2, "tierra": 0.3, "pasto": -0.6}
AJUSTE_SOMBRA = {"sol": 0.0, "parcial": -0.7, "sombra": -1.5}
INTEGRANTES = ["Felipe", "Magdalena", "Josefa", "Nicolás"]

COLUMNAS = ["fecha", "momento", "hora", "id_punto", "sensacion", "temp_aire_c",
            "medido_por", "notas", "ejemplo"]


def punto_en_poligono(lon, lat, anillo):
    dentro, j = False, len(anillo) - 1
    for i in range(len(anillo)):
        xi, yi = anillo[i]
        xj, yj = anillo[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            dentro = not dentro
        j = i
    return dentro


def revisar_ubicaciones(puntos):
    if not CAMPUS.exists():
        print("(No está data/campus.geojson; me salto la revisión de ubicaciones.)")
        return
    feats = json.loads(CAMPUS.read_text(encoding="utf-8"))["features"]
    limite = next((f for f in feats if f["properties"]["categoria"] == "limite_campus"), None)
    edificios = [f for f in feats if f["properties"]["categoria"] == "edificio"
                 and f["geometry"]["type"] == "Polygon"]
    for p in puntos:
        lat, lon = float(p["lat"]), float(p["lon"])
        if limite and not punto_en_poligono(lon, lat, limite["geometry"]["coordinates"][0]):
            print(f"  Aviso: {p['id']} ({p['nombre']}) queda fuera del límite del campus.")
        for e in edificios:
            if punto_en_poligono(lon, lat, e["geometry"]["coordinates"][0]):
                nombre = e["properties"]["nombre"] or "un edificio sin nombre"
                print(f"  Aviso: {p['id']} ({p['nombre']}) cae dentro de {nombre}.")
                break


def main():
    with PUNTOS.open(encoding="utf-8-sig", newline="") as f:
        puntos = list(csv.DictReader(f))
    print(f"{len(puntos)} puntos leídos de {PUNTOS.name}")
    revisar_ubicaciones(puntos)

    rng = random.Random(624)  # semilla fija: siempre genera los mismos datos
    filas = []
    for fecha in FECHAS:
        dia = rng.uniform(-0.4, 0.6)  # algunos días son más calurosos
        for momento, (hora, base, temp_base) in MOMENTOS.items():
            for p in puntos:
                ajuste = AJUSTE_SUPERFICIE.get(p["superficie"], 0) + AJUSTE_SOMBRA.get(p["sombra"], 0)
                if momento == "manana":
                    ajuste *= 0.5  # en la mañana las diferencias son menores
                s = base + dia + ajuste + rng.gauss(0, 0.45)
                t = temp_base + 2 * dia + 1.6 * ajuste + rng.gauss(0, 0.6)
                filas.append({
                    "fecha": fecha,
                    "momento": momento,
                    "hora": hora,
                    "id_punto": p["id"],
                    "sensacion": max(1, min(7, round(s))),
                    "temp_aire_c": f"{t:.1f}",
                    "medido_por": rng.choice(INTEGRANTES),
                    "notas": "",
                    "ejemplo": "si",
                })

    with MEDICIONES.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNAS)
        w.writeheader()
        w.writerows(filas)
    print(f"{len(filas)} mediciones de ejemplo escritas en {MEDICIONES}")


if __name__ == "__main__":
    main()
