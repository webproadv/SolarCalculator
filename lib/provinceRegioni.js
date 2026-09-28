// Mappa sigla provincia (2 lettere) -> regione italiana.
//
// Serve solo per compilare il campo REGIONE del foglio lead "Pipe" (vedi
// app/api/progetti/[id]/pipe/route.js): l'anagrafica azienda (tabella
// `progetti`, colonna `provincia`) salva solo la sigla (es. "MO"), mai il
// nome della regione, quindi va derivata da qui.
const PROVINCIA_REGIONE = {
  AQ: "Abruzzo", CH: "Abruzzo", PE: "Abruzzo", TE: "Abruzzo",
  MT: "Basilicata", PZ: "Basilicata",
  CZ: "Calabria", CS: "Calabria", KR: "Calabria", RC: "Calabria", VV: "Calabria",
  AV: "Campania", BN: "Campania", CE: "Campania", NA: "Campania", SA: "Campania",
  BO: "Emilia-Romagna", FC: "Emilia-Romagna", FE: "Emilia-Romagna", MO: "Emilia-Romagna",
  PC: "Emilia-Romagna", PR: "Emilia-Romagna", RA: "Emilia-Romagna", RE: "Emilia-Romagna", RN: "Emilia-Romagna",
  GO: "Friuli-Venezia Giulia", PN: "Friuli-Venezia Giulia", TS: "Friuli-Venezia Giulia", UD: "Friuli-Venezia Giulia",
  FR: "Lazio", LT: "Lazio", RI: "Lazio", RM: "Lazio", VT: "Lazio",
  GE: "Liguria", IM: "Liguria", SP: "Liguria", SV: "Liguria",
  BG: "Lombardia", BS: "Lombardia", CO: "Lombardia", CR: "Lombardia", LC: "Lombardia", LO: "Lombardia",
  MB: "Lombardia", MI: "Lombardia", MN: "Lombardia", PV: "Lombardia", SO: "Lombardia", VA: "Lombardia",
  AN: "Marche", AP: "Marche", FM: "Marche", MC: "Marche", PU: "Marche",
  CB: "Molise", IS: "Molise",
  AL: "Piemonte", AT: "Piemonte", BI: "Piemonte", CN: "Piemonte", NO: "Piemonte", TO: "Piemonte", VB: "Piemonte", VC: "Piemonte",
  BA: "Puglia", BR: "Puglia", BT: "Puglia", FG: "Puglia", LE: "Puglia", TA: "Puglia",
  CA: "Sardegna", NU: "Sardegna", OR: "Sardegna", SS: "Sardegna", SU: "Sardegna",
  AG: "Sicilia", CL: "Sicilia", CT: "Sicilia", EN: "Sicilia", ME: "Sicilia", PA: "Sicilia", RG: "Sicilia", SR: "Sicilia", TP: "Sicilia",
  AR: "Toscana", FI: "Toscana", GR: "Toscana", LI: "Toscana", LU: "Toscana", MS: "Toscana", PI: "Toscana", PO: "Toscana", PT: "Toscana", SI: "Toscana",
  BZ: "Trentino-Alto Adige", TN: "Trentino-Alto Adige",
  PG: "Umbria", TR: "Umbria",
  AO: "Valle d'Aosta",
  BL: "Veneto", PD: "Veneto", RO: "Veneto", TV: "Veneto", VE: "Veneto", VI: "Veneto", VR: "Veneto",
};

export function regioneFromProvincia(sigla) {
  if (!sigla) return "";
  return PROVINCIA_REGIONE[String(sigla).trim().toUpperCase()] || "";
}
