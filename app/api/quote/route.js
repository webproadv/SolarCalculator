import { NextResponse } from "next/server";
import { fetchRoof, fetchPvgisProduzione, normalizzaGeometria } from "../../../lib/sources";
import {
  DEFAULTS,
  diurnoNotturno,
  sizeSystemFromProduzione,
  sizeBatteryFromNotturno,
  investmentEstimate,
} from "../../../lib/calc";

// Orchestratore principale: dato un sito (lat/lng), i consumi dichiarati (con
// ripartizione F1/F2/F3) e la produzione specifica del sito — calcolata con
// PVGIS v6 (vedi fetchPvgisProduzione in lib/sources.js: inclinazione e
// orientamento indicati dal commerciale, monocristallino 2025 su tetto Free
// standing, perdite di sistema indicate dal commerciale) — calcola:
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
//   perditeSistemaPct (0-50, default 12),
//   inclinazioneGradi, orientamentoGradi,  // pannelli: 0-90° e -180/+180° (0 = Sud, +90 = Ovest, -90 = Est)
//   pvgisLat?, pvgisLng?,         // posizione del tetto confermata in anteprima satellitare
//                                 // (se assente si usano lat/lng dell'azienda)
//   giorniLavorativi,             // 5, 6 o 7 — usato per il calcolo diurno/notturno
//   tariffaGSE?, tariffaCER?      // default vedi lib/calc.js DEFAULTS
// }
export async function POST(req) {
  const body = await req.json();
  const { lat, lng, spesaAnnua, consumoAnnuoKwh, f1Pct, f2Pct, f3Pct, giorniLavorativi } = body;

  if (
    [lat, lng, spesaAnnua, consumoAnnuoKwh, f1Pct, f2Pct, f3Pct, giorniLavorativi].some(
      (v) => typeof v !== "number"
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Parametri mancanti: servono lat, lng, spesaAnnua, consumoAnnuoKwh, f1Pct, f2Pct, f3Pct, giorniLavorativi.",
      },
      { status: 400 }
    );
  }

  const geometria = normalizzaGeometria(body.inclinazioneGradi, body.orientamentoGradi, body.perditeSistemaPct);
  if (!geometria) {
    return NextResponse.json(
      { error: "Inclinazione (0-90°), orientamento (da -180° a +180°, 0 = Sud) e perdite di sistema (0-50%) dei pannelli mancanti o non validi." },
      { status: 400 }
    );
  }

  try {
    const sitoPvgis =
      typeof body.pvgisLat === "number" && typeof body.pvgisLng === "number"
        ? { lat: body.pvgisLat, lng: body.pvgisLng }
        : { lat, lng };
    const [roof, pvgis] = await Promise.all([
      fetchRoof(lat, lng),
      fetchPvgisProduzione(sitoPvgis.lat, sitoPvgis.lng, geometria),
    ]);
    const produzioneAnnuaFvKwh = pvgis.produzioneAnnuaKwhPerKwp;
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
      roofDataUnavailable: roof.noRoofData === true,
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
        produzioneAnnuaFvKwh, // kWh/kWp/anno, da PVGIS
        produzioneMensileKwhPerKwp: pvgis.produzioneMensileKwhPerKwp, // gen→dic, da PVGIS
        pvgisIpotesi: pvgis.ipotesi,
        pvgisLat: sitoPvgis.lat,
        pvgisLng: sitoPvgis.lng,
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
