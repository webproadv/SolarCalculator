"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export default function ProgettiPage() {
  const [progetti, setProgetti] = useState(null);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  // "Pipe": invia un progetto come nuovo lead nel foglio Google Sheet
  // condiviso del team (vedi /api/progetti/[id]/pipe). Referente, cellulare
  // ed email si inseriscono ormai nello step "Consumi e spesa" della
  // dashboard e si salvano col progetto: qui non si richiedono più, il
  // click invia subito la richiesta.
  const [pipeError, setPipeError] = useState("");
  const [pipingId, setPipingId] = useState(null);
  const [pipeSuccess, setPipeSuccess] = useState("");

  useEffect(() => {
    fetch("/api/progetti")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setProgetti(data.progetti || []);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Elimina definitivamente un progetto dal database (riga "progetti" su
  // Supabase): azione irreversibile, quindi richiede conferma esplicita
  // prima della chiamata DELETE a /api/progetti/[id].
  async function handleElimina(progetto) {
    const nome = progetto.ragione_sociale || progetto.nome_progetto || "questo progetto";
    if (!window.confirm(`Eliminare definitivamente "${nome}"? L'operazione non è reversibile.`)) return;

    setDeleteError("");
    setDeletingId(progetto.id);
    try {
      const r = await fetch(`/api/progetti/${progetto.id}`, { method: "DELETE" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Errore durante l'eliminazione del progetto.");
      setProgetti((prev) => prev.filter((p) => p.id !== progetto.id));
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  async function handlePipe(progetto) {
    setPipeError("");
    setPipingId(progetto.id);
    try {
      const r = await fetch(`/api/progetti/${progetto.id}/pipe`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Errore durante l'invio a Pipe.");
      setPipeSuccess(`Lead per "${progetto.ragione_sociale || progetto.nome_progetto || "il progetto"}" inviato a Pipe.`);
    } catch (err) {
      setPipeError(err.message);
    } finally {
      setPipingId(null);
    }
  }

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
            <Link href="/" className="btn btn-ghost">
              ← Nuovo preventivo
            </Link>
            <UserButton afterSignOutUrl="/sign-in" />
          </div>
        </div>
      </div>

      <div className="wrap" style={{ paddingTop: 32 }}>
        <h2 style={{ marginBottom: 4 }}>Progetti salvati</h2>
        <p className="card-note" style={{ marginBottom: 20 }}>
          Preventivi generati in precedenza da te o dai tuoi colleghi, con i valori proposti al momento del salvataggio.
        </p>

        {error && <div className="error-box">{error}</div>}
        {deleteError && <div className="error-box">{deleteError}</div>}
        {pipeError && <div className="error-box">{pipeError}</div>}
        {pipeSuccess && <div className="info-box">{pipeSuccess}</div>}
        {!progetti && !error && <p className="hint">Caricamento…</p>}
        {progetti && progetti.length === 0 && (
          <div className="card">
            <p className="card-note" style={{ marginBottom: 0 }}>
              Nessun progetto salvato finora. Genera un preventivo e usa &quot;Salva progetto&quot; nella dashboard dei risultati.
            </p>
          </div>
        )}

        {progetti && progetti.length > 0 && (
          <div className="progetti-table-wrap">
            <table className="progetti-table">
              <thead>
                <tr>
                  <th>Ragione sociale</th>
                  <th>P. IVA</th>
                  <th>Comune</th>
                  <th className="num">Impianto</th>
                  <th className="num">Accumulo</th>
                  <th className="num">Costo</th>
                  <th>Creato il</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {progetti.map((p) => (
                  <tr key={p.id}>
                    <td className="truncate">{p.ragione_sociale || "—"}</td>
                    <td className="mono">{p.piva || "—"}</td>
                    <td>
                      {p.comune || "—"}
                      {p.provincia ? ` (${p.provincia})` : ""}
                    </td>
                    <td className="num mono">{p.impianto_proposto_kwp ? `${p.impianto_proposto_kwp} kWp` : "—"}</td>
                    <td className="num mono">{p.accumulo_proposto_kwh ? `${p.accumulo_proposto_kwh} kWh` : "—"}</td>
                    <td className="num mono">{p.costo_impianto_proposto ? `€ ${Number(p.costo_impianto_proposto).toLocaleString("it-IT")}` : "—"}</td>
                    <td className="mono">{new Date(p.created_at).toLocaleDateString("it-IT")}</td>
                    <td>
                      <div className="progetti-actions">
                        <Link href={`/?progetto=${p.id}`} className="btn btn-primary btn-sm">
                          Apri
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => handleElimina(p)}
                          disabled={deletingId === p.id}
                        >
                          {deletingId === p.id ? "Eliminazione…" : "Elimina"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handlePipe(p)}
                          disabled={pipingId === p.id}
                        >
                          {pipingId === p.id ? "Invio…" : "Pipe"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
