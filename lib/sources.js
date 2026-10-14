// Funzioni di accesso alle fonti dati esterne (P.IVA, Solar API, PVGIS),
// condivise dalle singole API route e dall'orchestratore /api/quote.

import { DEMO_COMPANY, DEMO_ROOF } from "./demoData";

// Geocodifica un indirizzo testuale in lat/lng tramite Google Geocoding API.
// Usa la stessa chiave della Solar API: se la chiave è ristretta alla sola
// Solar API, va abilitata anche la Geocoding API sullo stesso progetto/chiave.
export async function geocodeAddress(indirizzoCompleto) {
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

// "VIA CADUTI DI SABBIUNO 3 - 40068 - SAN LAZZARO DI SAVENA (BO)"
//   -> { indirizzo, cap, comune, provincia } (formato del secondo actor,
// jungle_synthesizer/italy-registroimprese-bilanci-scraper). Se il formato
// non è riconosciuto restituisce l'intera stringa come indirizzo, lasciando
// i restanti campi vuoti (correggibili a mano nel form).
function parseIndirizzoUfficioCamerale(registeredAddress) {
  if (!registeredAddress) return { indirizzo: "", cap: "", comune: "", provincia: "" };
  const match = registeredAddress.match(/^(.*?)\s*-\s*(\d{5})\s*-\s*(.+?)\s*\(([A-Za-z]{2})\)\s*$/);
  if (!match) return { indirizzo: registeredAddress, cap: "", comune: "", provincia: "" };
  const [, indirizzo, cap, comune, provincia] = match;
  return { indirizzo: indirizzo.trim(), cap, comune: comune.trim(), provincia: provincia.toUpperCase() };
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
      signal: AbortSignal.timeout(45_000),
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

// Secondo actor Apify, usato solo se il primo fallisce. Scrapa
// ufficiocamerale.it: più lento (da ~30 a ~90 secondi a run) ma con una
// copertura diversa dal primo, quindi spesso trova ciò che l'altro non trova.
async function lookupCompanyApifyUfficioCamerale(piva, token) {
  const actorPath = "jungle_synthesizer~italy-registroimprese-bilanci-scraper";
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "by_vat_number", query: piva, includePec: false, maxItems: 1 }),
      cache: "no-store",
      signal: AbortSignal.timeout(110_000),
    }
  );
  if (!r.ok) throw new Error(`Apify (2° actor) ${r.status}: ${await r.text()}`);
  const items = await r.json();
  const record = Array.isArray(items) ? items.find((it) => it?.legal_name) : null;
  if (!record) throw new Error(`Apify (2° actor): Partita IVA ${piva} non trovata`);
  const vatTrovata = String(record.vat_number || "").replace(/\D/g, "");
  if (vatTrovata && vatTrovata !== piva) {
    throw new Error(`Apify (2° actor): trovata un'altra azienda (P.IVA ${vatTrovata}) invece di ${piva}`);
  }

  const { indirizzo, cap, comune, provincia } = parseIndirizzoUfficioCamerale(record.registered_address);
  const indirizzoPerGeocoding = [indirizzo, cap, comune, provincia].filter(Boolean).join(" ") || record.registered_address || "";
  const { lat, lng } = await geocodeAddress(indirizzoPerGeocoding);

  return {
    demo: false,
    piva,
    ragioneSociale: record.legal_name || record.trade_name || "",
    indirizzo,
    cap,
    comune,
    provincia: provincia || record.cciaa_chamber || "",
    lat,
    lng,
    stato: record.status || null,
    fonte: "apify:ufficiocamerale",
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

// Catena di fonti, in ordine: 1) Apify dltik/italy-company-registry-scraper,
// 2) Apify jungle_synthesizer/italy-registroimprese-bilanci-scraper (entrambe
// con APIFY_API_TOKEN), 3) openapi.com (con OPENAPI_KEY). Si passa alla fonte
// successiva se la precedente fallisce o non trova l'azienda. Se nessuna è
// configurata: dati di esempio (modalità demo). Se tutte falliscono: errore
// con il dettaglio di ciascuna, e la UI propone l'"Inserimento Manuale".
export async function lookupCompany(piva) {
  const apifyToken = process.env.APIFY_API_TOKEN;
  const openApiKey = process.env.OPENAPI_KEY;

  const fonti = [];
  if (apifyToken) {
    fonti.push(["Actor 1", () => lookupCompanyApify(piva, apifyToken)]);
    fonti.push(["Actor 2", () => lookupCompanyApifyUfficioCamerale(piva, apifyToken)]);
  }
  if (openApiKey) fonti.push(["OpenAPI", () => lookupCompanyOpenApi(piva, openApiKey)]);
  if (fonti.length === 0) return { ...DEMO_COMPANY, piva };

  const errori = [];
  for (const [nome, esegui] of fonti) {
    try {
      return await esegui();
    } catch (err) {
      console.error(`Lookup azienda, ${nome} fallito:`, err.message);
      errori.push(`${nome}: ${err.name === "TimeoutError" ? "tempo scaduto" : err.message}`);
    }
  }
  throw new Error(`Nessuna fonte ha trovato l'azienda (${errori.join(" | ")})`);
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
//
// `zoom`, se passato (numero finito), viene usato così com'è invece del
// calcolo automatico dall'area dei segmenti: è l'inquadratura scelta a mano
// dall'utente nell'anteprima interattiva dello step Azienda
// (SatellitePreviewMap in app/page.jsx, tramite /api/roof-image) e ha
// sempre la precedenza, perché è esplicitamente quello che l'utente ha
// deciso di vedere nella schermata dei calcoli e nel PDF.
export async function fetchRoofImages(lat, lng, { segments, zoom: zoomOverride } = {}) {
  const accessToken = process.env.MAPBOX_ACCESS_TOKEN;
  if (!accessToken) throw new Error("MAPBOX_ACCESS_TOKEN non configurata: impossibile generare la foto satellitare.");

  const width = 640;
  const height = 400;

  let zoom;
  if (typeof zoomOverride === "number" && Number.isFinite(zoomOverride)) {
    zoom = Math.min(20, Math.max(2, Math.round(zoomOverride)));
  } else {
    // Inquadratura: copre l'edificio con un margine proporzionato all'area
    // totale dei segmenti rilevati, quando disponibili; altrimenti (nessun
    // rilievo del tetto) usa un'inquadratura di default ragionevole per un
    // capannone/edificio commerciale.
    const areaTotale = (segments || []).reduce((s, seg) => s + (seg.areaMeters2 || 0), 0);
    const radiusMeters = Math.min(100, Math.max(30, Math.round(Math.sqrt(areaTotale || 900) * 1.3)));
    zoom = zoomPerRaggio(lat, radiusMeters, width);
  }

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

// ---------------------------------------------------------------------------
// PVGIS (Commissione Europea / JRC) — API v6, endpoint /power/broadband.
//
// Ipotesi di calcolo fissate per tutti gli impianti (indipendenti dal rilievo
// del tetto), come richiesto dal commerciale:
//  - esposizione a SUD (in PVGIS v6 surface_orientation è l'azimut in gradi
//    da Nord: 180 = Sud; nella v5 il Sud era 0);
//  - inclinazione pannelli 25°;
//  - moduli in silicio monocristallino, tecnologia 2025, installazione su
//    tetto su struttura ventilata ("Free standing" in PVGIS; l'alternativa
//    "cSi:Integrated 2025" è per moduli integrati nella copertura, resa circa
//    -3%: basta cambiare PVGIS_MODULO);
//  - perdite di sistema 12% (lo standard PVGIS è 14%) → system_efficiency 0,88;
//  - media su tutti gli anni disponibili (2014-2024), così il valore non
//    dipende da un'annata particolarmente soleggiata o nuvolosa.
// La resa si calcola per 1 kWp: la produzione di qualunque taglia di impianto
// è lineare, quindi dimensionamento e modifiche manuali dei kWp in dashboard
// si riscalano senza richiamare PVGIS.
// ---------------------------------------------------------------------------
export const PVGIS_BASE_URL = "https://photovoltaic-geographic-information-system.ec.europa.eu/api/v6/power/broadband";
export const INCLINAZIONE_PANNELLI_GRADI = 25;
export const ORIENTAMENTO_SUD_GRADI = 180;
export const PERDITE_SISTEMA_PCT = 12;
export const TECNOLOGIA_PANNELLI_LABEL = "Silicio monocristallino 2025, su tetto";
const PVGIS_MODULO = "cSi:Free standing 2025";
const PVGIS_ANNO_INIZIO = 2014;
const PVGIS_ANNO_FINE = 2024;

// Parametri mostrati in dashboard / PDF come "ipotesi di calcolo".
export const PVGIS_IPOTESI = {
  orientamento: "Sud",
  inclinazioneGradi: INCLINAZIONE_PANNELLI_GRADI,
  tecnologia: TECNOLOGIA_PANNELLI_LABEL,
  perditePct: PERDITE_SISTEMA_PCT,
  periodo: `${PVGIS_ANNO_INIZIO}-${PVGIS_ANNO_FINE}`,
  fonte: "PVGIS v6 (Commissione Europea, JRC)",
};

const pvgisCache = new Map(); // "lat,lng" arrotondati a 3 decimali (~100 m) -> risultato

async function callPvgisOnce(lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    surface_orientation: String(ORIENTAMENTO_SUD_GRADI),
    surface_tilt: String(INCLINAZIONE_PANNELLI_GRADI),
    start_time: `${PVGIS_ANNO_INIZIO}-01-01`,
    end_time: `${PVGIS_ANNO_FINE}-12-31`,
    photovoltaic_module: PVGIS_MODULO,
    system_efficiency: String(1 - PERDITE_SISTEMA_PCT / 100),
    "peak-power": "1",
    statistics: "true",
  });
  const r = await fetch(`${PVGIS_BASE_URL}?${params.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) throw new Error(`PVGIS ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const data = await r.json();
  const stats = data?.statistics;
  const annuo = stats?.yearly_average_energy?.value;
  const mensile = stats?.monthly_energy_summary?.value;
  if (typeof annuo !== "number" || !Array.isArray(mensile) || mensile.length !== 12 || !(annuo > 0)) {
    throw new Error("Risposta PVGIS inattesa (mancano energia annua o mensile).");
  }
  return {
    // kWh prodotti in un anno per ogni kWp installato
    produzioneAnnuaKwhPerKwp: Math.round(annuo),
    // idem, mese per mese (gen→dic); somma = produzione annua
    produzioneMensileKwhPerKwp: mensile.map((v) => Math.round(v * 10) / 10),
  };
}

// Produzione specifica (kWh/kWp) annua e mensile del sito da PVGIS. Un nuovo
// tentativo automatico in caso di errore transitorio; se fallisce anche quello
// l'errore arriva all'utente (non si inventano valori di produzione).
export async function fetchPvgisProduzione(lat, lng) {
  const key = `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
  if (pvgisCache.has(key)) return pvgisCache.get(key);
  let ultimoErrore;
  for (let tentativo = 0; tentativo < 2; tentativo++) {
    try {
      const risultato = { ...(await callPvgisOnce(lat, lng)), ipotesi: PVGIS_IPOTESI };
      pvgisCache.set(key, risultato);
      return risultato;
    } catch (err) {
      ultimoErrore = err;
    }
  }
  throw new Error(
    `Impossibile calcolare la produzione con PVGIS (${ultimoErrore?.name === "TimeoutError" ? "tempo scaduto" : ultimoErrore?.message}). Riprova tra qualche istante.`
  );
}
