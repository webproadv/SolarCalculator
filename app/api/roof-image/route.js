import { NextResponse } from "next/server";
import { fetchRoofImages } from "../../../lib/sources";

// Genera la foto aerea del sito tramite la Mapbox Static Images API (vista
// satellitare, centrata sulle coordinate dell'azienda). Non usa la Google
// Maps Static API perché Google blocca satellite/hybrid per gli account con
// fatturazione EEA dall'8 luglio 2025 (vedi commento in fetchRoofImages,
// lib/sources.js).
//
// Endpoint separato da /api/quote (chiamato subito dopo, non appena il
// preventivo è pronto — vedi fetchRoofImagesAuto in app/page.jsx): così un
// eventuale errore o lentezza nel recupero della foto non blocca la
// generazione del preventivo stesso.
//
// body atteso:
// {
//   lat, lng,
//   segments,       // quote.roof.segments — solo per dimensionare il raggio della richiesta
// }
export async function POST(req) {
  const { lat, lng, segments } = await req.json();

  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "Coordinate mancanti o non valide." }, { status: 400 });
  }

  try {
    const images = await fetchRoofImages(lat, lng, { segments });
    return NextResponse.json(images);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
