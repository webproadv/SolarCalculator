import { NextResponse } from "next/server";
import sharp from "sharp";

// Estrae i dati di consumo (fasce F1/F2/F3, consumo annuo, spesa annua,
// andamento mensile) da una foto di bolletta elettrica italiana usando un
// modello Claude con visione. Richiede ANTHROPIC_API_KEY.
// Se la key non è configurata, ritorna null: il frontend passa
// automaticamente all'inserimento manuale.
//
// Note sull'affidabilità della lettura (motivo delle scelte sotto):
// - Le foto scattate da cellulare arrivano spesso ruotate: l'orientamento
//   EXIF viene normalizzato prima di inviare l'immagine al modello.
// - L'output è vincolato con un tool JSON-schema (tool_choice forzato)
//   invece di chiedere "rispondi solo con JSON" e fare regex sul testo:
//   elimina un'intera classe di errori di parsing.
// - Il grafico "andamento dei consumi" delle bollette italiane mostra
//   quasi sempre una finestra mobile di 12 mesi (non l'anno solare
//   gennaio-dicembre): al modello viene chiesto di leggere mese E anno di
//   ogni barra, poi il server riallinea i valori nell'array fisso
//   gennaio->dicembre atteso dal frontend, preferendo l'anno più recente
//   in caso di doppioni.

const TOOL_NAME = "estrai_dati_bolletta";

const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description:
    "Registra i dati letti da una foto di bolletta elettrica italiana. Usa null per qualsiasi valore che non riesci a leggere con sufficiente certezza: non stimare o inventare mai numeri.",
  input_schema: {
    type: "object",
    properties: {
      tariffa_a_fasce: {
        type: ["boolean", "null"],
        description:
          "true se la bolletta ha una tariffazione multioraria a fasce F1/F2/F3, false se è monoraria/fascia unica, null se non determinabile.",
      },
      f1_pct: { type: ["number", "null"], description: "Percentuale di consumo in fascia F1 (0-100)." },
      f2_pct: { type: ["number", "null"], description: "Percentuale di consumo in fascia F2 (0-100)." },
      f3_pct: { type: ["number", "null"], description: "Percentuale di consumo in fascia F3 (0-100)." },
      consumo_annuo_kwh: {
        type: ["number", "null"],
        description:
          "Consumo totale annuo in kWh, se indicato esplicitamente in bolletta oppure ricavabile sommando un grafico/tabella dell'andamento dei consumi letto per intero (tutti e 12 i mesi).",
      },
      spesa_annua_euro: {
        type: ["number", "null"],
        description:
          "Spesa/importo totale su base annua in euro, SOLO se la bolletta riporta esplicitamente un totale annuale. Se riporta solo un importo periodico (mensile, bimestrale, ecc.) non estrapolare: usa null.",
      },
      andamento_consumi: {
        type: "array",
        description:
          "Una voce per ogni barra/punto del grafico o tabella 'andamento dei consumi' (o simile) leggibile con certezza nella foto. Array vuoto se il grafico non è presente o non è leggibile per nessun mese.",
        items: {
          type: "object",
          properties: {
            mese: { type: "integer", minimum: 1, maximum: 12, description: "Numero del mese (1=gennaio ... 12=dicembre) riportato sotto la barra." },
            anno: { type: ["integer", "null"], description: "Anno a 4 cifre riportato per quella barra, se presente; null se non indicato." },
            kwh: { type: "number", description: "Consumo in kWh per quel mese. Se il grafico è bimestrale, dividi il valore a metà tra i due mesi del bimestre." },
          },
          required: ["mese", "kwh"],
        },
      },
      confidence: {
        type: "string",
        enum: ["alta", "media", "bassa"],
        description: "Affidabilità complessiva della lettura.",
      },
      note: {
        type: ["string", "null"],
        description: "Eventuali osservazioni brevi utili (es. foto sfocata, fornitore riconosciuto, dati parziali).",
      },
    },
    required: ["f1_pct", "f2_pct", "f3_pct", "consumo_annuo_kwh", "spesa_annua_euro", "andamento_consumi", "confidence"],
  },
};

const PROMPT_TEXT =
  "Questa è una foto di una bolletta elettrica italiana (o dei suoi grafici/tabelle dei consumi). " +
  "Il layout varia molto da fornitore a fornitore (Enel, Eni Plenitude, A2A, Hera Comm, Iren, Sorgenia, Edison, Acea, Sinergy, Trenta, Octopus Energy, ecc.): non assumere una posizione fissa degli elementi, cerca i dati per significato.\n\n" +
  "Estrai quello che riesci a leggere con sicurezza, usando lo strumento fornito:\n\n" +
  "1. FASCE F1/F2/F3: se la bolletta ha una tariffa multioraria, leggi le percentuali di ripartizione del consumo tra le fasce (di solito da un grafico a torta o a barre). Le tre percentuali devono sommare a 100. " +
  "Se la bolletta è invece monoraria / a fascia unica (nessuna suddivisione F1/F2/F3), imposta tariffa_a_fasce a false e lascia f1_pct/f2_pct/f3_pct a null: non inventare una ripartizione.\n\n" +
  "2. CONSUMO ANNUO: cerca un totale esplicito (es. 'consumo annuo', 'kWh fatturati negli ultimi 12 mesi', totale di un riepilogo annuale). Se non c'è un totale esplicito ma riesci a leggere per intero (tutti e 12 i mesi) il grafico dell'andamento dei consumi, puoi calcolare il totale annuo sommando quei 12 valori.\n\n" +
  "3. SPESA ANNUA: SOLO se la bolletta riporta esplicitamente un importo totale su base annua. Se riporta solo un importo periodico (mensile, bimestrale, ecc.), NON moltiplicare né estrapolare tu il totale annuo: lascia il campo a null.\n\n" +
  "4. ANDAMENTO DEI CONSUMI (il punto più importante e più soggetto a errori): molte bollette includono un grafico a barre intitolato 'andamento dei consumi' o simile, con circa 12 barre. IMPORTANTE: questo grafico mostra quasi sempre una finestra mobile degli ultimi 12 mesi (es. da ottobre di due anni fa a settembre dell'anno corrente), NON l'anno solare gennaio-dicembre nell'ordine in cui appaiono le barre. Sotto (o sopra) ogni barra è di solito riportata un'etichetta con il mese (spesso abbreviato: gen, feb, mar...) ed eventualmente l'anno. Per OGNI barra che riesci a leggere con certezza, riporta il numero del mese (1-12) corrispondente all'etichetta, l'anno se indicato, e il valore in kWh — non assumere semplicemente che la prima barra sia gennaio. Se un valore è bimestrale, dividilo a metà tra i due mesi del bimestre e registra entrambi. Se il grafico non è presente nella foto, o non riesci a leggere con sufficiente certezza nessuna barra, lascia andamento_consumi come array vuoto: non stimare o inventare valori.\n\n" +
  "Usa null (o array vuoto per andamento_consumi) per ogni valore che non riesci a leggere con sufficiente certezza dalla foto. Se la foto è sfocata, tagliata o non riesci a leggere nulla con sufficiente certezza, usa confidence \"bassa\" e valorizza note di conseguenza.";

async function preprocessImage(arrayBuffer, mediaType) {
  try {
    const buffer = Buffer.from(arrayBuffer);
    const processed = await sharp(buffer)
      .rotate() // normalizza l'orientamento EXIF (foto scattate ruotate da cellulare)
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    return { base64: processed.toString("base64"), mediaType: "image/jpeg" };
  } catch (err) {
    // Se sharp non riesce a processare l'immagine (formato inatteso, ecc.),
    // invia i byte originali invece di far fallire del tutto la richiesta.
    return { base64: Buffer.from(arrayBuffer).toString("base64"), mediaType: mediaType || "image/jpeg" };
  }
}

// Riallinea le letture {mese, anno, kwh} in un array fisso di 12 posizioni
// (indice 0 = gennaio ... 11 = dicembre), preferendo l'anno più recente in
// caso di doppioni sullo stesso mese. Ritorna null nei mesi non letti.
function buildMonthlyKwhArray(andamentoConsumi) {
  if (!Array.isArray(andamentoConsumi) || andamentoConsumi.length === 0) return null;

  const perMese = new Map();
  for (const entry of andamentoConsumi) {
    if (!entry || typeof entry.mese !== "number") continue;
    const mese = Math.round(entry.mese);
    if (mese < 1 || mese > 12) continue;
    const kwh = Number(entry.kwh);
    if (!Number.isFinite(kwh) || kwh < 0) continue;
    const anno = typeof entry.anno === "number" ? Math.round(entry.anno) : null;

    const existing = perMese.get(mese);
    const preferNew =
      !existing || (anno !== null && (existing.anno === null || anno > existing.anno));
    if (preferNew) perMese.set(mese, { anno, kwh });
  }

  if (perMese.size === 0) return null;

  const result = [];
  for (let mese = 1; mese <= 12; mese++) {
    const v = perMese.get(mese);
    result.push(v ? Math.round(v.kwh) : null);
  }
  return result;
}

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
  const { base64, mediaType } = await preprocessImage(arrayBuffer, file.type);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929",
        max_tokens: 1500,
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: PROMPT_TEXT },
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
    const toolUse = data.content?.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
    if (!toolUse || !toolUse.input) {
      return NextResponse.json({ error: "Il modello non ha restituito i dati nel formato atteso." }, { status: 502 });
    }

    const parsed = toolUse.input;
    const monthlyKwh = buildMonthlyKwhArray(parsed.andamento_consumi);

    return NextResponse.json({
      available: true,
      f1_pct: parsed.f1_pct ?? null,
      f2_pct: parsed.f2_pct ?? null,
      f3_pct: parsed.f3_pct ?? null,
      consumo_annuo_kwh: parsed.consumo_annuo_kwh ?? null,
      spesa_annua_euro: parsed.spesa_annua_euro ?? null,
      monthly_kwh: monthlyKwh,
      confidence: parsed.confidence || "bassa",
    });
  } catch (err) {
    return NextResponse.json({ error: `Errore chiamando Anthropic API: ${err.message}` }, { status: 502 });
  }
}
