// Sezione F — Vendita energia in modalità PPA.
//
// Il cliente non paga l'impianto: lo installiamo a nostre spese e gli vendiamo
// l'energia a tariffa fissa per N anni.
//
//   Da recuperare      = costo effettivo impianto − anticipo
//   Ricavo vendita     = kWh F1 vendibili (mese per mese MIN(produzione, consumo F1)) × tariffa fissa
//   Ricavo GSE         = (produzione totale − kWh F1 venduti) × tariffa GSE
//   Ricavo annuo       = Ricavo vendita + Ricavo GSE
//   Rientro (anni)     = Da recuperare ÷ Ricavo annuo
//   Ricavo totale      = Ricavo annuo × durata accordo
//   Guadagno netto     = Ricavo totale − Da recuperare
//   Ritorno totale     = ((Ricavo totale ÷ costo effettivo impianto) − 1) × 100
//   Ritorno annuo      = Ritorno totale ÷ anni dell'accordo
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
  f1Kwh, // kWh F1 vendibili: somma mensile di MIN(produzione, F1 bolletta)
  immessoKwh, // produzione totale − kWh F1 venduti
  prezzoAttuale = 0, // €/kWh pagato oggi dal cliente (riferimento)
  energiaF23Kwh = 0, // energia diurna F2/F3 vendibile in più (NON entra nei calcoli principali)
  spesaAnnuaNetta = 0, // spesa annua in bolletta ATTUALE, IVA esclusa (x)
  bollettaDopoPpaAnnua = null, // bolletta residua annua a PPA scaduto, impianto del cliente
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
    // Se il solo GSE basta già a rientrare prima degli anni scelti, la tariffa
    // non può scendere sotto zero: il rientro reale è quello del solo GSE.
    if (f1 > 0 && (daRecuperare / anni - ricavoGseAnnuo) < 0 && ricavoGseAnnuo > 0) anni = daRecuperare / ricavoGseAnnuo;
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

  // Risparmio in bolletta del cliente sulla quota di energia che gli vendiamo
  // (kWh F1 venduti): differenza tra prezzo attuale e tariffa PPA.
  // Come % sul totale bolletta = risparmio annuo ÷ spesa annua netta.
  const spesaNetta = Math.max(0, n(spesaAnnuaNetta));
  // Spesa del cliente: oggi (x) → durante il PPA (y = x − risparmio sull'energia
  // F1 che compra da noi) → dopo il PPA (bolletta residua, impianto suo).
  // Risparmio % annuo = (x − y) ÷ x.
  const haSpesa = risparmioAnnuoCliente != null && spesaNetta > 0;
  const spesaDuranteAnnua = haSpesa ? spesaNetta - risparmioAnnuoCliente : null;
  const risparmioSuTotalePct = haSpesa ? ((spesaNetta - spesaDuranteAnnua) / spesaNetta) * 100 : null;
  const dopo = bollettaDopoPpaAnnua != null && Number.isFinite(Number(bollettaDopoPpaAnnua)) ? Math.max(0, Number(bollettaDopoPpaAnnua)) : null;
  const risparmioDopoPct = dopo != null && spesaNetta > 0 ? ((spesaNetta - dopo) / spesaNetta) * 100 : null;

  // Guadagno aggiuntivo "a parte": energia diurna in F2/F3 × nostra tariffa
  // di vendita meno GSE. Volutamente escluso da rientro, ricavi, ROI e guadagno netto.
  const f23 = Math.max(0, n(energiaF23Kwh));
  // Gli stessi kWh sono già pagati dal GSE nei calcoli principali (rientrano
  // nell'immissione): qui si valorizza solo la differenza (tariffa vendita − GSE).
  const margineF23 = tariffaN - gse;
  const extraF23Annuo = f23 * margineF23;

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
    // Ritorno totale = ((ricavo totale ÷ spese) − 1) × 100 ; spese = costo effettivo impianto
    // Ritorno annuo  = ritorno totale ÷ anni dell'accordo
    roiTotalePct: costoN > 0 ? (ricavoTotale / costoN - 1) * 100 : null,
    roiAnnuoPct: costoN > 0 ? ((ricavoTotale / costoN - 1) * 100) / durataN : null,
    guadagnoNettoPct: costoN > 0 ? (guadagnoNetto / costoN) * 100 : null,
    tariffaMinima,
    scontoPct,
    risparmioAnnuoCliente,
    risparmioTotaleCliente: risparmioAnnuoCliente != null ? risparmioAnnuoCliente * durataN : null,
    risparmioSuTotalePct,
    risparmioBollettaPct: risparmioSuTotalePct,
    spesaAnnuaNetta: spesaNetta,
    spesaDuranteAnnua,
    spesaDuranteTotale: spesaDuranteAnnua != null ? spesaDuranteAnnua * durataN : null,
    spesaDopoAnnua: dopo,
    risparmioDopoPct,
    extraF23Kwh: f23,
    extraF23Annuo,
    extraF23Totale: extraF23Annuo * durataN,
    extraF23Margine: margineF23, // €/kWh = tariffa di vendita − tariffa GSE
    f1Kwh: f1,
    immessoKwh: immesso,
    tariffaGse: gse,
  };
}
