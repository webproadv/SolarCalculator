"use client";

import { PPA_DEFAULTS } from "../lib/ppa";

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

export function PpaChart({ r, print = false }) {
  const C = print
    ? { grid: "#D8DCD3", axis: "#7A857D", ink: "#171D1B", ppa: "#1E4FA3", good: "#2F8F5B", crit: "#B33B30", bg: "#FFFFFF" }
    : { grid: "var(--border)", axis: "var(--ink-faint)", ink: "var(--ink)", ppa: "var(--c-ppa)", good: "var(--c-good)", crit: "var(--crit)", bg: "var(--surface)" };
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
    <svg className={print ? "ppa-chart ppa-chart-print" : "ppa-chart"} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Posizione cumulata dell'investimento nel tempo">
      {yt.map((v, i) => (
        <g key={i}>
          <line x1={L} x2={W - Rm} y1={y(v)} y2={y(v)} stroke={C.grid} strokeWidth="1" />
          <text x={L - 6} y={y(v) + 4} textAnchor="end">{k(v)}</text>
        </g>
      ))}
      <line x1={L} x2={W - Rm} y1={y(0)} y2={y(0)} stroke={C.axis} strokeWidth="1.5" strokeDasharray="4 3" />
      {xt.map((t) => (
        <text key={t} x={x(t)} y={H - 10} textAnchor="middle">{t}</text>
      ))}
      <polyline fill="none" stroke={inside ? C.ppa : C.crit} strokeWidth="3" points={`${x(0)},${y(val(0))} ${x(tb)},${y(val(tb))}`} />
      {inside && (
        <>
          <polyline fill="none" stroke={C.good} strokeWidth="3" points={`${x(tb)},${y(0)} ${x(durata)},${y(val(durata))}`} />
          <circle cx={x(tb)} cy={y(0)} r="5" fill={C.bg} stroke={C.ink} strokeWidth="2" />
          <text x={x(tb)} y={y(0) - 10} textAnchor="middle" style={{ fill: C.ink, fontWeight: 700 }}>pareggio {anniTxt(tb)} anni</text>
        </>
      )}
      <circle cx={x(0)} cy={y(val(0))} r="4" fill={C.ppa} />
      <text x={L + 8} y={y(val(0)) - 8} style={{ fill: C.ink }}>investimento −{k(rec)}</text>
      <text x={W - Rm} y={y(val(durata)) - 8} textAnchor="end" style={{ fill: C.ink, fontWeight: 700 }}>{k(val(durata))}</text>
    </svg>
  );
}

export default function PpaSection({ inp, setInp, r, produzioneKwh, f1BollettaKwh, mensile, prezzoMedio, costoListino }) {
  const { modo, costo, anticipo, tariffa, durata, anni, gse } = inp;
  const mk = (k) => (v) => setInp((p) => ({ ...p, [k]: v }));
  const setModo = mk("modo"), setCosto = mk("costo"), setAnticipo = mk("anticipo"), setTariffa = mk("tariffa");
  const setDurata = mk("durata"), setAnni = mk("anni"), setGse = mk("gse");

  const f1Kwh = r.f1Kwh;
  const immessoKwh = r.immessoKwh;
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
  const scontoBasso = pronto && r.risparmioBollettaPct != null && !nonConveniente && r.risparmioBollettaPct < 3;

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
          <div className="ppa-row"><span>Consumo F1 totale in bolletta</span><b>{grp(f1BollettaKwh || 0)} kWh</b></div>
          <div className="ppa-row"><span>F1 vendibile = somma mensile di MIN(produzione, F1)</span><b>{grp(f1Kwh)} kWh</b></div>
          <div className="ppa-row"><span>Immissione GSE = produzione − F1 venduto</span><b>{grp(immessoKwh)} kWh</b></div>
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
        <div className="ppa-roi">
          <div className="ppa-roi-box">
            <div className="l">Ritorno totale dell&apos;investimento</div>
            <div className="v">{r.roiTotalePct != null ? `${grp(r.roiTotalePct, 1)} %` : "—"}</div>
            <div className="s">((ricavo totale {eur(r.ricavoTotale)} ÷ spese {eur(r.costo)}) − 1) × 100</div>
          </div>
          <div className="ppa-roi-box">
            <div className="l">Ritorno annuo dell&apos;investimento</div>
            <div className="v">{r.roiAnnuoPct != null ? `${grp(r.roiAnnuoPct, 1)} %` : "—"}</div>
            <div className="s">ritorno totale ÷ {durTxt} anni</div>
          </div>
        </div>
      )}

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
          {f1Kwh <= 0 && (
            <div className="ppa-alert crit">⛔ <div><b>Nessun consumo F1:</b> senza consumi F1 non c&apos;è energia da vendere al cliente. Controlla la tabella consumi.</div></div>
          )}
          {nonConveniente && (
            <div className="ppa-alert crit">⛔ <div><b>Tariffa non conveniente per il cliente:</b> {eur(r.tariffa, 3)}/kWh è pari o superiore al prezzo medio che paga oggi ({eur(prezzoMedio, 3)}). Difficile da proporre: valuta anticipo, durata maggiore o un costo impianto più basso.</div></div>
          )}
          {scontoBasso && (
            <div className="ppa-alert warn">⚠️ <div><b>Risparmio in bolletta basso</b> ({grp(r.risparmioBollettaPct, 1)} %): potrebbe non bastare a convincere il cliente.</div></div>
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
              <div className="ppa-row hl"><span>Ritorno totale ({durTxt} anni)<small>((ricavo totale ÷ spese) − 1) × 100</small></span><b>{grp(r.roiTotalePct, 1)} %</b></div>
              <div className="ppa-row hl"><span>Ritorno annuo<small>ritorno totale ÷ {durTxt} anni</small></span><b>{grp(r.roiAnnuoPct, 1)} %</b></div>
              {r.spesaAnnuaNetta > 0 && r.spesaDuranteAnnua != null && (
                <>
                  <h3 style={{ marginTop: 16 }}>Lato cliente — spesa in bolletta</h3>
                  <div className="card-note">Quanto spende il cliente oggi, durante il PPA e dopo (IVA esclusa)</div>
                  <div className="ppa-row"><span>Spesa annua in bolletta attuale</span><b>{eur(r.spesaAnnuaNetta)}</b></div>
                  <div className="ppa-row"><span>Spesa annua durante il PPA<small>bolletta residua + energia F1 acquistata da noi · su {durTxt} anni: {eur(r.spesaDuranteTotale)}</small></span><b>{eur(r.spesaDuranteAnnua)}</b></div>
                  <div className="ppa-row hl"><span>Risparmio annuo in bolletta<small>(spesa attuale − spesa col PPA) ÷ spesa attuale · {eur(r.risparmioAnnuoCliente)} all&apos;anno</small></span><b>{grp(r.risparmioBollettaPct, 1)} %</b></div>
                  {r.spesaDopoAnnua != null && (
                    <div className="ppa-row"><span>Spesa annua dopo la scadenza del PPA<small>impianto di proprietà del cliente (bolletta residua della Sezione D) · {grp(r.risparmioDopoPct, 1)} % in meno di oggi</small></span><b>{eur(r.spesaDopoAnnua)}</b></div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {pronto && (
        <div className="ppa-extra">
          <div className="ppa-extra-head">
            <h3>Energia diurna in F2 e F3 <span className="ppa-tag calc">guadagno aggiuntivo</span></h3>
            <span className="ppa-extra-flag">Non incluso nei calcoli sopra</span>
          </div>
          <div className="ppa-grid4" style={{ marginTop: 10 }}>
            <div className="ppa-kpi"><div className="v">{grp(r.extraF23Kwh)} kWh</div><div className="l">Energia diurna F2/F3 vendibile<br />(annua)</div></div>
            <div className="ppa-kpi"><div className="v">{eur(r.extraF23Margine, 3)}</div><div className="l">Tariffa di vendita {grp(r.tariffa, 3)} − GSE {grp(r.tariffaGse, 3)}<br />(€/kWh)</div></div>
            <div className="ppa-kpi good"><div className="v">{eur(r.extraF23Annuo)}</div><div className="l">Guadagno aggiuntivo<br />annuo</div></div>
            <div className="ppa-kpi good"><div className="v">{eur(r.extraF23Totale)}</div><div className="l">Guadagno aggiuntivo<br />su {durTxt} anni</div></div>
          </div>
          <p className="hint">
            Consumo diurno del cliente (stessa formula del bilancio diurno/notturno, in base ai giorni lavorativi) meno la fascia F1 già venduta, mese per mese e comunque entro la produzione residua dell&apos;impianto. Questi kWh sono già pagati dal GSE nei calcoli principali, quindi si valorizza solo la differenza: energia diurna F2/F3 × (tariffa di vendita − tariffa GSE). Valore informativo: non entra in rientro, ricavi, ritorno dell&apos;investimento e guadagno netto.
          </p>
        </div>
      )}

      {Array.isArray(mensile) && mensile.length === 12 && (
        <details className="ppa-details">
          <summary>Dettaglio mensile — F1 vendibile al cliente</summary>
          <div className="ppa-scroll">
            <table className="ppa-table">
              <thead><tr><th>Mese</th><th className="num">Produzione impianto</th><th className="num">Consumo F1 bolletta</th><th className="num">F1 venduto</th><th className="num">Diurno F2/F3 (extra)</th><th className="num">Immesso GSE</th></tr></thead>
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
                <tr className="sum">
                  <td>Totale (kWh)</td>
                  <td className="num">{grp(mensile.reduce((s, m) => s + m.produzione, 0))}</td>
                  <td className="num">{grp(mensile.reduce((s, m) => s + m.f1, 0))}</td>
                  <td className="num">{grp(mensile.reduce((s, m) => s + m.venduto, 0))}</td>
                  <td className="num">{grp(mensile.reduce((s, m) => s + (m.extraF23 || 0), 0))}</td>
                  <td className="num">{grp(mensile.reduce((s, m) => s + Math.max(0, m.produzione - m.venduto), 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="hint">* mese in cui il consumo F1 supera la produzione: si vende solo la produzione. La colonna "Diurno F2/F3" è già inclusa nell&apos;immesso GSE (vedi nota sopra).</p>
        </details>
      )}

      <div className="hint" style={{ marginTop: 14 }}>
        Come si calcola: ricavo annuo = (kWh F1 venduti × tariffa fissa) + ((produzione totale − kWh F1 venduti) × tariffa GSE) · tempo di rientro = (costo effettivo − anticipo) ÷ ricavo annuo · tariffa necessaria = ((costo effettivo − anticipo) ÷ anni di rientro − ricavo GSE annuo) ÷ kWh F1 venduti. I kWh F1 venduti si calcolano mese per mese: per ogni mese il minore tra produzione dell&apos;impianto e consumo F1 in bolletta; la somma dei 12 mesi è il totale. Valori IVA esclusa.
      </div>
    </section>
  );
}
