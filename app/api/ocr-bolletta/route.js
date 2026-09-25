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
// - Un'unica lista andamento_consumi copre sia il caso "solo totale
//   mensile" sia il caso "totale già scomposto per fascia F1/F2/F3":
//   in una versione precedente questi erano due liste separate
//   (andamento_consumi + dettaglio_mensile_fasce, entrambe con campi
//   kWh obbligatori), e i campi obbligatori spingevano il modello a
//   inventare 0 come segnaposto quando non era sicuro di un valore o
//   quando doveva scegliere in quale delle due liste inserire una voce,
//   producendo una tabella tutta a zero. Un'unica lista con soli i campi
//   letti con certezza valorizzati (gli altri null) evita la scelta
//   forzata e riduce il rischio di valori inventati.
// - Il grafico "andamento dei consumi" delle bollette italiane mostra
//   quasi sempre una finestra mobile di 12 mesi (non l'anno solare
//   gennaio-dicembre): al modello viene chiesto di leggere mese E anno di
//   ogni voce, poi il server riallinea i valori nell'array fisso
//   gennaio->dicembre atteso dal frontend, preferendo l'anno più recente
//   in caso di doppioni.
// - Il server scarta come inaffidabile qualunque voce con valori
//   interamente a zero (un mese/fascia realmente a 0 kWh è di fatto
//   inesistente in una bolletta reale): è quasi sempre un segnaposto
//   inventato dal modello, mai un dato vero.

const TOOL_NAME = "estrai_dati_bolletta";

const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description:
    "Registra i dati letti da una foto di bolletta elettrica italiana. Usa null per qualsiasi valore che non riesci a leggere con sufficiente certezza: non stimare o inventare mai numeri, e non usare mai 0 come segnaposto.",
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
          "Consumo totale annuo in kWh, se indicato esplicitamente in bolletta oppure ricavabile sommando andamento_consumi letto per intero (tutti e 12 i mesi).",
      },
      spesa_annua_euro: {
        type: ["number", "null"],
        description:
          "Spesa/importo totale su base annua in euro, SOLO se la bolletta riporta esplicitamente un totale annuale. Se riporta solo un importo periodico (mensile, bimestrale, ecc.) non estrapolare: usa null.",
      },
      andamento_consumi: {
        type: "array",
        description:
          "Una voce per ciascun mese che riesci a leggere con sufficiente certezza da un grafico o tabella dei consumi (es. 'andamento dei consumi', 'dettaglio consumi', un riepilogo letture, o una tabella con colonne come Mese|F1|F2|F3|Totale). NON includere una voce per un mese che non riesci a leggere con certezza — ometterlo è sempre meglio che indovinare o mettere 0.",
        items: {
          type: "object",
          properties: {
            mese: {
              type: "integer",
              minimum: 1,
              maximum: 12,
              description: "Numero del mese (1=gennaio ... 12=dicembre), letto dall'etichetta della voce (non assumere l'ordine gennaio->dicembre).",
            },
            anno: { type: ["integer", "null"], description: "Anno a 4 cifre se indicato per questa voce, altrimenti null." },
            totale_kwh: {
              type: ["number", "null"],
              description:
                "Totale kWh del mese, se la fonte lo riporta direttamente. Lascia null se conosci solo la scomposizione per fascia (f1_kwh/f2_kwh/f3_kwh): il totale verrà calcolato sommandoli automaticamente.",
            },
            f1_kwh: {
              type: ["number", "null"],
              description: "kWh in fascia F1 per quel mese, SOLO se la fonte riporta esplicitamente questo valore separato per fascia. null se la fonte mostra solo un totale mensile senza scomposizione.",
            },
            f2_kwh: { type: ["number", "null"], description: "kWh in fascia F2 per quel mese (stessa logica di f1_kwh)." },
            f3_kwh: { type: ["number", "null"], description: "kWh in fascia F3 per quel mese (stessa logica di f1_kwh)." },
          },
          required: ["mese"],
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
  "REGOLA PIÙ IMPORTANTE: se non sei sicuro di un valore, lascialo null (oppure ometti del tutto quella voce/mese) piuttosto che indovinare. Non usare MAI 0 come valore segnaposto per un dato che non riesci a leggere: un consumo mensile o per fascia realistico non è quasi mai esattamente zero, quindi uno 0 non letto con certezza è quasi sempre un errore che rovina tutta la tabella.\n\n" +
  "Estrai quello che riesci a leggere con sicurezza, usando lo strumento fornito:\n\n" +
  "1. ANDAMENTO MENSILE DEI CONSUMI (andamento_consumi): cerca un grafico o una tabella con i consumi mese per mese (tipicamente 'andamento dei consumi', 'dettaglio consumi', un riepilogo letture, oppure una tabella con colonne come Mese|F1|F2|F3|Totale). Per ogni mese che riesci a leggere con certezza:\n" +
  "   - se la fonte mostra i kWh già separati per fascia (colonne F1/F2/F3), riporta f1_kwh/f2_kwh/f3_kwh per quel mese — questo è il dato più preciso possibile: la ripartizione reale tra fasce cambia da mese a mese (es. un mese può avere più F1 e un altro più F3) e NON va mai approssimata applicando un'unica percentuale fissa a tutti i mesi;\n" +
  "   - se la fonte mostra solo un totale mensile senza scomposizione, riporta solo totale_kwh e lascia f1_kwh/f2_kwh/f3_kwh a null.\n" +
  "   IMPORTANTE su mese/anno: questo tipo di grafico o tabella mostra quasi sempre una finestra mobile degli ultimi 12 mesi (es. da ottobre di due anni fa a settembre dell'anno corrente), NON l'anno solare gennaio-dicembre nell'ordine in cui appaiono le voci: leggi sempre l'etichetta del mese (ed eventualmente l'anno) di ciascuna voce, non assumere che la prima sia gennaio. Se una riga/voce è bimestrale, dividi ogni valore a metà tra i due mesi del bimestre e crea due voci separate. Ometti del tutto un mese che non riesci a leggere con sufficiente certezza: NON creare una voce con valori a 0 o indovinati.\n\n" +
  "2. FASCE F1/F2/F3 IN PERCENTUALE (f1_pct/f2_pct/f3_pct): usa questo SOLO quando NON riesci a leggere una scomposizione per fascia mese per mese (punto 1), ma la bolletta riporta comunque una ripartizione complessiva tra le fasce (tipicamente un grafico a torta riferito all'intero periodo). Le tre percentuali devono sommare a 100. Se la bolletta è invece monoraria / a fascia unica (nessuna suddivisione F1/F2/F3), imposta tariffa_a_fasce a false e lascia f1_pct/f2_pct/f3_pct a null: non inventare una ripartizione.\n\n" +
  "3. CONSUMO ANNUO (consumo_annuo_kwh): cerca un totale esplicito (es. 'consumo annuo', 'kWh fatturati negli ultimi 12 mesi', totale di un riepilogo annuale). Se non c'è un totale esplicito ma riesci a leggere per intero (tutti e 12 i mesi) il punto 1, puoi calcolare il totale annuo sommandone i valori.\n\n" +
  "4. SPESA ANNUA (spesa_annua_euro): SOLO se la bolletta riporta esplicitamente un importo totale su base annua. Se riporta solo un importo periodico (mensile, bimestrale, ecc.), NON moltiplicare né estrapolare tu il totale annuo: lascia il campo a null.\n\n" +
  "Usa null per ogni valore che non riesci a leggere con sufficiente certezza dalla foto. Se la foto è sfocata, tagliata o non riesci a leggere nulla con sufficiente certezza, usa confidence \"bassa\" e valorizza note di conseguenza.";

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

// Da un'unica lista di voci {mese, anno, totale_kwh, f1_kwh, f2_kwh, f3_kwh}
// (parzialmente valorizzate: ogni campo può essere assente/null) ricava due
// array fissi di 12 posizioni (indice 0 = gennaio ... 11 = dicembre):
// - monthlyKwh: il totale mensile (letto direttamente, o calcolato sommando
//   f1+f2+f3 quando il totale non è indicato separatamente);
// - monthlyDetail: la scomposizione {f1,f2,f3} per i soli mesi in cui è
//   stata letta per intero.
// In caso di più voci per lo stesso mese (doppioni), si preferisce quella
// con l'anno più recente. Qualunque valore pari a 0 (o negativo) viene
// scartato come inaffidabile: un consumo realmente nullo per un mese o una
// fascia intera è praticamente inesistente in una bolletta reale, quindi
// uno 0 è quasi sempre un segnaposto inventato dal modello piuttosto che un
// dato vero — meglio trattare quel mese come "non letto" che mostrarlo.
function buildMonthlyArrays(andamentoConsumi) {
  if (!Array.isArray(andamentoConsumi) || andamentoConsumi.length === 0) {
    return { monthlyKwh: null, monthlyDetail: null };
  }

  const perMeseTotale = new Map();
  const perMeseDettaglio = new Map();

  for (const entry of andamentoConsumi) {
    if (!entry || typeof entry.mese !== "number") continue;
    const mese = Math.round(entry.mese);
    if (mese < 1 || mese > 12) continue;
    const anno = typeof entry.anno === "number" ? Math.round(entry.anno) : null;

    const f1 = typeof entry.f1_kwh === "number" && Number.isFinite(entry.f1_kwh) ? entry.f1_kwh : null;
    const f2 = typeof entry.f2_kwh === "number" && Number.isFinite(entry.f2_kwh) ? entry.f2_kwh : null;
    const f3 = typeof entry.f3_kwh === "number" && Number.isFinite(entry.f3_kwh) ? entry.f3_kwh : null;
    const haveFasceComplete = f1 !== null && f2 !== null && f3 !== null && f1 >= 0 && f2 >= 0 && f3 >= 0 && f1 + f2 + f3 > 0;

    if (haveFasceComplete) {
      const existing = perMeseDettaglio.get(mese);
      const preferNew = !existing || (anno !== null && (existing.anno === null || anno > existing.anno));
      if (preferNew) perMeseDettaglio.set(mese, { anno, f1, f2, f3 });
    }

    let totale = typeof entry.totale_kwh === "number" && Number.isFinite(entry.totale_kwh) ? entry.totale_kwh : null;
    if (totale === null && haveFasceComplete) totale = f1 + f2 + f3;
    if (totale !== null && totale > 0) {
      const existing = perMeseTotale.get(mese);
      const preferNew = !existing || (anno !== null && (existing.anno === null || anno > existing.anno));
      if (preferNew) perMeseTotale.set(mese, { anno, kwh: totale });
    }
  }

  const monthlyKwh =
    perMeseTotale.size > 0
      ? Array.from({ length: 12 }, (_, i) => {
          const v = perMeseTotale.get(i + 1);
          return v ? Math.round(v.kwh) : null;
        })
      : null;

  const monthlyDetail =
    perMeseDettaglio.size > 0
      ? Array.from({ length: 12 }, (_, i) => {
          const v = perMeseDettaglio.get(i + 1);
          return v ? { f1: Math.round(v.f1), f2: Math.round(v.f2), f3: Math.round(v.f3) } : null;
        })
      : null;

  return { monthlyKwh, monthlyDetail };
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
        max_tokens: 2000,
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
    const { monthlyKwh, monthlyDetail } = buildMonthlyArrays(parsed.andamento_consumi);

    return NextResponse.json({
      available: true,
      f1_pct: parsed.f1_pct ?? null,
      f2_pct: parsed.f2_pct ?? null,
      f3_pct: parsed.f3_pct ?? null,
      consumo_annuo_kwh: parsed.consumo_annuo_kwh ?? null,
      spesa_annua_euro: parsed.spesa_annua_euro ?? null,
      monthly_kwh: monthlyKwh,
      monthly_detail: monthlyDetail,
      confidence: parsed.confidence || "bassa",
    });
  } catch (err) {
    return NextResponse.json({ error: `Errore chiamando Anthropic API: ${err.message}` }, { status: 502 });
  }
}
