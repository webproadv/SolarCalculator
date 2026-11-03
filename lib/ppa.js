// Sezione F — Vendita energia in modalità PPA.
//
// Il cliente non paga l'impianto: lo installiamo a nostre spese e gli vendiamo
// l'energia a tariffa fissa per N anni.
//
//   Da recuperare      = costo effettivo impianto − anticipo
//   Ricavo vendita     = kWh consumati in F1 (tutta la fascia) × tariffa fissa
//   Ricavo GSE         = (produzione totale − kWh F1 venduti) × tariffa GSE
//   Ricavo annuo       = Ricavo vendita + Ricavo GSE
//   Rientro (anni)     = Da recuperare ÷ Ricavo annuo
//   Ricavo totale      = Ricavo annuo × durata accordo
//   Guadagno netto     = Ricavo totale − Da recuperare
//   Ritorno annuo/tot. = Ricavo annuo (o totale) ÷ costo effettivo impianto
//
// Due modalità, intercambiabili:
//   modo 1: si fissa la tariffa → si calcolano gli anni di rientro
//   modo 2: si fissano gli anni di rientro → si calcola la tariffa necessaria
//           tariffa = (Da recuperare ÷ anni − Ricavo GSE annuo) ÷ kWh F1
//
// Funzioni pure, nessuna dipendenza dal resto dell'app.

export const PPA_DEFAULTS = {
  tariffaGse: 0.11, // €/kWh sull'energia non autoconsumata in F1
  durataAnni: 5,
  anniRientro: 2.5, // obiettivo: rientro in metà della durata
};

const n = (v) => {
  const x = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function calcolaPpa({
  modo = 2, // 1 = tariffa → anni; 2 = anni → tariffa
  costo,
  anticipo,
  tariffa, // €/kWh (usata in modo 1)
  durata, // anni accordo
  anniRientro, // anni (usati in modo 2)
  tariffaGse = PPA_DEFAULTS.tariffaGse,
  f1Kwh, // consumo annuo in F1 venduto al cliente (≤ produzione)
  immessoKwh, // produzione totale − kWh F1 venduti
  prezzoAttuale = 0, // €/kWh pagato oggi dal cliente (riferimento)
}) {
  const costoN = Math.max(0, n(costo));
  const anticipoN = Math.max(0, n(anticipo));
  const durataN = Math.max(0.5, n(durata) || PPA_DEFAULTS.durataAnni);
  const f1 = Math.max(0, n(f1Kwh));
  const immesso = Math.max(0, n(immessoKwh));
  const gse = Math.max(0, n(tariffaGse));

  const daRecuperare = Math.max(0, costoN - anticipoN);
  const ricavoGseAnnuo = immesso * gse;

  let tariffaN;
  let anni;
  if (modo === 1) {
    tariffaN = Math.max(0, n(tariffa));
    const ric = f1 * tariffaN + ricavoGseAnnuo;
    anni = ric > 0 ? daRecuperare / ric : Infinity;
  } else {
    anni = Math.max(0.1, n(anniRientro) || PPA_DEFAULTS.anniRientro);
    tariffaN = f1 > 0 ? Math.max(0, (daRecuperare / anni - ricavoGseAnnuo) / f1) : 0;
  }

  const ricavoVenditaAnnuo = f1 * tariffaN;
  const ricavoAnnuo = ricavoVenditaAnnuo + ricavoGseAnnuo;
  const ricavoTotale = ricavoAnnuo * durataN;
  const guadagnoNetto = ricavoTotale - daRecuperare;
  const rientraInDurata = Number.isFinite(anni) && anni <= durataN + 1e-9;
  const anniGuadagno = rientraInDurata ? durataN - anni : 0;

  // Tariffa minima per rientrare esattamente entro la durata dell'accordo.
  const tariffaMinima = f1 > 0 ? Math.max(0, (daRecuperare / durataN - ricavoGseAnnuo) / f1) : 0;

  const prezzo = Math.max(0, n(prezzoAttuale));
  const scontoPct = prezzo > 0 ? ((prezzo - tariffaN) / prezzo) * 100 : null;
  const risparmioAnnuoCliente = prezzo > 0 ? (prezzo - tariffaN) * f1 : null;

  return {
    modo,
    durata: durataN,
    daRecuperare,
    tariffa: tariffaN,
    anniRientro: anni,
    rientraInDurata,
    anniGuadagno,
    ricavoVenditaAnnuo,
    ricavoGseAnnuo,
    ricavoAnnuo,
    ricavoVenditaTotale: ricavoVenditaAnnuo * durataN,
    ricavoGseTotale: ricavoGseAnnuo * durataN,
    ricavoTotale,
    costo: costoN,
    anticipo: anticipoN,
    guadagnoNetto,
    roiAnnuoPct: costoN > 0 ? (ricavoAnnuo / costoN) * 100 : null,
    roiTotalePct: costoN > 0 ? (ricavoTotale / costoN) * 100 : null,
    guadagnoNettoPct: costoN > 0 ? (guadagnoNetto / costoN) * 100 : null,
    tariffaMinima,
    scontoPct,
    risparmioAnnuoCliente,
    risparmioTotaleCliente: risparmioAnnuoCliente != null ? risparmioAnnuoCliente * durataN : null,
    f1Kwh: f1,
    immessoKwh: immesso,
    tariffaGse: gse,
  };
}
