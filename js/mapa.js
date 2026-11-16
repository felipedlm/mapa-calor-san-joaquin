/* =====================================================================
   San Joaquín Bajo el Sol — Mapa interactivo de calor
   Leaflet + OpenStreetMap. Lee los datos desde CSV (ver js/config.js).
   ===================================================================== */
(() => {
  "use strict";

  const C = window.CONFIG;

  // Escala divergente de 7 pasos: azul (fresco) → gris neutro (4) → rojo (caluroso)
  const ESCALA = ["#1c5cab", "#3987e5", "#9ec5f4", "#f0efec", "#f2a39b", "#e34948", "#a32a2b"];

  const ETQ_MOMENTO = { manana: "Mañana", mediodia: "Mediodía", tarde: "Tarde" };
  const ETQ_SUPERFICIE = { asfalto: "Asfalto", concreto: "Concreto", mixto: "Mixto", tierra: "Tierra", pasto: "Pasto" };
  const ETQ_SOMBRA = { sol: "Pleno sol", parcial: "Sombra parcial", sombra: "Sombra" };

  const estado = {
    variable: "sensacion",
    momento: "todos",
    fecha: "todas",
    puntos: [],        // [{id, nombre, lat, lon, zona, superficie, sombra, descripcion}]
    mediciones: [],    // [{id, fecha, momento, hora, sensacion, temp, medido_por, notas, ejemplo}]
    limite: null,      // anillo [[lon, lat], ...] del campus
    dominioTemp: [20, 32],
  };

  // ------------------------------------------------------------------
  //  Mapa base
  // ------------------------------------------------------------------
  const mapa = L.map("mapa", { zoomControl: true, zoomSnap: 0.25, minZoom: 14, maxZoom: 20 }).setView([-33.4985, -70.611], 17);

  const baseOSM = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20, maxNativeZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>',
  });
  const baseSat = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 20, maxNativeZoom: 19, attribution: "Imagen &copy; Esri, Maxar, Earthstar Geographics" }
  );
  baseOSM.addTo(mapa);
  L.control.layers({ "Mapa": baseOSM, "Satélite": baseSat }, null, { position: "topright", collapsed: false }).addTo(mapa);
  L.control.scale({ imperial: false }).addTo(mapa);

  mapa.createPane("campus").style.zIndex = 350;
  const paneIdw = mapa.createPane("idw");
  paneIdw.style.zIndex = 380;
  paneIdw.style.pointerEvents = "none";

  const renderCampus = L.canvas({ pane: "campus" });
  const capaCampus = L.layerGroup();
  const capaPuntos = L.layerGroup();
  let capaIDW = null;
  const marcadores = new Map();

  // ------------------------------------------------------------------
  //  Utilidades
  // ------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const num = (v) => {
    if (v === null || v === undefined || String(v).trim() === "") return NaN;
    return parseFloat(String(v).replace(",", "."));
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const promedio = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);

  function hexARgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const ESCALA_RGB = ESCALA.map(hexARgb);

  // t en [0, 1] → color [r, g, b] interpolado en la escala
  function colorEscala(t) {
    t = Math.max(0, Math.min(1, t));
    const x = t * (ESCALA_RGB.length - 1);
    const i = Math.min(Math.floor(x), ESCALA_RGB.length - 2);
    const f = x - i;
    const a = ESCALA_RGB[i], b = ESCALA_RGB[i + 1];
    return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
  }
  function normalizar(v, variable = estado.variable) {
    if (variable === "sensacion") return (v - 1) / 6;
    const [lo, hi] = estado.dominioTemp;
    return (v - lo) / (hi - lo || 1);
  }
  const rgbCss = (rgb) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const colorValor = (v, variable) => colorEscala(normalizar(v, variable));
  function tintaSobre(rgb) {
    const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    return lum > 0.6 ? "#0b0b0b" : "#ffffff";
  }
  function formato(v, variable = estado.variable) {
    if (!Number.isFinite(v)) return "–";
    return variable === "sensacion" ? v.toFixed(1) : `${v.toFixed(1)}°`;
  }
  const fechaBonita = (iso) => {
    const [y, m, d] = iso.split("-");
    return `${d}-${m}-${y}`;
  };

  // ------------------------------------------------------------------
  //  Carga y normalización de datos
  // ------------------------------------------------------------------
  async function cargarTexto(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
    return r.text();
  }
  async function cargarCSV(url) {
    const txt = await cargarTexto(url);
    return Papa.parse(txt, { header: true, skipEmptyLines: true }).data;
  }

  function normalizarPunto(f) {
    const p = {};
    for (const [k, v] of Object.entries(f)) p[sinTildes(k)] = typeof v === "string" ? v.trim() : v;
    const lat = num(p.lat), lon = num(p.lon);
    if (!p.id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      id: p.id.toUpperCase(), nombre: p.nombre || p.id, lat, lon,
      zona: p.zona || "", superficie: sinTildes(p.superficie), sombra: sinTildes(p.sombra),
      descripcion: p.descripcion || "",
    };
  }

  function aFechaISO(s) {
    s = String(s ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/); // dd/mm/aaaa (formato de Google en Chile)
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
  }
  function aHora(s) {
    const m = String(s ?? "").match(/(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
  }
  function aMomento(valor, hora) {
    const v = sinTildes(valor);
    if (v.startsWith("man")) return "manana";
    if (v.startsWith("medio")) return "mediodia";
    if (v.startsWith("tard")) return "tarde";
    if (hora) {
      const [h, m] = hora.split(":").map(Number);
      const x = h + m / 60;
      return x < 11.5 ? "manana" : x < 15 ? "mediodia" : "tarde";
    }
    return "";
  }

  // Acepta tanto el CSV del repositorio como las columnas de un Google Form
  // (por ejemplo "Punto de medición", "Sensación de calor (1 a 7)", "Marca temporal").
  function normalizarMedicion(f) {
    const r = {};
    for (const [k, v] of Object.entries(f)) {
      const c = sinTildes(k);
      if (c.includes("sensacion")) r.sensacion = v;
      else if (c.includes("temp")) r.temp = v;
      else if (c.includes("momento")) r.momento = v;
      else if (c.includes("marca temporal") || c === "timestamp") r.marca = v;
      else if (c.includes("fecha")) r.fecha = v;
      else if (c === "hora") r.hora = v;
      else if (c.includes("medido") || c.includes("nombre")) r.medido_por = v;
      else if (c === "ejemplo") r.ejemplo = v;
      else if (c.includes("nota") || c.includes("comentario")) r.notas = v;
      else if (c.includes("punto")) r.punto = v;
    }
    const textoPunto = String(r.punto ?? "").trim();
    const m = textoPunto.match(/\bP\d+\b/i);
    const id = (m ? m[0] : textoPunto.split(" - ")[0]).toUpperCase();
    const fecha = aFechaISO(r.fecha) || aFechaISO(r.marca);
    const hora = aHora(r.hora) || aHora(r.marca);
    const sensacion = num(r.sensacion);
    const temp = num(r.temp);
    if (!id || (!Number.isFinite(sensacion) && !Number.isFinite(temp))) return null;
    return {
      id, fecha, hora, momento: aMomento(r.momento, hora),
      sensacion: Number.isFinite(sensacion) ? Math.max(1, Math.min(7, sensacion)) : NaN,
      temp, medido_por: r.medido_por || "", notas: r.notas || "",
      ejemplo: ["si", "sí", "true", "1", "x"].includes(sinTildes(r.ejemplo)),
    };
  }

  async function cargarDatos() {
    const fuentes = [];
    const errores = [];

    try {
      estado.puntos = (await cargarCSV(C.PUNTOS_URL)).map(normalizarPunto).filter(Boolean);
    } catch (e) {
      errores.push(`No pude leer los puntos (${e.message}).`);
    }

    const urls = [C.MEDICIONES_URL, C.MEDICIONES_GOOGLE_URL].filter(Boolean);
    const resultados = await Promise.allSettled(urls.map(cargarCSV));
    resultados.forEach((res, i) => {
      if (res.status === "fulfilled") {
        const filas = res.value.map(normalizarMedicion).filter(Boolean);
        estado.mediciones.push(...filas);
        fuentes.push(urls[i] === C.MEDICIONES_GOOGLE_URL ? "Google Form" : "CSV del repositorio");
      } else {
        errores.push(`No pude leer ${urls[i] === C.MEDICIONES_GOOGLE_URL ? "la planilla de Google" : urls[i]}.`);
      }
    });

    try {
      const campus = JSON.parse(await cargarTexto(C.CAMPUS_URL));
      dibujarCampus(campus);
    } catch (e) {
      errores.push("No pude leer la geometría del campus (data/campus.geojson).");
    }

    // Descarta mediciones de puntos que no existen en puntos.csv
    const ids = new Set(estado.puntos.map((p) => p.id));
    const huerfanas = estado.mediciones.filter((m) => !ids.has(m.id));
    if (huerfanas.length) {
      const lista = [...new Set(huerfanas.map((m) => m.id))].slice(0, 5).join(", ");
      errores.push(`${huerfanas.length} mediciones apuntan a puntos que no están en puntos.csv (${lista}).`);
      estado.mediciones = estado.mediciones.filter((m) => ids.has(m.id));
    }

    if (errores.length) {
      let msg = errores.map(esc).join("<br>");
      if (location.protocol === "file:") {
        msg = "<strong>Abriste el archivo directamente.</strong> El navegador no deja leer los CSV así: "
          + "abre el mapa con <code>ver_mapa.bat</code> o desde el link de GitHub Pages.<br><br>" + msg;
      }
      $("aviso-error").innerHTML = msg;
      $("aviso-error").hidden = false;
    }
    return fuentes;
  }

  // ------------------------------------------------------------------
  //  Capa del campus (OSM)
  // ------------------------------------------------------------------
  const ESTILO_CAMPUS = {
    edificio: { color: "#7f7a70", weight: 0.6, fillColor: "#a29d93", fillOpacity: 0.55 },
    verde: { color: "#5f9e4f", weight: 0.4, fillColor: "#9fd18f", fillOpacity: 0.5 },
    cancha: { color: "#5f9e4f", weight: 0.4, fillColor: "#b9dfa9", fillOpacity: 0.45 },
    estacionamiento: { color: "#5d5b56", weight: 0.4, fillColor: "#7d7b76", fillOpacity: 0.3 },
    camino: { color: "#8c877c", weight: 1, opacity: 0.45 },
    hilera_arboles: { color: "#2f7d32", weight: 3, opacity: 0.5 },
    limite_campus: { color: "#0b0b0b", weight: 1.5, dashArray: "5 5", fill: false, opacity: 0.6 },
  };

  function dibujarCampus(geojson) {
    const orden = ["limite_campus", "verde", "cancha", "estacionamiento", "camino", "hilera_arboles", "edificio", "arbol"];
    const feats = [...geojson.features].sort(
      (a, b) => orden.indexOf(a.properties.categoria) - orden.indexOf(b.properties.categoria)
    );
    const limite = feats.find((f) => f.properties.categoria === "limite_campus");
    if (limite && limite.geometry.type === "Polygon") estado.limite = limite.geometry.coordinates[0];

    L.geoJSON({ type: "FeatureCollection", features: feats }, {
      renderer: renderCampus,
      pane: "campus",
      style: (f) => ESTILO_CAMPUS[f.properties.categoria] || { weight: 0.5 },
      pointToLayer: (f, latlng) => L.circleMarker(latlng, {
        renderer: renderCampus, pane: "campus", radius: 2.2,
        color: "#2f7d32", weight: 0, fillColor: "#2f7d32", fillOpacity: 0.65, interactive: false,
      }),
      interactive: true,
      onEachFeature: (f, capa) => {
        const n = f.properties.nombre;
        if (n && f.properties.categoria === "edificio") capa.bindTooltip(esc(n), { sticky: true, className: "tip-punto" });
      },
    }).addTo(capaCampus);
  }

  // ------------------------------------------------------------------
  //  Cálculos sobre las mediciones filtradas
  // ------------------------------------------------------------------
  const valorDe = (m, variable = estado.variable) => (variable === "sensacion" ? m.sensacion : m.temp);

  function filtradas({ ignorarMomento = false, variable = estado.variable } = {}) {
    return estado.mediciones.filter((m) =>
      (estado.fecha === "todas" || m.fecha === estado.fecha) &&
      (ignorarMomento || estado.momento === "todos" || m.momento === estado.momento) &&
      Number.isFinite(valorDe(m, variable))
    );
  }

  function promedioPorPunto(meds, variable = estado.variable) {
    const grupos = new Map();
    for (const m of meds) {
      if (!grupos.has(m.id)) grupos.set(m.id, []);
      grupos.get(m.id).push(valorDe(m, variable));
    }
    const out = new Map();
    for (const [id, vals] of grupos) out.set(id, { prom: promedio(vals), n: vals.length });
    return out;
  }

  // ------------------------------------------------------------------
  //  Puntos
  // ------------------------------------------------------------------
  function contenidoPopup(p) {
    const meds = filtradas({ ignorarMomento: true, variable: "sensacion" }).filter((m) => m.id === p.id);
    const medsT = filtradas({ ignorarMomento: true, variable: "temp" }).filter((m) => m.id === p.id);
    const actual = promedioPorPunto(filtradas()).get(p.id);
    const filas = Object.entries(ETQ_MOMENTO).map(([k, etq]) => {
      const s = meds.filter((m) => m.momento === k).map((m) => m.sensacion);
      const t = medsT.filter((m) => m.momento === k).map((m) => m.temp);
      return `<tr><td>${etq}</td><td class="num">${formato(promedio(s), "sensacion")}</td>`
        + `<td class="num">${t.length ? promedio(t).toFixed(1) + " °C" : "–"}</td><td class="num">${s.length || t.length}</td></tr>`;
    }).join("");
    const etqs = [ETQ_SUPERFICIE[p.superficie] || p.superficie, ETQ_SOMBRA[p.sombra] || p.sombra]
      .filter(Boolean).map((t) => `<span class="etq">${esc(t)}</span>`).join("");
    const unidad = estado.variable === "sensacion" ? " / 7" : "";
    return `<div class="pop">
      <h3>${esc(p.nombre)}</h3>
      <div class="meta">${esc(p.id)}${p.zona ? " · " + esc(p.zona) : ""}</div>
      <div class="etiquetas">${etqs}</div>
      <p style="margin:0 0 8px">Promedio con los filtros actuales:<br>
        <span class="grande">${actual ? formato(actual.prom) : "sin datos"}</span>${actual ? unidad + ` · ${actual.n} mediciones` : ""}</p>
      <table><thead><tr><th>Momento</th><th class="num">Sensación</th><th class="num">Temp.</th><th class="num">n</th></tr></thead>
      <tbody>${filas}</tbody></table>
      ${p.descripcion ? `<p class="meta" style="margin:8px 0 0">${esc(p.descripcion)}</p>` : ""}
    </div>`;
  }

  function dibujarPuntos() {
    capaPuntos.clearLayers();
    marcadores.clear();
    const stats = promedioPorPunto(filtradas());
    for (const p of estado.puntos) {
      const s = stats.get(p.id);
      let html;
      if (s) {
        const rgb = colorValor(s.prom);
        html = `<div class="marcador" style="background:${rgbCss(rgb)};color:${tintaSobre(rgb)}">${formato(s.prom)}</div>`;
      } else {
        html = `<div class="marcador sin-datos">–</div>`;
      }
      const icono = L.divIcon({ html, className: "icono-punto", iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -14] });
      const mk = L.marker([p.lat, p.lon], { icon: icono, riseOnHover: true, keyboard: true, title: p.nombre })
        .bindTooltip(`${esc(p.id)} · ${esc(p.nombre)}`, { direction: "top", offset: [0, -16], className: "tip-punto" })
        .bindPopup(() => contenidoPopup(p), { maxWidth: 300 });
      mk.addTo(capaPuntos);
      marcadores.set(p.id, mk);
    }
  }

  // ------------------------------------------------------------------
  //  Superficie interpolada (IDW) recortada al límite del campus
  // ------------------------------------------------------------------
  function puntoEnPoligono(lon, lat, anillo) {
    let dentro = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }

  function dibujarIDW() {
    if (capaIDW) { capaIDW.remove(); capaIDW = null; }
    if (!$("chk-idw").checked) return;

    const stats = promedioPorPunto(filtradas());
    const datos = estado.puntos.filter((p) => stats.has(p.id)).map((p) => ({ lat: p.lat, lon: p.lon, v: stats.get(p.id).prom }));
    if (datos.length < 2) return;

    // Extensión: el campus completo (o los puntos, si no hay límite)
    let lats, lons;
    if (estado.limite) { lats = estado.limite.map((c) => c[1]); lons = estado.limite.map((c) => c[0]); }
    else { lats = datos.map((d) => d.lat); lons = datos.map((d) => d.lon); }
    const pad = 0.0004;
    const S = Math.min(...lats) - pad, N = Math.max(...lats) + pad;
    const W = Math.min(...lons) - pad, E = Math.max(...lons) + pad;

    const lat0 = (S + N) / 2;
    const mLat = 111320, mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const { potencia, distanciaMaxM, celdaM } = C.IDW;
    const cols = Math.ceil(((E - W) * mLon) / celdaM);
    const filas = Math.ceil(((N - S) * mLat) / celdaM);

    const lienzo = document.createElement("canvas");
    lienzo.width = cols; lienzo.height = filas;
    const ctx = lienzo.getContext("2d");
    const img = ctx.createImageData(cols, filas);
    const pts = datos.map((d) => ({ x: (d.lon - W) * mLon, y: (N - d.lat) * mLat, v: d.v }));

    for (let r = 0; r < filas; r++) {
      const y = (r + 0.5) * celdaM;
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * celdaM;
        let sw = 0, swv = 0, dmin = Infinity, exacto = null;
        for (const p of pts) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < dmin) dmin = d;
          if (d < 0.5) { exacto = p.v; break; }
          const w = 1 / Math.pow(d, potencia);
          sw += w; swv += w * p.v;
        }
        if (dmin > distanciaMaxM) continue;
        const v = exacto ?? swv / sw;
        // se desvanece en el último 40 % del radio máximo
        const borde = distanciaMaxM * 0.6;
        const alfa = dmin <= borde ? 1 : 1 - (dmin - borde) / (distanciaMaxM - borde);
        const rgb = colorValor(v);
        const k = (r * cols + c) * 4;
        img.data[k] = rgb[0]; img.data[k + 1] = rgb[1]; img.data[k + 2] = rgb[2];
        img.data[k + 3] = Math.round(alfa * 0.62 * 255);
      }
    }
    ctx.putImageData(img, 0, 0);

    if (estado.limite) {
      ctx.globalCompositeOperation = "destination-in";
      ctx.beginPath();
      estado.limite.forEach(([lon, lat], i) => {
        const px = ((lon - W) * mLon) / celdaM, py = ((N - lat) * mLat) / celdaM;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
    }

    capaIDW = L.imageOverlay(lienzo.toDataURL(), [[S, W], [N, E]], { pane: "idw", interactive: false }).addTo(mapa);
  }

  // ------------------------------------------------------------------
  //  Panel: leyenda, resúmenes y ranking
  // ------------------------------------------------------------------
  function dibujarLeyenda() {
    const cont = $("leyenda");
    if (estado.variable === "sensacion") {
      $("titulo-leyenda").textContent = "Sensación de calor";
      const celdas = [1, 2, 3, 4, 5, 6, 7].map((v) => {
        const rgb = colorValor(v, "sensacion");
        return `<div style="background:${rgbCss(rgb)};color:${tintaSobre(rgb)}">${v}</div>`;
      }).join("");
      cont.innerHTML = `<div class="escala">${celdas}</div>
        <div class="escala-extremos"><span>Fresco</span><span>Neutro</span><span>Muy caluroso</span></div>`;
    } else {
      $("titulo-leyenda").textContent = "Temperatura del aire";
      const [lo, hi] = estado.dominioTemp;
      const pasos = ESCALA.map((c, i) => `${c} ${(i / (ESCALA.length - 1)) * 100}%`).join(",");
      cont.innerHTML = `<div class="gradiente" style="background:linear-gradient(90deg,${pasos})"></div>
        <div class="escala-extremos"><span>${lo} °C</span><span>${(lo + hi) / 2} °C</span><span>${hi} °C</span></div>
        <p class="tip" style="margin:6px 0 0;font-size:12px;color:var(--tinta-suave)">La escala se ajusta a los valores del filtro elegido.</p>`;
    }
  }

  function barras(cont, titulo, grupos, etiquetas) {
    const filas = Object.entries(grupos)
      .map(([k, vals]) => ({ k, prom: promedio(vals), n: vals.length }))
      .sort((a, b) => b.prom - a.prom);
    if (!filas.length) { cont.innerHTML = ""; return; }
    const maximo = estado.variable === "sensacion" ? 7 : Math.ceil(estado.dominioTemp[1] / 5) * 5;
    cont.innerHTML = `<div class="barras-titulo">${titulo}</div>` + filas.map((f) => {
      const rgb = colorValor(f.prom);
      const ancho = Math.max(2, (f.prom / maximo) * 100);
      return `<div class="barra" title="${f.n} mediciones">
        <span class="etiqueta">${esc(etiquetas[f.k] || f.k || "Sin dato")}</span>
        <span class="riel"><span class="relleno" style="display:block;width:${ancho}%;background:${rgbCss(rgb)}"></span></span>
        <span class="valor">${formato(f.prom)}</span></div>`;
    }).join("");
  }

  function dibujarResumen() {
    const porId = new Map(estado.puntos.map((p) => [p.id, p]));
    const sup = {}, som = {};
    for (const m of filtradas()) {
      const p = porId.get(m.id);
      if (!p) continue;
      (sup[p.superficie] ||= []).push(valorDe(m));
      (som[p.sombra] ||= []).push(valorDe(m));
    }
    barras($("resumen-superficie"), "Por superficie", sup, ETQ_SUPERFICIE);
    barras($("resumen-sombra"), "Por exposición al sol", som, ETQ_SOMBRA);
  }

  function dibujarRanking() {
    const stats = promedioPorPunto(filtradas());
    const top = estado.puntos.filter((p) => stats.has(p.id))
      .sort((a, b) => stats.get(b.id).prom - stats.get(a.id).prom).slice(0, 5);
    $("ranking").innerHTML = top.map((p) => {
      const v = stats.get(p.id).prom, rgb = colorValor(v);
      return `<li><button type="button" data-id="${esc(p.id)}"><span>${esc(p.nombre)}</span>
        <span class="chip" style="background:${rgbCss(rgb)};color:${tintaSobre(rgb)}">${formato(v)}</span></button></li>`;
    }).join("") || "<li class='tip'>Sin mediciones para este filtro.</li>";
  }

  // Para temperatura, la escala de colores se ajusta a los valores que se están
  // mostrando (así se ven las diferencias dentro del campus); la leyenda lo indica.
  function ajustarDominioTemp() {
    const vals = [...promedioPorPunto(filtradas({ variable: "temp" }), "temp").values()].map((s) => s.prom);
    if (!vals.length) return;
    let lo = Math.floor(Math.min(...vals)), hi = Math.ceil(Math.max(...vals));
    while (hi - lo < 4) { lo -= 1; if (hi - lo < 4) hi += 1; }
    estado.dominioTemp = [lo, hi];
  }

  function dibujarTodo() {
    if (estado.variable === "temp") ajustarDominioTemp();
    dibujarPuntos();
    dibujarIDW();
    dibujarLeyenda();
    dibujarResumen();
    dibujarRanking();
  }

  // ------------------------------------------------------------------
  //  Controles
  // ------------------------------------------------------------------
  function prepararControles() {
    const fechas = [...new Set(estado.mediciones.map((m) => m.fecha).filter(Boolean))].sort();
    $("sel-fecha").insertAdjacentHTML("beforeend", fechas.map((f) => `<option value="${f}">${fechaBonita(f)}</option>`).join(""));

    if (!estado.mediciones.some((m) => Number.isFinite(m.temp))) {
      $("sel-variable").querySelector('[value="temp"]').disabled = true;
    }

    $("sel-variable").addEventListener("change", (e) => { estado.variable = e.target.value; dibujarTodo(); });
    $("sel-fecha").addEventListener("change", (e) => { estado.fecha = e.target.value; dibujarTodo(); });
    $("seg-momento").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      estado.momento = b.dataset.valor;
      $("seg-momento").querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      dibujarTodo();
    });

    const alternar = (chk, capa) => $(chk).addEventListener("change", (e) => (e.target.checked ? capa.addTo(mapa) : capa.remove()));
    alternar("chk-puntos", capaPuntos);
    alternar("chk-campus", capaCampus);
    $("chk-campus").addEventListener("change", (e) => { $("leyenda-campus").style.display = e.target.checked ? "" : "none"; });
    $("chk-idw").addEventListener("change", dibujarIDW);

    $("ranking").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b) return;
      const mk = marcadores.get(b.dataset.id);
      if (!mk) return;
      if (!mapa.hasLayer(capaPuntos)) { $("chk-puntos").checked = true; capaPuntos.addTo(mapa); }
      mapa.flyTo(mk.getLatLng(), 18, { duration: 0.6 });
      mapa.once("moveend", () => mk.openPopup());
    });

    $("toggle-panel").addEventListener("click", () => {
      const panel = $("panel");
      const cerrado = panel.classList.toggle("cerrado");
      $("toggle-panel").setAttribute("aria-expanded", String(!cerrado));
      setTimeout(() => mapa.invalidateSize(), 50);
    });

    // Clic en el mapa → coordenadas para agregar puntos nuevos a puntos.csv
    mapa.on("click", (e) => {
      const txt = `${e.latlng.lat.toFixed(5)},${e.latlng.lng.toFixed(5)}`;
      const div = document.createElement("div");
      div.className = "pop";
      div.innerHTML = `<div class="meta">Coordenadas (lat,lon)</div><p style="margin:0 0 8px"><code>${txt}</code></p>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Copiar";
      btn.addEventListener("click", () => {
        navigator.clipboard?.writeText(txt).then(
          () => (btn.textContent = "¡Copiado!"),
          () => (btn.textContent = "Cópialas a mano")
        );
      });
      div.appendChild(btn);
      L.popup().setLatLng(e.latlng).setContent(div).openOn(mapa);
    });
  }

  // ------------------------------------------------------------------
  //  Inicio
  // ------------------------------------------------------------------
  (async function iniciar() {
    const fuentes = await cargarDatos();
    capaCampus.addTo(mapa);
    capaPuntos.addTo(mapa);

    if (estado.limite) {
      mapa.fitBounds(L.latLngBounds(estado.limite.map(([lon, lat]) => [lat, lon])), { padding: [12, 12] });
    } else if (estado.puntos.length) {
      mapa.fitBounds(L.latLngBounds(estado.puntos.map((p) => [p.lat, p.lon])), { padding: [30, 30] });
    }

    $("aviso-ejemplo").hidden = !estado.mediciones.some((m) => m.ejemplo);
    prepararControles();
    dibujarTodo();

    const fechas = estado.mediciones.map((m) => m.fecha).filter(Boolean).sort();
    const ultima = fechas.length ? ` · última: ${fechaBonita(fechas[fechas.length - 1])}` : "";
    $("estado-datos").textContent =
      `${estado.mediciones.length} mediciones en ${estado.puntos.length} puntos${ultima}`
      + (fuentes.length ? ` · fuente: ${fuentes.join(" + ")}` : "");
  })();
})();
