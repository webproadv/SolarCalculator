"use client";

import { useState } from "react";
import { calcolaPpa, PPA_DEFAULTS } from "../lib/ppa";

// Sezione F — Vendita energia in modalità PPA (vedi lib/ppa.js per le formule).
// Dati automatici dall'analisi (produzione, autoconsumo F1, prezzo medio) in
// ingresso; costo effettivo, anticipo, tariffa e durata si inseriscono qui.

// "always" forza il separatore delle migliaia anche a 4 cifre (it-IT di default non lo mette).
const grp = (v, d = 0) =>
  (Number.isFinite(v) ? v : 0).toLocaleString("it-IT", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
    useGrouping: "always",
  });
const eur = (v, d = 0) => `€ ${grp(v, d)}`;
const anniTxt = (v) => grp(v, 1).replace(/,0$/, "");

function PpaChart({ r }) {
  const W = 640, H = 220, L = 58, Rm = 40, T = 26, B = 30;
  const rec = r.daRecuperare;
  const durata = r.durata;
  const yMin = -rec;
  const yMax = Math.max(r.ricavoAnnuo * durata - rec, rec * 0.15, 1);
  const x = (v) => L + (v / durata) * (W - L - Rm);
  const y = (v) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B);
  const val = (t) => -rec + r.ricavoAnnuo * t;
  const inside = Number.isFinite(r.anniRientro) && r.anniRientro < durata;
  const tb = inside ? r.anniRientro : durata;
  const step = durata > 8 ? 2 : 1;
  const xt = [];
  for (let t = 0; t <= durata + 0.001; t += step) xt.push(t);
  const yt = [0, 1, 2, 3, 4].map((i) => yMin + ((yMax - yMin) * i) / 4);
  const k = (v) => `${(v / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })}k`;
  return (
    <svg className="ppa-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Posizione cumulata dell'investimento nel tempo">
      {yt.map((v, i) => (
        <g key={i}>
          <line x1={L} x2={W - Rm} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
          <text x={L - 6} y={y(v) + 4} textAnchor="end">{k(v)}</text>
        </g>
      ))}
      <line x1={L} x2={W - Rm} y1={y(0)} y2={y(0)} stroke="var(--ink-faint)" strokeWidth="1.5" strokeDasharray="4 3" />
      {xt.map((t) => (
        <text key={t} x={x(t)} y={H - 10} textAnchor="middle">{t}</text>
      ))}
      <polyline fill="none" stroke={inside ? "var(--c-ppa)" : "var(--crit)"} strokeWidth="3" points={`${x(0)},${y(val(0))} ${x(tb)},${y(val(tb))}`} />
      {inside && (
        <>
          <polyline fill="none" stroke="var(--c-good)" strokeWidth="3" points={`${x(tb)},${y(0)} ${x(durata)},${y(val(durata))}`} />
          <circle cx={x(tb)} cy={y(0)} r="5" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2" />
          <text x={x(tb)} y={y(0) - 10} textAnchor="middle" style={{ fill: "var(--ink)", fontWeight: 700 }}>pareggio {anniTxt(tb)} anni</text>
        </>
      )}
      <circle cx={x(0)} cy={y(val(0))} r="4" fill="var(--c-ppa)" />
      <text x={L + 8} y={y(val(0)) - 8} style={{ fill: "var(--ink)" }}>investimento −{k(rec)}</text>
      <text x={W - Rm} y={y(val(durata)) - 8} textAnchor="end" style={{ fill: "var(--ink)", fontWeight: 700 }}>{k(val(durata))}</text>
    </svg>
  );
}

export default function PpaSection({ produzioneKwh, autoconsumoF1Kwh, prezzoMedio, costoListino }) {
  const [modo, setModo] = useState(2); // 2 = anni → tariffa (configurazione ottimale)
  const [costo, setCosto] = useState("");
  const [anticipo, setAnticipo] = useState("0");
  const [tariffa, setTariffa] = useState("");
  const [durata, setDurata] = useState(String(PPA_DEFAULTS.durataAnni));
  const [anni, setAnni] = useState(String(PPA_DEFAULTS.anniRientro));
  const [gse, setGse] = useState(String(PPA_DEFAULTS.tariffaGse));

  const f1Kwh = Math.max(0, Math.round(autoconsumoF1Kwh || 0));
  const immessoKwh = Math.max(0, Math.round((produzioneKwh || 0) - f1Kwh));

  const r = calcolaPpa({
    modo, costo, anticipo, tariffa, durata, anniRientro: anni,
    tariffaGse: gse, f1Kwh, immessoKwh, prezzoAttuale: prezzoMedio,
  });
  const pronto = r.costo > 0 && r.daRecuperare >= 0;
  const durTxt = anniTxt(r.durata);

  const cambiaModo = (m) => {
    if (m === modo) return;
    // Porta nel campo che diventa "libero" il valore appena calcolato.
    if (m === 1 && pronto) setTariffa(r.tariffa.toFixed(3));
    if (m === 2 && pronto && Number.isFinite(r.anniRientro)) setAnni(Math.min(r.anniRientro, 99).toFixed(1));
    setModo(m);
  };
  const ottimale = () => {
    setAnni(((Number(String(durata).replace(",", ".")) || PPA_DEFAULTS.durataAnni) / 2).toFixed(1));
    setModo(2);
  };

  const tariffaValue = modo === 2 ? (pronto ? r.tariffa.toFixed(3) : "") : tariffa;
  const anniValue = modo === 1 ? (pronto && Number.isFinite(r.anniRientro) ? Math.min(r.anniRientro, 99).toFixed(2) : "") : anni;

  const over = pronto && !r.rientraInDurata;
  const margineBasso = pronto && r.rientraInDurata && r.anniGuadagno < r.durata / 2 - 0.01;
  const nonConveniente = pronto && prezzoMedio > 0 && r.tariffa >= prezzoMedio;
  const scontoBasso = pronto && prezzoMedio > 0 && !nonConveniente && r.scontoPct < 5;

  const tlRientro = over ? 1 : r.anniRientro;
  const tlUtile = over ? 0 : r.anniGuadagno;

  return (
    <section className="block ppa-block" id="f">
      <div className="block-head"><span className="block-tag ppa">F</span><h2>Vendita energia — PPA</h2></div>
      <div className="block-desc">
        Il cliente non paga l&apos;impianto: lo installiamo a nostre spese e gli vendiamo l&apos;energia a tariffa fissa, più bassa di quella attuale, per tutta la durata dell&apos;accordo. L&apos;obiettivo è rientrare dell&apos;investimento nella prima parte del contratto e guadagnare nella restante.
      </div>

      <div className="ppa-grid2">
        <div className="card">
          <h3>Dati dell&apos;operazione <span className="ppa-tag man">da inserire</span></h3>
          <div className="card-note">I valori che inserisci a mano</div>
          <div className="field">
            <label>Costo effettivo impianto (€)</label>
            <input type="number" min="0" step="100" inputMode="decimal" placeholder="es. 42000" value={costo} onChange={(e) => setCosto(e.target.value)} />
            <p className="hint">Il costo reale per noi (più basso del prezzo di listino){costoListino > 0 ? ` — listino proposto in Sezione C: ${eur(costoListino)}` : ""}.</p>
          </div>
          <div className="field">
            <label>Anticipo del cliente (€)</label>
            <input type="number" min="0" step="100" inputMode="decimal" value={anticipo} onChange={(e) => setAnticipo(e.target.value)} />
            <p className="hint">Zero oppure cifra concordata col cliente.</p>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>
              Tariffa fissa di vendita energia (€/kWh)
              {modo === 2 && <span className="ppa-tag calc">calcolata</span>}
            </label>
            <input
              type="number" min="0" step="0.001" inputMode="decimal"
              className={modo === 2 ? "ppa-calc" : ""}
              readOnly={modo === 2}
              placeholder={modo === 2 ? "inserisci il costo effettivo" : "es. 0,180"}
              value={tariffaValue}
              onChange={(e) => setTariffa(e.target.value)}
            />
            <p className="hint">{modo === 1 ? "Applicata ai soli kWh autoconsumati in F1." : "Calcolata in base agli anni di rientro scelti."}</p>
          </div>
        </div>

        <div className="card">
          <h3>Dati dall&apos;analisi <span className="ppa-tag">automatici</span></h3>
          <div className="card-note">Letti dalle Sezioni B e C — non da reinserire</div>
          <div className="ppa-row"><span>Produzione totale annua impianto</span><b>{grp(produzioneKwh || 0)} kWh</b></div>
          <div className="ppa-row"><span>Consumo F1 in bolletta — tutta la fascia F1 (venduto)</span><b>{grp(f1Kwh)} kWh</b></div>
          <div className="ppa-row"><span>Immissione GSE = produzione − energia F1 venduta</span><b>{grp(immessoKwh)} kWh</b></div>
          <div className="ppa-row"><span>Prezzo medio energia attuale (IVA esclusa)</span><b>{eur(prezzoMedio || 0, 3)}/kWh</b></div>
          <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>Tariffa GSE (€/kWh)</label>
            <input type="number" min="0" step="0.001" inputMode="decimal" value={gse} onChange={(e) => setGse(e.target.value)} />
            <p className="hint">Applicata a tutta l&apos;energia prodotta e non venduta in F1. Preimpostata a 0,11.</p>
          </div>
        </div>
      </div>

      <h4 className="ppa-sec">Come vuoi ragionare?</h4>
      <div className="card">
        <div className="ppa-seg" role="tablist">
          <button type="button" role="tab" aria-selected={modo === 1} className={modo === 1 ? "on" : ""} onClick={() => cambiaModo(1)}>
            Fisso la tariffa<small>→ vedo in quanti anni rientro</small>
          </button>
          <button type="button" role="tab" aria-selected={modo === 2} className={modo === 2 ? "on" : ""} onClick={() => cambiaModo(2)}>
            Fisso gli anni di rientro<small>→ trovo la tariffa necessaria</small>
          </button>
        </div>
        <div className="ppa-grid2" style={{ gap: 14 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Durata accordo (anni)</label>
            <input type="number" min="1" max="25" step="0.5" inputMode="decimal" value={durata} onChange={(e) => setDurata(e.target.value)} />
            <input type="range" min="1" max="15" step="0.5" value={Math.min(15, Math.max(1, Number(durata) || 5))} onChange={(e) => setDurata(e.target.value)} aria-label="Durata accordo" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>
              Anni di rientro desiderati
              {modo === 1 && <span className="ppa-tag calc">calcolati</span>}
            </label>
            <input
              type="number" min="0.5" step="0.1" inputMode="decimal"
              className={modo === 1 ? "ppa-calc" : ""}
              readOnly={modo === 1}
              value={anniValue}
              onChange={(e) => setAnni(e.target.value)}
            />
            <input type="range" min="0.5" max="10" step="0.1" disabled={modo === 1}
              value={Math.min(10, Math.max(0.5, Number(anniValue) || 2.5))}
              onChange={(e) => setAnni(e.target.value)} aria-label="Anni di rientro" />
          </div>
        </div>
        <button type="button" className="ppa-opt" onClick={ottimale}>
          ⚡ Configurazione ottimale: rientro in metà durata ({anniTxt((Number(String(durata).replace(",", ".")) || 5) / 2)} su {durTxt} anni)
        </button>
        <p className="hint">Ottimale = rientro in metà della durata, così l&apos;altra metà è tutta di guadagno. Passa alla modalità &quot;anni → tariffa&quot; e calcola la tariffa necessaria.</p>
      </div>

      <h4 className="ppa-sec">Risultato</h4>
      {!pronto && (
        <div className="ppa-alert warn">Inserisci il <b>costo effettivo impianto</b> per vedere tariffa, tempi di rientro e guadagno.</div>
      )}
      <div className="ppa-grid4">
        <div className="ppa-kpi"><div className="v">{pronto ? eur(r.daRecuperare) : "—"}</div><div className="l">Da recuperare<br />(costo effettivo − anticipo)</div></div>
        <div className="ppa-kpi"><div className="v">{pronto ? eur(r.ricavoAnnuo) : "—"}</div><div className="l">Ricavo annuo<br />(vendita F1 + GSE)</div></div>
        <div className="ppa-kpi hl"><div className="v">{pronto && Number.isFinite(r.anniRientro) ? `${grp(r.anniRientro, 2)} anni` : "—"}</div><div className="l">Tempo di rientro<br />({modo === 1 ? "calcolato" : "scelto"})</div></div>
        <div className="ppa-kpi good"><div className="v">{pronto ? eur(r.guadagnoNetto) : "—"}</div><div className="l">Guadagno netto<br />a fine accordo</div></div>
      </div>

      {pronto && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Durata dell&apos;accordo: rientro e guadagno</h3>
          <div className="card-note">
            {over
              ? "Con questa tariffa l'investimento non rientra entro la durata dell'accordo."
              : `Su ${durTxt} anni: ${anniTxt(r.anniRientro)} per rientrare, ${anniTxt(r.anniGuadagno)} di guadagno puro.`}
          </div>
          <div className="ppa-tl">
            {over ? (
              <div className="ppa-tl-seg over" style={{ flex: "1 0 0" }}>
                {Number.isFinite(r.anniRientro) ? `Rientro dopo ${anniTxt(r.anniRientro)} anni (> durata)` : "Nessun rientro"}
              </div>
            ) : (
              <>
                <div className="ppa-tl-seg rientro" style={{ flex: `${tlRientro} 0 0` }}>Rientro {anniTxt(tlRientro)} anni</div>
                {tlUtile > 0.001 && <div className="ppa-tl-seg utile" style={{ flex: `${tlUtile} 0 0` }}>Guadagno {anniTxt(tlUtile)} anni</div>}
              </>
            )}
          </div>
          <div className="ppa-tl-scale"><span>Anno 0</span><span>anno {durTxt}</span></div>
          <div className="ppa-legend">
            <span><i style={{ background: "var(--c-ppa)" }} />Rientro dell&apos;investimento</span>
            <span><i style={{ background: "var(--c-good)" }} />Guadagno (dopo il rientro)</span>
            {over && <span><i style={{ background: "var(--crit)" }} />Non si rientra entro la durata</span>}
          </div>
          <PpaChart r={r} />
        </div>
      )}

      {pronto && (
        <>
          {over && (
            <div className="ppa-alert crit">⛔ <div><b>Non rientri entro la durata.</b> Servirebbe una tariffa di almeno {eur(r.tariffaMinima, 3)}/kWh per rientrare in {durTxt} anni.</div></div>
          )}
          {margineBasso && (
            <div className="ppa-alert warn">⚠️ <div><b>Margine ridotto:</b> il rientro occupa più di metà della durata ({anniTxt(r.anniRientro)} su {durTxt} anni). Obiettivo: massimo {anniTxt(r.durata / 2)}.</div></div>
          )}
          {!over && !margineBasso && (
            <div className="ppa-alert ok">✅ <div><b>Obiettivo rispettato:</b> rientro in {anniTxt(r.anniRientro)} anni, {anniTxt(r.anniGuadagno)} anni di guadagno.</div></div>
          )}
          {f1Kwh > (produzioneKwh || 0) && (
            <div className="ppa-alert warn">⚠️ <div><b>Il consumo F1 ({grp(f1Kwh)} kWh) supera la produzione annua dell&apos;impianto ({grp(produzioneKwh || 0)} kWh):</b> l&apos;impianto non può coprire tutta la fascia F1, quindi il ricavo da vendita è teorico e l&apos;immissione GSE è zero.</div></div>
          )}
          {f1Kwh <= 0 && (
            <div className="ppa-alert crit">⛔ <div><b>Nessun consumo F1:</b> senza consumi F1 non c&apos;è energia da vendere al cliente. Controlla la tabella consumi.</div></div>
          )}
          {nonConveniente && (
            <div className="ppa-alert crit">⛔ <div><b>Tariffa non conveniente per il cliente:</b> {eur(r.tariffa, 3)}/kWh è pari o superiore al prezzo medio che paga oggi ({eur(prezzoMedio, 3)}). Difficile da proporre: valuta anticipo, durata maggiore o un costo impianto più basso.</div></div>
          )}
          {scontoBasso && (
            <div className="ppa-alert warn">⚠️ <div><b>Sconto al cliente basso</b> ({grp(r.scontoPct, 1)} %): potrebbe non bastare a convincerlo.</div></div>
          )}

          <div className="ppa-grid2" style={{ marginTop: 14 }}>
            <div className="card">
              <h3>Ricavi</h3>
              <div className="card-note">Annui e sull&apos;intera durata</div>
              <table className="ppa-table">
                <thead><tr><th></th><th className="num">Annuo</th><th className="num">Totale {durTxt} anni</th></tr></thead>
                <tbody>
                  <tr><td>Vendita energia F1<small>{grp(r.f1Kwh)} kWh × {eur(r.tariffa, 3)}</small></td><td className="num">{eur(r.ricavoVenditaAnnuo)}</td><td className="num">{eur(r.ricavoVenditaTotale)}</td></tr>
                  <tr><td>Ritiro GSE<small>{grp(r.immessoKwh)} kWh × {eur(r.tariffaGse, 3)}</small></td><td className="num">{eur(r.ricavoGseAnnuo)}</td><td className="num">{eur(r.ricavoGseTotale)}</td></tr>
                  <tr className="sum"><td>Ricavo totale</td><td className="num">{eur(r.ricavoAnnuo)}</td><td className="num">{eur(r.ricavoTotale)}</td></tr>
                  <tr className="sub"><td>− Costo effettivo impianto</td><td></td><td className="num">− {eur(r.costo)}</td></tr>
                  <tr className="sub"><td>+ Anticipo del cliente</td><td></td><td className="num">+ {eur(r.anticipo)}</td></tr>
                  <tr className="sum"><td>Guadagno netto</td><td></td><td className="num">{eur(r.guadagnoNetto)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>Ritorno dell&apos;investimento</h3>
              <div className="card-note">Ricavo ÷ costo effettivo impianto</div>
              <div className="ppa-row"><span>Ritorno annuo</span><b>{grp(r.roiAnnuoPct, 1)} %</b></div>
              <div className="ppa-row"><span>Ritorno totale ({durTxt} anni)</span><b>{grp(r.roiTotalePct, 1)} %</b></div>
              <div className="ppa-row"><span>Guadagno netto su costo effettivo</span><b>{grp(r.guadagnoNettoPct, 1)} %</b></div>
              {prezzoMedio > 0 && (
                <>
                  <h3 style={{ marginTop: 16 }}>Lato cliente</h3>
                  <div className="card-note">Perché il cliente accetta</div>
                  <div className="ppa-row"><span>Tariffa PPA vs prezzo medio attuale ({grp(prezzoMedio, 3)})</span><b>{r.scontoPct >= 0 ? "−" : "+"}{grp(Math.abs(r.scontoPct), 1)} %</b></div>
                  <div className="ppa-row"><span>Risparmio annuo sull&apos;energia F1</span><b>{eur(r.risparmioAnnuoCliente)}</b></div>
                  <div className="ppa-row"><span>Risparmio sull&apos;intera durata</span><b>{eur(r.risparmioTotaleCliente)}</b></div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      <div className="hint" style={{ marginTop: 14 }}>
        Come si calcola: ricavo annuo = (tutti i kWh consumati in F1 × tariffa fissa) + ((produzione totale − kWh F1) × tariffa GSE) · tempo di rientro = (costo effettivo − anticipo) ÷ ricavo annuo · tariffa necessaria = ((costo effettivo − anticipo) ÷ anni di rientro − ricavo GSE annuo) ÷ kWh F1. Si vende al cliente tutto il consumo F1 annuo letto in bolletta (somma dei 12 mesi). Valori IVA esclusa.
      </div>
    </section>
  );
}
