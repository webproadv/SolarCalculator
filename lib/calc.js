// Motore di calcolo — dimensionamento impianto FV + accumulo + bilancio economico.
// Formule allineate al documento di progetto "Webapp Fotovoltaico".
// Tutti i parametri economici/tecnici hanno un default ma sono pensati per essere
// sovrascritti (query param o body) man mano che l'app matura da MVP a prodotto.

export const DEFAULTS = {
  coperturaTarget: 0.9, // quota del consumo annuo che l'impianto punta a coprire
  kwpPerM2: 0.20, // densità di potenza tipica per pannelli attuali (usata per la capacità max del tetto)
  panelWp: 505, // Wp per pannello standard, usato per stimare il numero di moduli da installare
  mqPerKwp: 4.1, // superficie utile richiesta per ogni kWp installato (stima cavi, distanziamento, ecc.)
  batteriaKwhPerKwpMin: 0.5, // accumulo minimo (quota F2+F3 ~ 0)
  batteriaKwhPerKwpMax: 1.5, // accumulo massimo (quota F2+F3 ~ 1)
  autoconsumoSenzaAccumuloMin: 0.30,
  autoconsumoSenzaAccumuloMax: 0.45,
  autoconsumoConAccumuloMin: 0.55,
  autoconsumoConAccumuloMax: 0.75,
  tariffaGSE: 0.11, // €/kWh — Ritiro Dedicato / vendita energia immessa
  tariffaCER: 0.07, // €/kWh — incentivo Comunità Energetiche Rinnovabili
  quotaCondivisaCER: 1.0, // quota dell'immesso considerata "condivisa" ai fini CER (semplificazione MVP)
  costoKwp: 900, // €/kWp — stima EPC impianto C&I turnkey
  costoKwhBatteria: 400, // €/kWh — stima costo accumulo
};

// Fabbisogno diurno/notturno a partire dai consumi per fascia (kWh/anno) e
// dai giorni lavorativi settimanali dichiarati dal cliente:
// - 5 giorni (lun-ven): il fine settimana coincide con F2/F3 -> diurno = F1
// - 6 giorni (lun-sab): il sabato "assorbe" parte della fascia F2 -> +33%
// - 7 giorni (turni no-stop): si conta anche metà della fascia F3
export function diurnoNotturno({ f1Kwh, f2Kwh, f3Kwh, totaleKwh, giorniLavorativi }) {
  let diurno;
  if (giorniLavorativi >= 7) {
    diurno = f1Kwh + f2Kwh * 0.33 + f3Kwh * 0.5;
  } else if (giorniLavorativi === 6) {
    diurno = f1Kwh + f2Kwh * 0.33;
  } else {
    diurno = f1Kwh;
  }
  diurno = Math.min(diurno, totaleKwh);
  const notturno = Math.max(0, totaleKwh - diurno);
  return { diurno: round(diurno, 0), notturno: round(notturno, 0) };
}

// Taglia impianto suggerita: rapporto diretto tra consumo annuo e produzione
// specifica annua del sito (kWh/kWp), inserita manualmente dall'utente
// (tipicamente da PVGIS o da una stima già in suo possesso).
export function sizeSystemFromProduzione({ consumoAnnuoKwh, produzioneAnnuaFvKwh }) {
  if (!produzioneAnnuaFvKwh || produzioneAnnuaFvKwh <= 0) return 0;
  return round(consumoAnnuoKwh / produzioneAnnuaFvKwh, 1);
}

// Accumulo suggerito: media giornaliera del consumo notturno annuo.
export function sizeBatteryFromNotturno({ consumoNotturnoKwh }) {
  return round((consumoNotturnoKwh || 0) / 365, 1);
}

// Ripartizione mensile fissa della produzione dell'impianto (somma 100%),
// da un profilo tipico fornito dal cliente — sostituisce il dettaglio
// mensile PVGIS per la sola generazione del grafico di produzione.
export const MONTHLY_PRODUCTION_SHARES = [
  0.05, 0.057, 0.08, 0.098, 0.105, 0.12, 0.13, 0.11, 0.087, 0.07, 0.051, 0.042,
];

export function monthlyProductionFromShares(produzioneAnnuaTotaleKwh) {
  return MONTHLY_PRODUCTION_SHARES.map((pct) => round((produzioneAnnuaTotaleKwh || 0) * pct, 0));
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
