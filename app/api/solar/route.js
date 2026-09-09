import { NextResponse } from "next/server";
import { fetchRoof } from "../../../lib/sources";

// Geometria tetto e producibilità aggregata da Google Solar API (Building Insights).
// Richiede GOOGLE_SOLAR_API_KEY. Senza key, ritorna il rilievo reale di
// esempio (Mecprogetti, Parma) con demo:true.
export async function POST(req) {
  const { lat, lng } = await req.json();

  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "Coordinate mancanti o non valide." }, { status: 400 });
  }

  try {
    const roof = await fetchRoof(lat, lng);
    return NextResponse.json(roof);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
