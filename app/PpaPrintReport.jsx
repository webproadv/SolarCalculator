"use client";

import { PpaChart } from "./PpaSection";

// PDF "Proposta PPA" — stesso stile "bolletta" del PDF di analisi energetica
// (classi pb-*/pr-*), ma con una sola ragione d'essere: mostrare a colpo
// d'occhio i vantaggi lato cliente e lato nostro della vendita di energia in
// PPA. Sempre presente nel DOM (nascosto a schermo) e mostrato in stampa solo
// quando <body data-print="ppa"> (vedi handleStampaPpa in page.jsx e
// .print-report-ppa in globals.css).

const grp = (v, d = 0) =>
  (Number.isFinite(v) ? v : 0).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" });
const eur = (v, d = 0) => `€ ${grp(v, d)}`;
const anniTxt = (v) => grp(v, 1).replace(/,0$/, "");

export default function PpaPrintReport({ company, quote, r, prezzoMedio, kwp, produzioneKwh, f1BollettaKwh, mensile, pronto }) {
  const oggi = new Date().toLocaleDateString("it-IT");
  const numeroDocumento = `PPA-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(company.piva || "").slice(-4)}`;
  const durTxt = anniTxt(r.durata);
  const over = !r.rientraInDurata;
  const tlRientro = over ? 1 : r.anniRientro;
  const tlUtile = over ? 0 : r.anniGuadagno;

  return (
    <div className="print-report print-report-ppa">
      {/* Pagina 1 — vantaggi cliente e vantaggi nostri */}
      <div className="pr-page">
        <div className="pb-top">
          <div className="pb-brand">
            <svg viewBox="0 0 32 32" width="38" height="38" aria-hidden="true">
              <circle cx="16" cy="16" r="6.2" fill="#FBBF24" />
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                <rect key={a} x="15" y="2.6" width="2" height="4.6" rx="1" fill="#FBBF24" transform={`rotate(${a} 16 16)`} />
              ))}
            </svg>
            <div>
              <div className="pb-name">Dott. Maurizio Galli</div>
              <div className="pb-tag">Business Energy Advisor</div>
            </div>
          </div>
          <dl className="pb-doc">
            <div><dt>Documento</dt><dd>Proposta PPA</dd></div>
            <div><dt>Rif.</dt><dd>{numeroDocumento}</dd></div>
            <div><dt>Data emissione</dt><dd>{oggi}</dd></div>
          </dl>
        </div>

        <div className="pb-title ppa-pdf-title">
          <h1 className="pr-h1">{company.ragioneSociale}</h1>
          <span className="pb-sub">Vendita energia — PPA</span>
        </div>

        <div className="pb-boxes">
          <section className="pb-box">
            <h4>Dati cliente</h4>
            <dl>
              <dt>Ragione sociale</dt><dd>{company.ragioneSociale}</dd>
              <dt>Partita IVA</dt><dd>{company.piva}</dd>
              <dt>Sede / sito</dt><dd>{company.indirizzo}, {company.cap} {company.comune} ({company.provincia})</dd>
              <dt>Consumo F1 annuo</dt><dd>{grp(f1BollettaKwh)} kWh</dd>
            </dl>
          </section>
          <section className="pb-box ppa-pdf-box">
            <h4>L&apos;accordo PPA</h4>
            <dl>
              <dt>Durata accordo</dt><dd>{durTxt} anni</dd>
              <dt>Tariffa fissa di vendita</dt><dd>{eur(r.tariffa, 3)}/kWh</dd>
              <dt>Anticipo cliente</dt><dd>{eur(r.anticipo)}</dd>
              <dt>Impianto</dt><dd>{kwp} kWp · {grp(produzioneKwh)} kWh/anno</dd>
            </dl>
          </section>
        </div>

        {!pronto ? (
          <p className="pr-note">Dati dell&apos;operazione non ancora inseriti (costo effettivo impianto).</p>
        ) : (
          <>
            {/* VANTAGGI PER IL CLIENTE — la sua bolletta: oggi → durante il PPA → dopo il PPA */}
            <section className="ppa-pdf-band cliente">
              <div className="ppa-pdf-band-head">
                <b>Vantaggi per il cliente</b>
                <span>{r.anticipo > 0 ? `Anticipo ${eur(r.anticipo)}` : "Nessun investimento"} · tariffa fissa {eur(r.tariffa, 3)}/kWh bloccata per {durTxt} anni</span>
              </div>
              <div className="ppa-pdf-flow">
                <div className="ppa-pdf-tile">
                  <span className="t">Spesa annua in bolletta oggi</span>
                  <span className="v">{r.spesaAnnuaNetta > 0 ? eur(r.spesaAnnuaNetta) : "—"}</span>
                  <span className="s">IVA esclusa</span>
                </div>
                <div className="ppa-pdf-arrow" aria-hidden="true">→</div>
                <div className="ppa-pdf-tile">
                  <span className="t">Spesa annua durante il PPA</span>
                  <span className="v">{r.spesaDuranteAnnua != null ? eur(r.spesaDuranteAnnua) : "—"}</span>
                  <span className="s">{r.spesaDuranteTotale != null ? `${eur(r.spesaDuranteTotale)} su ${durTxt} anni` : `per ${durTxt} anni`}</span>
                </div>
                <div className="ppa-pdf-arrow" aria-hidden="true">→</div>
                <div className="ppa-pdf-tile hl">
                  <span className="t">Risparmio annuo in bolletta</span>
                  <span className="v">{r.risparmioBollettaPct != null ? `${grp(r.risparmioBollettaPct, 1)} %` : "—"}</span>
                  <span className="s">{r.risparmioAnnuoCliente != null ? `${eur(r.risparmioAnnuoCliente)} all'anno` : ""}</span>
                </div>
                <div className="ppa-pdf-arrow" aria-hidden="true">→</div>
                <div className="ppa-pdf-tile">
                  <span className="t">Spesa annua dopo il PPA</span>
                  <span className="v">{r.spesaDopoAnnua != null ? eur(r.spesaDopoAnnua) : "—"}</span>
                  <span className="s">impianto di proprietà del cliente{r.risparmioDopoPct != null ? ` · ${grp(r.risparmioDopoPct, 1)} % in meno di oggi` : ""}</span>
                </div>
              </div>
            </section>

            {/* VANTAGGI PER NOI */}
            <section className="ppa-pdf-band noi">
              <div className="ppa-pdf-band-head">
                <b>Vantaggi per noi</b>
                <span>Investimento da recuperare {eur(r.daRecuperare)} · costo effettivo impianto {eur(r.costo)}</span>
              </div>
              <div className="ppa-pdf-flow four">
                <div className="ppa-pdf-tile">
                  <span className="t">Ricavo annuo</span>
                  <span className="v">{eur(r.ricavoAnnuo)}</span>
                  <span className="s">vendita F1 + GSE</span>
                </div>
                <div className="ppa-pdf-tile">
                  <span className="t">Tempo di rientro</span>
                  <span className="v">{Number.isFinite(r.anniRientro) ? `${grp(r.anniRientro, 1)} anni` : "—"}</span>
                  <span className="s">{anniTxt(r.anniGuadagno)} anni di guadagno puro</span>
                </div>
                <div className="ppa-pdf-tile">
                  <span className="t">Ricavo totale</span>
                  <span className="v">{eur(r.ricavoTotale)}</span>
                  <span className="s">su {durTxt} anni</span>
                </div>
                <div className="ppa-pdf-tile">
                  <span className="t">Guadagno netto</span>
                  <span className="v">{eur(r.guadagnoNetto)}</span>
                  <span className="s">a fine accordo</span>
                </div>
              </div>
              <div className="ppa-pdf-roi">
                <div className="ppa-pdf-tile hl">
                  <span className="t">Ritorno totale dell&apos;investimento</span>
                  <span className="v">{r.roiTotalePct != null ? `${grp(r.roiTotalePct, 1)} %` : "—"}</span>
                  <span className="s">(ricavo totale ÷ spese − 1) × 100 · su {durTxt} anni</span>
                </div>
                <div className="ppa-pdf-tile hl">
                  <span className="t">Ritorno annuo dell&apos;investimento</span>
                  <span className="v">{r.roiAnnuoPct != null ? `${grp(r.roiAnnuoPct, 1)} %` : "—"}</span>
                  <span className="s">ritorno totale ÷ {durTxt} anni</span>
                </div>
              </div>
            </section>

            <div className="pb-panel ppa-pdf-chartpanel">
              <h4>Durata dell&apos;accordo: rientro e guadagno <span>{durTxt} anni</span></h4>
              <div className="ppa-pdf-tl">
                {over ? (
                  <div className="over" style={{ flex: "1 0 0" }}>Rientro oltre la durata</div>
                ) : (
                  <>
                    <div className="rientro" style={{ flex: `${tlRientro} 0 0` }}>Rientro {anniTxt(tlRientro)} anni</div>
                    {tlUtile > 0.001 && <div className="utile" style={{ flex: `${tlUtile} 0 0` }}>Guadagno {anniTxt(tlUtile)} anni</div>}
                  </>
                )}
              </div>
              <PpaChart r={r} print />
            </div>
          </>
        )}

        <div className="pr-footer"><span>Proposta PPA — {company.ragioneSociale}</span><span>Pagina 1 di 2</span></div>
      </div>

      {/* Pagina 2 — dettaglio economico, opportunità aggiuntiva, dettaglio mensile */}
      <div className="pr-page">
        <h2 className="pr-h2"><span className="pr-section-tag ppa-pdf-tag">F</span>Dettaglio economico</h2>

        {pronto && (
          <>
            <table className="pr-table">
              <thead><tr><th></th><th className="num">Annuo</th><th className="num">Totale {durTxt} anni</th></tr></thead>
              <tbody>
                <tr><td>Vendita energia F1 ({grp(r.f1Kwh)} kWh × {eur(r.tariffa, 3)})</td><td className="num">{eur(r.ricavoVenditaAnnuo)}</td><td className="num">{eur(r.ricavoVenditaTotale)}</td></tr>
                <tr><td>Ritiro GSE ({grp(r.immessoKwh)} kWh × {eur(r.tariffaGse, 3)})</td><td className="num">{eur(r.ricavoGseAnnuo)}</td><td className="num">{eur(r.ricavoGseTotale)}</td></tr>
                <tr className="total"><td>Ricavo totale</td><td className="num">{eur(r.ricavoAnnuo)}</td><td className="num">{eur(r.ricavoTotale)}</td></tr>
                <tr><td>− Costo effettivo impianto</td><td className="num"></td><td className="num">− {eur(r.costo)}</td></tr>
                <tr><td>+ Anticipo del cliente</td><td className="num"></td><td className="num">+ {eur(r.anticipo)}</td></tr>
                <tr className="total"><td>Guadagno netto</td><td className="num"></td><td className="num">{eur(r.guadagnoNetto)}</td></tr>
              </tbody>
            </table>

            <div className="ppa-pdf-extra">
              <div className="ppa-pdf-extra-head">
                <b>Opportunità aggiuntiva — energia diurna in F2 e F3</b>
                <span>Non inclusa nei calcoli</span>
              </div>
              <div className="ppa-pdf-extra-body">
                <div><span>Energia diurna F2/F3 vendibile</span><b>{grp(r.extraF23Kwh)} kWh/anno</b></div>
                <div><span>Tariffa di vendita − tariffa GSE</span><b>{eur(r.extraF23Margine, 3)}/kWh</b></div>
                <div><span>Guadagno aggiuntivo annuo</span><b>{eur(r.extraF23Annuo)}</b></div>
                <div><span>Guadagno aggiuntivo su {durTxt} anni</span><b>{eur(r.extraF23Totale)}</b></div>
              </div>
              <p className="pr-note" style={{ margin: "6px 0 0" }}>
                Valore informativo: non entra in rientro, ricavi, ritorno dell&apos;investimento e guadagno netto. Gli stessi kWh sono già pagati dal GSE nel dettaglio sopra, quindi si valorizza solo la differenza tra tariffa di vendita e tariffa GSE.
              </p>
            </div>
          </>
        )}

        <h3 className="pr-h3">Dettaglio mensile — energia F1 vendibile al cliente</h3>
        {Array.isArray(mensile) && mensile.length === 12 && (
          <table className="pr-table ppa-pdf-month">
            <thead>
              <tr><th>Mese</th><th className="num">Produzione</th><th className="num">Consumo F1</th><th className="num">F1 venduto</th><th className="num">Diurno F2/F3</th><th className="num">Immesso GSE</th></tr>
            </thead>
            <tbody>
              {mensile.map((m) => (
                <tr key={m.mese}>
                  <td>{m.mese}</td>
                  <td className="num">{grp(m.produzione)}</td>
                  <td className="num">{grp(m.f1)}</td>
                  <td className="num">{grp(m.venduto)}{m.f1 > m.produzione ? " *" : ""}</td>
                  <td className="num">{grp(m.extraF23 || 0)}</td>
                  <td className="num">{grp(Math.max(0, m.produzione - m.venduto))}</td>
                </tr>
              ))}
              <tr className="total">
                <td>Totale kWh</td>
                <td className="num">{grp(mensile.reduce((s, m) => s + m.produzione, 0))}</td>
                <td className="num">{grp(mensile.reduce((s, m) => s + m.f1, 0))}</td>
                <td className="num">{grp(mensile.reduce((s, m) => s + m.venduto, 0))}</td>
                <td className="num">{grp(mensile.reduce((s, m) => s + (m.extraF23 || 0), 0))}</td>
                <td className="num">{grp(mensile.reduce((s, m) => s + Math.max(0, m.produzione - m.venduto), 0))}</td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="pr-note">
          * Mese in cui il consumo F1 supera la produzione: si vende solo la produzione. Energia F1 venduta = somma dei 12 mesi del minore tra produzione dell&apos;impianto e consumo F1 in bolletta; immissione GSE = produzione − F1 venduto. Tempo di rientro = (costo effettivo − anticipo) ÷ ricavo annuo. Ritorno totale = ((ricavo totale ÷ spese) − 1) × 100; ritorno annuo = ritorno totale ÷ anni dell&apos;accordo (spese = costo effettivo impianto). Valori IVA esclusa, indicativi e non vincolanti.
        </p>

        <div className="pr-contact">
          <div className="pr-contact-name">Dott. Maurizio Galli</div>
          <div className="pr-contact-role">Business Energy Advisor</div>
          <div className="pr-contact-rows">
            <span><b>Tel.</b> +39 3391860201</span>
          </div>
        </div>

        <div className="pr-footer"><span>Proposta PPA — {company.ragioneSociale}</span><span>Pagina 2 di 2</span></div>
      </div>
    </div>
  );
}
