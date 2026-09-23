import { NextResponse } from "next/server";
import { fetchRoof } from "../../../lib/sources";
import {
  DEFAULTS,
  diurnoNotturno,
  sizeSystemFromProduzione,
  sizeBatteryFromNotturno,
  investmentEstimate,
} from "../../../lib/calc";

// Orchestratore principale: dato un sito (lat/lng), i consumi dichiarati (con
// ripartizione F1/F2/F3) e la produzione annua specifica del sito — inserita
// manualmente dall'utente nella schermata "Consumi" (tipicamente da PVGIS o
// da una stima già in suo possesso: questa route NON chiama più PVGIS) —
// calcola:
// - il fabbisogno diurno/notturno, in base ai giorni lavorativi dichiarati;
// - la taglia di impianto e accumulo suggerita (di partenza: resta poi
//   modificabile a mano in dashboard, insieme al costo dell'impianto);
// - la geometria del tetto (Google Solar API), usata come riferimento per
//   l'area massima disponibile e per generare la foto satellitare.
//
// body atteso:
// {
//   lat, lng,
//   spesaAnnua, consumoAnnuoKwh,
//   f1Pct, f2Pct, f3Pct,          // ripartizione consumi, sommano a 100
//   produzioneAnnuaFvKwh,         // kWh/kWp/anno — inserito manualmente dall'utente
//   giorniLavorativi,             // 5, 6 o 7 — usato per il calcolo diurno/notturno
//   tariffaGSE?, tariffaCER?      // default vedi lib/calc.js DEFAULTS
// }
export async function POST(req) {
  const body = await req.json();
  const { lat, lng, spesaAnnua, consumoAnnuoKwh, f1Pct, f2Pct, f3Pct, produzioneAnnuaFvKwh, giorniLavorativi } = body;

  if (
    [lat, lng, spesaAnnua, consumoAnnuoKwh, f1Pct, f2Pct, f3Pct, produzioneAnnuaFvKwh, giorniLavorativi].some(
      (v) => typeof v !== "number"
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Parametri mancanti: servono lat, lng, spesaAnnua, consumoAnnuoKwh, f1Pct, f2Pct, f3Pct, produzioneAnnuaFvKwh, giorniLavorativi.",
      },
      { status: 400 }
    );
  }

  try {
    const roof = await fetchRoof(lat, lng);
    const areaTotale = roof.segments.reduce((s, seg) => s + seg.areaMeters2, 0);
    const maxKwpTetto = roof.maxArrayAreaMeters2
      ? roof.maxArrayAreaMeters2 * DEFAULTS.kwpPerM2
      : areaTotale * DEFAULTS.kwpPerM2;

    // Consumi per fascia in kWh assoluti (non solo percentuali), evidenziati
    // poi in dashboard: l'ultima fascia assorbe l'arrotondamento per tornare
    // esattamente al totale dichiarato.
    const f1Kwh = Math.round((consumoAnnuoKwh * f1Pct) / 100);
    const f2Kwh = Math.round((consumoAnnuoKwh * f2Pct) / 100);
    const f3Kwh = Math.round(consumoAnnuoKwh - f1Kwh - f2Kwh);

    const { diurno: consumoDiurnoKwh, notturno: consumoNotturnoKwh } = diurnoNotturno({
      f1Kwh,
      f2Kwh,
      f3Kwh,
      totaleKwh: consumoAnnuoKwh,
      giorniLavorativi,
    });

    const kwpSuggerito = sizeSystemFromProduzione({ consumoAnnuoKwh, produzioneAnnuaFvKwh });
    const accumuloSuggeritoKwh = sizeBatteryFromNotturno({ consumoNotturnoKwh });
    const limitatoDalTetto = maxKwpTetto > 0 && kwpSuggerito > maxKwpTetto;
    const investimentoSuggerito = investmentEstimate({ kwp: kwpSuggerito, batteriaKwh: accumuloSuggeritoKwh });

    const tariffaGSE = typeof body.tariffaGSE === "number" ? body.tariffaGSE : DEFAULTS.tariffaGSE;
    const tariffaCER = typeof body.tariffaCER === "number" ? body.tariffaCER : DEFAULTS.tariffaCER;

    return NextResponse.json({
      demo: roof.demo === true,
      input: {
        lat,
        lng,
        spesaAnnua,
        consumoAnnuoKwh,
        f1Pct,
        f2Pct,
        f3Pct,
        f1Kwh,
        f2Kwh,
        f3Kwh,
        consumoDiurnoKwh,
        consumoNotturnoKwh,
        giorniLavorativi,
        produzioneAnnuaFvKwh,
        tariffaGSE,
        tariffaCER,
      },
      roof: {
        imageryDate: roof.imageryDate,
        imageryQuality: roof.imageryQuality,
        maxArrayPanelsCount: roof.maxArrayPanelsCount,
        maxArrayAreaMeters2: roof.maxArrayAreaMeters2,
        carbonOffsetFactorKgPerMwh: roof.carbonOffsetFactorKgPerMwh,
        segments: roof.segments,
        // Passati al frontend solo per la generazione automatica della foto
        // con simulazione pannelli (vedi /api/roof-image).
        solarPanels: roof.solarPanels || [],
      },
      sizing: {
        kwpSuggerito,
        accumuloSuggeritoKwh,
        maxKwpTetto: Math.round(maxKwpTetto),
        limitatoDalTetto,
        investimentoSuggerito,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
