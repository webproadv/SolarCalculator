import { NextResponse } from "next/server";
import { lookupCompany } from "../../../lib/sources";

// Lookup dati aziendali da Partita IVA tramite OpenAPI.com
// (https://openapi.com — endpoint "Italian Registered Office Address").
// Se OPENAPI_KEY non è configurata, ritorna dati di esempio (demo:true)
// così il flusso resta testabile end-to-end senza credenziali.
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
