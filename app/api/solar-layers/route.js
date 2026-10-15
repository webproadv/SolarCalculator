import { NextResponse } from "next/server";
import sharp from "sharp";
import { elaboraStrati } from "../../../lib/solarLayers";

export const runtime = "nodejs";
export const maxDuration = 60;

// Rilievo reale del sito dai livelli di Google Solar API (dataLayers:get):
// modello digitale delle superfici (altezze di tetti, alberi, terreno) e foto
// aerea, ricampionati su una griglia locale in metri centrata sul sito. Serve
// alla vista 3D della simulazione di posa pannelli. Richiede la stessa
// GOOGLE_SOLAR_API_KEY usata per Building Insights (Solar API abilitata).
//
// body: { lat, lng }
// risposta: { nx, ny, passoM, estensioneM, quoteB64 (Int16 LE, cm sopra il suolo),
//             fotoDataUrl (JPEG), suoloM, qualita, data, georefEsatta }
const RAGGIO_RICHIESTO_M = 100;
const ESTENSIONE_USCITA_M = 90;

export async function POST(req) {
  const { lat, lng } = await req.json();
  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "Coordinate mancanti o non valide." }, { status: 400 });
  }
  const apiKey = process.env.GOOGLE_SOLAR_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_SOLAR_API_KEY non configurata: rilievo reale non disponibile." }, { status: 503 });
  }

  try {
    const url =
      `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}` +
      `&radiusMeters=${RAGGIO_RICHIESTO_M}&view=IMAGERY_LAYERS&requiredQuality=BASE&pixelSizeMeters=0.25&key=${apiKey}`;
    const r = await fetch(url, { cache: "no-store" });
    if (r.status === 404) {
      return NextResponse.json({ error: "Nessun rilievo Google disponibile per questa posizione." }, { status: 404 });
    }
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return NextResponse.json({ error: `Google Solar API (dataLayers): ${r.status} ${t.slice(0, 200)}` }, { status: 502 });
    }
    const layers = await r.json();
    if (!layers.dsmUrl || !layers.rgbUrl) {
      return NextResponse.json({ error: "Google non ha restituito DSM e foto per questa posizione." }, { status: 404 });
    }

    const scarica = async (u) => {
      const res = await fetch(`${u}${u.includes("?") ? "&" : "?"}key=${apiKey}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Download livelli Solar fallito (${res.status}).`);
      return res.arrayBuffer();
    };
    const [dsmBuf, rgbBuf] = await Promise.all([scarica(layers.dsmUrl), scarica(layers.rgbUrl)]);

    const out = await elaboraStrati({
      dsmBuf,
      rgbBuf,
      origine: { lat, lng },
      estensioneM: ESTENSIONE_USCITA_M,
    });

    const jpeg = await sharp(Buffer.from(out.foto.rgb.buffer, out.foto.rgb.byteOffset, out.foto.rgb.byteLength), {
      raw: { width: out.foto.w, height: out.foto.h, channels: 3 },
    })
      .jpeg({ quality: 84 })
      .toBuffer();

    const d = layers.imageryDate;
    return NextResponse.json({
      nx: out.nx,
      ny: out.ny,
      passoM: out.passoM,
      estensioneM: out.estensioneM,
      quoteB64: Buffer.from(out.quoteCm.buffer, out.quoteCm.byteOffset, out.quoteCm.byteLength).toString("base64"),
      fotoDataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
      suoloM: Math.round(out.suoloM * 10) / 10,
      qualita: layers.imageryQuality || null,
      data: d ? `${String(d.day || 1).padStart(2, "0")}/${String(d.month || 1).padStart(2, "0")}/${d.year}` : null,
      georefEsatta: out.georefEsatta,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Errore nell'elaborazione del rilievo." }, { status: 502 });
  }
}
