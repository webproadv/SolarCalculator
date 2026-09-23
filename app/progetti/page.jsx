"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export default function ProgettiPage() {
  const [progetti, setProgetti] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/progetti")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setProgetti(data.progetti || []);
      })
      .catch((err) => setError(err.message));
  }, []);

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
        {!progetti && !error && <p className="hint">Caricamento…</p>}
        {progetti && progetti.length === 0 && (
          <div className="card">
            <p className="card-note" style={{ marginBottom: 0 }}>
              Nessun progetto salvato finora. Genera un preventivo e usa &quot;Salva progetto&quot; nella dashboard dei risultati.
            </p>
          </div>
        )}

        {progetti && progetti.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ragione sociale</th>
                  <th>P. IVA</th>
                  <th>Comune</th>
                  <th className="num">Impianto</th>
                  <th className="num">Accumulo</th>
                  <th className="num">Costo</th>
                  <th>Data</th>
                  <th>Salvato da</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {progetti.map((p) => (
                  <tr key={p.id}>
                    <td>{p.ragione_sociale || "—"}</td>
                    <td className="mono">{p.piva || "—"}</td>
                    <td>
                      {p.comune || "—"}
                      {p.provincia ? ` (${p.provincia})` : ""}
                    </td>
                    <td className="num mono">{p.impianto_proposto_kwp ? `${p.impianto_proposto_kwp} kWp` : "—"}</td>
                    <td className="num mono">{p.accumulo_proposto_kwh ? `${p.accumulo_proposto_kwh} kWh` : "—"}</td>
                    <td className="num mono">{p.costo_impianto_proposto ? `€ ${Number(p.costo_impianto_proposto).toLocaleString("it-IT")}` : "—"}</td>
                    <td className="mono">{new Date(p.created_at).toLocaleDateString("it-IT")}</td>
                    <td style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{p.creato_da_email || "—"}</td>
                    <td>
                      <Link href={`/?progetto=${p.id}`} className="btn btn-primary" style={{ padding: "6px 14px", fontSize: 13 }}>
                        Apri
                      </Link>
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
