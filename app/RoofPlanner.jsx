"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoofScene3D from "./RoofScene3D";
import OrientamentoDial from "./OrientamentoDial";
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

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

const LAYER_OVERLAY = [
  "aree-fill", "aree-line", "ostacoli-fill", "ostacoli-line",
  "pann-extra-fill", "pann-usati-fill", "pann-usati-line", "bozza-line", "bozza-pts",
];

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
function firmaLayout(aree, n) {
  const s = JSON.stringify([aree.map((a) => [a.ring, a.ostacoli, a.tipo, a.tilt, a.orient, a.disposizione, a.orientamentoModulo, a.margine, a.allinea]), n]);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
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
  const orientForm = Number.isFinite(Number(orientamentoForm)) ? Number(orientamentoForm) : 0;
  const tiltForm = Number.isFinite(Number(inclinazioneForm)) ? Number(inclinazioneForm) : 25;

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapPronta, setMapPronta] = useState(false);
  const [errore, setErrore] = useState("");

  const [modo, setModo] = useState(null); // null | "area" | "ostacolo"
  const [bozza, setBozza] = useState([]);
  const [daConfigurare, setDaConfigurare] = useState(null); // { ring }
  const [selezionata, setSelezionata] = useState(null);
  const [scena3d, setScena3d] = useState(null);
  const [lavoro, setLavoro] = useState("");
  const ref3d = useRef(null);

  // specchi per i gestori dell'evento della mappa (registrati una sola volta)
  const modoRef = useRef(null);
  const bozzaRef = useRef([]);
  const areeRef = useRef([]);
  const selezRef = useRef(null);
  useEffect(() => { modoRef.current = modo; }, [modo]);
  useEffect(() => { bozzaRef.current = bozza; }, [bozza]);
  useEffect(() => { areeRef.current = aree; }, [aree]);
  useEffect(() => { selezRef.current = selezionata; }, [selezionata]);

  const aggiornaPosa = useCallback(
    (patch) => onPosaChange({ aree, altezzaM, immagini: posa?.immagini || null, ...patch }),
    [onPosaChange, aree, altezzaM, posa]
  );

  /* ------------------------------------------------------------- calcolo */

  const calcolo = useMemo(() => {
    const layouts = aree.map((a) => {
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
      });
      return { ...layout, poligono, ostacoliLocali: ostacoli };
    });
    const dist = distribuisciPannelli(layouts, pannelliRichiesti, norm360(180 + orientForm));
    return { layouts, dist };
  }, [aree, centro, pannelliRichiesti, orientForm]);

  // dati GeoJSON per la mappa
  const geo = useMemo(() => {
    const pol = (pts) => {
      const ring = pts.map((p) => p.slice());
      ring.push(ring[0]);
      return [ring];
    };
    const areeF = aree.map((a) => ({
      type: "Feature",
      properties: { id: a.id, sel: a.id === selezionata ? 1 : 0 },
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
          ["aree", "ostacoli", "pann-usati", "pann-extra", "bozza-linea", "bozza-punti"].forEach(src);
          map.addLayer({ id: "aree-fill", type: "fill", source: "aree", paint: { "fill-color": "#f59e0b", "fill-opacity": 0.14 } });
          map.addLayer({
            id: "aree-line", type: "line", source: "aree",
            paint: { "line-color": ["case", ["==", ["get", "sel"], 1], "#ffffff", "#fbbf24"], "line-width": ["case", ["==", ["get", "sel"], 1], 3, 2] },
          });
          map.addLayer({ id: "ostacoli-fill", type: "fill", source: "ostacoli", paint: { "fill-color": "#ef4444", "fill-opacity": 0.45 } });
          map.addLayer({ id: "ostacoli-line", type: "line", source: "ostacoli", paint: { "line-color": "#fecaca", "line-width": 1.5 } });
          map.addLayer({ id: "pann-extra-fill", type: "fill", source: "pann-extra", paint: { "fill-color": "#93c5fd", "fill-opacity": 0.35 } });
          map.addLayer({ id: "pann-usati-fill", type: "fill", source: "pann-usati", paint: { "fill-color": "#1e3a8a", "fill-opacity": 0.88 } });
          map.addLayer({ id: "pann-usati-line", type: "line", source: "pann-usati", paint: { "line-color": "#bfdbfe", "line-width": 0.6 } });
          map.addLayer({ id: "bozza-line", type: "line", source: "bozza-linea", paint: { "line-color": "#22d3ee", "line-width": 2.5, "line-dasharray": [2, 1] } });
          map.addLayer({ id: "bozza-pts", type: "circle", source: "bozza-punti", paint: { "circle-radius": 5, "circle-color": "#22d3ee", "circle-stroke-color": "#0e7490", "circle-stroke-width": 2 } });
          setMapPronta(true);
        });

        map.on("click", (e) => {
          const m = modoRef.current;
          const pt = [e.lngLat.lng, e.lngLat.lat];
          if (!m) {
            // selezione di un'area cliccandoci sopra
            const loc = lngLatToLocale(centro, pt);
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
    map.getSource("bozza-linea")?.setData(geoBozza.linea);
    map.getSource("bozza-punti")?.setData(geoBozza.punti);
  }, [geoBozza, mapPronta]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapPronta) return;
    map.getCanvas().style.cursor = modo ? "crosshair" : "";
    if (modo) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [modo, mapPronta]);

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
    if (modoRef.current === "ostacolo") {
      const loc = lngLatToLocale(centro, pulita[0]);
      let target = areeRef.current.find((a) => a.id === selezRef.current);
      if (!target) target = areeRef.current.find((a) => puntoInPoligono(loc, a.ring.map((p) => lngLatToLocale(centro, p))));
      if (!target) {
        setErrore("L'ostacolo deve stare dentro un'area: disegna prima l'area o selezionala.");
      } else {
        onPosaChange({
          aree: areeRef.current.map((a) => (a.id === target.id ? { ...a, ostacoli: [...(a.ostacoli || []), pulita] } : a)),
          altezzaM, immagini: posa?.immagini || null,
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
      nome: `Area ${aree.length + 1}`,
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
    onPosaChange({ aree: [...aree, area], altezzaM, immagini: posa?.immagini || null });
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
    setLavoro("Preparo la vista 3D…");
    setErrore("");
    try {
      LAYER_OVERLAY.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", "none"));
      await aspettaMappa(map);
      const textureGrezza = map.getCanvas().toDataURL("image/jpeg", 0.9);
      LAYER_OVERLAY.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", "visible"));
      const texture = await riduciImmagine(textureGrezza, 2000, 0.88);
      const b = map.getBounds();
      const sw = lngLatToLocale(centro, [b.getWest(), b.getSouth()]);
      const ne = lngLatToLocale(centro, [b.getEast(), b.getNorth()]);
      const pannelli = [];
      calcolo.layouts.forEach((l, i) => {
        l.pannelli.slice(0, calcolo.dist.usati[i]).forEach((p) =>
          pannelli.push({ cx: p.cx, cy: p.cy, az: p.az, tilt: p.tilt, portrait: p.portrait, areaIdx: i })
        );
      });
      setScena3d({
        bounds: { xmin: sw.x, xmax: ne.x, ymin: sw.y, ymax: ne.y },
        texture,
        altezzaM,
        aree: aree.map((a, i) => ({
          tipo: a.tipo,
          poligono: calcolo.layouts[i].poligono,
          ostacoli: calcolo.layouts[i].ostacoliLocali,
          pendenzaDeg: a.tipo === "falda" ? a.tilt : 0,
          azimutDiscesa: calcolo.layouts[i].azimutEffettivo,
        })),
        pannelli,
      });
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
        richiesti: Math.round(pannelliRichiesti),
        posizionati: calcolo.dist.posizionati,
        capacita: calcolo.dist.capacitaTotale,
        kwp: calcolo.dist.kwp,
        kwpMassimi: calcolo.dist.kwpMassimi,
        modulo: MODULO.nome,
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
        immagini: { pianta, v3d1: v1, v3d2: v2, firma: firmaLayout(aree, pannelliRichiesti), riepilogo, data: new Date().toISOString() },
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
  const immaginiAttuali = immagini && immagini.firma === firmaLayout(aree, pannelliRichiesti);
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
            <span> / {Math.round(pannelliRichiesti)}</span>
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
          </>
        ) : (
          <>
            <span className="posa-hint">
              {modo === "area" ? "Clicca gli angoli dell'area." : "Clicca gli angoli dell'ostacolo."} Chiudi con doppio click o cliccando sul primo punto.
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBozza((b) => b.slice(0, -1))} disabled={!bozza.length}>↶ Annulla ultimo punto</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => chiudiBozzaRef.current()} disabled={bozza.length < 3}>Chiudi figura</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={annullaDisegno}>Annulla</button>
          </>
        )}
      </div>

      {errore && <div className="error-box" style={{ marginTop: 8 }}>{errore}</div>}

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
              <strong>{a.nome}</strong> · {a.tipo === "piano" ? "piano" : "falda"} · {dist.usati[i]}/{calcolo.layouts[i].capacita} moduli
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
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => eliminaArea(sel.id)}>Elimina area</button>
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
          {diffGradi(orientApp(selLayout.azimutEffettivo), orientForm) > 5 && sel.tipo !== "falda" && sel.disposizione !== "estovest" && (
            <p className="hint" style={{ color: "var(--warn, #b45309)" }}>
              Attenzione: l&apos;orientamento di posa differisce da quello usato per calcolare la produzione ({orientForm}°): la stima PVGIS resta riferita a quel valore.
            </p>
          )}
        </div>
      )}

      <div className="posa-3d-head">
        <div className="field" style={{ margin: 0 }}>
          <label>Altezza del tetto/gronda (m) — solo per la vista 3D</label>
          <input
            type="number" min="2" max="40" step="0.5" value={altezzaM}
            onChange={(e) => aggiornaPosa({ altezzaM: Math.max(2, Math.min(40, Number(e.target.value) || 8)) })}
            style={{ maxWidth: 120 }}
          />
        </div>
        <button type="button" className="btn btn-primary" onClick={generaVista3d} disabled={!dist.posizionati || !mapPronta || Boolean(lavoro)}>
          {scena3d ? "Aggiorna vista 3D" : "Genera vista 3D"}
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
            <span className="hint" style={{ margin: 0 }}>Trascina per ruotare, rotellina per lo zoom.</span>
          </div>
          <RoofScene3D ref={ref3d} scena={scena3d} />
          <div className="posa-actions">
            <button type="button" className="btn btn-primary" onClick={salvaImmagini} disabled={Boolean(lavoro)}>
              Usa queste immagini nel preventivo (PDF)
            </button>
            <button type="button" className="btn btn-ghost" onClick={scaricaVista}>Scarica immagine 3D</button>
          </div>
          <p className="hint">
            Simulazione indicativa: la quota e le pareti degli edifici sono stimate dall&apos;altezza indicata, non da un rilievo. Verificare ingombri, ombreggiamenti e portata della copertura in sopralluogo.
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
