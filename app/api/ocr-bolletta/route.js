import { NextResponse } from "next/server";

// Estrae la ripartizione F1/F2/F3 da una foto del grafico bolletta usando
// un modello Claude con visione. Richiede ANTHROPIC_API_KEY.
// Se la key non è configurata, ritorna null: il frontend passa
// automaticamente all'inserimento manuale delle percentuali.
export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ available: false });
  }

  const form = await req.formData();
  const file = form.get("bolletta");
  if (!file) {
    return NextResponse.json({ error: "Nessuna immagine ricevuta." }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mediaType = file.type || "image/jpeg";

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              {
                type: "text",
                text:
                  "Questa è una foto del grafico dei consumi in fascia oraria (F1/F2/F3) di una bolletta elettrica italiana. " +
                  "Leggi i valori (percentuali o kWh) per F1, F2 e F3. Rispondi SOLO con un JSON valido nel formato " +
                  '{"f1_pct": <numero 0-100>, "f2_pct": <numero 0-100>, "f3_pct": <numero 0-100>, "confidence": "alta|media|bassa"}. ' +
                  "Le tre percentuali devono sommare a 100. Se non riesci a leggere il grafico con sufficiente certezza, usa confidence: \"bassa\".",
              },
            ],
          },
        ],
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      return NextResponse.json({ error: `Anthropic API ha risposto ${r.status}: ${text}` }, { status: 502 });
    }

    const data = await r.json();
    const textBlock = data.content?.find((b) => b.type === "text")?.text || "";
    const match = textBlock.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: "Risposta del modello non interpretabile come JSON." }, { status: 502 });
    }
    const parsed = JSON.parse(match[0]);
    return NextResponse.json({ available: true, ...parsed });
  } catch (err) {
    return NextResponse.json({ error: `Errore chiamando Anthropic API: ${err.message}` }, { status: 502 });
  }
}
