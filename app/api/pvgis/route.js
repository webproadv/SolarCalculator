import { NextResponse } from "next/server";
import { fetchPvgisYield } from "../../../lib/sources";

// Producibilità specifica (kWh/kWp/anno) per uno o più segmenti di tetto,
// via PVGIS (Commissione Europea/JRC — nessuna API key richiesta).
// body: { lat, lng, segments: [{ pitchDegrees, azimuthDegrees }, ...] }
export async function POST(req) {
  const { lat, lng, segments } = await req.json();

  if (typeof lat !== "number" || typeof lng !== "number" || !Array.isArray(segments)) {
    return NextResponse.json({ error: "Parametri mancanti (lat, lng, segments[])." }, { status: 400 });
  }

  const yields = await fetchPvgisYield(lat, lng, segments);
  return NextResponse.json({ results: yields.map((producibilitaSpecifica) => ({ producibilitaSpecifica })) });
}
