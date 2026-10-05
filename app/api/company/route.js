import { NextResponse } from "next/server";
import { lookupCompany } from "../../../lib/sources";

// Lookup dati aziendali da Partita IVA. Ordine di preferenza (vedi lib/sources.js):
// 1) Apify, actor dltik/italy-company-registry-scraper (Registro Imprese/VIES);
// 2) Apify, actor jungle_synthesizer/italy-registroimprese-bilanci-scraper,
//    solo se il primo fallisce o non trova la P.IVA (stesso APIFY_API_TOKEN);
// 3) OpenAPI.com (https://openapi.com) se OPENAPI_KEY è configurato;
// 4) dati di esempio (demo:true), così il flusso resta testabile end-to-end
//    senza credenziali.
// Il secondo actor può impiegare fino a ~90 s: serve un timeout di funzione
// più ampio del default (su Vercel va comunque rispettato il limite del piano).
export const maxDuration = 120;

export async function POST(req) {
  const { piva } = await req.json();

  if (!piva || !/^\d{11}$/.test(piva.trim())) {
    return NextResponse.json({ error: "Partita IVA non valida: servono 11 cifre." }, { status: 400 });
  }

  try {
    const company = await lookupCompany(piva.trim());
    return NextResponse.json(company);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
