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

export async function fetchRoof(lat, lng) {
  const apiKey = process.env.GOOGLE_SOLAR_API_KEY;
  if (!apiKey) return DEMO_ROOF;

  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${apiKey}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Google Solar API ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const segments = (data.solarPotential?.roofSegmentStats || []).map((s, i) => ({
    nome: `Segmento ${i + 1}`,
    areaMeters2: s.stats?.areaMeters2 ?? s.areaMeters2 ?? 0,
    pitchDegrees: s.pitchDegrees,
    azimuthDegrees: s.azimuthDegrees,
  }));
  return {
    demo: false,
    imageryDate: data.imageryDate ? `${data.imageryDate.year}-${data.imageryDate.month}-${data.imageryDate.day}` : null,
    imageryQuality: data.imageryQuality,
    maxArrayPanelsCount: data.solarPotential?.maxArrayPanelsCount,
    maxArrayAreaMeters2: data.solarPotential?.maxArrayAreaMeters2,
    carbonOffsetFactorKgPerMwh: data.solarPotential?.carbonOffsetFactorKgPerMwh,
    segments: segments.length ? segments : DEMO_ROOF.segments,
  };
}

// Fallback: curva stagionale tipica per un impianto FV in pianura padana
// (frazioni mensili della produzione annua), usata solo se PVGIS non
// restituisce il dettaglio mensile.
const FALLBACK_MONTHLY_SHAPE = [0.041, 0.056, 0.082, 0.102, 0.118, 0.123, 0.127, 0.112, 0.092, 0.066, 0.046, 0.036];

async function callPvgis(lat, lng, seg) {
  const aspect = azimuthToPvgisAspect(seg.azimuthDegrees);
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    peakpower: "1",
    loss: "14",
    angle: String(seg.pitchDegrees),
    aspect: String(aspect),
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
