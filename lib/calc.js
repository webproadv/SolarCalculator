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
  tariffaGSE: 0.11, // €/kWh IVA esclusa — Ritiro Dedicato / vendita energia immessa
  tariffaCER: 0.07, // €/kWh IVA esclusa — incentivo Comunità Energetiche Rinnovabili
  quotaCondivisaCER: 1.0, // quota dell'immesso considerata "condivisa" ai fini CER (semplificazione MVP)
  costoKwp: 900, // €/kWp — stima EPC impianto C&I turnkey
  costoKwhBatteria: 400, // €/kWh — stima costo accumulo
  ivaBolletta: 0.22, // aliquota IVA sulla spesa energetica dichiarata dal cliente (bolletta, IVA inclusa)
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

// Accumulo suggerito: media giornaliera del consumo notturno annuo (360
// giorni convenzionali, coerente con la simulazione mensile dell'autoconsumo
// più sotto, che usa 30,4 giorni/mese medi = 364,8 ≈ 360 giorni/anno).
export function sizeBatteryFromNotturno({ consumoNotturnoKwh }) {
  return round((consumoNotturnoKwh || 0) / 360, 1);
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

// Euristica precedente, non più usata per il calcolo mostrato in dashboard
// (sostituita da simulaAutoconsumoMensile, più sotto) — lasciata per
// compatibilità/riferimento.
export function estimateSelfConsumption({ hasBattery, kwp, consumoAnnuoKwh, producibilitaAnnuaKwh }) {
  const copertura = producibilitaAnnuaKwh / consumoAnnuoKwh;
  const t = Math.max(0, Math.min(1, (copertura - 0.5) / 1.0)); // 0 a copertura 50%, 1 a copertura 150%
  const [min, max] = hasBattery
    ? [DEFAULTS.autoconsumoConAccumuloMin, DEFAULTS.autoconsumoConAccumuloMax]
    : [DEFAULTS.autoconsumoSenzaAccumuloMin, DEFAULTS.autoconsumoSenzaAccumuloMax];
  const pct = max - t * (max - min); // copertura alta -> autoconsumo verso il minimo del range
  return round(pct, 3);
}

// Giorni medi per mese (365/12), usati per convertire la potenza di accumulo
// (kWh) in "capacità mensile spostabile dal giorno alla notte", assumendo un
// ciclo di carica/scarica pieno al giorno.
const GIORNI_MESE_MEDI = 30.4;

// Simulazione mensile dell'autoconsumo — sostituisce l'euristica precedente
// con un calcolo preciso mese per mese, come da formula del cliente:
//   Autoconsumo mese_i = MIN(Produzione impianto mese_i, Consumo diurno
//                            mese_i + Potenza accumulo (kWh) × 30,4)
//   Immissione mese_i  = Produzione mese_i − Autoconsumo mese_i (per differenza)
// Sommando i 12 mesi si ottiene l'autoconsumo totale, la percentuale esatta
// (autoconsumo totale ÷ produzione totale) e l'immesso in rete da usare per
// i benefici GSE + CER.
export function simulaAutoconsumoMensile({ monthlyProduzioneKwh, monthlyConsumoDiurnoKwh, batteriaKwh }) {
  const capacitaAccumuloMensile = (batteriaKwh || 0) * GIORNI_MESE_MEDI;

  const mesi = monthlyProduzioneKwh.map((produzioneRaw, i) => {
    const produzione = produzioneRaw || 0;
    const consumoDiurno = monthlyConsumoDiurnoKwh[i] || 0;
    const autoconsumo = Math.min(produzione, consumoDiurno + capacitaAccumuloMensile);
    const immissione = Math.max(0, produzione - autoconsumo);
    return {
      produzione: round(produzione, 0),
      consumoDiurno: round(consumoDiurno, 0),
      autoconsumo: round(autoconsumo, 0),
      immissione: round(immissione, 0),
    };
  });

  const totaleProduzione = mesi.reduce((s, m) => s + m.produzione, 0);
  const totaleAutoconsumo = mesi.reduce((s, m) => s + m.autoconsumo, 0);
  const totaleImmissione = mesi.reduce((s, m) => s + m.immissione, 0);
  const autoconsumoPct = totaleProduzione > 0 ? totaleAutoconsumo / totaleProduzione : 0;

  return { mesi, totaleProduzione, totaleAutoconsumo, totaleImmissione, autoconsumoPct: round(autoconsumoPct, 4) };
}

export function energyBalance({ producibilitaAnnuaKwh, autoconsumoPct }) {
  const autoconsumata = producibilitaAnnuaKwh * autoconsumoPct;
  const immessa = producibilitaAnnuaKwh - autoconsumata;
  return { autoconsumata: round(autoconsumata, 0), immessa: round(immessa, 0) };
}

// Tutti i valori economici sono calcolati e restituiti IVA ESCLUSA. La spesa
// energetica dichiarata dal cliente (spesaAnnua) è quella che legge in
// bolletta, quindi IVA inclusa: il primo passo è depurarla dell'aliquota
// IVA (22% di default) per ottenere sia la spesa netta sia il costo al kWh
// netto, da cui discendono risparmio in bolletta, ricavo GSE, ricavo CER e
// beneficio totale — tutti coerentemente IVA esclusa da qui in avanti.
//   Risparmio bolletta = Costo al kWh (IVA esclusa) × Produzione totale × % autoconsumo
//                       = prezzoMedio × energiaAutoconsumata
//   Ricavo GSE = 0,11 €/kWh × energia immessa in rete
//   Ricavo CER = 0,07 €/kWh × energia immessa in rete (× quota condivisa)
//   Beneficio totale = somma dei tre valori sopra
export function economics({
  spesaAnnua,
  consumoAnnuoKwh,
  energiaAutoconsumata,
  energiaImmessa,
  tariffaGSE = DEFAULTS.tariffaGSE,
  tariffaCER = DEFAULTS.tariffaCER,
  quotaCondivisaCER = DEFAULTS.quotaCondivisaCER,
  ivaBolletta = DEFAULTS.ivaBolletta,
}) {
  const spesaAnnuaNetta = spesaAnnua / (1 + ivaBolletta);
  const prezzoMedio = spesaAnnuaNetta / consumoAnnuoKwh; // €/kWh, IVA esclusa
  const risparmioBolletta = energiaAutoconsumata * prezzoMedio;
  const ricavoGSE = energiaImmessa * tariffaGSE;
  const energiaCondivisaCER = energiaImmessa * quotaCondivisaCER;
  const ricavoCER = energiaCondivisaCER * tariffaCER;
  const beneficioTotale = risparmioBolletta + ricavoGSE + ricavoCER;
  return {
    spesaAnnuaNetta: round(spesaAnnuaNetta, 0),
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

// Noleggio operativo — tassi mensili (% del costo impianto) per numero di
// rate e fascia di importo (soglia 50.000 €); dati commerciali forniti.
export const NOLEGGIO_OPERATIVO_TASSI = {
  84: { sottoSoglia: 1.593, sopraSoglia: 1.546 },
  72: { sottoSoglia: 1.781, sopraSoglia: 1.735 },
  60: { sottoSoglia: 2.049, sopraSoglia: 2.004 },
};
const NOLEGGIO_OPERATIVO_SOGLIA_IMPORTO = 50000;
const NOLEGGIO_OPERATIVO_DEDUCIBILITA = 0.279; // 27,9% del costo annuo di noleggio

// Soluzione economica "Noleggio operativo": rata mensile da tabella tassi
// (per numero rate e fascia di importo — soglia 50.000 €), da cui derivano
// il costo annuo di noleggio (12 rate), la deduzione fiscale annua e il
// beneficio economico complessivo sommando il beneficio "impianto" già
// calcolato (risparmio bolletta + GSE + CER) alla deduzione da noleggio.
export function noleggioOperativo({ costoImpianto, numeroRate, beneficioTotaleAnnuo = 0 }) {
  const tassi = NOLEGGIO_OPERATIVO_TASSI[numeroRate];
  if (!tassi || !(costoImpianto > 0)) {
    return { rataMensile: 0, costoAnnuoNoleggio: 0, deduzioneAnnua: 0, beneficioTotaleConNoleggio: round(beneficioTotaleAnnuo, 0) };
  }
  const tassoPct = costoImpianto <= NOLEGGIO_OPERATIVO_SOGLIA_IMPORTO ? tassi.sottoSoglia : tassi.sopraSoglia;
  const rataMensile = (costoImpianto * tassoPct) / 100;
  const costoAnnuoNoleggio = rataMensile * 12;
  const deduzioneAnnua = costoAnnuoNoleggio * NOLEGGIO_OPERATIVO_DEDUCIBILITA;
  const beneficioTotaleConNoleggio = beneficioTotaleAnnuo + deduzioneAnnua;
  return {
    rataMensile: round(rataMensile, 0),
    costoAnnuoNoleggio: round(costoAnnuoNoleggio, 0),
    deduzioneAnnua: round(deduzioneAnnua, 0),
    beneficioTotaleConNoleggio: round(beneficioTotaleConNoleggio, 0),
  };
}

// Riepilogo del flusso di cassa a confronto: senza impianto (si continua a
// pagare l'intera bolletta), con impianto durante il noleggio (si somma il
// beneficio GSE/CER/deduzione fiscale ma si paga la rata di noleggio), e con
// impianto dopo il noleggio (la rata sparisce, così come la sua deduzione).
// Tutti i valori sono IVA esclusa, in coerenza con gli altri importi
// economici calcolati dall'app (vedi economics()); la spesa annua NETTA è
// quindi il riferimento "senza impianto", non la spesa annua lorda inserita
// dal cliente. La "bolletta residua" è la parte di spesa energetica che
// resta anche con l'impianto, perché non tutto il consumo viene
// autoconsumato. Il "delta cash flow" di ogni scenario è la differenza
// rispetto al saldo "senza impianto" (quanto si guadagna o si perde further
// scegliendo l'impianto anziché non fare nulla); per la riga "senza
// impianto" il delta coincide con il suo stesso saldo, riportato come
// riferimento.
export function flussoCassaNoleggio({ spesaAnnuaNetta, risparmioBolletta, ricavoGSE, ricavoCER, deduzioneAnnua, costoAnnuoNoleggio }) {
  const bollettaResidua = Math.max(0, round(spesaAnnuaNetta - risparmioBolletta, 0));
  const saldoSenzaImpianto = -round(spesaAnnuaNetta, 0);

  const entrateDuranteNoleggio = round(ricavoGSE + ricavoCER + deduzioneAnnua, 0);
  const usciteDuranteNoleggio = round(bollettaResidua + costoAnnuoNoleggio, 0);
  const saldoDuranteNoleggio = entrateDuranteNoleggio - usciteDuranteNoleggio;

  const entrateDopoNoleggio = round(ricavoGSE + ricavoCER, 0);
  const usciteDopoNoleggio = bollettaResidua;
  const saldoDopoNoleggio = entrateDopoNoleggio - usciteDopoNoleggio;

  return {
    bollettaResidua,
    senzaImpianto: {
      uscita: round(spesaAnnuaNetta, 0),
      saldo: saldoSenzaImpianto,
      delta: saldoSenzaImpianto,
    },
    duranteNoleggio: {
      ricavoGSE: round(ricavoGSE, 0),
      ricavoCER: round(ricavoCER, 0),
      deduzioneAnnua: round(deduzioneAnnua, 0),
      bollettaResidua,
      costoAnnuoNoleggio: round(costoAnnuoNoleggio, 0),
      entrate: entrateDuranteNoleggio,
      uscite: usciteDuranteNoleggio,
      saldo: saldoDuranteNoleggio,
      delta: saldoDuranteNoleggio - saldoSenzaImpianto,
    },
    dopoNoleggio: {
      ricavoGSE: round(ricavoGSE, 0),
      ricavoCER: round(ricavoCER, 0),
      bollettaResidua,
      entrate: entrateDopoNoleggio,
      uscite: usciteDopoNoleggio,
      saldo: saldoDopoNoleggio,
      delta: saldoDopoNoleggio - saldoSenzaImpianto,
    },
  };
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
