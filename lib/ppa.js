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

// Obiettivi della "configurazione ottimale" (impostata in automatico quando si
// inserisce il costo effettivo dell'impianto; poi tutto resta modificabile).
export const PPA_TARGET = {
  risparmioClientePct: 25, // risparmio annuo in bolletta del cliente: ALMENO questo (% della spesa annua netta)
  margineNettoPct: 50, // guadagno netto ÷ costo effettivo, a fine accordo
  paybackMaxAnni: 3, // rientro massimo
  tariffaMin: 0.2, // €/kWh: forchetta ideale di vendita (0,20–0,22). Solo il tetto è vincolante:
  tariffaMax: 0.22, // per garantire il 25% di risparmio la tariffa può scendere anche sotto 0,20.
};

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
  // Sotto la tariffa GSE non si venderebbe: nessun guadagno aggiuntivo (mai negativo).
  const extraF23Annuo = f23 * Math.max(0, margineF23);

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
    // Ritorno totale = (((ricavo totale + anticipo incassato) ÷ costo effettivo impianto) − 1) × 100
    // (senza anticipo coincide con ((ricavo totale ÷ spese) − 1) × 100; con anticipo = margine finale)
    // Ritorno annuo  = ritorno totale ÷ anni dell'accordo
    roiTotalePct: costoN > 0 ? ((ricavoTotale + anticipoN) / costoN - 1) * 100 : null,
    roiAnnuoPct: costoN > 0 ? (((ricavoTotale + anticipoN) / costoN - 1) * 100) / durataN : null,
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

// Configurazione ottimale: tariffa + anticipo che portano agli obiettivi PPA_TARGET.
//  1) tariffa: la PIÙ ALTA che garantisce al cliente almeno il 25% di risparmio in bolletta
//       risparmio € = (prezzo attuale − tariffa) × kWh F1 venduti ≥ 25% × spesa annua netta
//       → tariffa = prezzo attuale − 25% × spesa ÷ kWh F1   (arrotondata per difetto, mai < 0)
//     con tetto 0,22 €/kWh (sopra non serve salire: il risparmio sarebbe già > 25%).
//  2) anticipo: l'anticipo minimo del cliente che, con quella tariffa, porta insieme
//     margine finale ≥ 50% e rientro ≤ 3 anni (arrotondato per eccesso a 100 €):
//       margine:  R·N − (C − A) ≥ 50% · C   →  A ≥ 1,5·C − R·N
//       rientro:  (C − A) ÷ R ≤ 3           →  A ≥ C − 3·R
//     (C costo, R ricavo annuo, N durata). Mai oltre il costo dell'impianto.
export function configurazioneOttimale({
  costo,
  durata,
  f1Kwh,
  immessoKwh,
  prezzoAttuale,
  spesaAnnuaNetta,
  tariffaGse = PPA_DEFAULTS.tariffaGse,
  target = PPA_TARGET,
}) {
  const C = Math.max(0, n(costo));
  const N = Math.max(0.5, n(durata) || PPA_DEFAULTS.durataAnni);
  const f1 = Math.max(0, n(f1Kwh));
  const immesso = Math.max(0, n(immessoKwh));
  const gse = Math.max(0, n(tariffaGse));
  const prezzo = Math.max(0, n(prezzoAttuale));
  const spesa = Math.max(0, n(spesaAnnuaNetta));

  const haDati = prezzo > 0 && spesa > 0 && f1 > 0;
  const tariffaDaRisparmio = haDati ? prezzo - ((target.risparmioClientePct / 100) * spesa) / f1 : (target.tariffaMin + target.tariffaMax) / 2;
  const tariffa = Math.floor(Math.min(target.tariffaMax, Math.max(0, tariffaDaRisparmio)) * 1000 + 1e-9) / 1000;

  const R = f1 * tariffa + immesso * gse;
  const aMargine = (target.margineNettoPct / 100 + 1) * C - R * N;
  const aPayback = C - target.paybackMaxAnni * R;
  let anticipo = Math.max(0, aMargine, aPayback);
  anticipo = Math.min(C, Math.ceil(anticipo / 100) * 100);
  if (!Number.isFinite(anticipo) || anticipo < 0) anticipo = 0;

  const risparmioPct = haDati ? ((prezzo - tariffa) * f1 / spesa) * 100 : null;
  const margine = C > 0 ? ((R * N - (C - anticipo)) / C) * 100 : null;
  const payback = R > 0 ? (C - anticipo) / R : Infinity;
  return {
    tariffa,
    anticipo,
    ricavoAnnuo: R,
    risparmioPct,
    margine,
    payback,
    // true se tutti e tre gli obiettivi sono centrati (altrimenti i riquadri in pagina lo segnalano)
    raggiunto:
      (risparmioPct == null || risparmioPct >= target.risparmioClientePct - 0.05) &&
      margine != null && margine >= target.margineNettoPct - 0.05 &&
      payback <= target.paybackMaxAnni + 0.005,
  };
}
