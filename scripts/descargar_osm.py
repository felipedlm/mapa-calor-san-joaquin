"""
Descarga la geometría del Campus San Joaquín (UC) desde OpenStreetMap
y la guarda como GeoJSON para usarla en el mapa.

Uso (desde la carpeta Proyecto):
    python scripts/descargar_osm.py

Genera:
    data/campus.geojson   -> límite del campus, edificios, áreas verdes,
                             árboles, caminos, estacionamientos y canchas

Solo usa la librería estándar de Python (no hay que instalar nada).
Datos © colaboradores de OpenStreetMap (licencia ODbL).
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
HEADERS = {"User-Agent": "GEO624-mapa-calor-san-joaquin/1.0 (proyecto universitario)"}

# Punto aproximado del campus, para encontrar su polígono
CENTRO = (-33.4985, -70.6120)
SALIDA = Path(__file__).resolve().parent.parent / "data" / "campus.geojson"


def overpass(query: str) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    ultimo_error = None
    for url in OVERPASS_URLS:
        for intento in range(2):
            try:
                req = urllib.request.Request(url, data=body, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=120) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:  # servidor ocupado, timeout, etc.
                ultimo_error = e
                time.sleep(3)
    raise RuntimeError(f"No se pudo consultar Overpass: {ultimo_error}")


def buscar_campus() -> dict:
    lat, lon = CENTRO
    q = f"""
    [out:json][timeout:90];
    (
      way["amenity"="university"](around:2000,{lat},{lon});
      relation["amenity"="university"](around:2000,{lat},{lon});
    );
    out tags geom;
    """
    data = overpass(q)
    candidatos = [e for e in data["elements"] if "san joaqu" in e.get("tags", {}).get("name", "").lower()]
    if not candidatos:
        nombres = [e.get("tags", {}).get("name") for e in data["elements"]]
        raise RuntimeError(f"No encontré el campus. Universidades cercanas: {nombres}")
    return candidatos[0]


def anillos(elemento: dict) -> list:
    """Devuelve la lista de anillos exteriores [[lon, lat], ...] de un way o relation."""
    if elemento["type"] == "way":
        return [[[p["lon"], p["lat"]] for p in elemento["geometry"]]]
    out = []
    for m in elemento.get("members", []):
        if m.get("role") in ("outer", "") and "geometry" in m:
            out.append([[p["lon"], p["lat"]] for p in m["geometry"]])
    return out


def categoria(tags: dict) -> str | None:
    if "building" in tags:
        return "edificio"
    if tags.get("natural") == "tree":
        return "arbol"
    if tags.get("natural") == "tree_row":
        return "hilera_arboles"
    if tags.get("leisure") == "pitch":
        return "cancha"
    if tags.get("amenity") == "parking" or tags.get("parking"):
        return "estacionamiento"
    if (
        tags.get("landuse") in ("grass", "forest", "meadow", "village_green", "flowerbed")
        or tags.get("leisure") in ("park", "garden")
        or tags.get("natural") in ("wood", "scrub", "grassland")
    ):
        return "verde"
    if tags.get("highway") in ("footway", "path", "pedestrian", "steps", "cycleway", "service", "living_street"):
        return "camino"
    return None


def a_feature(e: dict, cat: str) -> dict | None:
    tags = e.get("tags", {})
    props = {"categoria": cat, "nombre": tags.get("name", ""), "osm_id": f"{e['type']}/{e['id']}"}
    if e["type"] == "node":
        return {"type": "Feature", "properties": props,
                "geometry": {"type": "Point", "coordinates": [e["lon"], e["lat"]]}}
    rings = anillos(e)
    if not rings:
        return None
    lineal = cat in ("camino", "hilera_arboles")
    if lineal:
        return {"type": "Feature", "properties": props,
                "geometry": {"type": "LineString", "coordinates": rings[0]}}
    polys = [[r] for r in rings if len(r) >= 4 and r[0] == r[-1]]
    if not polys:
        return None
    geom = {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1 else \
           {"type": "MultiPolygon", "coordinates": polys}
    return {"type": "Feature", "properties": props, "geometry": geom}


def punto_en_poligono(lon: float, lat: float, anillo: list) -> bool:
    """Ray casting: ¿está el punto dentro del anillo?"""
    dentro = False
    j = len(anillo) - 1
    for i in range(len(anillo)):
        xi, yi = anillo[i]
        xj, yj = anillo[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            dentro = not dentro
        j = i
    return dentro


def dentro_del_campus(feature: dict, anillo: list) -> bool:
    """Un elemento cuenta si alguno de sus vértices cae dentro del límite del campus."""
    g = feature["geometry"]
    if g["type"] == "Point":
        pts = [g["coordinates"]]
    elif g["type"] == "LineString":
        pts = g["coordinates"]
    elif g["type"] == "Polygon":
        pts = g["coordinates"][0]
    else:
        pts = [p for poly in g["coordinates"] for p in poly[0]]
    return any(punto_en_poligono(x, y, anillo) for x, y in pts)


def main() -> None:
    print("Buscando el polígono del campus en OpenStreetMap...")
    campus = buscar_campus()
    print(f"  Encontrado: {campus['tags'].get('name')} ({campus['type']}/{campus['id']})")

    limite_anillo = anillos(campus)[0]
    lats = [p[1] for p in limite_anillo]
    lons = [p[0] for p in limite_anillo]
    bbox = f"{min(lats)},{min(lons)},{max(lats)},{max(lons)}"
    q = f"""
    [out:json][timeout:120][bbox:{bbox}];
    (
      way["building"];
      relation["building"];
      way["landuse"~"grass|forest|meadow|village_green|flowerbed"];
      way["leisure"~"park|garden|pitch"];
      relation["leisure"~"park|garden"];
      way["natural"~"wood|scrub|grassland|tree_row"];
      node["natural"="tree"];
      way["highway"~"footway|path|pedestrian|steps|cycleway|service|living_street"];
      way["amenity"="parking"];
    );
    out tags geom;
    """
    print("Descargando edificios, áreas verdes, árboles y caminos...")
    data = overpass(q)

    features = []
    limite = a_feature(campus, "limite_campus")
    if limite:
        features.append(limite)
    conteo: dict[str, int] = {}
    for e in data["elements"]:
        cat = categoria(e.get("tags", {}))
        if not cat:
            continue
        f = a_feature(e, cat)
        if f and dentro_del_campus(f, limite_anillo):
            features.append(f)
            conteo[cat] = conteo.get(cat, 0) + 1

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    geojson = {
        "type": "FeatureCollection",
        "attribution": "© colaboradores de OpenStreetMap (ODbL)",
        "features": features,
    }
    SALIDA.write_text(json.dumps(geojson, ensure_ascii=False), encoding="utf-8")
    print(f"Listo: {SALIDA}")
    for k, v in sorted(conteo.items()):
        print(f"  {k}: {v}")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(f"Error: {err}", file=sys.stderr)
        sys.exit(1)
