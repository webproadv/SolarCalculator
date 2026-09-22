import { NextResponse } from "next/server";
import { fetchRoofImages } from "../../../lib/sources";

// Genera la foto aerea del sito e la foto con la simulazione dei pannelli
// sovrapposti al tetto, a partire dal layer RGB della Google Solar API
// (dataLayers) e dalla lista pannelli restituita da /api/quote
// (quote.roof.solarPanels).
//
// Endpoint separato da /api/quote e pensato per essere chiamato solo su
// azione esplicita dell'utente (bottone in dashboard): la richiesta
// dataLayers è nel livello di prezzo "Enterprise" della Solar API, più caro
// della sola buildingInsights già usata per calcolare il preventivo — non va
// quindi eseguita automaticamente ad ogni preventivo generato.
//
// body atteso:
// {
//   lat, lng,
//   segments,       // quote.roof.segments
//   solarPanels,    // quote.roof.solarPanels
//   panelsCount,    // quote.sizing.pannelliStimati — quanti pannelli evidenziare come "proposti"
// }
export async function POST(req) {
  const { lat, lng, segments, solarPanels, panelsCount } = await req.json();

  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "Coordinate mancanti o non valide." }, { status: 400 });
  }

  try {
    const images = await fetchRoofImages(lat, lng, { segments, solarPanels, panelsCount });
    return NextResponse.json(images);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
