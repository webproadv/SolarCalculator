"use client";

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
  const durTxt = anniTxt(r.durata);
  const over = !r.rientraInDurata;
  const tlRientro = over ? 1 : r.anniRientro;
  const tlUtile = over ? 0 : r.anniGuadagno;
  const kwpTxt = grp(Number(kwp) || 0, Number.isInteger(Number(kwp)) ? 0 : 1);

  return (
    <div className="print-report print-report-ppa">
      {/* Pagina 1 — solo i KPI principali: vantaggi cliente e vantaggi nostri */}
      <div className="pr-page">
        <div className="ppa-p1-head">
          <span className="ppa-p1-kicker">Proposta PPA</span>
          <h1 className="pr-h1">{company.ragioneSociale}</h1>
          <p className="ppa-p1-sum">
            Impianto {kwpTxt} kWp · durata {durTxt} anni · tariffa fissa {eur(r.tariffa, 3)}/kWh · {r.anticipo > 0 ? `anticipo ${eur(r.anticipo)}` : "nessun anticipo"}
          </p>
        </div>

        {!pronto ? (
          <p className="pr-note">Dati dell&apos;operazione non ancora inseriti (costo effettivo impianto).</p>
        ) : (
          <>
            {/* VANTAGGI PER IL CLIENTE — la sua bolletta: oggi → durante il PPA → dopo il PPA */}
            <section className="ppa-pdf-band cliente big">
              <div className="ppa-pdf-band-head">
                <b>Vantaggi per il cliente</b>
                <span>Tariffa fissa bloccata per {durTxt} anni</span>
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
                  <span className="s">impianto di proprietà del cliente</span>
                </div>
              </div>
            </section>

            {/* VANTAGGI PER NOI */}
            <section className="ppa-pdf-band noi big">
              <div className="ppa-pdf-band-head">
                <b>Vantaggi per noi</b>
                <span>Investimento da recuperare {eur(r.daRecuperare)}</span>
              </div>
              <div className="ppa-pdf-flow four">
                <div className="ppa-pdf-tile">
                  <span className="t">Tempo di rientro</span>
                  <span className="v">{Number.isFinite(r.anniRientro) ? `${grp(r.anniRientro, 1)} anni` : "—"}</span>
                  <span className="s">{over ? "oltre la durata dell'accordo" : `${anniTxt(r.anniGuadagno)} anni di guadagno puro`}</span>
                </div>
                <div className="ppa-pdf-tile">
                  <span className="t">Guadagno netto</span>
                  <span className="v">{eur(r.guadagnoNetto)}</span>
                  <span className="s">a fine accordo ({durTxt} anni)</span>
                </div>
                <div className="ppa-pdf-tile hl">
                  <span className="t">Ritorno totale</span>
                  <span className="v">{r.roiTotalePct != null ? `${grp(r.roiTotalePct, 1)} %` : "—"}</span>
                  <span className="s">sull&apos;investimento</span>
                </div>
                <div className="ppa-pdf-tile hl">
                  <span className="t">Ritorno annuo</span>
                  <span className="v">{r.roiAnnuoPct != null ? `${grp(r.roiAnnuoPct, 1)} %` : "—"}</span>
                  <span className="s">all&apos;anno</span>
                </div>
              </div>
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
            </section>
          </>
        )}

        <div className="ppa-pageno">Pagina 1 di 2</div>
      </div>

      {/* Pagina 2 — dettagli delle voci e calcoli */}
      <div className="pr-page">
        <h2 className="pr-h2">Dettaglio e calcoli</h2>
        <p className="ppa-p2-sub">
          {company.ragioneSociale}{company.piva ? ` · P.IVA ${company.piva}` : ""} · impianto {kwpTxt} kWp · {grp(produzioneKwh)} kWh/anno · consumo F1 {grp(f1BollettaKwh)} kWh/anno
        </p>

        {pronto && (
          <>
            <h3 className="pr-h3">Ricavi e guadagno per noi</h3>
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

            <h3 className="pr-h3 cliente">Spesa in bolletta del cliente</h3>
            <table className="pr-table ppa-pdf-cli">
              <thead><tr><th></th><th className="num">Annuo</th><th className="num">Totale {durTxt} anni</th></tr></thead>
              <tbody>
                <tr><td>Bolletta attuale (x)</td><td className="num">{eur(r.spesaAnnuaNetta)}</td><td className="num">{eur(r.spesaAnnuaNetta * r.durata)}</td></tr>
                <tr><td>− Risparmio sull&apos;energia F1 acquistata da noi ({prezzoMedio > 0 ? `${eur(prezzoMedio, 3)}` : "prezzo attuale"} → {eur(r.tariffa, 3)}/kWh)</td><td className="num">{r.risparmioAnnuoCliente != null ? `− ${eur(r.risparmioAnnuoCliente)}` : "—"}</td><td className="num">{r.risparmioTotaleCliente != null ? `− ${eur(r.risparmioTotaleCliente)}` : "—"}</td></tr>
                <tr className="total"><td>Spesa durante il PPA (y)</td><td className="num">{r.spesaDuranteAnnua != null ? eur(r.spesaDuranteAnnua) : "—"}</td><td className="num">{r.spesaDuranteTotale != null ? eur(r.spesaDuranteTotale) : "—"}</td></tr>
                <tr><td>Risparmio annuo in bolletta = (x − y) ÷ x</td><td className="num">{r.risparmioBollettaPct != null ? `${grp(r.risparmioBollettaPct, 1)} %` : "—"}</td><td className="num"></td></tr>
                <tr><td>Spesa dopo la scadenza del PPA (impianto del cliente)</td><td className="num">{r.spesaDopoAnnua != null ? eur(r.spesaDopoAnnua) : "—"}</td><td className="num"></td></tr>
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
            </div>
          </>
        )}

        <h3 className="pr-h3">Dettaglio mensile — energia F1 vendibile al cliente (kWh)</h3>
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
                <td>Totale</td>
                <td className="num">{grp(mensile.reduce((s, m) => s + m.produzione, 0))}</td>
                <td className="num">{grp(mensile.reduce((s, m) => s + m.f1, 0))}</td>
                <td className="num">{grp(mensile.reduce((s, m) => s + m.venduto, 0))}</td>
                <td className="num">{grp(mensile.reduce((s, m) => s + (m.extraF23 || 0), 0))}</td>
                <td className="num">{grp(mensile.reduce((s, m) => s + Math.max(0, m.produzione - m.venduto), 0))}</td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="pr-note ppa-p2-notes">
          * Mese in cui il consumo F1 supera la produzione: si vende solo la produzione. F1 venduto = somma dei 12 mesi del minore tra produzione e consumo F1 in bolletta; immissione GSE = produzione − F1 venduto. Tempo di rientro = (costo effettivo − anticipo) ÷ ricavo annuo. Ritorno totale = ((ricavo totale ÷ costo effettivo impianto) − 1) × 100; ritorno annuo = ritorno totale ÷ anni dell&apos;accordo. Valori IVA esclusa, indicativi e non vincolanti.
        </p>

        <div className="ppa-pageno">Pagina 2 di 2</div>
      </div>
    </div>
  );
}
