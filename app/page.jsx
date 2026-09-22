"use client";

import { useState, useRef } from "react";

const STEPS = ["Azienda", "Bolletta", "Consumi", "Risultati"];

const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

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

export default function Page() {
  const [step, setStep] = useState(0);

  // Step 1 — azienda
  const [piva, setPiva] = useState("");
  const [company, setCompany] = useState(null);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyError, setCompanyError] = useState("");

  // Step 2 — bolletta / fasce
  const [f1Pct, setF1Pct] = useState(55);
  const [f2Pct, setF2Pct] = useState(25);
  const [f3Pct, setF3Pct] = useState(20);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrNote, setOcrNote] = useState("");
  const [preview, setPreview] = useState(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // Step 2 — inserimento manuale dei consumi mensili (alternativa alla foto)
  const [bollettaMode, setBollettaMode] = useState("foto"); // "foto" | "manuale"
  const [monthly, setMonthly] = useState(MESI.map(() => ({ f1: "", f2: "", f3: "" })));

  // Step 3 — consumi
  const [spesaAnnua, setSpesaAnnua] = useState("");
  const [consumoAnnuoKwh, setConsumoAnnuoKwh] = useState("");

  // Step 4 — risultati
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");

  // Step 4 — foto satellitare e simulazione pannelli (on demand, vedi /api/roof-image)
  const [roofImages, setRoofImages] = useState(null);
  const [roofImagesLoading, setRoofImagesLoading] = useState(false);
  const [roofImagesError, setRoofImagesError] = useState("");

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

  function normalizeF(next, changed) {
    // Mantiene la somma a 100 riequilibrando le altre due fasce proporzionalmente.
    const others = ["f1", "f2", "f3"].filter((k) => k !== changed);
    const remaining = 100 - next[changed];
    const currentOthersSum = others.reduce((s, k) => s + next[k], 0) || 1;
    others.forEach((k) => {
      next[k] = Math.round((next[k] / currentOthersSum) * remaining);
    });
    // Correzione arrotondamento sull'ultimo
    const sum = next.f1 + next.f2 + next.f3;
    if (sum !== 100) next[others[others.length - 1]] += 100 - sum;
    return next;
  }

  function onFasciaChange(key, value) {
    const current = { f1: f1Pct, f2: f2Pct, f3: f3Pct };
    current[key] = Number(value);
    const balanced = normalizeF(current, key);
    setF1Pct(balanced.f1);
    setF2Pct(balanced.f2);
    setF3Pct(balanced.f3);
  }

  async function onBollettaUpload(file) {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setOcrLoading(true);
    setOcrNote("");
    try {
      const fd = new FormData();
      fd.append("bolletta", file);
      const r = await fetch("/api/ocr-bolletta", { method: "POST", body: fd });
      const data = await r.json();
      if (data.available === false) {
        setOcrNote("Lettura automatica non configurata su questa istanza (manca ANTHROPIC_API_KEY): imposta le percentuali manualmente qui sotto.");
      } else if (data.error) {
        setOcrNote(`Lettura automatica non riuscita (${data.error}). Imposta le percentuali manualmente.`);
      } else if (typeof data.f1_pct === "number") {
        setF1Pct(Math.round(data.f1_pct));
        setF2Pct(Math.round(data.f2_pct));
        setF3Pct(Math.round(100 - Math.round(data.f1_pct) - Math.round(data.f2_pct)));
        setOcrNote(`Valori letti automaticamente dal grafico (confidenza: ${data.confidence || "n/d"}). Controlla e correggi se necessario.`);
      }
    } catch (err) {
      setOcrNote(`Errore durante la lettura automatica: ${err.message}. Imposta le percentuali manualmente.`);
    } finally {
      setOcrLoading(false);
    }
  }

  async function generaPreventivo() {
    setQuoteError("");
    setQuoteLoading(true);
    setRoofImages(null);
    setRoofImagesError("");
    try {
      const r = await fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lat: company.lat,
          lng: company.lng,
          spesaAnnua: Number(spesaAnnua),
          consumoAnnuoKwh: Number(consumoAnnuoKwh),
          f1Pct,
          f2Pct,
          f3Pct,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Errore nel calcolo del preventivo.");
      setQuote(data);
      setStep(3);
    } catch (err) {
      setQuoteError(err.message);
    } finally {
      setQuoteLoading(false);
    }
  }

  // Foto satellitare + simulazione pannelli sul tetto (Google Solar API
  // dataLayers): a differenza di generaPreventivo, non viene chiamata in
  // automatico — l'utente la richiede col bottone in dashboard, perché usa
  // un livello di prezzo più caro della sola buildingInsights.
  async function generaFotoTetto() {
    if (!quote) return;
    setRoofImagesError("");
    setRoofImagesLoading(true);
    try {
      const r = await fetch("/api/roof-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lat: company.lat,
          lng: company.lng,
          segments: quote.roof.segments,
          solarPanels: quote.roof.solarPanels,
          panelsCount: quote.sizing.pannelliStimati,
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

  function updateMonthly(i, key, value) {
    setMonthly((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [key]: value };
      return next;
    });
  }

  const monthlyTotalsCalc = monthlyTotals(monthly);
  const monthlyPctCalc = pctFromTotals(monthlyTotalsCalc);

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
        </div>
      </div>

      {step < 3 ? (
        <div className="wizard">
          <div className="steps">
            {STEPS.slice(0, 3).map((s, i) => (
              <div key={s} className={`step-dot ${i === step ? "active" : i < step ? "done" : ""}`} title={s} />
            ))}
          </div>

          {step === 0 && (
            <div className="card">
              <h3>Dati azienda</h3>
              <p className="card-note">Inserisci la Partita IVA: recuperiamo automaticamente ragione sociale e indirizzo.</p>
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
                    <input type="text" value={company.ragioneSociale} onChange={(e) => setCompany({ ...company, ragioneSociale: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Indirizzo</label>
                    <input
                      type="text"
                      value={`${company.indirizzo}, ${company.cap} ${company.comune} (${company.provincia})`}
                      readOnly
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="field">
                      <label>Latitudine</label>
                      <input type="number" step="0.000001" value={company.lat} onChange={(e) => setCompany({ ...company, lat: Number(e.target.value) })} />
                    </div>
                    <div className="field">
                      <label>Longitudine</label>
                      <input type="number" step="0.000001" value={company.lng} onChange={(e) => setCompany({ ...company, lng: Number(e.target.value) })} />
                    </div>
                  </div>
                  <p className="hint">La sede legale non sempre coincide con il capannone su cui installare i pannelli: correggi le coordinate se necessario.</p>
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
              <h3>Consumi in fascia (F1/F2/F3)</h3>
              <p className="card-note">Carica una foto della bolletta per la lettura automatica, oppure inserisci i consumi mensili manualmente.</p>

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

                  {ocrLoading && <p className="hint">Lettura del grafico in corso…</p>}
                  {ocrNote && <div className="info-box" style={{ marginTop: 12 }}>{ocrNote}</div>}

                  <div style={{ marginTop: 22 }}>
                    <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 12 }}>
                      Ripartizione consumi per fascia
                    </label>
                    <div className="fascia-row">
                      <span className="seg-swatch" style={{ background: "var(--c-f1)" }} />
                      <label>F1 — punta</label>
                      <input type="range" min="0" max="100" value={f1Pct} onChange={(e) => onFasciaChange("f1", e.target.value)} />
                      <span className="val mono">{f1Pct}%</span>
                    </div>
                    <div className="fascia-row">
                      <span className="seg-swatch" style={{ background: "var(--c-f2)" }} />
                      <label>F2 — intermedia</label>
                      <input type="range" min="0" max="100" value={f2Pct} onChange={(e) => onFasciaChange("f2", e.target.value)} />
                      <span className="val mono">{f2Pct}%</span>
                    </div>
                    <div className="fascia-row">
                      <span className="seg-swatch" style={{ background: "var(--c-f3)" }} />
                      <label>F3 — fuori punta</label>
                      <input type="range" min="0" max="100" value={f3Pct} onChange={(e) => onFasciaChange("f3", e.target.value)} />
                      <span className="val mono">{f3Pct}%</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p className="hint" style={{ marginBottom: 14 }}>
                    Inserisci i kWh consumati per fascia in ciascun mese (dati disponibili in bolletta o nel portale del fornitore).
                  </p>
                  <div className="mensile-table-wrap">
                    <table className="mensile-table">
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left" }}>Mese</th>
                          <th><span className="seg-swatch" style={{ background: "var(--c-f1)" }} />F1</th>
                          <th><span className="seg-swatch" style={{ background: "var(--c-f2)" }} />F2</th>
                          <th><span className="seg-swatch" style={{ background: "var(--c-f3)" }} />F3</th>
                        </tr>
                      </thead>
                      <tbody>
                        {MESI.map((mese, i) => (
                          <tr key={mese}>
                            <td>{mese}</td>
                            <td>
                              <input type="number" min="0" inputMode="numeric" placeholder="0" value={monthly[i].f1} onChange={(e) => updateMonthly(i, "f1", e.target.value)} />
                            </td>
                            <td>
                              <input type="number" min="0" inputMode="numeric" placeholder="0" value={monthly[i].f2} onChange={(e) => updateMonthly(i, "f2", e.target.value)} />
                            </td>
                            <td>
                              <input type="number" min="0" inputMode="numeric" placeholder="0" value={monthly[i].f3} onChange={(e) => updateMonthly(i, "f3", e.target.value)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mensile-totals">
                    <StatMini v={`${monthlyTotalsCalc.f1.toLocaleString("it-IT")} kWh`} l="Totale F1" />
                    <StatMini v={`${monthlyTotalsCalc.f2.toLocaleString("it-IT")} kWh`} l="Totale F2" />
                    <StatMini v={`${monthlyTotalsCalc.f3.toLocaleString("it-IT")} kWh`} l="Totale F3" />
                    <StatMini v={`${monthlyTotalsCalc.total.toLocaleString("it-IT")} kWh`} l="Totale annuo" />
                  </div>
                  {monthlyTotalsCalc.total > 0 && (
                    <p className="hint" style={{ marginTop: 10 }}>
                      Ripartizione calcolata: F1 {monthlyPctCalc.f1}% · F2 {monthlyPctCalc.f2}% · F3 {monthlyPctCalc.f3}%
                    </p>
                  )}
                </>
              )}

              <div className="btn-row">
                <button className="btn btn-ghost" onClick={() => setStep(0)}>← Indietro</button>
                <button
                  className="btn btn-primary"
                  disabled={bollettaMode === "manuale" && monthlyTotalsCalc.total === 0}
                  onClick={() => {
                    if (bollettaMode === "manuale") {
                      setF1Pct(monthlyPctCalc.f1);
                      setF2Pct(monthlyPctCalc.f2);
                      setF3Pct(monthlyPctCalc.f3);
                      setConsumoAnnuoKwh(String(Math.round(monthlyTotalsCalc.total)));
                    }
                    setStep(2);
                  }}
                >
                  Continua →
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="card">
              <h3>Consumi energetici</h3>
              <p className="card-note">Dati disponibili in bolletta: spesa annua e kWh totali consumati nell&apos;ultimo anno.</p>
              <div className="field">
                <label>Spesa energetica annua (€)</label>
                <input type="number" min="0" placeholder="es. 45000" value={spesaAnnua} onChange={(e) => setSpesaAnnua(e.target.value)} />
              </div>
              <div className="field">
                <label>Consumo annuo (kWh)</label>
                <input type="number" min="0" placeholder="es. 180000" value={consumoAnnuoKwh} onChange={(e) => setConsumoAnnuoKwh(e.target.value)} />
                <p className="hint">
                  {bollettaMode === "manuale" && "Calcolato dalla tabella mensile inserita — puoi correggerlo. "}
                  Prezzo medio stimato: {spesaAnnua && consumoAnnuoKwh ? `€ ${(Number(spesaAnnua) / Number(consumoAnnuoKwh)).toFixed(3)}/kWh` : "—"}
                </p>
              </div>
              {quoteError && <div className="error-box">{quoteError}</div>}
              <div className="btn-row">
                <button className="btn btn-ghost" onClick={() => setStep(1)}>← Indietro</button>
                <button
                  className="btn btn-primary"
                  disabled={quoteLoading || !spesaAnnua || !consumoAnnuoKwh}
                  onClick={generaPreventivo}
                >
                  {quoteLoading && <span className="spinner" />}
                  Genera preventivo →
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <Dashboard
          company={company}
          quote={quote}
          onRestart={() => setStep(0)}
          roofImages={roofImages}
          roofImagesLoading={roofImagesLoading}
          roofImagesError={roofImagesError}
          onGeneraFotoTetto={generaFotoTetto}
        />
      )}
    </>
  );
}

function Dashboard({ company, quote, onRestart, roofImages, roofImagesLoading, roofImagesError, onGeneraFotoTetto }) {
  const seg = quote.roof.segments;
  const segColors = ["var(--c-f1)", "var(--c-f2)", "var(--c-f3)"];
  const areaTot = seg.reduce((s, x) => s + x.areaMeters2, 0);

  return (
    <div className="wrap">
      {(quote.demo || company?.demo) && (
        <div className="demo-banner" style={{ margin: "0 -24px 24px" }}>
          DATI DI ESEMPIO — alcune sorgenti non sono configurate su questa istanza (vedi README)
          <span> · PVGIS è comunque reale quando raggiungibile</span>
        </div>
      )}

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
              <div className="meta-item"><dt>Spesa energetica annua</dt><dd className="mono">€ {quote.input.spesaAnnua.toLocaleString("it-IT")}</dd></div>
              <div className="meta-item"><dt>Consumo annuo</dt><dd className="mono">{quote.input.consumoAnnuoKwh.toLocaleString("it-IT")} kWh</dd></div>
            </dl>
          </div>
          <div className="company-map">
            <RoofSvg segments={seg} colors={segColors} />
            <span className="map-tag">📍 {quote.roof.imageryQuality || "N/D"} · {quote.roof.imageryDate || "n/d"}</span>
          </div>
        </div>

        <div className="kpi-strip">
          <Kpi label="Potenza impianto" value={quote.sizing.kwp} unit="kWp" delta={`${quote.sizing.pannelliStimati} pannelli stimati`} accent />
          <Kpi label="Produzione annua" value={(quote.production.annuaKwh / 1000).toFixed(1)} unit="MWh" delta={`${quote.production.coperturaFabbisognoPct}% del fabbisogno`} />
          <Kpi label="Autoconsumo" value={quote.balance.autoconsumoPct} unit="%" delta={quote.sizing.hasBattery ? `con accumulo ${quote.sizing.batteriaKwh} kWh` : "senza accumulo"} good />
          <Kpi label="Beneficio annuo" value={`€ ${quote.economics.beneficioTotale.toLocaleString("it-IT")}`} delta="risparmio + GSE + CER" good />
          <Kpi label="Payback stimato" value={quote.investment.paybackYears ?? "—"} unit="anni" delta={`su investimento ~€${Math.round(quote.investment.stimaEuro / 1000)}k`} />
        </div>
      </div>

      <section className="block" id="a">
        <div className="block-head"><span className="block-tag">A</span><h2>Dati di partenza</h2></div>
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
              <StatMini v={`€ ${quote.economics.prezzoMedio.toFixed(3)}`} l="Prezzo medio / kWh" />
              <StatMini v={`${quote.input.f2Pct + quote.input.f3Pct}%`} l="Quota F2+F3 (indica utilità accumulo)" />
            </div>
          </div>
        </div>
      </section>

      <section className="block" id="b">
        <div className="block-head"><span className="block-tag">B</span><h2>Sito e producibilità</h2></div>
        <div className="grid-2">
          <div className="card">
            <h3>Segmenti di tetto individuati</h3>
            <div className="card-note">{quote.roof.imageryQuality || "N/D"} quality · rilievo {quote.roof.imageryDate || "n/d"}</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Segmento</th><th className="num">Area</th><th className="num">Pitch</th><th className="num">Azimuth</th><th className="num">Producibilità</th></tr></thead>
                <tbody>
                  {seg.map((s, i) => (
                    <tr key={i}>
                      <td><span className="seg-swatch" style={{ background: segColors[i % 3] }} />{s.nome}</td>
                      <td className="num">{s.areaMeters2.toFixed(0)} m²</td>
                      <td className="num">{s.pitchDegrees.toFixed(1)}°</td>
                      <td className="num">{s.azimuthDegrees.toFixed(0)}°</td>
                      <td className="num">{s.producibilitaSpecifica} kWh/kWp</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 20 }}>
              <StatMini v={`${quote.roof.maxArrayPanelsCount ?? "—"}`} l="Pannelli max installabili (tetto)" />
              <StatMini v={`${quote.roof.carbonOffsetFactorKgPerMwh ? Math.round(quote.roof.carbonOffsetFactorKgPerMwh) : "—"} kg/MWh`} l="Fattore offset CO₂ (zona)" />
            </div>
          </div>
          <div className="card">
            <h3>Produzione mensile stimata</h3>
            <div className="card-note">{quote.sizing.kwp} kWp installati — fonte PVGIS</div>
            <BarChart data={quote.production.monthlyKwh} />
          </div>
        </div>

        <div className="card" style={{ marginTop: 20 }}>
          <h3>Foto satellitare e simulazione pannelli</h3>
          <div className="card-note">
            Foto aerea del sito e simulazione dell&apos;impianto proposto sul tetto, generate on demand dal layer RGB della Google Solar API (richiesta separata dal preventivo).
          </div>

          {!quote.roof.solarPanels?.length ? (
            <div className="card-note" style={{ marginTop: 10 }}>
              Non disponibile: {quote.demo
                ? "questa istanza è in modalità demo (manca GOOGLE_SOLAR_API_KEY)."
                : "la Solar API non ha restituito dati sui pannelli per questo sito."}
            </div>
          ) : !roofImages ? (
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onGeneraFotoTetto} disabled={roofImagesLoading}>
              {roofImagesLoading && <span className="spinner" />}
              Genera foto tetto →
            </button>
          ) : (
            <div style={{ marginTop: 14, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 280px" }}>
                <img src={roofImages.satelliteImageUrl} alt="Foto aerea del sito" style={{ width: "100%", borderRadius: 8, display: "block" }} />
                <div className="card-note" style={{ marginTop: 6 }}>Foto aerea · rilievo {roofImages.imageryDate || "n/d"}</div>
              </div>
              <div style={{ flex: "1 1 280px" }}>
                <img src={roofImages.panelsImageUrl} alt="Simulazione pannelli sul tetto" style={{ width: "100%", borderRadius: 8, display: "block" }} />
                <div className="card-note" style={{ marginTop: 6 }}>
                  Impianto proposto: {roofImages.panelsProposti} pannelli in verde (su {roofImages.panelsTotaliDisponibili} posizioni possibili, in grigio)
                </div>
              </div>
            </div>
          )}
          {roofImagesError && <div className="error-box" style={{ marginTop: 10 }}>{roofImagesError}</div>}
        </div>
      </section>

      <section className="block" id="c">
        <div className="block-head"><span className="block-tag">C</span><h2>Dimensionamento impianto</h2></div>
        <div className="grid-3">
          <div className="card">
            <h3>Impianto fotovoltaico</h3>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
              <StatMini v={`${quote.sizing.kwp} kWp`} l="Potenza installata proposta" />
              <StatMini v={`≈ ${quote.sizing.pannelliStimati}`} l="Pannelli (moduli da 530 Wp)" />
              <StatMini v={`${quote.sizing.areaOccupataStimataM2} m²`} l={`Area occupata su ${areaTot.toFixed(0)} m² disponibili`} />
            </div>
            {quote.sizing.limitatoDalTetto && <span className="pill warn" style={{ marginTop: 10 }}>dimensionamento limitato dal tetto</span>}
          </div>
          <div className="card">
            <h3>Sistema di accumulo</h3>
            {quote.sizing.hasBattery ? (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
                <StatMini v={`${quote.sizing.batteriaKwh} kWh`} l="Capacità batteria consigliata" />
                <StatMini v={`${quote.sizing.batteriaRapporto} kWh/kWp`} l="Rapporto capacità/potenza" />
              </div>
            ) : (
              <p style={{ fontSize: 13.5, color: "var(--ink-soft)", marginTop: 12 }}>
                Quota F2+F3 sotto il 30%: l&apos;accumulo non è prioritario per questo profilo di consumo.
              </p>
            )}
          </div>
          <div className="card">
            <h3>Copertura del fabbisogno</h3>
            <div style={{ marginTop: 12 }}>
              <StatMini v={`${quote.production.coperturaFabbisognoPct}%`} l={`${(quote.production.annuaKwh / 1000).toFixed(1)} MWh prodotti su ${(quote.input.consumoAnnuoKwh / 1000).toFixed(1)} MWh consumati`} />
              <div className="econ-track" style={{ marginTop: 12 }}>
                <div className="econ-fill" style={{ width: `${Math.min(100, quote.production.coperturaFabbisognoPct)}%`, background: "var(--c-f1)" }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="block" id="d">
        <div className="block-head"><span className="block-tag">D</span><h2>Bilancio energetico ed economico</h2></div>
        <div className="grid-2">
          <div className="card">
            <h3>Autoconsumo vs. immesso in rete</h3>
            <div className="card-note">{(quote.production.annuaKwh / 1000).toFixed(1)} MWh prodotti/anno</div>
            <div className="donut-row">
              <Donut
                values={[quote.balance.autoconsumoPct, 100 - quote.balance.autoconsumoPct]}
                colors={["var(--c-good)", "var(--c-grid)"]}
                centerLabel={`${quote.balance.autoconsumoPct}%`}
                centerSub="autoconsumo"
              />
              <div className="legend">
                <LegendItem color="var(--c-good)" label="Autoconsumato" value={`${quote.balance.autoconsumata.toLocaleString("it-IT")} kWh`} />
                <LegendItem color="var(--c-grid)" label="Immesso in rete" value={`${quote.balance.immessa.toLocaleString("it-IT")} kWh`} />
              </div>
            </div>
          </div>
          <div className="card">
            <h3>Composizione del beneficio annuo</h3>
            <div className="card-note">Ritiro Dedicato GSE 2026: {quote.input.tariffaGSE} €/kWh · CER: {quote.input.tariffaCER} €/kWh</div>
            <EconRow label="Risparmio bolletta" value={quote.economics.risparmioBolletta} max={quote.economics.risparmioBolletta} color="var(--c-good)" />
            <EconRow label="Ricavo GSE (ritiro ded.)" value={quote.economics.ricavoGSE} max={quote.economics.risparmioBolletta} color="var(--c-f2)" />
            <EconRow label="Ricavo CER" value={quote.economics.ricavoCER} max={quote.economics.risparmioBolletta} color="var(--c-f3)" />
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Beneficio totale annuo</span>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--c-good)" }}>€ {quote.economics.beneficioTotale.toLocaleString("it-IT")}</span>
            </div>
          </div>
        </div>

        <div className="grid-3" style={{ marginTop: 16 }}>
          <div className="card"><StatMini v={`~€ ${quote.investment.stimaEuro.toLocaleString("it-IT")}`} l="Investimento stimato (impianto + accumulo)" /></div>
          <div className="card">
            <StatMini v={`${quote.investment.paybackYears ?? "—"} anni`} l="Tempo di rientro semplice" />
            {quote.investment.paybackYears && quote.investment.paybackYears < 8 && <span className="pill good" style={{ marginTop: 8 }}>payback sotto gli 8 anni</span>}
          </div>
          <div className="card"><StatMini v={`${quote.co2EvitataTonnellate} t`} l="CO₂ evitata stimata / anno" /></div>
        </div>
      </section>

      <div className="footnote">
        <strong>Nota metodologica:</strong> il Ritiro Dedicato GSE è impostato al valore ufficiale ARERA 2026 (0,0475 €/kWh); la tariffa CER
        (0,075 €/kWh) è una media indicativa componente fissa + variabile, applicata per semplicità all&apos;intera energia immessa — nella realtà
        si applica solo alla quota effettivamente condivisa entro la comunità energetica. Le percentuali di autoconsumo sono stime da curve
        statistiche di settore, non da un profilo di carico orario reale. Questo è un MVP dimostrativo: i risultati sono indicativi, non un
        preventivo tecnico vincolante.
      </div>

      <div style={{ marginTop: 24 }}>
        <button className="btn btn-ghost" onClick={onRestart}>← Nuovo preventivo</button>
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
  const months = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
  const max = Math.max(...data, 1);
  return (
    <div className="barchart">
      {data.map((v, i) => (
        <div className="bar-col" key={i}>
          <div className="bar" style={{ height: `${(v / max) * 100}%` }} title={`${months[i]} · ${(v / 1000).toFixed(1)} MWh`} />
          <div className="bar-month">{months[i]}</div>
        </div>
      ))}
    </div>
  );
}

function RoofSvg({ segments, colors }) {
  // Rappresentazione schematica proporzionale alle aree reali (max 3 segmenti mostrati).
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
