"use client";

import { useUser, SignOutButton } from "@clerk/nextjs";

// Niente export "metadata" qui: essendo un componente client (serve
// useUser), l'eventuale title/description della pagina restano quelli
// di default del layout radice.
export default function NonAutorizzatoPage() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 440, textAlign: "center" }}>
        <h3>Accesso non autorizzato</h3>
        <p className="card-note" style={{ marginBottom: 18 }}>
          {email ? (
            <>
              L&apos;indirizzo <strong>{email}</strong> non è abilitato
            </>
          ) : (
            "Il tuo account non è abilitato"
          )}{" "}
          a usare questa applicazione. Contatta chi gestisce SolarCalculator per richiedere l&apos;accesso.
        </p>
        <SignOutButton>
          <button className="btn btn-ghost">Esci e riprova con un altro account</button>
        </SignOutButton>
      </div>
    </div>
  );
}
