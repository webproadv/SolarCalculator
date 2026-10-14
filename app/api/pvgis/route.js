import { NextResponse } from "next/server";
import { fetchPvgisProduzione, normalizzaGeometria } from "../../../lib/sources";

// Produzione specifica del sito (kWh/kWp, annua e mensile) via PVGIS v6, con
// le ipotesi fisse dell'app (monocristallino 2025 su tetto Free standing,
// perdite 12%) e inclinazione/orientamento indicati — la stessa funzione usata
// da /api/quote. Nessuna API key richiesta.
// body: { lat, lng, inclinazioneGradi?, orientamentoGradi? } (default 25° e
// 0° = Sud; orientamento: 0 = Sud, +90 = Ovest, -90 = Est)
export async function POST(req) {
  const { lat, lng, inclinazioneGradi, orientamentoGradi } = await req.json();

  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "Parametri mancanti (lat, lng)." }, { status: 400 });
  }

  try {
    const geometria = normalizzaGeometria(inclinazioneGradi ?? 25, orientamentoGradi ?? 0);
    if (!geometria) {
      return NextResponse.json({ error: "Inclinazione (0-90°) o orientamento (-180/+180°) non validi." }, { status: 400 });
    }
    return NextResponse.json(await fetchPvgisProduzione(lat, lng, geometria));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
