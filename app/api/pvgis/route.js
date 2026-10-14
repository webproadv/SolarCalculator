import { NextResponse } from "next/server";
import { fetchPvgisProduzione } from "../../../lib/sources";

// Produzione specifica del sito (kWh/kWp, annua e mensile) via PVGIS v6, con
// le ipotesi fisse dell'app (Sud, 25°, monocristallino 2025 su tetto, perdite
// 11%) — la stessa funzione usata da /api/quote. Nessuna API key richiesta.
// body: { lat, lng }
export async function POST(req) {
  const { lat, lng } = await req.json();

  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "Parametri mancanti (lat, lng)." }, { status: 400 });
  }

  try {
    return NextResponse.json(await fetchPvgisProduzione(lat, lng));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
