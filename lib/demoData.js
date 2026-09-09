// Dati di fallback usati quando le rispettive API key non sono configurate
// (vedi README). I dati del tetto sono reali (rilievo Google Solar API su
// Mecprogetti Srl, Via F. Coppi 51/a, Parma — 6 marzo 2025); azienda e
// consumi sono di esempio.

export const DEMO_COMPANY = {
  demo: true,
  piva: "01234567890",
  ragioneSociale: "Mecprogetti Srl",
  indirizzo: "Via F. Coppi, 51/a",
  cap: "43122",
  comune: "Parma",
  provincia: "PR",
  lat: 44.786897,
  lng: 10.3803777,
};

export const DEMO_ROOF = {
  demo: true,
  imageryDate: "2025-03-06",
  imageryQuality: "HIGH",
  maxArrayPanelsCount: 486,
  maxArrayAreaMeters2: 954.29,
  carbonOffsetFactorKgPerMwh: 384.99954,
  segments: [
    { nome: "Falda NO", areaMeters2: 583.12, pitchDegrees: 1.99, azimuthDegrees: 294.76 },
    { nome: "Falda SE", areaMeters2: 507.18, pitchDegrees: 2.01, azimuthDegrees: 114.48 },
    { nome: "Falda N", areaMeters2: 106.43, pitchDegrees: 0.58, azimuthDegrees: 0.0 },
  ],
};

// kWh/kWp/anno di fallback per segmento, usati solo se anche la chiamata a
// PVGIS (che non richiede key) fallisce per un problema di rete.
export const DEMO_PVGIS_YIELD = [1180, 1310, 1250];
