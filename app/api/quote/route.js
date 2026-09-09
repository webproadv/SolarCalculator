import { NextResponse } from "next/server";
import { fetchRoof, fetchPvgisDetailed } from "../../../lib/sources";
import {
  DEFAULTS,
  sizeSystem,
  sizeBattery,
  estimateSelfConsumption,
  energyBalance,
  economics,
  investmentEstimate,
  paybackYears,
  co2Evitata,
} from "../../../lib/calc";

// Orchestratore principale: dato un sito (lat/lng) e i consumi dichiarati,
// recupera geometria tetto (Solar API) + producibilità (PVGIS), dimensiona
// impianto e accumulo, e calcola il bilancio energetico-economico completo.
//
// body atteso:
// {
//   lat, lng,
//   spesaAnnua, consumoAnnuoKwh,
//   f1Pct, f2Pct, f3Pct,          // ripartizione consumi, sommano a 100
//   coperturaTarget?,             // default 0.9
//   tariffaGSE?, tariffaCER?      // default vedi lib/calc.js DEFAULTS
// }
export async function POST(req) {
  const body = await req.json();
  const { lat, lng, spesaAnnua, consumoAnnuoKwh, f1Pct, f2Pct, f3Pct } = body;

  if ([lat, lng, spesaAnnua, consumoAnnuoKwh, f1Pct, f2Pct, f3Pct].some((v) => typeof v !== "number")) {
    return NextResponse.json(
      { error: "Parametri mancanti: servono lat, lng, spesaAnnua, consumoAnnuoKwh, f1Pct, f2Pct, f3Pct." },
      { status: 400 }
    );
  }

  try {
    const roof = await fetchRoof(lat, lng);
    const { specificYields, monthlyShapes } = await fetchPvgisDetailed(lat, lng, roof.segments);

    const areaTotale = roof.segments.reduce((s, seg) => s + seg.areaMeters2, 0);
    const producibilitaSpecificaMedia =
      roof.segments.reduce((s, seg, i) => s + seg.areaMeters2 * specificYields[i], 0) / areaTotale;

    const maxKwpTetto = roof.maxArrayAreaMeters2
      ? roof.maxArrayAreaMeters2 * DEFAULTS.kwpPerM2
      : areaTotale * DEFAULTS.kwpPerM2;

    const coperturaTarget = body.coperturaTarget ?? DEFAULTS.coperturaTarget;
    const { kwp, limitatoDalTetto } = sizeSystem({
      consumoAnnuoKwh,
      producibilitaSpecifica: producibilitaSpecificaMedia,
      maxKwpTetto,
      coperturaTarget,
    });

    const quotaF2F3 = (f2Pct + f3Pct) / 100;
    const hasBattery = quotaF2F3 >= 0.3;
    const battery = hasBattery ? sizeBattery({ kwp, quotaF2F3 }) : { kwh: 0, rapporto: 0 };

    const producibilitaAnnuaKwh = kwp * producibilitaSpecificaMedia;

    const autoconsumoPct = estimateSelfConsumption({
      hasBattery,
      kwp,
      consumoAnnuoKwh,
      producibilitaAnnuaKwh,
    });
    const balance = energyBalance({ producibilitaAnnuaKwh, autoconsumoPct });

    const tariffaGSE = body.tariffaGSE ?? DEFAULTS.tariffaGSE;
    const tariffaCER = body.tariffaCER ?? DEFAULTS.tariffaCER;
    const econ = economics({
      spesaAnnua,
      consumoAnnuoKwh,
      energiaAutoconsumata: balance.autoconsumata,
      energiaImmessa: balance.immessa,
      tariffaGSE,
      tariffaCER,
    });

    const investimento = investmentEstimate({ kwp, batteriaKwh: battery.kwh });
    const payback = paybackYears({ investimento, beneficioAnnuo: econ.beneficioTotale });
    const co2 = co2Evitata({
      producibilitaAnnuaKwh,
      carbonOffsetFactorKgPerMwh: roof.carbonOffsetFactorKgPerMwh ?? 350,
    });

    // Produzione mensile: pesiamo la forma mensile di ciascun segmento per la
    // quota di kWp che gli assegniamo (proporzionale all'area, come per la
    // producibilità specifica media).
    const monthlyProduction = Array.from({ length: 12 }, (_, m) =>
      roof.segments.reduce((sum, seg, i) => {
        const kwpSegmento = kwp * (seg.areaMeters2 / areaTotale);
        return sum + kwpSegmento * specificYields[i] * monthlyShapes[i][m];
      }, 0)
    );

    return NextResponse.json({
      demo: roof.demo === true,
      input: { lat, lng, spesaAnnua, consumoAnnuoKwh, f1Pct, f2Pct, f3Pct, coperturaTarget, tariffaGSE, tariffaCER },
      roof: {
        imageryDate: roof.imageryDate,
        imageryQuality: roof.imageryQuality,
        maxArrayPanelsCount: roof.maxArrayPanelsCount,
        maxArrayAreaMeters2: roof.maxArrayAreaMeters2,
        carbonOffsetFactorKgPerMwh: roof.carbonOffsetFactorKgPerMwh,
        segments: roof.segments.map((seg, i) => ({ ...seg, producibilitaSpecifica: Math.round(specificYields[i]) })),
      },
      sizing: {
        kwp,
        limitatoDalTetto,
        areaOccupataStimataM2: Math.round(kwp / DEFAULTS.kwpPerM2),
        pannelliStimati: Math.round((kwp * 1000) / 530),
        batteriaKwh: battery.kwh,
        batteriaRapporto: battery.rapporto,
        hasBattery,
      },
      production: {
        annuaKwh: Math.round(producibilitaAnnuaKwh),
        coperturaFabbisognoPct: Math.round((producibilitaAnnuaKwh / consumoAnnuoKwh) * 1000) / 10,
        monthlyKwh: monthlyProduction.map((v) => Math.round(v)),
      },
      balance: { autoconsumoPct: Math.round(autoconsumoPct * 1000) / 10, ...balance },
      economics: econ,
      investment: { stimaEuro: investimento, paybackYears: payback },
      co2EvitataTonnellate: co2,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
