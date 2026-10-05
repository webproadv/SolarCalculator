import { NextResponse } from "next/server";
import { geocodeAddress } from "../../../lib/sources";

// Coordinate da indirizzo: usata dall'"Inserimento Manuale" dei dati azienda
// (step 1), dove nessun actor ha fornito lat/lng.
export async function POST(req) {
  const { indirizzo, cap, comune, provincia } = await req.json();
  const testo = [indirizzo, cap, comune, provincia].filter(Boolean).join(" ").trim();
  if (!testo) {
    return NextResponse.json({ error: "Inserisci almeno indirizzo e comune." }, { status: 400 });
  }
  const { lat, lng } = await geocodeAddress(testo);
  if (lat == null || lng == null) {
    return NextResponse.json(
      { error: "Indirizzo non trovato (o chiave Google non configurata): inserisci le coordinate a mano." },
      { status: 404 }
    );
  }
  return NextResponse.json({ lat, lng });
}
