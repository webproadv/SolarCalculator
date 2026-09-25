// Funzioni di accesso alle fonti dati esterne (P.IVA, Solar API, PVGIS),
// condivise dalle singole API route e dall'orchestratore /api/quote.

import { azimuthToPvgisAspect } from "./calc";
import { DEMO_COMPANY, DEMO_ROOF, DEMO_PVGIS_YIELD } from "./demoData";

// Geocodifica un indirizzo testuale in lat/lng tramite Google Geocoding API.
// Usa la stessa chiave della Solar API: se la chiave è ristretta alla sola
// Solar API, va abilitata anche la Geocoding API sullo stesso progetto/chiave.
async function geocodeAddress(indirizzoCompleto) {
  const apiKey = process.env.GOOGLE_SOLAR_API_KEY;
  if (!apiKey) return { lat: null, lng: null };

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    indirizzoCompleto
  )}&region=it&key=${apiKey}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    console.error(`Geocoding HTTP ${r.status}: ${await r.text()}`);
    return { lat: null, lng: null };
  }
  const data = await r.json();
  const loc = data?.results?.[0]?.geometry?.location;
  if (!loc) {
    console.error(`Geocoding status=${data.status} error_message=${data.error_message || "n/d"}`);
    return { lat: null, lng: null };
  }
  return { lat: loc.lat, lng: loc.lng };
}

// "VIA EMILIA EST 1163, 41122 MODENA MO" -> { indirizzo, cap, comune, provincia }
function parseIndirizzoRegistroImprese(adresseSiege) {
  if (!adresseSiege) return { indirizzo: "", cap: "", comune: "", provincia: "" };
  const match = adresseSiege.match(/^(.*),\s*(\d{5})\s+(.+?)\s+([A-Z]{2})$/);
  if (!match) return { indirizzo: adresseSiege, cap: "", comune: "", provincia: "" };
  const [, indirizzo, cap, comune, provincia] = match;
  return { indirizzo: indirizzo.trim(), cap, comune: comune.trim(), provincia };
}

async function lookupCompanyApify(piva, token) {
  const actorPath = "dltik~italy-company-registry-scraper";
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "lookup", query: piva, richResults: true }),
      cache: "no-store",
    }
  );
  if (!r.ok) throw new Error(`Apify ${r.status}: ${await r.text()}`);
  const items = await r.json();
  const record = Array.isArray(items) ? items.find((it) => "found" in it) : null;
  if (!record) throw new Error("Apify: risposta senza dati aziendali (nessun item con 'found')");
  if (!record.found) throw new Error(`Apify: Partita IVA ${piva} non trovata nel Registro Imprese`);

  const { indirizzo, cap, comune, provincia } = parseIndirizzoRegistroImprese(record.adresse_siege);
  const { lat, lng } = await geocodeAddress(record.adresse_siege || "");

  return {
    demo: false,
    piva,
    ragioneSociale: record.raison_sociale || record.nom_complet || "",
    indirizzo,
    cap,
    comune,
    provincia,
    lat,
    lng,
    stato: record.etat_administratif || null,
    fonte: "apify:registro-imprese",
  };
}

async function lookupCompanyOpenApi(piva, apiKey) {
  const r = await fetch(`https://company.openapi.com/IT-address/${encodeURIComponent(piva)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`OpenAPI.com ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return {
    demo: false,
    piva,
    ragioneSociale: data.companyName || data.denominazione || "",
    indirizzo: data.address?.street || data.indirizzo || "",
    cap: data.address?.zipCode || data.cap || "",
    comune: data.address?.city || data.comune || "",
    provincia: data.address?.province || data.provincia || "",
    lat: data.address?.latitude ?? data.latitude ?? null,
    lng: data.address?.longitude ?? data.longitude ?? null,
    fonte: "openapi.com",
  };
}

// Fonte preferita: Apify (Registro Imprese / VIES) se APIFY_API_TOKEN è
// configurato; altrimenti openapi.com se OPENAPI_KEY è configurato;
// altrimenti dati di esempio (modalità demo).
export async function lookupCompany(piva) {
  const apifyToken = process.env.APIFY_API_TOKEN;
  const openApiKey = process.env.OPENAPI_KEY;

  if (apifyToken) return lookupCompanyApify(piva, apifyToken);
  if (openApiKey) return lookupCompanyOpenApi(piva, openApiKey);
  return { ...DEMO_COMPANY, piva };
}

// Nessun rilievo satellitare disponibile per questo punto (indirizzo fuori
// dalla copertura ad alta risoluzione della Solar API — capita spesso per
// comuni piccoli o edifici non ancora rilevati): non un errore dell'app, va
// gestito lasciando comunque generare il preventivo (dimensionato solo sui
// consumi, senza vincolo di superficie tetto).
const NO_ROOF_DATA = {
  demo: false,
  noRoofData: true,
  imageryDate: null,
  imageryQuality: null,
  maxArrayPanelsCount: null,
  maxArrayAreaMeters2: null,
  carbonOffsetFactorKgPerMwh: null,
  segments: [],
  solarPanels: [],
};

export async function fetchRoof(lat, lng) {
  const apiKey = process.env.GOOGLE_SOLAR_API_KEY;
  if (!apiKey) return DEMO_ROOF;

  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${apiKey}`;
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 404) return NO_ROOF_DATA;
  if (!r.ok) throw new Error(`Google Solar API ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const segments = (data.solarPotential?.roofSegmentStats || []).map((s, i) => ({
    nome: `Segmento ${i + 1}`,
    areaMeters2: s.stats?.areaMeters2 ?? s.areaMeters2 ?? 0,
    pitchDegrees: s.pitchDegrees,
    azimuthDegrees: s.azimuthDegrees,
  }));
  // Posizione dei singoli pannelli candidati (ordinati dall'algoritmo Google
  // per producibilità decrescente): usata solo per generare la foto con la
  // simulazione dei pannelli (vedi fetchRoofImages), non nel dimensionamento.
  const solarPanels = (data.solarPotential?.solarPanels || [])
    .filter((p) => p.center)
    .map((p) => ({
      lat: p.center.latitude,
      lng: p.center.longitude,
      orientation: p.orientation,
      segmentIndex: p.segmentIndex ?? 0,
      yearlyEnergyDcKwh: p.yearlyEnergyDcKwh,
    }));
  return {
    demo: false,
    imageryDate: data.imageryDate ? `${data.imageryDate.year}-${data.imageryDate.month}-${data.imageryDate.day}` : null,
    imageryQuality: data.imageryQuality,
    maxArrayPanelsCount: data.solarPotential?.maxArrayPanelsCount,
    maxArrayAreaMeters2: data.solarPotential?.maxArrayAreaMeters2,
    carbonOffsetFactorKgPerMwh: data.solarPotential?.carbonOffsetFactorKgPerMwh,
    segments: segments.length ? segments : DEMO_ROOF.segments,
    solarPanels,
  };
}

// Metri coperti da un pixel a una data latitudine/zoom nella proiezione Web
// Mercator standard (schema a tile 256px usato da Google Maps, Mapbox, OSM
// ecc. — la formula e i livelli di zoom sono gli stessi su tutti questi
// fornitori).
function metriPerPixel(latDeg, zoom) {
  return (156543.03392 * Math.cos((latDeg * Math.PI) / 180)) / Math.pow(2, zoom);
}

// Livello di zoom che fa stare un diametro di ~2×radiusMeters nella larghezza
// dell'immagine richiesta (stessa idea di "inquadratura" usata prima con la
// richiesta dataLayers, qui applicata allo zoom della Mapbox Static Images
// API). Il -1 finale allarga l'inquadratura di un livello (~2× l'area
// visibile) rispetto al calcolo "esatto", per lasciare più contesto attorno
// all'edificio invece di un'inquadratura troppo stretta.
function zoomPerRaggio(latDeg, radiusMeters, imageWidthPx) {
  const metriPerPixelDesiderati = (radiusMeters * 2) / imageWidthPx;
  const zoomGrezzo = Math.log2(156543.03392 * Math.cos((latDeg * Math.PI) / 180) / metriPerPixelDesiderati) - 1;
  return Math.min(19, Math.max(14, Math.round(zoomGrezzo)));
}

// Genera la foto aerea del sito tramite la Mapbox Static Images API (stile
// "satellite-v9", vista satellitare pura senza etichette), inquadrata sulle
// coordinate dell'azienda.
//
// PERCHÉ MAPBOX E NON GOOGLE: una versione precedente usava la Google Maps
// Static API (maptype=satellite), ma dall'8 luglio 2025 Google ha bloccato le
// immagini satellitari/hybrid per tutti i progetti con fatturazione in area
// EEA (Europa), come parte degli adeguamenti al Digital Markets Act — la API
// risponde 403 "satellite and hybrid map types are not available for your
// account and region" (vedi https://developers.google.com/maps/comms/eea/maps-static
// e, per lo stesso motivo, https://developers.google.com/maps/comms/eea/map-tiles).
// L'unica via che Google lascia aperta per il satellite è lato browser
// (Maps JavaScript API) o negli SDK nativi Android/iOS: non utilizzabile per
// generare un'immagine statica lato server come serve qui (PDF/report).
// Mapbox non è soggetto a questa restrizione ed espone la stessa identica
// logica (chiamata REST -> immagine statica), quindi è il sostituto più
// diretto: cambia solo il fornitore, non l'architettura.
//
// Prima ancora, la versione precedente a Google Maps era basata sul layer RGB
// della Google Solar API (dataLayers): quella richiesta è nel livello
// "Enterprise" della Solar API ed è disponibile solo dove Google ha fatto un
// rilievo dettagliato dell'edificio, quindi falliva spesso ("nessun layer RGB
// disponibile") anche per indirizzi normalmente coperti da satellite. Dato
// che l'app non disegna più i pannelli sovrapposti alla foto (vedi nota
// storica sotto), una semplice foto satellitare centrata sul sito è
// sufficiente ed è disponibile ovunque Mapbox abbia copertura satellitare —
// praticamente ogni indirizzo, incluso quando buildingInsights non ha un
// rilievo del tetto (roofDataUnavailable).
//
// NOTA STORICA: una versione ancora precedente generava anche una foto con la
// simulazione dei singoli pannelli sovrapposti (proiezione lat/lng -> pixel
// e rotazione per azimuth, disegnata riga per riga): rimossa perché
// l'allineamento non era affidabile su tutti i siti (foto sfalsate/ruotate
// male). La superficie utile per i pannelli si stima dai dati aggregati
// forniti da buildingInsights (roof.maxArrayAreaMeters2 /
// maxArrayPanelsCount, mostrati in Sezione A), non da un disegno
// pixel-per-pixel sulla foto.
//
// Richiede un access token Mapbox separato (MAPBOX_ACCESS_TOKEN, non è la
// stessa chiave della Solar API/Geocoding che restano su Google).
export async function fetchRoofImages(lat, lng, { segments } = {}) {
  const accessToken = process.env.MAPBOX_ACCESS_TOKEN;
  if (!accessToken) throw new Error("MAPBOX_ACCESS_TOKEN non configurata: impossibile generare la foto satellitare.");

  const width = 640;
  const height = 400;

  // Inquadratura: copre l'edificio con un margine proporzionato all'area
  // totale dei segmenti rilevati, quando disponibili; altrimenti (nessun
  // rilievo del tetto) usa un'inquadratura di default ragionevole per un
  // capannone/edificio commerciale.
  const areaTotale = (segments || []).reduce((s, seg) => s + (seg.areaMeters2 || 0), 0);
  const radiusMeters = Math.min(100, Math.max(30, Math.round(Math.sqrt(areaTotale || 900) * 1.3)));
  const zoom = zoomPerRaggio(lat, radiusMeters, width);

  // Nota ordine coordinate: Mapbox vuole lon,lat (Google voleva lat,lng).
  const url =
    `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom},0/${width}x${height}` +
    `?access_token=${accessToken}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Mapbox Static Images API ${res.status}: ${await res.text()}`);
  const contentType = res.headers.get("content-type") || "image/png";
  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return {
    satelliteImageUrl: `data:${contentType};base64,${base64}`,
  };
}

// Fallback: curva stagionale tipica per un impianto FV in pianura padana
// (frazioni mensili della produzione annua), usata solo se PVGIS non
// restituisce il dettaglio mensile.
const FALLBACK_MONTHLY_SHAPE = [0.041, 0.056, 0.082, 0.102, 0.118, 0.123, 0.127, 0.112, 0.092, 0.066, 0.046, 0.036];

// Ipotesi di calcolo PVGIS fissate per tutti gli impianti (indipendenti dal
// rilievo del tetto): l'impianto va sempre installato sul tetto (l'azimuth
// resta quello del segmento rilevato), ma con un'inclinazione media dei
// pannelli di 25° (tipica di installazioni su struttura/carpenteria dedicata,
// non necessariamente pari alla pendenza reale della falda), moduli in
// silicio cristallino e perdite di sistema del 14%.
export const INCLINAZIONE_PANNELLI_GRADI = 25;
export const TECNOLOGIA_PANNELLI_LABEL = "Silicio cristallino";
const TECNOLOGIA_PANNELLI_PVGIS = "crystSi"; // silicio cristallino
export const PERDITE_SISTEMA_PCT = 14;

async function callPvgis(lat, lng, seg) {
  const aspect = azimuthToPvgisAspect(seg.azimuthDegrees);
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    peakpower: "1",
    loss: String(PERDITE_SISTEMA_PCT),
    angle: String(INCLINAZIONE_PANNELLI_GRADI),
    aspect: String(aspect),
    pvtechchoice: TECNOLOGIA_PANNELLI_PVGIS,
    outputformat: "json",
    pvcalculation: "1",
  });
  const r = await fetch(`https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?${params.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`PVGIS ${r.status}`);
  const data = await r.json();
  const eY = data?.outputs?.totals?.fixed?.E_y;
  if (typeof eY !== "number") throw new Error("Risposta PVGIS senza E_y");
  const monthly = data?.outputs?.monthly?.fixed;
  const monthlyShape =
    Array.isArray(monthly) && monthly.length === 12 && eY > 0
      ? monthly.map((m) => m.E_m / eY)
      : FALLBACK_MONTHLY_SHAPE;
  return { eY, monthlyShape };
}

export async function fetchPvgisYield(lat, lng, segments) {
  return Promise.all(
    segments.map(async (seg, i) => {
      try {
        const { eY } = await callPvgis(lat, lng, seg);
        return eY;
      } catch {
        return DEMO_PVGIS_YIELD[i] ?? 1250;
      }
    })
  );
}

// Ritorna { specificYields: [...], monthlyShapes: [[12 valori], ...] } —
// usato dall'orchestratore /api/quote per costruire sia il dimensionamento
// sia il grafico di produzione mensile.
export async function fetchPvgisDetailed(lat, lng, segments) {
  const results = await Promise.all(
    segments.map(async (seg, i) => {
      try {
        return await callPvgis(lat, lng, seg);
      } catch {
        return { eY: DEMO_PVGIS_YIELD[i] ?? 1250, monthlyShape: FALLBACK_MONTHLY_SHAPE };
      }
    })
  );
  return {
    specificYields: results.map((r) => r.eY),
    monthlyShapes: results.map((r) => r.monthlyShape),
  };
}
