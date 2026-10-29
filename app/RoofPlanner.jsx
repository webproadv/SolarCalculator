"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoofScene3D from "./RoofScene3D";
import OrientamentoDial from "./OrientamentoDial";
import { decodificaRilievo, stimaPiano } from "../lib/rilievo";
import { segmentaTetto, areeDaSegmentazione, ordinaPerSud, distanzaDalSud, etichettaEsposizione } from "../lib/roofSegmentation";
import {
  MODULO,
  POSA_DEFAULT,
  lngLatToLocale,
  localeToLngLat,
  calcolaLayoutArea,
  distribuisciPannelli,
  puntoInPoligono,
} from "../lib/roofLayout";

// Simulazione indicativa della posa dei moduli sul tetto.
//
// Flusso: l'utente disegna sulla mappa satellitare le aree del tetto adatte
// all'installazione; appena chiude un'area gli viene chiesto se il tetto è
// piano o a falda (la disposizione dei moduli è diversa); l'app dispone i
// moduli Trina Vertex S+ 505 W (1961 × 1134 mm) dentro le aree e confronta
// quanti ne entrano con quelli richiesti dal dimensionamento. Da lì si genera
// la vista 3D e si salvano le immagini per il PDF.
//
// Rilievo reale: su richiesta si scarica da Google Solar API il modello delle
// superfici (DSM) e la foto aerea del sito; la vista 3D usa allora il rilievo
// vero (tetti, alberi, edifici vicini) con la foto stesa sopra, e i moduli
// poggiano sul piano della falda misurato. Con più aree, i moduli richiesti si
// ripartiscono "in ordine" (la prima si riempie, le altre prendono il resto) o
// "uniformemente" (stessa quantità su ogni area, nei limiti della capacità).

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

const LAYER_OVERLAY = [
  "aree-fill", "aree-line", "ostacoli-fill", "ostacoli-line",
  "pann-extra-fill", "pann-usati-fill", "pann-usati-line", "perimetro-fill", "perimetro-line", "cand-fill", "cand-line", "cand-num", "bozza-line", "bozza-pts",
];

// un colore per area: lo stesso sulla mappa, nell'elenco e nella vista 3D
export const COLORI_AREE = ["#f59e0b", "#22c55e", "#3b82f6", "#ec4899", "#a855f7", "#14b8a6", "#ef4444", "#84cc16"];
const coloreArea = (i) => COLORI_AREE[i % COLORI_AREE.length];

const vuoto = { type: "FeatureCollection", features: [] };

function norm360(a) {
  return ((a % 360) + 360) % 360;
}
// azimut bussola (0 = Nord) -> convenzione dell'app (0 = Sud, +90 = Ovest, -90 = Est)
function orientApp(az) {
  let o = norm360(az - 180);
  if (o > 180) o -= 360;
  return Math.round(o);
}
function diffGradi(a, b) {
  const d = Math.abs(norm360(a - b));
  return d > 180 ? 360 - d : d;
}
function riduciImmagine(dataUrl, maxW, q = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", q));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
function firmaLayout(aree, n, ripartizione = "sequenziale", modulo = null) {
  const base = [aree.map((a) => [a.ring, a.ostacoli, a.tipo, a.tilt, a.orient, a.disposizione, a.orientamentoModulo, a.margine, a.allinea, a.riempiResti]), n];
  if (modulo) base.push([modulo.wp, modulo.lunghezzaM, modulo.larghezzaM]);
  // la ripartizione entra nella firma solo se diversa dal default (compatibile con i salvataggi precedenti)
  if (ripartizione !== "sequenziale") base.push(ripartizione);
  const s = JSON.stringify(base);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}
// Nome nuovo con numero progressivo: "Falda 3 · Sud" -> "Falda 4 · Sud" (mai due falde con lo stesso nome)
function nomeDistinto(nome, esistenti) {
  const m = /^(.*?)(\d+)(.*)$/.exec(nome);
  if (!m) return prossimoNome(esistenti, nome);
  const [, pre, , post] = m;
  let max = 0;
  const re = new RegExp("^" + pre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\d+)");
  for (const e of esistenti) {
    const mm = re.exec(e);
    if (mm) max = Math.max(max, Number(mm[1]));
  }
  return `${pre}${max + 1}${post}`;
}
function prossimoNome(esistenti, base) {
  let max = 0;
  const re = new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " (\\d+)");
  for (const e of esistenti) {
    const mm = re.exec(e);
    if (mm) max = Math.max(max, Number(mm[1]));
  }
  return `${base} ${max + 1}`;
}

// Moduli proposti (l'utente può comunque scrivere le misure che vuole). Il primo è il modulo di riferimento.
const PRESET_MODULI = [
  { id: "ref", nome: MODULO.nome, wp: MODULO.wp, lunghezzaM: MODULO.lunghezzaM, larghezzaM: MODULO.larghezzaM },
  { id: "g430", nome: "Modulo generico 430 Wp", wp: 430, lunghezzaM: 1.722, larghezzaM: 1.134 },
  { id: "g600", nome: "Modulo generico 600 Wp", wp: 600, lunghezzaM: 2.278, larghezzaM: 1.134 },
];

// modulo "pulito": numeri sensati, lato lungo sempre come lunghezza
function normalizzaModulo(m) {
  const base = m || {};
  const num = (v, d, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };
  let l = num(base.lunghezzaM, MODULO.lunghezzaM, 0.5, 3.5);
  let w = num(base.larghezzaM, MODULO.larghezzaM, 0.3, 2);
  if (w > l) [l, w] = [w, l];
  return {
    nome: String(base.nome || MODULO.nome),
    wp: Math.round(num(base.wp, MODULO.wp, 50, 1000)),
    lunghezzaM: l,
    larghezzaM: w,
    spessoreM: MODULO.spessoreM,
  };
}

// Layout dei moduli in una area (stesso calcolo per la mappa e per le scelte automatiche)
function layoutDiArea(a, centro, modulo) {
  const poligono = a.ring.map((p) => lngLatToLocale(centro, p));
  const ostacoli = (a.ostacoli || []).map((o) => o.map((p) => lngLatToLocale(centro, p)));
  const azBase = a.tipo === "piano" && a.disposizione === "estovest" ? 90 + a.orient : 180 + a.orient;
  const layout = calcolaLayoutArea({
    poligono,
    ostacoli,
    tipo: a.tipo,
    azimutFaccia: norm360(azBase),
    tiltDeg: a.tilt,
    disposizione: a.disposizione,
    allineaAiLati: a.allinea !== false,
    orientamentoModulo: a.orientamentoModulo || "auto",
    margineM: a.margine,
    latitudine: centro.lat,
    modulo,
    riempiResti: a.riempiResti !== false,
  });
  return { ...layout, poligono, ostacoliLocali: ostacoli };
}

// campo numerico che si conferma all'uscita (così si può digitare senza che il valore cambi a metà)
function NumeroConferma({ value, onCommit, min, max, step = 1, width = 90, id }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => { setTxt(String(value)); }, [value]);
  const conferma = () => {
    const n = Number(String(txt).replace(",", "."));
    if (Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, n)));
    else setTxt(String(value));
  };
  return (
    <input
      id={id} type="number" min={min} max={max} step={step} value={txt} style={{ width }}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={conferma}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
    />
  );
}

let contatoreId = 1;
const nuovoId = () => `a${Date.now().toString(36)}${contatoreId++}`;

export default function RoofPlanner({
  centro, // { lat, lng }
  pannelliRichiesti,
  kwpRichiesti,
  inclinazioneForm,
  orientamentoForm,
  posa, // { aree, altezzaM, immagini } | null
  onPosaChange,
  onAdeguaKwp,
}) {
  const aree = useMemo(() => posa?.aree || [], [posa]);
  const altezzaM = posa?.altezzaM ?? 8;
  const ripartizione = posa?.ripartizione === "uniforme" ? "uniforme" : "sequenziale";
  const modulo = useMemo(() => normalizzaModulo(posa?.modulo), [posa?.modulo]);
  const moduloDefault = modulo.wp === MODULO.wp && modulo.lunghezzaM === MODULO.lunghezzaM && modulo.larghezzaM === MODULO.larghezzaM;
  const massimo = Boolean(posa?.massimo); // true: si dispone il massimo numero di moduli possibile, a prescindere dalla taglia richiesta
  // moduli richiesti dal dimensionamento: con un modulo diverso da quello di riferimento si ricalcolano dai kWp
  const richiestiTaglia = moduloDefault ? Math.round(pannelliRichiesti) : Math.max(0, Math.round((Number(kwpRichiesti) * 1000) / modulo.wp));
  const presetModulo =
    PRESET_MODULI.find((x) => Math.abs(x.wp - modulo.wp) < 0.5 && Math.abs(x.lunghezzaM - modulo.lunghezzaM) < 0.0005 && Math.abs(x.larghezzaM - modulo.larghezzaM) < 0.0005)?.id || "custom";
  const orientForm = Number.isFinite(Number(orientamentoForm)) ? Number(orientamentoForm) : 0;
  const tiltForm = Number.isFinite(Number(inclinazioneForm)) ? Number(inclinazioneForm) : 25;

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapPronta, setMapPronta] = useState(false);
  const [errore, setErrore] = useState("");

  const [modo, setModo] = useState(null); // null | "area" | "ostacolo"
  const [bozza, setBozza] = useState([]);
  const [daConfigurare, setDaConfigurare] = useState(null); // { ring }
  // falde candidate trovate dal rilievo (tutte, anche quelle di edifici vicini):
  // l'utente sceglie quali appartengono all'azienda. { seg, falde[], ostacoli }
  const [candidati, setCandidati] = useState([]);
  const [selCand, setSelCand] = useState([]); // id delle falde scelte
  const candRef = useRef([]);
  useEffect(() => { candRef.current = candidati; }, [candidati]);
  const [selezionata, setSelezionata] = useState(null);
  // perimetro disegnato dall'utente: il rilevamento automatico lavora solo là dentro
  const [perimetro, setPerimetro] = useState(null); // anello lng/lat
  const [confermaCancella, setConfermaCancella] = useState(false);
  const [spostaAttivo, setSpostaAttivo] = useState(false); // trascinamento dell'area selezionata
  const [distanzaCopiaM, setDistanzaCopiaM] = useState(1); // distanza tra una falda e la sua copia
  const [candNascosti, setCandNascosti] = useState(null); // falde dell'ultimo rilevamento automatico, per rivederle: { falde, usate }
  const [stile3d, setStile3d] = useState("colori"); // "colori" | "foto"
  const [aree3d, setAree3d] = useState(true);
  const [scena3d, setScena3d] = useState(null);
  const [lavoro, setLavoro] = useState("");
  const [rilievo, setRilievo] = useState(null);
  const [rilievoErr, setRilievoErr] = useState("");
  const [autoMsg, setAutoMsg] = useState(null); // { tipo: "ok"|"warn", testo }
  const [fotoGoogle, setFotoGoogle] = useState(true);
  const ref3d = useRef(null);

  // specchi per i gestori dell'evento della mappa (registrati una sola volta)
  const modoRef = useRef(null);
  const bozzaRef = useRef([]);
  const areeRef = useRef([]);
  const selezRef = useRef(null);
  const spostaRef = useRef(false);
  const dragRef = useRef(null);
  const posaRef = useRef(null);
  useEffect(() => { posaRef.current = posa; }, [posa]);
  useEffect(() => { modoRef.current = modo; }, [modo]);
  useEffect(() => { bozzaRef.current = bozza; }, [bozza]);
  useEffect(() => { areeRef.current = aree; }, [aree]);
  useEffect(() => { selezRef.current = selezionata; }, [selezionata]);
  useEffect(() => { spostaRef.current = spostaAttivo; }, [spostaAttivo]);
  // fuori dalla selezione non si può spostare nulla
  useEffect(() => { if (!selezionata) setSpostaAttivo(false); }, [selezionata]);

  const aggiornaPosa = useCallback(
    (patch) => onPosaChange({ ...(posa || {}), aree, altezzaM, immagini: posa?.immagini || null, ...patch }),
    [onPosaChange, aree, altezzaM, posa]
  );

  function impostaModulo(patch) {
    const n = normalizzaModulo({ ...modulo, ...patch });
    const pr = PRESET_MODULI.find((x) => Math.abs(x.wp - n.wp) < 0.5 && Math.abs(x.lunghezzaM - n.lunghezzaM) < 0.0005 && Math.abs(x.larghezzaM - n.larghezzaM) < 0.0005);
    aggiornaPosa({ modulo: { ...n, nome: pr ? pr.nome : `Modulo personalizzato ${n.wp} Wp` } });
  }

  /* ------------------------------------------------------------- calcolo */

  const calcolo = useMemo(() => {
    const layouts = aree.map((a) => layoutDiArea(a, centro, modulo));
    const target = massimo ? layouts.reduce((t, l) => t + l.capacita, 0) : richiestiTaglia;
    const dist = distribuisciPannelli(layouts, target, ripartizione, modulo.wp);
    return { layouts, dist, target };
  }, [aree, centro, modulo, massimo, richiestiTaglia, ripartizione]);
  const richiesti = calcolo.target;

  // piano medio di ogni area dal rilievo reale (pendenza e verso della falda)
  const piani = useMemo(
    () => (rilievo ? calcolo.layouts.map((l) => stimaPiano(rilievo, l.poligono, l.ostacoliLocali)) : []),
    [rilievo, calcolo]
  );
  // dati GeoJSON per la mappa
  const geo = useMemo(() => {
    const pol = (pts) => {
      const ring = pts.map((p) => p.slice());
      ring.push(ring[0]);
      return [ring];
    };
    const areeF = aree.map((a, i) => ({
      type: "Feature",
      properties: { id: a.id, sel: a.id === selezionata ? 1 : 0, c: coloreArea(i) },
      geometry: { type: "Polygon", coordinates: pol(a.ring) },
    }));
    const ostF = aree.flatMap((a) =>
      (a.ostacoli || []).map((o) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: pol(o) } }))
    );
    const usati = [];
    const extra = [];
    calcolo.layouts.forEach((l, i) => {
      l.pannelli.forEach((p, k) => {
        const f = {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: pol(p.angoli.map((c) => localeToLngLat(centro, c))) },
        };
        (k < calcolo.dist.usati[i] ? usati : extra).push(f);
      });
    });
    return {
      aree: { type: "FeatureCollection", features: areeF },
      ostacoli: { type: "FeatureCollection", features: ostF },
      usati: { type: "FeatureCollection", features: usati },
      extra: { type: "FeatureCollection", features: extra },
    };
  }, [aree, calcolo, centro, selezionata]);

  const geoCand = useMemo(() => {
    const poli = [];
    const num = [];
    candidati.forEach((f, i) => {
      const ring = f.ring.map((q) => q.slice());
      ring.push(ring[0]);
      const sel = selCand.includes(f.id) ? 1 : 0;
      poli.push({ type: "Feature", properties: { id: f.id, sel }, geometry: { type: "Polygon", coordinates: [ring] } });
      const cx = f.ring.reduce((t, q) => t + q[0], 0) / f.ring.length;
      const cy = f.ring.reduce((t, q) => t + q[1], 0) / f.ring.length;
      num.push({ type: "Feature", properties: { n: String(i + 1), sel }, geometry: { type: "Point", coordinates: [cx, cy] } });
    });
    return { poli: { type: "FeatureCollection", features: poli }, num: { type: "FeatureCollection", features: num } };
  }, [candidati, selCand]);

  const geoPerimetro = useMemo(() => {
    if (!perimetro || perimetro.length < 3) return vuoto;
    const ring = perimetro.map((q) => q.slice());
    ring.push(ring[0]);
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] };
  }, [perimetro]);

  const geoBozza = useMemo(() => {
    const feats = [];
    if (bozza.length >= 2) feats.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: bozza } });
    return {
      linea: { type: "FeatureCollection", features: feats },
      punti: { type: "FeatureCollection", features: bozza.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } })) },
    };
  }, [bozza]);

  /* ------------------------------------------------------------- mappa */

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current) return;
    let annullato = false;
    let map;
    import("mapbox-gl")
      .then((mod) => {
        if (annullato || !containerRef.current) return;
        const mapboxgl = mod.default;
        mapboxgl.accessToken = MAPBOX_TOKEN;
        map = new mapboxgl.Map({
          container: containerRef.current,
          style: "mapbox://styles/mapbox/satellite-v9",
          center: [centro.lng, centro.lat],
          zoom: 19.3,
          attributionControl: false,
          preserveDrawingBuffer: true,
          dragRotate: false,
          pitchWithRotate: false,
          maxPitch: 0,
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new mapboxgl.AttributionControl({ compact: true }));
        mapRef.current = map;

        map.on("load", () => {
          const src = (id) => map.addSource(id, { type: "geojson", data: vuoto });
          ["aree", "ostacoli", "pann-usati", "pann-extra", "perimetro", "cand", "cand-num", "bozza-linea", "bozza-punti"].forEach(src);
          map.addLayer({ id: "perimetro-fill", type: "fill", source: "perimetro", paint: { "fill-color": "#38bdf8", "fill-opacity": 0.1 } });
          map.addLayer({ id: "perimetro-line", type: "line", source: "perimetro", paint: { "line-color": "#38bdf8", "line-width": 2.5, "line-dasharray": [3, 2] } });
          map.addLayer({
            id: "aree-fill", type: "fill", source: "aree",
            paint: { "fill-color": ["coalesce", ["get", "c"], "#f59e0b"], "fill-opacity": ["case", ["==", ["get", "sel"], 1], 0.3, 0.18] },
          });
          map.addLayer({
            id: "aree-line", type: "line", source: "aree",
            paint: { "line-color": ["case", ["==", ["get", "sel"], 1], "#ffffff", ["coalesce", ["get", "c"], "#fbbf24"]], "line-width": ["case", ["==", ["get", "sel"], 1], 3.5, 2.5] },
          });
          map.addLayer({ id: "ostacoli-fill", type: "fill", source: "ostacoli", paint: { "fill-color": "#ef4444", "fill-opacity": 0.45 } });
          map.addLayer({ id: "ostacoli-line", type: "line", source: "ostacoli", paint: { "line-color": "#fecaca", "line-width": 1.5 } });
          map.addLayer({ id: "pann-extra-fill", type: "fill", source: "pann-extra", paint: { "fill-color": "#93c5fd", "fill-opacity": 0.35 } });
          map.addLayer({ id: "pann-usati-fill", type: "fill", source: "pann-usati", paint: { "fill-color": "#1e3a8a", "fill-opacity": 0.88 } });
          map.addLayer({ id: "pann-usati-line", type: "line", source: "pann-usati", paint: { "line-color": "#bfdbfe", "line-width": 0.6 } });
          map.addLayer({
            id: "cand-fill", type: "fill", source: "cand",
            paint: { "fill-color": ["case", ["==", ["get", "sel"], 1], "#22c55e", "#94a3b8"], "fill-opacity": ["case", ["==", ["get", "sel"], 1], 0.45, 0.25] },
          });
          map.addLayer({
            id: "cand-line", type: "line", source: "cand",
            paint: { "line-color": ["case", ["==", ["get", "sel"], 1], "#bbf7d0", "#e2e8f0"], "line-width": 2.5, "line-dasharray": [3, 2] },
          });
          map.addLayer({
            id: "cand-num", type: "symbol", source: "cand-num",
            layout: { "text-field": ["get", "n"], "text-size": 18, "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"], "text-allow-overlap": true },
            paint: { "text-color": "#ffffff", "text-halo-color": "#0f172a", "text-halo-width": 2 },
          });
          map.addLayer({ id: "bozza-line", type: "line", source: "bozza-linea", paint: { "line-color": "#22d3ee", "line-width": 2.5, "line-dasharray": [2, 1] } });
          map.addLayer({ id: "bozza-pts", type: "circle", source: "bozza-punti", paint: { "circle-radius": 5, "circle-color": "#22d3ee", "circle-stroke-color": "#0e7490", "circle-stroke-width": 2 } });
          setMapPronta(true);
        });

        map.on("click", (e) => {
          const m = modoRef.current;
          const pt = [e.lngLat.lng, e.lngLat.lat];
          if (!m) {
            const loc = lngLatToLocale(centro, pt);
            // scelta delle falde candidate (rilevamento automatico): click = seleziona/deseleziona
            const cand = candRef.current.find((f) => puntoInPoligono(loc, f.ring.map((q) => lngLatToLocale(centro, q))));
            if (cand) {
              setSelCand((v) => (v.includes(cand.id) ? v.filter((x) => x !== cand.id) : [...v, cand.id]));
              return;
            }
            // selezione di un'area cliccandoci sopra
            const trovata = areeRef.current.find((a) => puntoInPoligono(loc, a.ring.map((p) => lngLatToLocale(centro, p))));
            setSelezionata(trovata ? trovata.id : null);
            return;
          }
          const b = bozzaRef.current;
          // click vicino al primo punto: chiude la figura
          if (b.length >= 3) {
            const p0 = map.project(b[0]);
            if (Math.hypot(p0.x - e.point.x, p0.y - e.point.y) < 12) {
              chiudiBozzaRef.current();
              return;
            }
          }
          setBozza([...b, pt]);
        });
        // trascinamento dell'area selezionata (per posizionare una falda duplicata)
        const inizioTrascina = (e) => {
          if (!spostaRef.current || modoRef.current) return;
          const area = areeRef.current.find((a) => a.id === selezRef.current);
          if (!area || !e.lngLat) return;
          const loc = lngLatToLocale(centro, [e.lngLat.lng, e.lngLat.lat]);
          const ring = area.ring.map((q) => lngLatToLocale(centro, q));
          if (!puntoInPoligono(loc, ring)) return;
          e.preventDefault();
          map.dragPan.disable();
          dragRef.current = { id: area.id, start: loc, mosso: false };
        };
        const muoviTrascina = (e) => {
          const d = dragRef.current;
          if (!d || !e.lngLat) return;
          const loc = lngLatToLocale(centro, [e.lngLat.lng, e.lngLat.lat]);
          d.dx = loc.x - d.start.x;
          d.dy = loc.y - d.start.y;
          d.mosso = true;
          if (!d.raf) {
            d.raf = requestAnimationFrame(() => {
              d.raf = 0;
              if (dragRef.current === d) traslaAreaRef.current(d.id, d.dx, d.dy, d);
            });
          }
        };
        const fineTrascina = () => {
          const d = dragRef.current;
          if (!d) return;
          if (d.raf) cancelAnimationFrame(d.raf);
          if (d.mosso) traslaAreaRef.current(d.id, d.dx, d.dy, d);
          dragRef.current = null;
          map.dragPan.enable();
        };
        map.on("mousedown", inizioTrascina);
        map.on("touchstart", inizioTrascina);
        map.on("mousemove", muoviTrascina);
        map.on("touchmove", muoviTrascina);
        map.on("mouseup", fineTrascina);
        map.on("touchend", fineTrascina);
        map.on("dblclick", (e) => {
          if (!modoRef.current) return;
          e.preventDefault();
          chiudiBozzaRef.current();
        });
        map.on("error", (ev) => setErrore(ev?.error?.message || "Errore nel caricamento della mappa."));
      })
      .catch(() => setErrore("Impossibile caricare la mappa satellitare (mapbox-gl)."));

    return () => {
      annullato = true;
      map?.remove();
      mapRef.current = null;
      setMapPronta(false);
    };
    // la mappa si monta una sola volta per questa posizione
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centro.lat, centro.lng]);

  // aggiorna i dati sulla mappa
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapPronta) return;
    map.getSource("aree")?.setData(geo.aree);
    map.getSource("ostacoli")?.setData(geo.ostacoli);
    map.getSource("pann-usati")?.setData(geo.usati);
    map.getSource("pann-extra")?.setData(geo.extra);
  }, [geo, mapPronta]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapPronta) return;
    map.getSource("cand")?.setData(geoCand.poli);
    map.getSource("cand-num")?.setData(geoCand.num);
  }, [geoCand, mapPronta]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapPronta) return;
    map.getSource("perimetro")?.setData(geoPerimetro);
  }, [geoPerimetro, mapPronta]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapPronta) return;
    map.getSource("bozza-linea")?.setData(geoBozza.linea);
    map.getSource("bozza-punti")?.setData(geoBozza.punti);
  }, [geoBozza, mapPronta]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapPronta) return;
    map.getCanvas().style.cursor = modo ? "crosshair" : spostaAttivo ? "move" : "";
    if (modo) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [modo, spostaAttivo, mapPronta]);

  /* ------------------------------------------------------ rilievo reale */

  useEffect(() => {
    setRilievo(null);
    setRilievoErr("");
    setScena3d(null);
    setCandidati([]);
    setSelCand([]);
    setPerimetro(null);
    setCandNascosti(null);
    setAutoMsg(null);
  }, [centro.lat, centro.lng]);

  // Rilevamento automatico.
  //  1. l'utente disegna il PERIMETRO dell'area disponibile: fuori da lì il rilievo non viene
  //     nemmeno guardato (edifici vicini esclusi);
  //  2. "Rileva e disponi": dentro il perimetro il rilievo (DSM) viene scomposto in falde e
  //     ostacoli e i moduli vengono posati da soli, al massimo che entra su ogni falda. Le
  //     falde si usano in ordine di esposizione: Sud, poi Sud-Est/Sud-Ovest, poi Est/Ovest;
  //     quelle a Nord solo se i moduli richiesti non entrano altrove;
  //  3. le falde non usate si possono rivedere e aggiungere a mano ("Rivedi le falde rilevate").
  //     Le aree disegnate a mano restano intatte.
  function preparaCandidati(seg) {
    return ordinaPerSud(seg.falde).map((f) => ({
      ...f,
      ring: f.anello.map((q) => localeToLngLat(centro, q)),
      ostRing: f.ostacoli.map((o) => o.map((q) => localeToLngLat(centro, q))),
    }));
  }
  function nomeFalda(f, i) {
    return `Falda ${i + 1} · ${etichettaEsposizione(f)}`;
  }
  function areeDaFalde(falde, daNumero = 0) {
    return areeDaSegmentazione({ falde }, centro, localeToLngLat, POSA_DEFAULT, nuovoId).map((a, i) => ({
      ...a,
      nome: nomeFalda(falde[i], daNumero + i),
      orient: Math.max(-180, Math.min(180, a.orient)),
    }));
  }

  // (modo manuale) mostra le falde trovate nel perimetro, da spuntare
  async function rilevaFalde() {
    setAutoMsg(null);
    if (!perimetro || perimetro.length < 3) {
      setAutoMsg({ tipo: "warn", testo: "Prima disegna sulla mappa l'area disponibile (pulsante «① Disegna area disponibile»)." });
      return;
    }
    const ril = rilievo || (await caricaRilievo());
    if (!ril) return;
    try {
      const poligono = perimetro.map((q) => lngLatToLocale(centro, q));
      const seg = segmentaTetto(ril, { poligono });
      if (!seg.falde.length) {
        setCandidati([]);
        setSelCand([]);
        setAutoMsg({ tipo: "warn", testo: seg.avvisi[0] || "Nessuna falda riconosciuta nel perimetro: ridisegnalo o disegna le aree a mano." });
        return;
      }
      const ordinate = preparaCandidati(seg);
      setCandidati(ordinate);
      setSelCand(ordinate.map((f) => f.id));
      const nOst = ordinate.reduce((t, f) => t + f.ostacoli.length, 0);
      setAutoMsg({
        tipo: seg.avvisi.length ? "warn" : "ok",
        testo: `Nel perimetro: ${ordinate.length} ${ordinate.length === 1 ? "falda" : "falde"} e ${nOst} ${nOst === 1 ? "ostacolo" : "ostacoli"} (ordinate dalla più rivolta a Sud). Togli la spunta a quelle che non servono, poi conferma.${seg.avvisi.length ? " " + seg.avvisi.join(" ") : ""}`,
      });
    } catch (e) {
      setAutoMsg({ tipo: "warn", testo: `Rilevamento automatico non riuscito: ${e.message}` });
    }
  }

  // rileva le falde nel perimetro E dispone i moduli: precedenza Sud → SE/SO → Est/Ovest → Nord
  async function rilevaEDisponi() {
    setAutoMsg(null);
    setCandidati([]);
    setSelCand([]);
    if (!perimetro || perimetro.length < 3) {
      setAutoMsg({ tipo: "warn", testo: "Prima disegna sulla mappa l'area disponibile (pulsante «① Disegna area disponibile»)." });
      return;
    }
    const ril = rilievo || (await caricaRilievo());
    if (!ril) {
      setAutoMsg({ tipo: "warn", testo: "Rilievo Google non disponibile per questo indirizzo: disegna le aree a mano." });
      return;
    }
    try {
      setLavoro("Riconosco falde e ostacoli e dispongo i moduli…");
      const poligono = perimetro.map((q) => lngLatToLocale(centro, q));
      const seg = segmentaTetto(ril, { poligono });
      if (!seg.falde.length) {
        setAutoMsg({ tipo: "warn", testo: seg.avvisi[0] || "Nessuna falda riconosciuta nel perimetro: ridisegnalo o disegna le aree a mano." });
        return;
      }
      const ordinate = preparaCandidati(seg);
      const manuali = aree.filter((a) => !a.auto);
      // moduli già sistemati dalle aree disegnate a mano
      const idxManuali = aree.map((a, i) => (a.auto ? -1 : i)).filter((i) => i >= 0);
      let capacita = idxManuali.reduce((t, i) => t + calcolo.layouts[i].capacita, 0);
      const obiettivo = massimo ? Infinity : richiestiTaglia;
      const usate = [];
      const nonUsate = [];
      for (const f of ordinate) {
        if (capacita >= obiettivo) { nonUsate.push(f); continue; }
        const [areaTest] = areeDaFalde([f]);
        const cap = layoutDiArea(areaTest, centro, modulo).capacita;
        if (cap <= 0) { nonUsate.push(f); continue; }
        usate.push(f);
        capacita += cap;
      }
      if (!usate.length) {
        setAutoMsg({ tipo: "warn", testo: "Nelle falde trovate non entra nessun modulo: controlla le misure del modulo e le distanze dai bordi, oppure disegna le aree a mano." });
        return;
      }
      const nuove = areeDaFalde(usate);
      aggiornaPosa({ aree: [...manuali, ...nuove], ripartizione: "sequenziale" });
      setSelezionata(nuove[0]?.id || null);
      setCandNascosti({ falde: ordinate, usate: usate.map((f) => f.id) });
      const nOst = usate.reduce((t, f) => t + f.ostacoli.length, 0);
      const nord = nonUsate.filter((f) => f.tipo === "falda" && distanzaDalSud(f) > 112).length;
      const esp = [...new Set(usate.map((f) => etichettaEsposizione(f)))].join(", ");
      const finale = capacita >= obiettivo
        ? `Il numero di moduli richiesto (${richiestiTaglia}) entra nelle falde usate`
        : massimo
        ? `Posizionati ${capacita} moduli, il massimo che entra`
        : `Nel perimetro entrano al massimo ${capacita} moduli su ${richiestiTaglia} richiesti`;
      setAutoMsg({
        tipo: "ok",
        testo: `Usate ${nuove.length} ${nuove.length === 1 ? "falda" : "falde"} (${esp}) con ${nOst} ${nOst === 1 ? "ostacolo" : "ostacoli"}. ${finale}. ${nonUsate.length ? `Non usate: ${nonUsate.length}${nord ? ` (di cui ${nord} a Nord)` : ""} — si usano solo se servono. ` : ""}Controlla sulla mappa e correggi a mano se serve.`,
      });
    } catch (e) {
      setAutoMsg({ tipo: "warn", testo: `Rilevamento automatico non riuscito: ${e.message}` });
    } finally {
      setLavoro("");
    }
  }

  // riapre l'elenco delle falde dell'ultimo rilevamento (usate già spuntate) per aggiungerne o toglierne
  function rivediFalde() {
    if (!candNascosti) return;
    setCandidati(candNascosti.falde);
    setSelCand(candNascosti.usate);
    setAutoMsg({ tipo: "ok", testo: "Spunta le falde da usare (anche quelle a Nord) e conferma: i moduli verranno disposti di nuovo." });
  }

  function usaFaldeScelte() {
    const scelte = candidati.filter((f) => selCand.includes(f.id));
    if (!scelte.length) {
      setAutoMsg({ tipo: "warn", testo: "Seleziona almeno una falda (click sulla mappa o spunta nell'elenco)." });
      return;
    }
    const ordinate = ordinaPerSud(scelte);
    const aree0 = areeDaFalde(ordinate);
    const manuali = aree.filter((a) => !a.auto);
    aggiornaPosa({ aree: [...manuali, ...aree0], ripartizione: "sequenziale" });
    setSelezionata(aree0[0]?.id || null);
    setCandNascosti({ falde: candidati, usate: scelte.map((f) => f.id) });
    const nOst = ordinate.reduce((t, f) => t + f.ostacoli.length, 0);
    setCandidati([]);
    setSelCand([]);
    setAutoMsg({
      tipo: "ok",
      testo: `Create ${aree0.length} ${aree0.length === 1 ? "area" : "aree"} con ${nOst} ${nOst === 1 ? "ostacolo" : "ostacoli"}. I moduli riempiono prima le falde più rivolte a Sud. Controlla sulla mappa e correggi a mano se serve.`,
    });
  }

  async function caricaRilievo() {
    setLavoro("Scarico il rilievo reale da Google Solar…");
    setRilievoErr("");
    try {
      const r = await fetch("/api/solar-layers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: centro.lat, lng: centro.lng }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Errore ${r.status}`);
      const ril = decodificaRilievo(j);
      setRilievo(ril);
      setFotoGoogle(true);
      setScena3d(null);
      return ril;
    } catch (e) {
      setRilievoErr(e.message);
      return null;
    } finally {
      setLavoro("");
    }
  }

  // la foto Google va sulla mappa (sotto le aree) così si disegna sulla stessa immagine del rilievo
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapPronta) return;
    const pulisci = () => {
      if (map.getLayer("google-foto-layer")) map.removeLayer("google-foto-layer");
      if (map.getSource("google-foto")) map.removeSource("google-foto");
    };
    pulisci();
    if (!rilievo || !fotoGoogle) return;
    const E = rilievo.estensioneM;
    const c = (x, y) => localeToLngLat(centro, { x, y });
    map.addSource("google-foto", {
      type: "image",
      url: rilievo.fotoDataUrl,
      coordinates: [c(-E, E), c(E, E), c(E, -E), c(-E, -E)],
    });
    map.addLayer({ id: "google-foto-layer", type: "raster", source: "google-foto", paint: { "raster-opacity": 1, "raster-fade-duration": 0 } }, "aree-fill");
    return pulisci;
  }, [rilievo, fotoGoogle, mapPronta, centro]);

  /* --------------------------------------------------------- disegno */

  const chiudiBozzaRef = useRef(() => {});
  chiudiBozzaRef.current = () => {
    // toglie i punti doppi (i due click di un doppio click)
    const pulita = [];
    for (const p of bozzaRef.current) {
      const l = pulita[pulita.length - 1];
      if (!l) pulita.push(p);
      else {
        const a = lngLatToLocale(centro, l);
        const b = lngLatToLocale(centro, p);
        if (Math.hypot(a.x - b.x, a.y - b.y) > 0.5) pulita.push(p);
      }
    }
    if (pulita.length < 3) {
      setErrore("Servono almeno 3 punti per chiudere un'area.");
      return;
    }
    setErrore("");
    if (modoRef.current === "perimetro") {
      setPerimetro(pulita);
      setCandidati([]);
      setSelCand([]);
      setAutoMsg(null);
      setBozza([]);
      setModo(null);
      return;
    }
    if (modoRef.current === "ostacolo") {
      const loc = lngLatToLocale(centro, pulita[0]);
      let target = areeRef.current.find((a) => a.id === selezRef.current);
      if (!target) target = areeRef.current.find((a) => puntoInPoligono(loc, a.ring.map((p) => lngLatToLocale(centro, p))));
      if (!target) {
        setErrore("L'ostacolo deve stare dentro un'area: disegna prima l'area o selezionala.");
      } else {
        onPosaChange({
          ...(posaRef.current || {}),
          aree: areeRef.current.map((a) => (a.id === target.id ? { ...a, ostacoli: [...(a.ostacoli || []), pulita] } : a)),
          altezzaM, immagini: posaRef.current?.immagini || null,
        });
      }
      setBozza([]);
      setModo(null);
      return;
    }
    setDaConfigurare({ ring: pulita });
    setBozza([]);
    setModo(null);
  };

  function avviaDisegno(m) {
    setErrore("");
    setBozza([]);
    setDaConfigurare(null);
    setModo(m);
  }
  function annullaDisegno() {
    setBozza([]);
    setModo(null);
  }

  function creaArea(tipo) {
    if (!daConfigurare) return;
    const piano = tipo === "piano";
    const area = {
      id: nuovoId(),
      nome: prossimoNome(aree.map((x) => x.nome), "Area"),
      tipo,
      ring: daConfigurare.ring,
      ostacoli: [],
      tilt: piano ? POSA_DEFAULT.tiltPianoSud : Math.max(5, Math.min(60, tiltForm)),
      orient: orientForm,
      disposizione: "sud",
      orientamentoModulo: "auto",
      margine: piano ? POSA_DEFAULT.marginePiano : POSA_DEFAULT.margineFalda,
      allinea: true,
    };
    aggiornaPosa({ aree: [...aree, area] });
    setSelezionata(area.id);
    setDaConfigurare(null);
  }

  function modificaArea(id, patch) {
    aggiornaPosa({ aree: aree.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  }
  function eliminaArea(id) {
    aggiornaPosa({ aree: aree.filter((a) => a.id !== id) });
    if (selezionata === id) setSelezionata(null);
  }
  function spostaArea(id, delta) {
    const i = aree.findIndex((a) => a.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= aree.length) return;
    const copia = aree.slice();
    [copia[i], copia[j]] = [copia[j], copia[i]];
    aggiornaPosa({ aree: copia });
  }
  // sposta un'area (e i suoi ostacoli) di dx, dy metri (x = Est, y = Nord)
  const traslaAreaRef = useRef(() => {});
  traslaAreaRef.current = (id, dx, dy, d) => {
    const a = areeRef.current.find((x) => x.id === id);
    if (!a) return;
    let orig = d?.orig;
    if (!orig) {
      orig = { ring: a.ring.map((q) => lngLatToLocale(centro, q)), ost: (a.ostacoli || []).map((o) => o.map((q) => lngLatToLocale(centro, q))) };
      if (d) d.orig = orig;
    }
    const sp = (p) => localeToLngLat(centro, { x: p.x + dx, y: p.y + dy });
    const nuove = areeRef.current.map((x) => (x.id === id ? { ...x, ring: orig.ring.map(sp), ostacoli: orig.ost.map((o) => o.map(sp)) } : x));
    onPosaChange({ ...(posaRef.current || {}), aree: nuove, altezzaM, immagini: posaRef.current?.immagini || null });
  };
  function nudgeArea(id, dx, dy) {
    traslaAreaRef.current(id, dx, dy, null);
  }

  // Duplica un'area: stessa forma, orientamento, pendenza e ostacoli, traslata di fianco in
  // direzione perpendicolare al suo lato più lungo, di tutta la sua larghezza + 1 m di distanza,
  // così le due aree sono parallele e non si toccano. Poi si trascina dove serve.
  function duplicaArea(id) {
    const a = aree.find((x) => x.id === id);
    if (!a) return;
    const loc = a.ring.map((q) => lngLatToLocale(centro, q));
    let lung = 0;
    let ux = 1;
    let uy = 0;
    for (let i = 0; i < loc.length; i++) {
      const p0 = loc[i];
      const p1 = loc[(i + 1) % loc.length];
      const l = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (l > lung) {
        lung = l;
        ux = (p1.x - p0.x) / l;
        uy = (p1.y - p0.y) / l;
      }
    }
    let nx = -uy;
    let ny = ux;
    // verso: preferibilmente a Nord (le file successive), altrimenti a Est
    if (ny < -1e-9 || (Math.abs(ny) <= 1e-9 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    const proj = loc.map((p) => p.x * nx + p.y * ny);
    const passo = Math.max(...proj) - Math.min(...proj) + distanzaCopiaM; // larghezza + distanza (default 1 m)
    const sp = (q) => {
      const p = lngLatToLocale(centro, q);
      return localeToLngLat(centro, { x: p.x + nx * passo, y: p.y + ny * passo });
    };
    const copia = {
      ...a,
      id: nuovoId(),
      nome: nomeDistinto(a.nome, aree.map((x) => x.nome)),
      ring: a.ring.map(sp),
      ostacoli: (a.ostacoli || []).map((o) => o.map(sp)),
      auto: false, // una copia è una scelta dell'utente: non viene sostituita da un nuovo rilevamento
    };
    const i = aree.findIndex((x) => x.id === id);
    const nuove = aree.slice();
    nuove.splice(i + 1, 0, copia);
    aggiornaPosa({ aree: nuove });
    setSelezionata(copia.id);
    setSpostaAttivo(true);
  }

  function cancellaTutteLeAree() {
    aggiornaPosa({ aree: [] });
    setSelezionata(null);
    setSpostaAttivo(false);
    setConfermaCancella(false);
    setCandidati([]);
    setSelCand([]);
    setCandNascosti(null);
    setAutoMsg(null);
  }

  function rimuoviOstacoli(id) {
    modificaArea(id, { ostacoli: [] });
  }
  function cambiaTipo(a, tipo) {
    modificaArea(a.id, {
      tipo,
      tilt: tipo === "piano" ? (a.disposizione === "estovest" ? POSA_DEFAULT.tiltPianoEstOvest : POSA_DEFAULT.tiltPianoSud) : Math.max(5, Math.min(60, tiltForm)),
      margine: tipo === "piano" ? POSA_DEFAULT.marginePiano : POSA_DEFAULT.margineFalda,
      disposizione: "sud",
    });
  }

  /* -------------------------------------------------------- 3D e immagini */

  async function aspettaMappa(map) {
    await new Promise((res) => {
      let fatto = false;
      const fine = () => { if (!fatto) { fatto = true; res(); } };
      map.once("idle", fine);
      map.triggerRepaint();
      setTimeout(fine, 3000);
    });
  }

  async function generaVista3d() {
    const map = mapRef.current;
    if (!map || !calcolo.dist.posizionati) return;
    setErrore("");
    try {
      // Per riprodurre tutto l'edificio serve il rilievo (quote reali): se manca lo scarico adesso.
      let ril = rilievo;
      let senzaRilievo = false;
      if (!ril) {
        ril = await caricaRilievo();
        senzaRilievo = !ril;
      }
      setLavoro("Preparo la vista 3D…");
      const pianiUsati = ril ? (ril === rilievo ? piani : calcolo.layouts.map((l) => stimaPiano(ril, l.poligono, l.ostacoliLocali))) : [];

      const pannelli = [];
      calcolo.layouts.forEach((l, i) => {
        l.pannelli.slice(0, calcolo.dist.usati[i]).forEach((p) =>
          pannelli.push({ cx: p.cx, cy: p.cy, az: p.az, tilt: p.tilt, portrait: p.portrait, areaIdx: i })
        );
      });
      const areeScena = aree.map((a, i) => ({
        nome: a.nome,
        colore: coloreArea(i),
        tipo: a.tipo,
        poligono: calcolo.layouts[i].poligono,
        ostacoli: calcolo.layouts[i].ostacoliLocali,
        pendenzaDeg: a.tipo === "falda" ? a.tilt : 0,
        azimutDiscesa: calcolo.layouts[i].azimutEffettivo,
        piano: pianiUsati[i] || null,
      }));

      if (ril) {
        // rilievo reale: foto e quote Google, già sulla stessa griglia locale
        const E = ril.estensioneM;
        setScena3d({
          bounds: { xmin: -E, xmax: E, ymin: -E, ymax: E },
          texture: ril.fotoDataUrl,
          altezzaM,
          aree: areeScena,
          pannelli,
          modulo: { l: modulo.lunghezzaM, w: modulo.larghezzaM },
          rilievo: ril,
        });
        return;
      }

      LAYER_OVERLAY.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", "none"));
      await aspettaMappa(map);
      const textureGrezza = map.getCanvas().toDataURL("image/jpeg", 0.9);
      LAYER_OVERLAY.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", "visible"));
      const texture = await riduciImmagine(textureGrezza, 2000, 0.88);
      const b = map.getBounds();
      const sw = lngLatToLocale(centro, [b.getWest(), b.getSouth()]);
      const ne = lngLatToLocale(centro, [b.getEast(), b.getNorth()]);
      setScena3d({
        bounds: { xmin: sw.x, xmax: ne.x, ymin: sw.y, ymax: ne.y },
        texture,
        altezzaM,
        aree: areeScena.map((a) => ({ ...a, piano: null })),
        pannelli,
        modulo: { l: modulo.lunghezzaM, w: modulo.larghezzaM },
      });
      if (senzaRilievo) setAutoMsg({ tipo: "warn", testo: "Rilievo Google non disponibile per questo indirizzo: la vista 3D mostra solo le aree disegnate (quote stimate dall'altezza indicata), non l'intero edificio." });
    } catch (e) {
      setErrore(`Vista 3D non generata: ${e.message}`);
    } finally {
      setLavoro("");
    }
  }

  async function salvaImmagini() {
    const map = mapRef.current;
    if (!map || !scena3d || !ref3d.current) return;
    setLavoro("Salvo le immagini nel preventivo…");
    try {
      await aspettaMappa(map);
      const piantaGrezza = map.getCanvas().toDataURL("image/jpeg", 0.9);
      const pianta = await riduciImmagine(piantaGrezza, 1300, 0.82);
      const v1 = ref3d.current.cattura("sud_est", 1100, 688);
      const v2 = ref3d.current.cattura("sud_ovest", 1100, 688);
      const riepilogo = {
        richiesti: richiesti,
        posizionati: calcolo.dist.posizionati,
        capacita: calcolo.dist.capacitaTotale,
        ripartizione: aree.length > 1 ? ripartizione : null,
        rilievoReale: Boolean(rilievo),
        kwp: calcolo.dist.kwp,
        kwpMassimi: calcolo.dist.kwpMassimi,
        modulo: modulo.nome,
        moduloWp: modulo.wp,
        moduloDim: [Math.round(modulo.lunghezzaM * 1000), Math.round(modulo.larghezzaM * 1000)],
        massimo,
        aree: aree.map((a, i) => ({
          nome: a.nome,
          tipo: a.tipo,
          tilt: a.tilt,
          orient: a.orient,
          disposizione: a.disposizione,
          moduli: calcolo.dist.usati[i],
          capacita: calcolo.layouts[i].capacita,
          areaM2: Math.round(calcolo.layouts[i].areaNettaPiantaM2),
          azimutEffettivo: Math.round(calcolo.layouts[i].azimutEffettivo),
        })),
      };
      aggiornaPosa({
        immagini: { pianta, v3d1: v1, v3d2: v2, firma: firmaLayout(aree, richiesti, ripartizione, moduloDefault ? null : modulo), riepilogo, data: new Date().toISOString() },
      });
    } catch (e) {
      setErrore(`Immagini non salvate: ${e.message}`);
    } finally {
      setLavoro("");
    }
  }

  function scaricaVista() {
    if (!ref3d.current) return;
    const url = ref3d.current.cattura("sud_est", 1600, 1000);
    const a = document.createElement("a");
    a.href = url;
    a.download = "simulazione-posa-pannelli.jpg";
    a.click();
  }

  /* --------------------------------------------------------------- UI */

  const sel = aree.find((a) => a.id === selezionata) || null;
  const selIdx = sel ? aree.indexOf(sel) : -1;
  const selLayout = selIdx >= 0 ? calcolo.layouts[selIdx] : null;
  const { dist } = calcolo;
  const immagini = posa?.immagini || null;
  const immaginiAttuali = immagini && immagini.firma === firmaLayout(aree, richiesti, ripartizione, moduloDefault ? null : modulo);
  const mancanti = dist.mancanti;

  if (!MAPBOX_TOKEN) {
    return (
      <div className="sat-preview-fallback">
        <p>
          Simulazione non disponibile: configura la variabile d&apos;ambiente <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="posa-summary">
        <div>
          <div className="posa-num">
            {dist.posizionati}
            <span> / {richiesti}</span>
          </div>
          <div className="posa-lab">moduli posizionati / richiesti ({dist.kwp} kWp)</div>
        </div>
        <div>
          <div className="posa-num">{dist.capacitaTotale}</div>
          <div className="posa-lab">capacità massima delle aree ({dist.kwpMassimi} kWp)</div>
        </div>
        <div>
          <div className="posa-num">{aree.length}</div>
          <div className="posa-lab">aree disegnate</div>
        </div>
      </div>

      {aree.length > 0 && mancanti > 0 && (
        <div className="info-box" style={{ marginTop: 10 }}>
          Nelle aree disegnate entrano al massimo <strong>{dist.capacitaTotale}</strong> moduli ({dist.kwpMassimi} kWp): ne mancano <strong>{mancanti}</strong> rispetto a quelli richiesti.
          Puoi disegnare altre aree oppure adeguare la taglia dell&apos;impianto.{" "}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAdeguaKwp(dist.kwpMassimi)}>
            Imposta taglia a {dist.kwpMassimi} kWp
          </button>
        </div>
      )}

      <div className="posa-toolbar">
        {!modo ? (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => avviaDisegno("area")}>＋ Disegna area del tetto</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => avviaDisegno("ostacolo")} disabled={!aree.length}>
              ＋ Ostacolo (lucernario, camino…)
            </button>
            {aree.length > 0 && !confermaCancella && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfermaCancella(true)} title="Elimina tutte le aree (e i loro ostacoli) inserite">
                🗑 Cancella tutte le aree
              </button>
            )}
            {aree.length > 0 && confermaCancella && (
              <span className="posa-hint" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                Eliminare tutte le {aree.length} aree?
                <button type="button" className="btn btn-primary btn-sm" onClick={cancellaTutteLeAree}>Sì, cancella tutto</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfermaCancella(false)}>No</button>
              </span>
            )}
          </>
        ) : (
          <>
            <span className="posa-hint">
              {modo === "area" ? "Clicca gli angoli dell'area." : modo === "perimetro" ? "Clicca gli angoli del perimetro: racchiudi solo l'edificio da analizzare." : "Clicca gli angoli dell'ostacolo."} Chiudi con doppio click o cliccando sul primo punto.
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBozza((b) => b.slice(0, -1))} disabled={!bozza.length}>↶ Annulla ultimo punto</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => chiudiBozzaRef.current()} disabled={bozza.length < 3}>Chiudi figura</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={annullaDisegno}>Annulla</button>
          </>
        )}
      </div>

      {errore && <div className="error-box" style={{ marginTop: 8 }}>{errore}</div>}

      <div className="posa-auto" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "10px 0" }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => avviaDisegno("perimetro")} disabled={Boolean(lavoro) || Boolean(modo)} title="Disegna il contorno dell'area disponibile: fuori da lì il rilievo viene ignorato (edifici vicini esclusi)">
          ① {perimetro ? "Ridisegna" : "Disegna"} area disponibile
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={rilevaEDisponi} disabled={Boolean(lavoro) || Boolean(modo) || !perimetro} title={perimetro ? "Riconosce falde e ostacoli nell'area e dispone il massimo dei moduli, dando la precedenza a Sud, Sud-Est e Sud-Ovest" : "Disegna prima l'area disponibile"}>
          ② ✨ Rileva falde e ostacoli e disponi i moduli
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={rilevaFalde} disabled={Boolean(lavoro) || Boolean(modo) || !perimetro} title="Mostra le falde trovate e le scegli tu">
          Scegli le falde a mano
        </button>
        {candNascosti && candidati.length === 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={rivediFalde} disabled={Boolean(lavoro) || Boolean(modo)}>
            Rivedi le falde rilevate ({candNascosti.falde.length - candNascosti.usate.length} non usate)
          </button>
        )}
        {perimetro && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPerimetro(null); setCandidati([]); setSelCand([]); setCandNascosti(null); setAutoMsg(null); }}>
            Cancella area disponibile
          </button>
        )}
      </div>

      <div className="posa-modulo" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", margin: "10px 0", padding: 10, border: "1px solid var(--border)", borderRadius: 10 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Modulo fotovoltaico</label>
          <select
            value={presetModulo}
            onChange={(e) => {
              const pr = PRESET_MODULI.find((x) => x.id === e.target.value);
              if (pr) aggiornaPosa({ modulo: normalizzaModulo(pr) });
            }}
          >
            {PRESET_MODULI.map((pr) => (
              <option key={pr.id} value={pr.id}>{pr.nome} · {Math.round(pr.lunghezzaM * 1000)} × {Math.round(pr.larghezzaM * 1000)} mm</option>
            ))}
            <option value="custom">Personalizzato</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Potenza (Wp)</label>
          <NumeroConferma value={modulo.wp} min={50} max={1000} step={5} width={80} onCommit={(v) => impostaModulo({ wp: v })} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Lato lungo (mm)</label>
          <NumeroConferma value={Math.round(modulo.lunghezzaM * 1000)} min={500} max={3500} step={1} width={90} onCommit={(v) => impostaModulo({ lunghezzaM: v / 1000 })} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Lato corto (mm)</label>
          <NumeroConferma value={Math.round(modulo.larghezzaM * 1000)} min={300} max={2000} step={1} width={90} onCommit={(v) => impostaModulo({ larghezzaM: v / 1000 })} />
        </div>
        <label className="posa-check" style={{ margin: 0 }} title="Se attivo, la taglia dell'impianto non limita i moduli: se ne dispongono quanti ne entrano nelle aree">
          <input type="checkbox" checked={massimo} onChange={(e) => aggiornaPosa({ massimo: e.target.checked })} />
          Posiziona il massimo possibile (ignora la taglia richiesta)
        </label>
        {!moduloDefault && !massimo && (
          <span className="hint" style={{ margin: 0 }}>Con questo modulo servono {richiestiTaglia} moduli per {Number(kwpRichiesti) || 0} kWp.</span>
        )}
      </div>

      <div className="posa-rilievo">
        {!rilievo ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={caricaRilievo} disabled={Boolean(lavoro)}>
              ⛰ Carica rilievo reale (foto e quote Google)
            </button>
            <span className="hint" style={{ margin: 0 }}>
              Il rilievo di tetti, alberi ed edifici vicini viene scaricato in automatico quando serve (rilevamento falde, vista 3D).
            </span>
          </>
        ) : (
          <>
            <span className="posa-rilievo-ok">
              Rilievo Google attivo{rilievo.qualita ? ` · qualità ${rilievo.qualita}` : ""}{rilievo.data ? ` · rilievo del ${rilievo.data}` : ""}
            </span>
            <label className="posa-check" style={{ margin: 0 }}>
              <input type="checkbox" checked={fotoGoogle} onChange={(e) => setFotoGoogle(e.target.checked)} />
              Mostra la foto Google sulla mappa
            </label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRilievo(null); setScena3d(null); setAutoMsg(null); setCandidati([]); setSelCand([]); setCandNascosti(null); }}>
              Rimuovi rilievo
            </button>
            {!rilievo.georefEsatta && (
              <span className="hint" style={{ color: "var(--warn, #b45309)", margin: 0 }}>
                Georeferenziazione approssimata: la foto potrebbe non coincidere perfettamente con la mappa.
              </span>
            )}
          </>
        )}
      </div>
      {rilievoErr && <div className="error-box" style={{ marginTop: 8 }}>{rilievoErr}</div>}
      {autoMsg && (
        <div className={autoMsg.tipo === "ok" ? "info-box" : "error-box"} style={{ marginTop: 8 }}>{autoMsg.testo}</div>
      )}
      {candidati.length > 0 && (
        <div className="posa-cand" style={{ marginTop: 10, border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Falde rilevate: scegli quelle da usare</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelCand(candidati.filter((f) => distanzaDalSud(f) <= 67).map((f) => f.id))}>
              Solo quelle rivolte a Sud
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelCand(candidati.map((f) => f.id))}>Tutte</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelCand([])}>Nessuna</button>
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            {candidati.map((f, i) => (
              <label key={f.id} className="posa-check" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={selCand.includes(f.id)}
                  onChange={() => setSelCand((v) => (v.includes(f.id) ? v.filter((x) => x !== f.id) : [...v, f.id]))}
                />
                <strong>{i + 1}</strong> · {etichettaEsposizione(f)}
                {f.tipo === "falda" ? ` (${f.orientApp > 0 ? "+" : ""}${f.orientApp}°, pend. ${Math.round(f.pendenzaDeg)}°)` : ""} · {Math.round(f.areaM2)} m²
                {f.ostacoli.length ? ` · ${f.ostacoli.length} ostacol${f.ostacoli.length === 1 ? "o" : "i"}` : ""}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={usaFaldeScelte} disabled={!selCand.length}>
              Usa le falde scelte ({selCand.length})
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCandidati([]); setSelCand([]); setAutoMsg(null); }}>Chiudi</button>
          </div>
        </div>
      )}

      {aree.length > 1 && (
        <div className="posa-ripartizione">
          <div className="posa-ripartizione-titolo">Come distribuire i {richiesti} moduli tra le {aree.length} aree</div>
          <label className={`posa-radio ${ripartizione === "sequenziale" ? "on" : ""}`}>
            <input type="radio" name="ripartizione" checked={ripartizione === "sequenziale"} onChange={() => aggiornaPosa({ ripartizione: "sequenziale" })} />
            <span>
              <strong>In ordine</strong> — la prima area si riempie, la seconda prende il resto
            </span>
          </label>
          <label className={`posa-radio ${ripartizione === "uniforme" ? "on" : ""}`}>
            <input type="radio" name="ripartizione" checked={ripartizione === "uniforme"} onChange={() => aggiornaPosa({ ripartizione: "uniforme" })} />
            <span>
              <strong>Uniforme</strong> — stessa quantità su ogni area (es. metà e metà), nei limiti della capacità di ciascuna
            </span>
          </label>
        </div>
      )}

      <div className="posa-mapwrap">
        <div ref={containerRef} className="posa-map" />
        {daConfigurare && (
          <div className="posa-chooser">
            <div className="posa-chooser-box">
              <h4>Che tipo di tetto è quest&apos;area?</h4>
              <p>La disposizione dei moduli cambia: su un tetto piano i moduli sono inclinati su file distanziate, su una falda seguono la pendenza.</p>
              <div className="posa-chooser-btns">
                <button type="button" className="btn btn-primary" onClick={() => creaArea("piano")}>Tetto piano</button>
                <button type="button" className="btn btn-primary" onClick={() => creaArea("falda")}>Tetto a falda</button>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDaConfigurare(null)}>Annulla</button>
            </div>
          </div>
        )}
        <div className="posa-legend">
          <span><i style={{ background: "#1e3a8a" }} /> moduli posizionati</span>
          <span><i style={{ background: "#93c5fd" }} /> capacità non usata</span>
          <span><i style={{ background: "#fbbf24" }} /> area</span>
          <span><i style={{ background: "#ef4444" }} /> ostacolo</span>
          {perimetro && <span><i style={{ background: "#38bdf8" }} /> perimetro</span>}
        </div>
      </div>

      {aree.length > 0 && (
        <div className="posa-areas">
          {aree.map((a, i) => (
            <button
              key={a.id}
              type="button"
              className={`posa-area-chip ${a.id === selezionata ? "active" : ""}`}
              onClick={() => setSelezionata(a.id === selezionata ? null : a.id)}
            >
              <i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: coloreArea(i), marginRight: 6 }} />
              {aree.length > 1 && ripartizione === "sequenziale" ? `${i + 1}. ` : ""}<strong>{a.nome}</strong> · {a.tipo === "piano" ? "piano" : "falda"} · {dist.usati[i]}/{calcolo.layouts[i].capacita} moduli
            </button>
          ))}
        </div>
      )}

      {sel && selLayout && (
        <div className="posa-edit">
          <div className="posa-edit-head">
            <input
              type="text"
              value={sel.nome}
              onChange={(e) => modificaArea(sel.id, { nome: e.target.value })}
              aria-label="Nome area"
            />
            <div className="posa-seg">
              <button type="button" className={sel.tipo === "piano" ? "on" : ""} onClick={() => sel.tipo !== "piano" && cambiaTipo(sel, "piano")}>Tetto piano</button>
              <button type="button" className={sel.tipo === "falda" ? "on" : ""} onClick={() => sel.tipo !== "falda" && cambiaTipo(sel, "falda")}>Tetto a falda</button>
            </div>
            {aree.length > 1 && (
              <div className="posa-order" title="Ordine di riempimento (conta con la ripartizione «In ordine»)">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => spostaArea(sel.id, -1)} disabled={selIdx === 0} aria-label="Sposta prima">▲</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => spostaArea(sel.id, 1)} disabled={selIdx === aree.length - 1} aria-label="Sposta dopo">▼</button>
              </div>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => duplicaArea(sel.id)} title="Crea una copia identica, parallela e a 1 m di distanza, da trascinare dove serve (utile per disegnare stringhe uguali)">
              ⧉ Duplica falda
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => eliminaArea(sel.id)}>Elimina area</button>
          </div>
          <div className="posa-move" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "8px 0" }}>
            <button type="button" className={`btn btn-sm ${spostaAttivo ? "btn-primary" : "btn-ghost"}`} onClick={() => setSpostaAttivo((v) => !v)} disabled={Boolean(modo)}>
              ✥ {spostaAttivo ? "Spostamento attivo" : "Sposta area"}
            </button>
            <span className="hint" style={{ margin: 0 }}>
              {spostaAttivo ? "Trascina l'area sulla mappa, oppure usa le frecce (0,5 m a ogni click)." : "Attivalo per trascinare l'area sulla mappa."}
            </span>
            <span className="hint" style={{ margin: 0, display: "inline-flex", gap: 4, alignItems: "center" }}>
              Distanza della copia (m)
              <NumeroConferma value={distanzaCopiaM} min={0} max={30} step={0.1} width={64} onCommit={setDistanzaCopiaM} />
            </span>
            <span style={{ display: "inline-flex", gap: 4 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => nudgeArea(sel.id, -0.5, 0)} aria-label="Sposta a Ovest">◀</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => nudgeArea(sel.id, 0, 0.5)} aria-label="Sposta a Nord">▲</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => nudgeArea(sel.id, 0, -0.5)} aria-label="Sposta a Sud">▼</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => nudgeArea(sel.id, 0.5, 0)} aria-label="Sposta a Est">▶</button>
            </span>
          </div>

          <div className="posa-edit-grid">
            <div>
              {sel.tipo === "piano" && (
                <div className="field">
                  <label>Disposizione dei moduli</label>
                  <select
                    value={sel.disposizione}
                    onChange={(e) =>
                      modificaArea(sel.id, {
                        disposizione: e.target.value,
                        tilt: e.target.value === "estovest" ? POSA_DEFAULT.tiltPianoEstOvest : POSA_DEFAULT.tiltPianoSud,
                      })
                    }
                  >
                    <option value="sud">File inclinate verso l&apos;orientamento (es. Sud)</option>
                    <option value="estovest">Est-Ovest a coppie (più moduli, inclinazione bassa)</option>
                  </select>
                </div>
              )}
              <div className="field">
                <label>{sel.tipo === "piano" ? "Inclinazione dei moduli (°)" : "Pendenza della falda (°)"}</label>
                <input
                  type="number" min="0" max="60" step="1" value={sel.tilt}
                  onChange={(e) => modificaArea(sel.id, { tilt: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })}
                />
                {sel.tipo === "piano" && sel.disposizione !== "estovest" && selLayout.interfilaM !== null && (
                  <p className="hint">Distanza tra le file per non farsi ombra (solstizio d&apos;inverno): {selLayout.interfilaM.toFixed(2).replace(".", ",")} m.</p>
                )}
              </div>
              <div className="field">
                <label>Posa dei moduli</label>
                <select value={sel.orientamentoModulo} onChange={(e) => modificaArea(sel.id, { orientamentoModulo: e.target.value })}>
                  <option value="auto">Automatica (la più capiente)</option>
                  <option value="verticale">Verticale</option>
                  <option value="orizzontale">Orizzontale</option>
                </select>
                {selLayout.capacita > 0 && <p className="hint">In uso: {selLayout.orientamentoModulo}.</p>}
              </div>
              <div className="field">
                <label>Distanza dai bordi (m)</label>
                <input
                  type="number" min="0" max="5" step="0.1" value={sel.margine}
                  onChange={(e) => modificaArea(sel.id, { margine: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })}
                />
              </div>
              <label className="posa-check">
                <input type="checkbox" checked={sel.allinea !== false} onChange={(e) => modificaArea(sel.id, { allinea: e.target.checked })} />
                Allinea i moduli ai lati dell&apos;edificio
              </label>
              {sel.tipo === "falda" && (
                <label className="posa-check" title="Negli spazi che la griglia lascia liberi (bordi, attorno agli ostacoli) si posano moduli ruotati di 90° per contenerne il più possibile">
                  <input type="checkbox" checked={sel.riempiResti !== false} onChange={(e) => modificaArea(sel.id, { riempiResti: e.target.checked })} />
                  Riempi gli spazi residui con moduli ruotati (più moduli)
                </label>
              )}
            </div>
            <div>
              <div className="field" style={{ marginBottom: 4 }}>
                <label>
                  {sel.tipo === "falda"
                    ? "Verso cui è rivolta la falda"
                    : sel.disposizione === "estovest"
                    ? "Rotazione di riferimento (0 = file Est-Ovest)"
                    : "Verso cui sono rivolti i moduli"}
                </label>
                <input
                  type="number" min="-180" max="180" step="1" value={sel.orient}
                  onChange={(e) => modificaArea(sel.id, { orient: Math.max(-180, Math.min(180, Number(e.target.value) || 0)) })}
                />
                <p className="hint">0 = Sud, +90 = Ovest, −90 = Est, ±180 = Nord.</p>
              </div>
              <OrientamentoDial value={String(sel.orient)} onChange={(v) => modificaArea(sel.id, { orient: Number(v) })} />
            </div>
          </div>

          <p className="hint" style={{ marginTop: 6 }}>
            Superficie {Math.round(selLayout.areaNettaPiantaM2)} m² in pianta
            {sel.tipo === "falda" ? ` (≈ ${Math.round(selLayout.areaRealeM2)} m² sulla falda)` : ""} · capacità {selLayout.capacita} moduli · orientamento effettivo{" "}
            {orientApp(selLayout.azimutEffettivo)}° (0 = Sud).
            {(sel.ostacoli || []).length > 0 && (
              <>
                {" "}· {(sel.ostacoli || []).length} ostacol{(sel.ostacoli || []).length === 1 ? "o" : "i"}{" "}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => rimuoviOstacoli(sel.id)}>rimuovi</button>
              </>
            )}
          </p>
          {rilievo && piani[selIdx] && (() => {
            const pi = piani[selIdx];
            const pend = Math.round(pi.pendenzaDeg);
            const ver = orientApp(pi.azimutDiscesa);
            const piatto = pi.pendenzaDeg < 4;
            return (
              <div className="posa-rilevato">
                <span>
                  Dal rilievo Google: pendenza <strong>{pend}°</strong>
                  {piatto ? " (copertura praticamente piana)" : <>, falda rivolta a <strong>{ver}°</strong> (0 = Sud)</>}
                  {pi.rms > 0.35 ? " · superficie irregolare, valore poco affidabile" : ""}.
                </span>
                {sel.tipo === "falda" && !piatto && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => modificaArea(sel.id, { tilt: Math.max(0, Math.min(60, pend)), orient: Math.max(-180, Math.min(180, ver)) })}
                  >
                    Usa valori rilevati
                  </button>
                )}
                {sel.tipo === "falda" && piatto && <span className="hint" style={{ margin: 0 }}>Sembra un tetto piano: valuta di cambiare il tipo.</span>}
                {sel.tipo === "piano" && !piatto && <span className="hint" style={{ margin: 0 }}>Sembra una falda: valuta di cambiare il tipo.</span>}
              </div>
            );
          })()}
          {diffGradi(orientApp(selLayout.azimutEffettivo), orientForm) > 5 && sel.tipo !== "falda" && sel.disposizione !== "estovest" && (
            <p className="hint" style={{ color: "var(--warn, #b45309)" }}>
              Attenzione: l&apos;orientamento di posa differisce da quello usato per calcolare la produzione ({orientForm}°): la stima PVGIS resta riferita a quel valore.
            </p>
          )}
        </div>
      )}

      <div className="posa-3d-head">
        <div className="field" style={{ margin: 0 }}>
          <label>{rilievo ? "Altezza del tetto (m) — non usata con il rilievo reale" : "Altezza del tetto/gronda (m) — solo se manca il rilievo"}</label>
          <input
            type="number" min="2" max="40" step="0.5" value={altezzaM} disabled={Boolean(rilievo)}
            onChange={(e) => aggiornaPosa({ altezzaM: Math.max(2, Math.min(40, Number(e.target.value) || 8)) })}
            style={{ maxWidth: 120 }}
          />
        </div>
        <button type="button" className="btn btn-primary" onClick={generaVista3d} disabled={!dist.posizionati || !mapPronta || Boolean(lavoro)}>
          {scena3d ? "Aggiorna vista 3D" : "Genera vista 3D dell'edificio"}
        </button>
      </div>
      {!aree.length && <p className="hint">Disegna almeno un&apos;area del tetto per vedere la disposizione dei moduli e generare la vista 3D.</p>}
      {lavoro && <p className="hint">{lavoro}</p>}

      {scena3d && (
        <div style={{ marginTop: 12 }}>
          <div className="posa-views">
            {[["sud_est", "Da Sud-Est"], ["sud_ovest", "Da Sud-Ovest"], ["nord_est", "Da Nord-Est"], ["alto", "Dall'alto"]].map(([k, l]) => (
              <button key={k} type="button" className="btn btn-ghost btn-sm" onClick={() => ref3d.current?.setVista(k)}>{l}</button>
            ))}
            <span className="posa-sep" style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 4px" }} />
            <button type="button" className={`btn btn-sm ${stile3d === "colori" ? "btn-primary" : "btn-ghost"}`} onClick={() => setStile3d("colori")}>Modello a colori</button>
            <button type="button" className={`btn btn-sm ${stile3d === "foto" ? "btn-primary" : "btn-ghost"}`} onClick={() => setStile3d("foto")} disabled={!scena3d.texture}>Foto reale</button>
            <label className="posa-check" style={{ margin: 0 }}>
              <input type="checkbox" checked={aree3d} onChange={(e) => setAree3d(e.target.checked)} />
              Aree colorate
            </label>
            <span className="hint" style={{ margin: 0 }}>Trascina per ruotare, rotellina per lo zoom.</span>
          </div>
          <RoofScene3D ref={ref3d} scena={scena3d} stile={stile3d} mostraAree={aree3d} />
          {scena3d.aree.length > 0 && (
            <div className="posa-legend" style={{ position: "static", marginTop: 6, display: "flex", flexWrap: "wrap", gap: 12 }}>
              {scena3d.aree.map((a) => (
                <span key={a.nome + a.colore}><i style={{ background: a.colore }} /> {a.nome}</span>
              ))}
              <span><i style={{ background: "#1e3a8a" }} /> moduli</span>
              <span><i style={{ background: "#ef4444" }} /> ostacoli</span>
            </div>
          )}
          <div className="posa-actions">
            <button type="button" className="btn btn-primary" onClick={salvaImmagini} disabled={Boolean(lavoro)}>
              Usa queste immagini nel preventivo (PDF)
            </button>
            <button type="button" className="btn btn-ghost" onClick={scaricaVista}>Scarica immagine 3D</button>
          </div>
          <p className="hint">
            {scena3d.rilievo
              ? "Rilievo e foto: Imagery © Google (Solar API). Le quote hanno risoluzione di circa 50 cm: i bordi dei tetti sono addolciti. Simulazione indicativa: verificare ingombri, ombreggiamenti e portata della copertura in sopralluogo."
              : "Simulazione indicativa: la quota e le pareti degli edifici sono stimate dall'altezza indicata, non da un rilievo (carica il rilievo reale per una vista fedele). Verificare ingombri, ombreggiamenti e portata della copertura in sopralluogo."}
          </p>
        </div>
      )}

      {immagini && (
        <div className={immaginiAttuali ? "info-box" : "error-box"} style={{ marginTop: 10 }}>
          {immaginiAttuali
            ? "Le immagini della simulazione sono salvate nel preventivo e compaiono nel PDF."
            : "Le immagini salvate nel preventivo non corrispondono più al layout attuale: rigenera la vista 3D e salvale di nuovo."}
        </div>
      )}
    </div>
  );
}
