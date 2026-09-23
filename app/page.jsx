"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import {
  DEFAULTS,
  diurnoNotturno,
  simulaAutoconsumoMensile,
  economics,
  paybackYears,
  co2Evitata,
  monthlyProductionFromShares,
} from "../lib/calc";

const STEPS = ["Azienda", "Consumi", "Risultati"];

const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const MESI_BREVI = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

// Somma i kWh per fascia da una tabella di consumi mensili (12 righe {f1,f2,f3}).
function monthlyTotals(monthly) {
  const sums = monthly.reduce(
    (acc, m) => ({
      f1: acc.f1 + (Number(m.f1) || 0),
      f2: acc.f2 + (Number(m.f2) || 0),
      f3: acc.f3 + (Number(m.f3) || 0),
    }),
    { f1: 0, f2: 0, f3: 0 }
  );
  return { ...sums, total: sums.f1 + sums.f2 + sums.f3 };
}

// Percentuali F1/F2/F3 (sommano sempre a 100) dai totali annui per fascia.
function pctFromTotals({ f1, f2, f3 }) {
  const total = f1 + f2 + f3;
  if (!total) return { f1: 34, f2: 33, f3: 33 };
  const pf1 = Math.round((f1 / total) * 100);
  const pf2 = Math.round((f2 / total) * 100);
  return { f1: pf1, f2: pf2, f3: 100 - pf1 - pf2 };
}

// Forma stagionale generica per un profilo di consumo commerciale/industriale
// italiano (pesi relativi mese per mese: non serve che sommino a un valore
// preciso, vengono sempre rinormalizzati sul totale annuo reale prima
// dell'uso). Riflette il tipico calo di agosto per le ferie e punte leggere
// nei mesi invernali/estivi (riscaldamento/climatizzazione). Usata SOLO come
// ultima risorsa, quando non sono disponibili né i consumi mensili reali
// (tabella "manuale") né un andamento letto dalla bolletta (OCR) — è una
// stima dichiarata come tale, mai un valore identico su tutti i mesi.
const CONSUMO_MONTHLY_SHAPE_FALLBACK = [1.06, 1.02, 1.0, 0.94, 0.94, 1.0, 1.04, 0.55, 0.96, 1.0, 1.06, 1.08];

// Distribuisce un totale annuo sui 12 mesi secondo una "forma" di pesi
// relativi, rinormalizzata così che la somma dei 12 valori risultanti torni
// sempre esattamente al totale annuo passato.
function applyMonthlyShape(totaleAnnuo, pesi) {
  const sommaPesi = pesi.reduce((s, p) => s + p, 0) || 1;
  return pesi.map((p) => (totaleAnnuo * p) / sommaPesi);
}

// Consumo diurno/notturno mese per mese per il grafico combinato in
// dashboard — calcolato sempre a partire dai totali confermati nel
// preventivo (quote.input), mai da una copia locale separata, in modo che la
// colonna dei consumi rispecchi esattamente i dati inseriti nel form
// iniziale (stessi numeri della card "Riepilogo consumi" in Sezione B).
// La tabella mensile F1/F2/F3 (vedi monthly) è ormai lo stesso identico
// componente in entrambe le modalità: in "manuale" l'utente la compila a
// mano, in "foto" viene precompilata dall'OCR della bolletta e poi verificata
// e confermata dall'utente. Se contiene dati reali si usa sempre quella.
// Il ramo "legacy" sotto resta solo per i preventivi salvati prima
// dell'introduzione della tabella mensile anche in modalità foto (quando la
// tabella non era mai stata valorizzata): in quel caso si ricostruisce una
// stima dall'andamento letto dalla bolletta (se presente) o, in ultima
// istanza, dalla stagionalità tipica di CONSUMO_MONTHLY_SHAPE_FALLBACK — mai
// una semplice divisione per 12 uguale su tutti i mesi.
function monthlyConsumoFromQuote({ quoteInput, monthly, ocrMonthlyKwh }) {
  const totaliMonthly = monthlyTotals(monthly);
  if (totaliMonthly.total > 0) {
    return MESI.map((_, i) => {
      const f1 = Number(monthly[i]?.f1) || 0;
      const f2 = Number(monthly[i]?.f2) || 0;
      const f3 = Number(monthly[i]?.f3) || 0;
      const totale = f1 + f2 + f3;
      const { diurno, notturno } = diurnoNotturno({
        f1Kwh: f1,
        f2Kwh: f2,
        f3Kwh: f3,
        totaleKwh: totale,
        giorniLavorativi: quoteInput.giorniLavorativi,
      });
      return { diurno, notturno, totale: Math.round(totale) };
    });
  }

  const pesi =
    Array.isArray(ocrMonthlyKwh) && ocrMonthlyKwh.length === 12 && ocrMonthlyKwh.every((v) => typeof v === "number" && v >= 0)
      ? ocrMonthlyKwh
      : CONSUMO_MONTHLY_SHAPE_FALLBACK;

  const diurnoMensile = applyMonthlyShape(quoteInput.consumoDiurnoKwh || 0, pesi);
  const notturnoMensile = applyMonthlyShape(quoteInput.consumoNotturnoKwh || 0, pesi);

  return MESI.map((_, i) => {
    const diurno = Math.round(diurnoMensile[i]);
    const notturno = Math.round(notturnoMensile[i]);
    return { diurno, notturno, totale: diurno + notturno };
  });
}

export default function Page() {
  const [step, setStep] = useState(0);

  // Step 1 — azienda
  const [piva, setPiva] = useState("");
  const [company, setCompany] = useState(null);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyError, setCompanyError] = useState("");

  // Step 2 — bolletta / fasce / consumo totale / spesa / produzione FV / giorni lavorativi
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrNote, setOcrNote] = useState("");
  // Andamento mensile dei consumi (12 kWh, gennaio→dicembre) se leggibile dal
  // grafico "andamento consumi" della bolletta caricata; null se non presente
  // o non letto con sufficiente certezza — vedi monthlyConsumoFromQuote.
  const [ocrMonthlyKwh, setOcrMonthlyKwh] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const [bollettaMode, setBollettaMode] = useState("foto"); // "foto" | "manuale"
  // Tabella mensile F1/F2/F3 (kWh), condivisa da entrambe le modalità: in
  // "manuale" l'utente la compila a mano da zero; in "foto" viene
  // precompilata automaticamente dai valori letti dalla bolletta (OCR) e poi
  // mostrata come tabella di verifica che l'utente controlla/corregge prima
  // di confermare. Il totale (per mese e annuo) si calcola sempre da solo.
  const [monthly, setMonthly] = useState(MESI.map(() => ({ f1: "", f2: "", f3: "" })));
  // true quando l'utente ha verificato/confermato la tabella (solo modalità
  // "foto"): da quel momento si può proseguire con produzione FV/giorni
  // lavorativi e generare il preventivo (validazione dei dati richiesta dal
  // cliente). Qualunque modifica successiva alla tabella o alla spesa annua
  // la annulla di nuovo.
  const [fotoConfermato, setFotoConfermato] = useState(false);

  // La spesa annua, la produzione annua FV e i giorni lavorativi si
  // inseriscono sempre in questa stessa schermata, in entrambe le modalità.
  const [spesaAnnua, setSpesaAnnua] = useState("");
  const [produzioneAnnuaFvKwh, setProduzioneAnnuaFvKwh] = useState("");
  const [giorniLavorativi, setGiorniLavorativi] = useState(5);

  // Step 3 — risultati
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");

  // Foto satellitare e simulazione pannelli: generate automaticamente subito
  // dopo il preventivo (vedi generaPreventivo), mostrate in dashboard.
  const [roofImages, setRoofImages] = useState(null);
  const [roofImagesLoading, setRoofImagesLoading] = useState(false);
  const [roofImagesError, setRoofImagesError] = useState("");

  // Progetto salvato aperto da "I miei progetti" (/?progetto=<id>): tiene i
  // valori proposto impianto/accumulo/costo con cui era stato salvato, così
  // la Dashboard li ripristina invece di ripartire dai valori suggeriti.
  const [progettoCaricato, setProgettoCaricato] = useState(null);
  const [progettoCaricamento, setProgettoCaricamento] = useState(false);

  async function caricaProgettoDaId(id) {
    setProgettoCaricamento(true);
    setQuoteError("");
    try {
      const r = await fetch(`/api/progetti/${id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Errore nel caricamento del progetto salvato.");
      const saved = data.dati || {};
      if (saved.company) setCompany(saved.company);
      if (saved.quote) setQuote(saved.quote);
      if (saved.monthly) setMonthly(saved.monthly);
      if (saved.bollettaMode) setBollettaMode(saved.bollettaMode);
      if (saved.ocrMonthlyKwh) setOcrMonthlyKwh(saved.ocrMonthlyKwh);
      setProgettoCaricato({
        id: data.id,
        impiantoProposto: saved.impiantoProposto,
        accumuloProposto: saved.accumuloProposto,
        costoImpiantoProposto: saved.costoImpiantoProposto,
      });
      setStep(2);
    } catch (err) {
      setQuoteError(err.message);
    } finally {
      setProgettoCaricamento(false);
    }
  }

  // Apertura diretta di un progetto salvato tramite /?progetto=<id> (link
  // "Apri" nella pagina "I miei progetti").
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("progetto");
    if (id) caricaProgettoDaId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cercaAzienda(e) {
    e.preventDefault();
    setCompanyError("");
    setCompanyLoading(true);
    try {
      const r = await fetch("/api/company", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ piva }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Errore nella ricerca azienda.");
      setCompany(data);
    } catch (err) {
      setCompanyError(err.message);
    } finally {
      setCompanyLoading(false);
    }
  }

  function updateCompanyField(key, value) {
    setCompany((prev) => ({ ...prev, [key]: value }));
  }

  // Modifica manuale della spesa annua: come per la tabella mensile (vedi
  // updateMonthly più sotto), annulla un'eventuale conferma già data in
  // modalità foto, così la validazione riflette sempre l'ultimo valore.
  function onSpesaAnnuaChange(value) {
    setSpesaAnnua(value);
    setFotoConfermato(false);
  }

  async function onBollettaUpload(file) {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setOcrLoading(true);
    setOcrNote("");
    setOcrMonthlyKwh(null);
    setFotoConfermato(false);
    try {
      const fd = new FormData();
      fd.append("bolletta", file);
      const r = await fetch("/api/ocr-bolletta", { method: "POST", body: fd });
      const data = await r.json();
      if (data.available === false) {
        setOcrNote("Lettura automatica non configurata su questa istanza (manca ANTHROPIC_API_KEY): compila la tabella mensile manualmente.");
      } else if (data.error) {
        setOcrNote(`Lettura automatica non riuscita (${data.error}). Compila la tabella mensile manualmente.`);
      } else {
        const letti = [];
        const havePct = typeof data.f1_pct === "number" && typeof data.f2_pct === "number";
        const haveMonthlyTrend =
          Array.isArray(data.monthly_kwh) && data.monthly_kwh.length === 12 && data.monthly_kwh.every((v) => typeof v === "number" && v >= 0);
        const haveTotaleAnnuo = typeof data.consumo_annuo_kwh === "number" && data.consumo_annuo_kwh > 0;

        if (haveMonthlyTrend) {
          setOcrMonthlyKwh(data.monthly_kwh);
        }

        // Totale kWh per ciascuno dei 12 mesi: se la bolletta riportava un
        // grafico "andamento consumi" mese per mese lo usiamo direttamente
        // (è un dato reale); altrimenti, se è noto solo il consumo annuo,
        // lo distribuiamo con la stagionalità tipica CONSUMO_MONTHLY_SHAPE_FALLBACK
        // (una stima dichiarata come tale, non un dato letto).
        let totaliPerMese = null;
        if (haveMonthlyTrend) {
          totaliPerMese = data.monthly_kwh;
        } else if (haveTotaleAnnuo) {
          totaliPerMese = applyMonthlyShape(Math.round(data.consumo_annuo_kwh), CONSUMO_MONTHLY_SHAPE_FALLBACK);
        }

        // La tabella mensile F1/F2/F3 si può precompilare solo avendo sia un
        // totale mese per mese (reale o stimato) sia le percentuali di
        // fascia lette dal grafico a torta della bolletta: la ripartizione
        // per fascia si applica identica a ogni mese. Se manca uno dei due,
        // la tabella resta vuota e l'utente la compila/verifica a mano.
        if (totaliPerMese && havePct) {
          const p1 = Math.round(data.f1_pct);
          const p2 = Math.round(data.f2_pct);
          const nuovoMonthly = totaliPerMese.map((totRaw) => {
            const tot = Math.round(totRaw);
            const f1 = Math.round((p1 / 100) * tot);
            const f2 = Math.round((p2 / 100) * tot);
            const f3 = Math.max(0, tot - f1 - f2);
            return { f1: String(f1), f2: String(f2), f3: String(f3) };
          });
          setMonthly(nuovoMonthly);
          letti.push(haveMonthlyTrend ? "andamento mensile e ripartizione F1/F2/F3" : "consumo annuo (distribuito sui 12 mesi) e ripartizione F1/F2/F3");
        } else if (totaliPerMese) {
          letti.push(
            haveMonthlyTrend
              ? "andamento mensile (ripartisci tu F1/F2/F3 in tabella per ogni mese)"
              : `consumo annuo (${Math.round(data.consumo_annuo_kwh).toLocaleString("it-IT")} kWh — inserisci tu i kWh mese per mese in tabella)`
          );
        } else if (havePct) {
          letti.push("ripartizione F1/F2/F3 in percentuale (inserisci i kWh mese per mese in tabella)");
        }

        // Precompila la spesa solo se l'utente non ha già inserito un
        // valore, per non sovrascrivere una correzione manuale.
        if (typeof data.spesa_annua_euro === "number") {
          setSpesaAnnua((prev) => (prev ? prev : String(Math.round(data.spesa_annua_euro))));
          letti.push("spesa annua");
        }
        setOcrNote(
          letti.length
            ? `Valori letti automaticamente dalla bolletta (${letti.join(", ")} — confidenza: ${data.confidence || "n/d"}). Controlla e correggi la tabella qui sotto, poi conferma.`
            : `Non è stato possibile leggere valori affidabili dalla foto (confidenza: ${data.confidence || "n/d"}). Compila la tabella manualmente.`
        );
      }
    } catch (err) {
      setOcrNote(`Errore durante la lettura automatica: ${err.message}. Compila la tabella manualmente.`);
    } finally {
      setOcrLoading(false);
    }
  }

  // Foto satellitare + simulazione pannelli sul tetto (Google Solar API
  // dataLayers): generata automaticamente non appena è pronto un preventivo
  // reale (non demo) con posizioni pannelli disponibili — nessuna azione
  // richiesta all'utente.
  async function fetchRoofImagesAuto(quoteData, companyData) {
    if (!quoteData?.roof?.solarPanels?.length) return;
    setRoofImagesError("");
    setRoofImagesLoading(true);
    try {
      const r = await fetch("/api/roof-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lat: companyData.lat,
          lng: companyData.lng,
          segments: quoteData.roof.segments,
          solarPanels: quoteData.roof.solarPanels,
          panelsCount: Math.round((quoteData.sizing.kwpSuggerito * 1000) / DEFAULTS.panelWp),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Errore nella generazione delle foto.");
      setRoofImages(data);
    } catch (err) {
      setRoofImagesError(err.message);
    } finally {
      setRoofImagesLoading(false);
    }
  }

  async function generaPreventivo() {
    setQuoteError("");
    setQuoteLoading(true);
    setRoofImages(null);
    setRoofImagesError("");

    // Il consumo annuo e le percentuali F1/F2/F3 derivano sempre dalla
    // tabella mensile (stessa tabella in entrambe le modalità: compilata a
    // mano in "manuale", precompilata dall'OCR e confermata in "foto" — vedi
    // puoProseguireOltreBolletta più sotto per il blocco di conferma).
    const totali = monthlyTotals(monthly);
    const pctCalcolate = pctFromTotals(totali);
    const consumoEffettivo = totali.total;
    const f1Effettivo = pctCalcolate.f1;
    const f2Effettivo = pctCalcolate.f2;
    const f3Effettivo = pctCalcolate.f3;
    const giorniEffettivi = Number(giorniLavorativi) || 5;

    try {
      const r = await fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lat: company.lat,
          lng: company.lng,
          spesaAnnua: Number(spesaAnnua),
          consumoAnnuoKwh: consumoEffettivo,
          f1Pct: f1Effettivo,
          f2Pct: f2Effettivo,
          f3Pct: f3Effettivo,
          produzioneAnnuaFvKwh: Number(produzioneAnnuaFvKwh),
          giorniLavorativi: giorniEffettivi,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Errore nel calcolo del preventivo.");
      setQuote(data);
      setStep(2);
      // Non blocca il passaggio alla dashboard: le foto arrivano appena pronte.
      fetchRoofImagesAuto(data, company);
    } catch (err) {
      setQuoteError(err.message);
    } finally {
      setQuoteLoading(false);
    }
  }

  // Qualunque modifica manuale alla tabella dopo una conferma la annulla,
  // così in modalità foto il tasto torna a "Conferma" e la validazione
  // riflette sempre l'ultimo valore corretto dall'utente.
  function updateMonthly(i, key, value) {
    setMonthly((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [key]: value };
      return next;
    });
    setFotoConfermato(false);
  }

  const monthlyTotalsCalc = monthlyTotals(monthly);
  const monthlyPctCalc = pctFromTotals(monthlyTotalsCalc);

  const consumoValido = monthlyTotalsCalc.total > 0;
  const spesaValida = Number(spesaAnnua) > 0;
  const produzioneValida = Number(produzioneAnnuaFvKwh) > 0;
  // In modalità foto occorre anche aver verificato/confermato la tabella
  // prima di poter proseguire con produzione FV/giorni lavorativi e generare
  // il preventivo (validazione dei dati richiesta dal cliente); in modalità
  // manuale non serve alcuna conferma (i dati sono già inseriti a mano).
  const editingBloccato = bollettaMode === "foto" && fotoConfermato;
  const puoProseguireOltreBolletta = bollettaMode === "manuale" || fotoConfermato;

  return (
    <>
      <div className="topnav">
        <div className="topnav-inner">
          <div className="brandmark">
            <span className="dot" aria-hidden="true"></span>
            <div>
              <b>Preventivo FV</b>
              <br />
              <small>SolarCalculator — MVP</small>
            </div>
          </div>
          <div className="topnav-actions">
            <Link href="/progetti" className="btn btn-ghost">
              📂 I miei progetti
            </Link>
            <UserButton afterSignOutUrl="/sign-in" />
          </div>
        </div>
      </div>

      {progettoCaricamento ? (
        <div className="wizard">
          <div className="card">
            <p className="hint">
              <span className="spinner" style={{ marginRight: 8 }} />
              Caricamento del progetto salvato…
            </p>
          </div>
        </div>
      ) : step < 2 ? (
        <div className="wizard">
          <div className="steps">
            {STEPS.slice(0, 2).map((s, i) => (
              <div key={s} className={`step-dot ${i === step ? "active" : i < step ? "done" : ""}`} title={s} />
            ))}
          </div>

          {step === 0 && (
            <div className="card">
              <h3>Dati azienda</h3>
              <p className="card-note">Inserisci la Partita IVA: recuperiamo automaticamente ragione sociale e indirizzo (puoi correggerli).</p>
              <form onSubmit={cercaAzienda}>
                <div className="field">
                  <label htmlFor="piva">Partita IVA</label>
                  <input
                    id="piva"
                    type="text"
                    inputMode="numeric"
                    placeholder="11 cifre, es. 01234567890"
                    value={piva}
                    onChange={(e) => setPiva(e.target.value)}
                    maxLength={11}
                  />
                </div>
                {companyError && <div className="error-box">{companyError}</div>}
                <button className="btn btn-primary" type="submit" disabled={companyLoading || piva.length !== 11}>
                  {companyLoading && <span className="spinner" />}
                  Cerca azienda
                </button>
              </form>

              {company && (
                <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
                  {company.demo && (
                    <div className="info-box">
                      Dati di esempio: nessuna fonte configurata su questa istanza (APIFY_API_TOKEN o OPENAPI_KEY). In produzione qui comparirebbero i dati reali dell&apos;azienda.
                    </div>
                  )}
                  <div className="field">
                    <label>Ragione sociale</label>
                    <input type="text" value={company.ragioneSociale} onChange={(e) => updateCompanyField("ragioneSociale", e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Indirizzo</label>
                    <input type="text" value={company.indirizzo} onChange={(e) => updateCompanyField("indirizzo", e.target.value)} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr", gap: 12 }}>
                    <div className="field">
                      <label>Comune</label>
                      <input type="text" value={company.comune} onChange={(e) => updateCompanyField("comune", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>CAP</label>
                      <input type="text" value={company.cap} onChange={(e) => updateCompanyField("cap", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Prov.</label>
                      <input type="text" value={company.provincia} maxLength={2} onChange={(e) => updateCompanyField("provincia", e.target.value.toUpperCase())} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="field">
                      <label>Latitudine</label>
                      <input type="number" step="0.000001" value={company.lat} onChange={(e) => updateCompanyField("lat", Number(e.target.value))} />
                    </div>
                    <div className="field">
                      <label>Longitudine</label>
                      <input type="number" step="0.000001" value={company.lng} onChange={(e) => updateCompanyField("lng", Number(e.target.value))} />
                    </div>
                  </div>
                  <p className="hint">La sede legale non sempre coincide con il capannone su cui installare i pannelli: correggi indirizzo e coordinate se necessario.</p>
                  <div className="btn-row">
                    <span />
                    <button className="btn btn-primary" onClick={() => setStep(1)}>
                      Continua →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="card">
              <h3>Consumi e spesa energetica</h3>
              <p className="card-note">
                Carica una foto della bolletta oppure inserisci i consumi mensili: consumo annuo totale e ripartizione F1/F2/F3 vengono calcolati automaticamente. Indica anche la spesa energetica annua, la produzione annua del tuo riferimento FV e i giorni lavorativi settimanali dell&apos;azienda.
              </p>

              <div className="mode-tabs">
                <button
                  type="button"
                  className={`mode-tab ${bollettaMode === "foto" ? "active" : ""}`}
                  onClick={() => setBollettaMode("foto")}
                >
                  📷 Foto bolletta
                </button>
                <button
                  type="button"
                  className={`mode-tab ${bollettaMode === "manuale" ? "active" : ""}`}
                  onClick={() => setBollettaMode("manuale")}
                >
                  ✍️ Inserisci manualmente
                </button>
              </div>

              {bollettaMode === "foto" ? (
                <>
                  <div className="upload-actions">
                    <button type="button" className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                      📁 Carica foto
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => cameraInputRef.current?.click()}>
                      📸 Scatta foto
                    </button>
                  </div>

                  <div
                    className="dropzone"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      onBollettaUpload(e.dataTransfer.files?.[0]);
                    }}
                  >
                    {preview ? (
                      <img src={preview} alt="Anteprima bolletta caricata" />
                    ) : (
                      <p>Trascina qui la foto della bolletta, o clicca per scegliere un file</p>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => onBollettaUpload(e.target.files?.[0])}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(e) => onBollettaUpload(e.target.files?.[0])}
                  />

                  {ocrLoading && <p className="hint">Lettura della bolletta in corso…</p>}
                  {ocrNote && <div className="info-box" style={{ marginTop: 12 }}>{ocrNote}</div>}

                  <p className="hint" style={{ marginTop: 22, marginBottom: 14 }}>
                    Verifica i kWh per fascia letti dalla bolletta mese per mese e correggili se necessario: il totale (per mese e annuo) si calcola da solo. Poi conferma per proseguire.
                  </p>
                </>
              ) : (
                <p className="hint" style={{ marginBottom: 14 }}>
                  Inserisci i kWh consumati per fascia in ciascun mese (dati disponibili in bolletta o nel portale del fornitore): il totale si calcola da solo.
                </p>
              )}

              <div className="mensile-table-wrap">
                <table className="mensile-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Mese</th>
                      <th><span className="seg-swatch" style={{ background: "var(--c-f1)" }} />F1</th>
                      <th><span className="seg-swatch" style={{ background: "var(--c-f2)" }} />F2</th>
                      <th><span className="seg-swatch" style={{ background: "var(--c-f3)" }} />F3</th>
                      <th>Totale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MESI.map((mese, i) => {
                      const rigaTotale = (Number(monthly[i].f1) || 0) + (Number(monthly[i].f2) || 0) + (Number(monthly[i].f3) || 0);
                      return (
                        <tr key={mese}>
                          <td>{mese}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              inputMode="numeric"
                              placeholder="0"
                              value={monthly[i].f1}
                              disabled={editingBloccato}
                              onChange={(e) => updateMonthly(i, "f1", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              inputMode="numeric"
                              placeholder="0"
                              value={monthly[i].f2}
                              disabled={editingBloccato}
                              onChange={(e) => updateMonthly(i, "f2", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              inputMode="numeric"
                              placeholder="0"
                              value={monthly[i].f3}
                              disabled={editingBloccato}
                              onChange={(e) => updateMonthly(i, "f3", e.target.value)}
                            />
                          </td>
                          <td>
                            <input type="text" className="mono" readOnly disabled value={rigaTotale.toLocaleString("it-IT")} style={{ fontWeight: 600 }} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mensile-totals">
                <StatMini v={`${monthlyTotalsCalc.f1.toLocaleString("it-IT")} kWh`} l="Totale F1" />
                <StatMini v={`${monthlyTotalsCalc.f2.toLocaleString("it-IT")} kWh`} l="Totale F2" />
                <StatMini v={`${monthlyTotalsCalc.f3.toLocaleString("it-IT")} kWh`} l="Totale F3" />
                <StatMini v={`${monthlyTotalsCalc.total.toLocaleString("it-IT")} kWh`} l="Totale annuo (automatico)" />
              </div>
              {monthlyTotalsCalc.total > 0 && (
                <p className="hint" style={{ marginTop: 10 }}>
                  Ripartizione calcolata: F1 {monthlyPctCalc.f1}% · F2 {monthlyPctCalc.f2}% · F3 {monthlyPctCalc.f3}%
                </p>
              )}

              <div className="field" style={{ marginTop: 20, maxWidth: 320 }}>
                <label>Spesa energetica annua (€, IVA inclusa)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="es. 45000"
                  value={spesaAnnua}
                  disabled={editingBloccato}
                  onChange={(e) => onSpesaAnnuaChange(e.target.value)}
                />
                <p className="hint">
                  Come riportato in bolletta (IVA inclusa) — verrà depurata dell'IVA (22%) per i calcoli economici.
                  {" "}Prezzo medio stimato (IVA esclusa): {spesaAnnua && monthlyTotalsCalc.total ? `€ ${(Number(spesaAnnua) / (1 + DEFAULTS.ivaBolletta) / monthlyTotalsCalc.total).toFixed(3)}/kWh` : "—"}
                </p>
              </div>

              {bollettaMode === "foto" && (
                <div className="btn-row" style={{ marginTop: 14 }}>
                  <span />
                  {fotoConfermato ? (
                    <button type="button" className="btn btn-ghost" onClick={() => setFotoConfermato(false)}>
                      ✏️ Modifica dati
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!(monthlyTotalsCalc.total > 0 && spesaValida)}
                      onClick={() => setFotoConfermato(true)}
                    >
                      ✓ Conferma dati bolletta
                    </button>
                  )}
                </div>
              )}

              {puoProseguireOltreBolletta ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
                    <div className="field">
                      <label>Produzione annuale FV (kWh/kWp)</label>
                      <input
                        type="number"
                        min="0"
                        placeholder="es. 1350"
                        value={produzioneAnnuaFvKwh}
                        onChange={(e) => setProduzioneAnnuaFvKwh(e.target.value)}
                      />
                      <p className="hint">Producibilità specifica annua del sito (es. da PVGIS o da una tua stima): kWh prodotti per ogni kWp installato.</p>
                    </div>
                    <div className="field">
                      <label>Giorni lavorativi</label>
                      <select value={giorniLavorativi} onChange={(e) => setGiorniLavorativi(Number(e.target.value))}>
                        <option value={5}>5 giorni (lun–ven)</option>
                        <option value={6}>6 giorni (lun–sab)</option>
                        <option value={7}>7 giorni (tutti i giorni)</option>
                      </select>
                      <p className="hint">Usato per calcolare il fabbisogno diurno e notturno dell&apos;azienda.</p>
                    </div>
                  </div>

                  {quoteError && <div className="error-box" style={{ marginTop: 16 }}>{quoteError}</div>}
                  <div className="btn-row">
                    <button className="btn btn-ghost" onClick={() => setStep(0)}>← Indietro</button>
                    <button
                      className="btn btn-primary"
                      disabled={quoteLoading || !consumoValido || !spesaValida || !produzioneValida}
                      onClick={generaPreventivo}
                    >
                      {quoteLoading && <span className="spinner" />}
                      Genera preventivo →
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="info-box" style={{ marginTop: 18 }}>
                    Verifica e conferma la tabella dei dati bolletta qui sopra per continuare.
                  </div>
                  <div className="btn-row">
                    <button className="btn btn-ghost" onClick={() => setStep(0)}>← Indietro</button>
                    <span />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <Dashboard
          company={company}
          quote={quote}
          onRestart={() => {
            setStep(0);
            setProgettoCaricato(null);
          }}
          roofImages={roofImages}
          roofImagesLoading={roofImagesLoading}
          roofImagesError={roofImagesError}
          monthly={monthly}
          bollettaMode={bollettaMode}
          ocrMonthlyKwh={ocrMonthlyKwh}
          initialImpiantoProposto={progettoCaricato?.impiantoProposto}
          initialAccumuloProposto={progettoCaricato?.accumuloProposto}
          initialCostoImpiantoProposto={progettoCaricato?.costoImpiantoProposto}
        />
      )}
    </>
  );
}

function Dashboard({
  company,
  quote,
  onRestart,
  roofImages,
  roofImagesLoading,
  roofImagesError,
  monthly,
  bollettaMode,
  ocrMonthlyKwh,
  initialImpiantoProposto,
  initialAccumuloProposto,
  initialCostoImpiantoProposto,
}) {
  const seg = quote.roof.segments;
  const segColors = ["var(--c-f1)", "var(--c-f2)", "var(--c-f3)"];
  const hasPanelsData = quote.roof.solarPanels?.length > 0;

  // Impianto, accumulo e costo proposti: pre-compilati con i valori
  // suggeriti dal calcolo, ma sempre modificabili — dal loro valore
  // dipendono produzione, autoconsumo, benefici e payback qui sotto.
  const [impiantoProposto, setImpiantoProposto] = useState(
    String(initialImpiantoProposto ?? quote.sizing.kwpSuggerito ?? "")
  );
  const [accumuloProposto, setAccumuloProposto] = useState(
    String(initialAccumuloProposto ?? quote.sizing.accumuloSuggeritoKwh ?? 0)
  );
  const [costoImpiantoProposto, setCostoImpiantoProposto] = useState(
    String(initialCostoImpiantoProposto ?? quote.sizing.investimentoSuggerito ?? "")
  );

  // Salvataggio su Supabase (tabella `progetti`): ogni salvataggio crea un
  // nuovo snapshot con i valori attuali di impianto/accumulo/costo proposti.
  const [saveState, setSaveState] = useState({ status: "idle", message: "" });

  async function salvaProgetto() {
    setSaveState({ status: "loading", message: "" });
    try {
      const r = await fetch("/api/progetti", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ company, quote, monthly, bollettaMode, ocrMonthlyKwh, impiantoProposto, accumuloProposto, costoImpiantoProposto }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Errore nel salvataggio del progetto.");
      setSaveState({ status: "done", message: "Progetto salvato." });
    } catch (err) {
      setSaveState({ status: "error", message: err.message });
    }
  }

  const kwp = Number(impiantoProposto) || 0;
  const batteriaKwh = Number(accumuloProposto) || 0;
  const costoImpianto = Number(costoImpiantoProposto) || 0;
  const hasBattery = batteriaKwh > 0;

  const produzioneAnnuaTotaleKwh = kwp * (quote.input.produzioneAnnuaFvKwh || 0);
  const monthlyProduction = monthlyProductionFromShares(produzioneAnnuaTotaleKwh);

  const monthlyConsumo = monthlyConsumoFromQuote({ quoteInput: quote.input, monthly, ocrMonthlyKwh });
  const monthlyDiurno = monthlyConsumo.map((m) => m.diurno);
  const monthlyNotturno = monthlyConsumo.map((m) => m.notturno);
  // true quando la tabella mensile F1/F2/F3 (compilata a mano in modalità
  // manuale, o precompilata dall'OCR e confermata in modalità foto) contiene
  // dati reali: in quel caso è sempre la fonte del grafico sotto. Falso solo
  // per i progetti salvati prima dell'introduzione della tabella mensile
  // anche in modalità foto (vedi monthlyConsumoFromQuote).
  const hasMonthlyDettaglio = monthlyTotals(monthly).total > 0;

  // Autoconsumo: simulazione mese per mese (MIN tra produzione e consumo
  // diurno + quanto l'accumulo può spostare dal giorno alla notte), non più
  // una stima forfettaria — vedi lib/calc.js:simulaAutoconsumoMensile.
  const autoconsumoSim = simulaAutoconsumoMensile({
    monthlyProduzioneKwh: monthlyProduction,
    monthlyConsumoDiurnoKwh: monthlyDiurno,
    batteriaKwh,
  });
  const autoconsumoPct = Math.round(autoconsumoSim.autoconsumoPct * 1000) / 10; // percentuale, 1 decimale
  const balance = { autoconsumata: autoconsumoSim.totaleAutoconsumo, immessa: autoconsumoSim.totaleImmissione };
  const econ = economics({
    spesaAnnua: quote.input.spesaAnnua,
    consumoAnnuoKwh: quote.input.consumoAnnuoKwh,
    energiaAutoconsumata: balance.autoconsumata,
    energiaImmessa: balance.immessa,
    tariffaGSE: quote.input.tariffaGSE,
    tariffaCER: quote.input.tariffaCER,
  });
  const payback = paybackYears({ investimento: costoImpianto, beneficioAnnuo: econ.beneficioTotale });
  const co2 = co2Evitata({
    producibilitaAnnuaKwh: produzioneAnnuaTotaleKwh,
    carbonOffsetFactorKgPerMwh: quote.roof.carbonOffsetFactorKgPerMwh ?? 350,
  });
  const coperturaFabbisognoPct = quote.input.consumoAnnuoKwh
    ? Math.round((produzioneAnnuaTotaleKwh / quote.input.consumoAnnuoKwh) * 1000) / 10
    : 0;
  const pannelliStimati = Math.round((kwp * 1000) / DEFAULTS.panelWp);
  const areaUtileStimataM2 = Math.round(kwp * DEFAULTS.mqPerKwp);

  return (
    <div className="wrap">
      <div className="print-header">
        <div className="print-header-title">Preventivo impianto fotovoltaico — {company.ragioneSociale}</div>
        <div className="print-header-meta">Lenergy Spa — Business Energy Advisor · Generato il {new Date().toLocaleDateString("it-IT")}</div>
      </div>

      {(quote.demo || company?.demo) && (
        <div className="demo-banner" style={{ margin: "0 -24px 24px" }}>
          DATI DI ESEMPIO — alcune sorgenti non sono configurate su questa istanza (vedi README)
        </div>
      )}

      {quote.roofDataUnavailable && (
        <div className="demo-banner" style={{ margin: "0 -24px 24px" }}>
          ⚠️ Google non dispone di un rilievo satellitare dettagliato per questo indirizzo: il dimensionamento qui sotto è basato solo sui consumi dichiarati (nessun vincolo di superficie tetto). Foto satellitare e superficie massima non disponibili — puoi comunque procedere e modificare a mano i campi proposti.
        </div>
      )}

      <div className="save-bar">
        <button className="btn btn-primary" onClick={salvaProgetto} disabled={saveState.status === "loading"}>
          {saveState.status === "loading" && <span className="spinner" />}
          💾 Salva progetto
        </button>
        <button className="btn btn-ghost" onClick={() => window.print()}>🖨️ Stampa preventivo</button>
        <button className="btn btn-ghost" onClick={onRestart}>← Nuovo preventivo</button>
        {saveState.status === "done" && <span className="save-feedback good">{saveState.message}</span>}
        {saveState.status === "error" && <span className="save-feedback error">{saveState.message}</span>}
      </div>

      <div className="header">
        <div className="company-card">
          <div className="company-main">
            <span className="eyebrow">Anagrafica azienda</span>
            <h1>{company.ragioneSociale}</h1>
            <div className="company-sub">
              {company.indirizzo}, {company.cap} {company.comune} ({company.provincia})
            </div>
            <dl className="meta-grid">
              <div className="meta-item"><dt>Partita IVA</dt><dd className="mono">{company.piva}</dd></div>
              <div className="meta-item"><dt>Coordinate sito</dt><dd className="mono">{company.lat.toFixed(4)}, {company.lng.toFixed(4)}</dd></div>
              <div className="meta-item"><dt>Spesa energetica annua (IVA inclusa)</dt><dd className="mono">€ {quote.input.spesaAnnua.toLocaleString("it-IT")}</dd></div>
              <div className="meta-item"><dt>Consumo annuo</dt><dd className="mono">{quote.input.consumoAnnuoKwh.toLocaleString("it-IT")} kWh</dd></div>
            </dl>
          </div>
          <div className="company-map">
            {roofImages ? (
              <img
                src={roofImages.satelliteImageUrl}
                alt="Foto aerea satellitare del sito"
                style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }}
              />
            ) : roofImagesLoading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: "var(--ink-soft)", fontSize: 12.5 }}>
                <span className="spinner" />
                Generazione foto satellitare…
              </div>
            ) : (
              <RoofSvg segments={seg} colors={segColors} />
            )}
            <span className="map-tag">📍 {quote.roof.imageryQuality || "N/D"} · {roofImages?.imageryDate || quote.roof.imageryDate || "n/d"}</span>
          </div>
        </div>

        <div className="kpi-strip">
          <Kpi label="Potenza impianto" value={kwp} unit="kWp" delta={`${pannelliStimati} pannelli stimati`} accent />
          <Kpi label="Produzione annua" value={(produzioneAnnuaTotaleKwh / 1000).toFixed(1)} unit="MWh" delta={`${coperturaFabbisognoPct}% del fabbisogno`} />
          <Kpi label="Autoconsumo" value={autoconsumoPct} unit="%" delta={hasBattery ? `con accumulo ${batteriaKwh} kWh` : "senza accumulo"} good />
          <Kpi label="Beneficio annuo" value={`€ ${econ.beneficioTotale.toLocaleString("it-IT")}`} delta="risparmio + GSE + CER" good />
          <Kpi label="Payback stimato" value={payback ?? "—"} unit="anni" delta={`su investimento € ${costoImpianto.toLocaleString("it-IT")}`} />
        </div>
      </div>

      <section className="block" id="a">
        <div className="block-head"><span className="block-tag">A</span><h2>Producibilità fotovoltaica</h2></div>
        <div className="grid-2">
          <div className="card">
            <h3>Produzione mensile stimata impianto</h3>
            <div className="card-note">{kwp} kWp proposti — ripartizione mensile da profilo tipico</div>
            <BarChart data={monthlyProduction} />
          </div>
          <div className="card">
            <h3>Come viene calcolata</h3>
            <div className="card-note">Produzione annua = produzione specifica del sito × impianto proposto</div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 14 }}>
              <StatMini v={`${quote.input.produzioneAnnuaFvKwh.toLocaleString("it-IT")} kWh/kWp`} l="Produzione specifica annua (inserita)" />
              <StatMini v={`${kwp} kWp`} l="Impianto proposto" />
              <StatMini v={`${Math.round(produzioneAnnuaTotaleKwh).toLocaleString("it-IT")} kWh`} l="Produzione annua totale stimata" />
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 20 }}>
          <h3>Simulazione pannelli sul tetto</h3>
          <div className="card-note">
            Impianto proposto sovrapposto alla foto aerea del sito (già mostrata in alto), generato automaticamente dal layer RGB della Google Solar API.
          </div>

          {!hasPanelsData ? (
            <div className="card-note" style={{ marginTop: 10 }}>
              Non disponibile: {quote.demo
                ? "questa istanza è in modalità demo (manca GOOGLE_SOLAR_API_KEY)."
                : "la Solar API non ha restituito dati sui pannelli per questo sito."}
            </div>
          ) : roofImagesLoading ? (
            <p className="hint" style={{ marginTop: 10 }}><span className="spinner" style={{ marginRight: 8 }} />Generazione foto in corso…</p>
          ) : roofImages ? (
            <div style={{ marginTop: 14, maxWidth: 480 }}>
              <img src={roofImages.panelsImageUrl} alt="Simulazione pannelli sul tetto" style={{ width: "100%", borderRadius: 8, display: "block" }} />
              <div className="card-note" style={{ marginTop: 6 }}>
                Impianto proposto: {roofImages.panelsProposti} pannelli in verde (su {roofImages.panelsTotaliDisponibili} posizioni possibili, in grigio)
              </div>
            </div>
          ) : null}
          {roofImagesError && <div className="error-box" style={{ marginTop: 10 }}>{roofImagesError}</div>}
        </div>
      </section>

      <section className="block" id="b">
        <div className="block-head"><span className="block-tag">B</span><h2>Dimensionamento impianto</h2></div>

        <div className="card">
          <h3>Riepilogo consumi</h3>
          <div className="card-note">Consumi annui per fascia oraria e diurno/notturno, calcolati dai dati inseriti nello step Consumi — e dimensionamento consigliato di conseguenza</div>
          <div className="grid-3" style={{ marginTop: 4 }}>
            <StatMini v={`${quote.input.f1Kwh.toLocaleString("it-IT")} kWh`} l={`Totale F1 — punta (${quote.input.f1Pct}%)`} />
            <StatMini v={`${quote.input.f2Kwh.toLocaleString("it-IT")} kWh`} l={`Totale F2 — intermedia (${quote.input.f2Pct}%)`} />
            <StatMini v={`${quote.input.f3Kwh.toLocaleString("it-IT")} kWh`} l={`Totale F3 — fuori punta (${quote.input.f3Pct}%)`} />
            <StatMini v={`${quote.input.consumoAnnuoKwh.toLocaleString("it-IT")} kWh`} l="Consumo totale" />
            <StatMini v={`${quote.input.giorniLavorativi} giorni/sett.`} l="Giorni lavorativi dichiarati" />
            <StatMini v={`${quote.input.consumoDiurnoKwh.toLocaleString("it-IT")} kWh`} l="Consumo diurno" />
            <StatMini v={`${quote.input.consumoNotturnoKwh.toLocaleString("it-IT")} kWh`} l="Consumo notturno" />
            <StatMini v={`${quote.sizing.kwpSuggerito} kWp`} l="Potenza impianto consigliata (consumo totale ÷ produzione annua FV)" />
            <StatMini v={`${quote.sizing.accumuloSuggeritoKwh} kWh`} l="Potenza accumulo consigliata (consumo notturno ÷ 360)" />
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3>Impianto proposto</h3>
          <div className="card-note">Valori modificabili — da questi dipendono produzione, autoconsumo, benefici e payback qui sotto</div>
          <div className="grid-3" style={{ marginTop: 4 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Potenza impianto proposta (kWp)</label>
              <input type="number" min="0" step="0.1" value={impiantoProposto} onChange={(e) => setImpiantoProposto(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Potenza accumulo proposta (kWh)</label>
              <input type="number" min="0" step="1" value={accumuloProposto} onChange={(e) => setAccumuloProposto(e.target.value)} />
              {!hasBattery && <p className="hint">Nessun accumulo previsto con il valore attuale.</p>}
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Costo impianto proposto (€)</label>
              <input type="number" min="0" step="100" value={costoImpiantoProposto} onChange={(e) => setCostoImpiantoProposto(e.target.value)} />
              <p className="hint">Stima di riferimento: € {quote.sizing.investimentoSuggerito.toLocaleString("it-IT")} — modificalo con il prezzo reale del preventivo.</p>
            </div>
          </div>
          <div className="suggested-box" style={{ marginTop: 16 }}>
            <div className="v">{autoconsumoPct}%</div>
            <div className="l">Percentuale di autoconsumo ottenuta (simulazione mensile: produzione vs. consumo diurno + accumulo)</div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3>Dati tecnici dell&apos;impianto proposto</h3>
          <div className="card-note">Stime basate su moduli standard e superficie utile media per kWp installato</div>
          <div className="grid-3" style={{ marginTop: 4 }}>
            <StatMini v={`≈ ${pannelliStimati}`} l="Pannelli da installare (moduli da 505 Wp)" />
            <StatMini v={`≈ ${areaUtileStimataM2} m²`} l="Superficie utile richiesta (≈4,1 m²/kWp)" />
            <StatMini v={`${coperturaFabbisognoPct}%`} l="Copertura del fabbisogno" />
          </div>
          <div className="econ-track" style={{ marginTop: 10 }}>
            <div className="econ-fill" style={{ width: `${Math.min(100, coperturaFabbisognoPct)}%`, background: "var(--c-f1)" }} />
          </div>
        </div>
      </section>

      <section className="block" id="c">
        <div className="block-head"><span className="block-tag">C</span><h2>Vantaggi e bilancio economico</h2></div>
        <div className="grid-2">
          <div className="card">
            <h3>Autoconsumo vs. immesso in rete</h3>
            <div className="card-note">{(produzioneAnnuaTotaleKwh / 1000).toFixed(1)} MWh prodotti/anno</div>
            <div className="donut-row">
              <Donut
                values={[autoconsumoPct, 100 - autoconsumoPct]}
                colors={["var(--c-good)", "var(--c-grid)"]}
                centerLabel={`${autoconsumoPct}%`}
                centerSub="autoconsumo"
              />
              <div className="legend">
                <LegendItem color="var(--c-good)" label="Autoconsumato" value={`${balance.autoconsumata.toLocaleString("it-IT")} kWh`} />
                <LegendItem color="var(--c-grid)" label="Immesso in rete" value={`${balance.immessa.toLocaleString("it-IT")} kWh`} />
              </div>
            </div>
          </div>
          <div className="card">
            <h3>Composizione del beneficio annuo</h3>
            <div className="card-note">
              Tutti i valori IVA esclusa — costo energia: € {econ.prezzoMedio.toFixed(3)}/kWh (da spesa annua € {econ.spesaAnnuaNetta.toLocaleString("it-IT")} netta) · Vendita energia (GSE): {quote.input.tariffaGSE} €/kWh · CER: {quote.input.tariffaCER} €/kWh
            </div>
            <EconRow label="Risparmio bolletta" value={econ.risparmioBolletta} max={econ.risparmioBolletta} color="var(--c-good)" />
            <EconRow label="Ricavo GSE (vendita)" value={econ.ricavoGSE} max={econ.risparmioBolletta} color="var(--c-f2)" />
            <EconRow label="Ricavo CER" value={econ.ricavoCER} max={econ.risparmioBolletta} color="var(--c-f3)" />
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Beneficio totale annuo (IVA esclusa)</span>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--c-good)" }}>€ {econ.beneficioTotale.toLocaleString("it-IT")}</span>
            </div>
          </div>
        </div>

        <div className="grid-3" style={{ marginTop: 16 }}>
          <div className="card"><StatMini v={`€ ${costoImpianto.toLocaleString("it-IT")}`} l="Costo impianto proposto (impianto + accumulo)" /></div>
          <div className="card">
            <StatMini v={`${payback ?? "—"} anni`} l="Tempo di rientro semplice" />
            {payback && payback < 8 && <span className="pill good" style={{ marginTop: 8 }}>payback sotto gli 8 anni</span>}
          </div>
          <div className="card"><StatMini v={`${co2} t`} l="CO₂ evitata stimata / anno" /></div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3>Consumi (diurno/notturno) e produzione impianto — mese per mese</h3>
          <div className="card-note">
            {hasMonthlyDettaglio
              ? "Consumi dalla tabella mensile F1/F2/F3 inserita nello step Consumi (compilata a mano, oppure precompilata dai dati della bolletta e confermata — stessi totali della card “Riepilogo consumi” nella Sezione B); produzione dal profilo mensile tipico applicato all'impianto proposto."
              : ocrMonthlyKwh
              ? "Andamento mensile letto dalla bolletta caricata, riproporzionato sul consumo annuo confermato nel preventivo (card “Riepilogo consumi” nella Sezione B); produzione dal profilo mensile tipico applicato all'impianto proposto."
              : "Consumo diurno/notturno annuo confermato nel preventivo (card “Riepilogo consumi” nella Sezione B), distribuito sui 12 mesi secondo una stagionalità tipica — nessun andamento mensile disponibile dalla bolletta; produzione dal profilo mensile tipico applicato all'impianto proposto."}
          </div>
          <ComboChart diurno={monthlyDiurno} notturno={monthlyNotturno} produzione={monthlyProduction} />
        </div>
      </section>

      <section className="block" id="d">
        <div className="block-head"><span className="block-tag">D</span><h2>Dati di partenza</h2></div>
        <div className="grid-2">
          <div className="card">
            <h3>Ripartizione consumi per fascia oraria</h3>
            <div className="card-note">Da lettura automatica o inserimento manuale</div>
            <div className="donut-row">
              <Donut
                values={[quote.input.f1Pct, quote.input.f2Pct, quote.input.f3Pct]}
                colors={["var(--c-f1)", "var(--c-f2)", "var(--c-f3)"]}
                centerLabel={`${(quote.input.consumoAnnuoKwh / 1000).toFixed(0)}`}
                centerSub="MWh/anno"
              />
              <div className="legend">
                <LegendItem color="var(--c-f1)" label="F1 — punta" value={`${quote.input.f1Pct}%`} />
                <LegendItem color="var(--c-f2)" label="F2 — intermedia" value={`${quote.input.f2Pct}%`} />
                <LegendItem color="var(--c-f3)" label="F3 — fuori punta" value={`${quote.input.f3Pct}%`} />
              </div>
            </div>
          </div>
          <div className="card">
            <h3>Spesa e prezzo medio</h3>
            <div className="card-note">Base per il calcolo del risparmio in bolletta</div>
            <div className="grid-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <StatMini v={`€ ${quote.input.spesaAnnua.toLocaleString("it-IT")}`} l="Spesa annua attuale" />
              <StatMini v={`${quote.input.consumoAnnuoKwh.toLocaleString("it-IT")}`} l="kWh consumati/anno" />
              <StatMini v={`€ ${econ.prezzoMedio.toFixed(3)}`} l="Prezzo medio / kWh" />
              <StatMini v={`${quote.input.f2Pct + quote.input.f3Pct}%`} l="Quota F2+F3" />
            </div>
          </div>
        </div>
      </section>

      <div className="footnote">
        <strong>Nota metodologica:</strong> la produzione dell&apos;impianto si basa sulla produzione specifica annua (kWh/kWp) inserita nello step Consumi e sulla taglia di impianto proposta, distribuita sui mesi secondo un profilo di producibilità tipico (non una simulazione PVGIS puntuale sul sito). Il fabbisogno diurno/notturno è calcolato dalla ripartizione F1/F2/F3 e dai giorni lavorativi dichiarati. La percentuale di autoconsumo è calcolata con una simulazione mese per mese (autoconsumo mensile = minimo tra produzione e consumo diurno + accumulo disponibile, sommato sui 12 mesi), non una stima forfettaria. Tutti i valori economici sono IVA esclusa. La tariffa CER
        ({quote.input.tariffaCER} €/kWh) è applicata per semplicità all&apos;intera energia immessa — nella realtà
        si applica solo alla quota effettivamente condivisa entro la comunità energetica. Questo è un MVP dimostrativo: i risultati sono indicativi, non un
        preventivo tecnico vincolante.
      </div>
    </div>
  );
}

function Kpi({ label, value, unit, delta, accent, good }) {
  return (
    <div className={`kpi ${accent ? "accent" : ""} ${good ? "good" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value mono">
        {value}
        {unit && <sup>{unit}</sup>}
      </div>
      <div className="kpi-delta">{delta}</div>
    </div>
  );
}

function StatMini({ v, l }) {
  return (
    <div className="stat-mini">
      <span className="v">{v}</span>
      <span className="l">{l}</span>
    </div>
  );
}

function LegendItem({ color, label, value }) {
  return (
    <div className="legend-item">
      <span className="legend-swatch" style={{ background: color }} />
      <span className="legend-label">{label}</span>
      <span className="legend-val">{value}</span>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-soft)" }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

function EconRow({ label, value, max, color }) {
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="econ-row">
      <div className="econ-label">{label}</div>
      <div className="econ-track"><div className="econ-fill" style={{ width: `${width}%`, background: color }} /></div>
      <div className="econ-val">€ {value.toLocaleString("it-IT")}</div>
    </div>
  );
}

function Donut({ values, colors, centerLabel, centerSub }) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const r = 52;
  const circumference = 2 * Math.PI * r;
  let offsetAcc = 0;
  const arcs = values.map((v, i) => {
    const frac = v / total;
    const dash = frac * circumference;
    const arc = (
      <circle
        key={i}
        r={r}
        fill="none"
        stroke={colors[i]}
        strokeWidth="20"
        strokeDasharray={`${dash} ${circumference}`}
        strokeDashoffset={-offsetAcc}
      />
    );
    offsetAcc += dash;
    return arc;
  });
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={`Grafico a ciambella: ${centerLabel} ${centerSub}`}>
      <g transform="translate(70,70) rotate(-90)">
        <circle r={r} fill="none" stroke="var(--surface-2)" strokeWidth="20" />
        {arcs}
      </g>
      <text x="70" y="66" textAnchor="middle" fontFamily="IBM Plex Mono" fontWeight="700" fontSize="20" fill="var(--ink)">{centerLabel}</text>
      <text x="70" y="82" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="10" fill="var(--ink-faint)">{centerSub}</text>
    </svg>
  );
}

function BarChart({ data }) {
  const max = Math.max(...data, 1);
  return (
    <div className="barchart">
      {data.map((v, i) => (
        <div className="bar-col" key={i}>
          <div className="bar" style={{ height: `${(v / max) * 100}%` }} title={`${MESI_BREVI[i]} · ${(v / 1000).toFixed(1)} MWh`} />
          <div className="bar-month">{MESI_BREVI[i]}</div>
        </div>
      ))}
    </div>
  );
}

// Grafico combinato consumi/produzione mensile: per ogni mese, una colonna
// impilata diurno (sotto) + notturno (sopra) dei consumi, affiancata da una
// colonna piena della produzione stimata dell'impianto — stessa scala kWh.
function ComboChart({ diurno, notturno, produzione }) {
  const totaliConsumo = diurno.map((d, i) => d + (notturno[i] || 0));
  const max = Math.max(...totaliConsumo, ...produzione, 1);
  return (
    <div>
      <div className="combo-legend">
        <LegendDot color="var(--c-f1)" label="Consumo diurno" />
        <LegendDot color="var(--c-f3)" label="Consumo notturno" />
        <LegendDot color="var(--warn)" label="Produzione impianto" />
      </div>
      <div className="combo-chart">
        {MESI_BREVI.map((m, i) => {
          const d = diurno[i] || 0;
          const n = notturno[i] || 0;
          const p = produzione[i] || 0;
          const totale = d + n;
          return (
            <div className="combo-month" key={m}>
              <div className="combo-bars">
                <div
                  className="combo-bar-group"
                  style={{ height: `${(totale / max) * 100}%` }}
                  title={`${m} · consumo diurno ${Math.round(d).toLocaleString("it-IT")} kWh, notturno ${Math.round(n).toLocaleString("it-IT")} kWh`}
                >
                  <div style={{ flexGrow: n || 0, background: "var(--c-f3)" }} />
                  <div style={{ flexGrow: d || 0, background: "var(--c-f1)" }} />
                </div>
                <div
                  className="combo-bar-solid"
                  style={{ height: `${(p / max) * 100}%` }}
                  title={`${m} · produzione ${Math.round(p).toLocaleString("it-IT")} kWh`}
                />
              </div>
              <div className="combo-month-label">{m}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoofSvg({ segments, colors }) {
  // Rappresentazione schematica proporzionale alle aree reali (max 3 segmenti mostrati).
  // Usata come fallback finché la foto satellitare non è pronta (o non disponibile).
  const top = segments.slice(0, 2);
  const bottom = segments.slice(2, 3);
  return (
    <svg className="roof-svg" viewBox="0 0 300 180" aria-label="Schema dei segmenti di tetto individuati">
      {top[1] && <polygon points="150,20 270,70 270,160 150,140" fill={colors[1]} opacity="0.75" />}
      {top[0] && <polygon points="150,20 30,70 30,160 150,140" fill={colors[0]} opacity="0.75" />}
      {bottom[0] && <polygon points="30,160 270,160 270,178 30,178" fill={colors[2]} opacity="0.75" />}
      <line x1="150" y1="20" x2="150" y2="140" stroke="var(--surface)" strokeWidth="2" />
      {top[1] && <text x="205" y="105" fontFamily="IBM Plex Mono" fontSize="9" fill="var(--surface)" textAnchor="middle">{top[1].areaMeters2.toFixed(0)} m²</text>}
      {top[0] && <text x="95" y="105" fontFamily="IBM Plex Mono" fontSize="9" fill="var(--surface)" textAnchor="middle">{top[0].areaMeters2.toFixed(0)} m²</text>}
      {bottom[0] && <text x="150" y="171" fontFamily="IBM Plex Mono" fontSize="8" fill="var(--surface)" textAnchor="middle">{bottom[0].areaMeters2.toFixed(0)} m²</text>}
    </svg>
  );
}
