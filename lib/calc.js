// Motore di calcolo — dimensionamento impianto FV + accumulo + bilancio economico.
// Formule allineate al documento di progetto "Webapp Fotovoltaico".
// Tutti i parametri economici/tecnici hanno un default ma sono pensati per essere
// sovrascritti (query param o body) man mano che l'app matura da MVP a prodotto.

export const DEFAULTS = {
  coperturaTarget: 0.9, // quota del consumo annuo che l'impianto punta a coprire
  kwpPerM2: 0.20, // densità di potenza tipica per pannelli attuali
  batteriaKwhPerKwpMin: 0.5, // accumulo minimo (quota F2+F3 ~ 0)
  batteriaKwhPerKwpMax: 1.5, // accumulo massimo (quota F2+F3 ~ 1)
  autoconsumoSenzaAccumuloMin: 0.30,
  autoconsumoSenzaAccumuloMax: 0.45,
  autoconsumoConAccumuloMin: 0.55,
  autoconsumoConAccumuloMax: 0.75,
  tariffaGSE: 0.0475, // €/kWh — Ritiro Dedicato, valore ufficiale ARERA 2026
  tariffaCER: 0.075, // €/kWh — stima media componente fissa+variabile CER 2026
  quotaCondivisaCER: 1.0, // quota dell'immesso considerata "condivisa" ai fini CER (semplificazione MVP)
  costoKwp: 900, // €/kWp — stima EPC impianto C&I turnkey
  costoKwhBatteria: 400, // €/kWh — stima costo accumulo
};

export function sizeSystem({ consumoAnnuoKwh, producibilitaSpecifica, maxKwpTetto, coperturaTarget = DEFAULTS.coperturaTarget }) {
  const kwpIdeale = (consumoAnnuoKwh * coperturaTarget) / producibilitaSpecifica;
  const kwp = Math.min(kwpIdeale, maxKwpTetto);
  const limitatoDalTetto = kwpIdeale > maxKwpTetto;
  return { kwp: round(kwp, 1), limitatoDalTetto };
}

export function sizeBattery({ kwp, quotaF2F3 }) {
  const { batteriaKwhPerKwpMin: min, batteriaKwhPerKwpMax: max } = DEFAULTS;
  const rapporto = min + quotaF2F3 * (max - min);
  return { kwh: round(kwp * rapporto, 0), rapporto: round(rapporto, 2) };
}

export function estimateSelfConsumption({ hasBattery, kwp, consumoAnnuoKwh, producibilitaAnnuaKwh }) {
  // Euristica: più l'impianto è vicino/oltre il 100% del consumo, più cala
  // l'autoconsumo senza accumulo; con accumulo il range si alza.
  const copertura = producibilitaAnnuaKwh / consumoAnnuoKwh;
  const t = Math.max(0, Math.min(1, (copertura - 0.5) / 1.0)); // 0 a copertura 50%, 1 a copertura 150%
  const [min, max] = hasBattery
    ? [DEFAULTS.autoconsumoConAccumuloMin, DEFAULTS.autoconsumoConAccumuloMax]
    : [DEFAULTS.autoconsumoSenzaAccumuloMin, DEFAULTS.autoconsumoSenzaAccumuloMax];
  const pct = max - t * (max - min); // copertura alta -> autoconsumo verso il minimo del range
  return round(pct, 3);
}

export function energyBalance({ producibilitaAnnuaKwh, autoconsumoPct }) {
  const autoconsumata = producibilitaAnnuaKwh * autoconsumoPct;
  const immessa = producibilitaAnnuaKwh - autoconsumata;
  return { autoconsumata: round(autoconsumata, 0), immessa: round(immessa, 0) };
}

export function economics({
  spesaAnnua,
  consumoAnnuoKwh,
  energiaAutoconsumata,
  energiaImmessa,
  tariffaGSE = DEFAULTS.tariffaGSE,
  tariffaCER = DEFAULTS.tariffaCER,
  quotaCondivisaCER = DEFAULTS.quotaCondivisaCER,
}) {
  const prezzoMedio = spesaAnnua / consumoAnnuoKwh;
  const risparmioBolletta = energiaAutoconsumata * prezzoMedio;
  const ricavoGSE = energiaImmessa * tariffaGSE;
  const energiaCondivisaCER = energiaImmessa * quotaCondivisaCER;
  const ricavoCER = energiaCondivisaCER * tariffaCER;
  const beneficioTotale = risparmioBolletta + ricavoGSE + ricavoCER;
  return {
    prezzoMedio: round(prezzoMedio, 4),
    risparmioBolletta: round(risparmioBolletta, 0),
    ricavoGSE: round(ricavoGSE, 0),
    ricavoCER: round(ricavoCER, 0),
    beneficioTotale: round(beneficioTotale, 0),
  };
}

export function investmentEstimate({ kwp, batteriaKwh, costoKwp = DEFAULTS.costoKwp, costoKwhBatteria = DEFAULTS.costoKwhBatteria }) {
  const investimento = kwp * costoKwp + batteriaKwh * costoKwhBatteria;
  return round(investimento, 0);
}

export function paybackYears({ investimento, beneficioAnnuo }) {
  if (!beneficioAnnuo) return null;
  return round(investimento / beneficioAnnuo, 1);
}

export function co2Evitata({ producibilitaAnnuaKwh, carbonOffsetFactorKgPerMwh }) {
  const kg = (producibilitaAnnuaKwh / 1000) * carbonOffsetFactorKgPerMwh;
  return round(kg / 1000, 1); // tonnellate
}

// Converte l'azimuth "bussola" di Google Solar API (0=Nord, 90=Est, 180=Sud, 270=Ovest)
// nell'aspect PVGIS (0=Sud, +90=Ovest, -90=Est).
export function azimuthToPvgisAspect(azimuthCompass) {
  let aspect = azimuthCompass - 180;
  if (aspect > 180) aspect -= 360;
  if (aspect < -180) aspect += 360;
  return round(aspect, 1);
}

function round(n, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
