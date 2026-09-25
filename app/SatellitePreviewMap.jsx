"use client";

import { useEffect, useRef, useState } from "react";

// Zoom di partenza per l'anteprima nello step Azienda: prima di generare un
// preventivo non abbiamo ancora la geometria del tetto (arriva dalla Solar
// API solo in /api/quote), quindi non possiamo calcolare uno zoom "su
// misura" come fa zoomPerRaggio in lib/sources.js — usiamo un valore medio
// ragionevole che l'utente può comunque correggere trascinando/zoomando.
const DEFAULT_ZOOM = 19;

// Anteprima satellitare interattiva (Mapbox GL JS) mostrata nello step
// "Azienda", appena sono note le coordinate del sito. Usa lo stesso stile
// ("satellite-v9") e lo stesso rapporto d'aspetto (8:5, come l'immagine
// 640x400 generata da /api/roof-image) della foto statica finale mostrata
// in dashboard/PDF: quello che l'utente inquadra qui — zoom e centratura
// inclusi — è quindi esattamente quello che ritroverà dopo.
//
// Il componente si monta una sola volta per ogni "sessione di inquadratura":
// il chiamante lo rimonta passando una `key` diversa (vedi satMapKey in
// page.jsx) quando serve ripartire da un'inquadratura pulita — una nuova
// ricerca Partita IVA, o il bottone "Ricentra su indirizzo" dopo aver
// corretto lat/lng a mano. Non risponde invece a cambi di lat/lng "in
// diretta" (es. durante la digitazione in un campo numerico), altrimenti la
// mappa si ricentrerebbe da sola ad ogni carattere digitato, cancellando lo
// zoom/spostamento scelto dall'utente.
//
// onViewChange({ lat, lng, zoom }) viene richiamato al primo caricamento e
// ad ogni spostamento/zoom completato ("moveend"): il chiamante tiene
// traccia dell'ultima inquadratura vista e la userà al posto del calcolo
// automatico basato sull'area del tetto quando genera la foto definitiva.
export default function SatellitePreviewMap({ lat, lng, zoom = DEFAULT_ZOOM, onViewChange }) {
  const containerRef = useRef(null);
  const [error, setError] = useState("");

  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  useEffect(() => {
    if (!accessToken || !containerRef.current) return;

    let cancelled = false;
    let map;

    import("mapbox-gl").then((mod) => {
      if (cancelled || !containerRef.current) return;
      const mapboxgl = mod.default;
      mapboxgl.accessToken = accessToken;

      map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/satellite-v9",
        center: [lng, lat],
        zoom,
        attributionControl: false,
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new mapboxgl.AttributionControl({ compact: true }));

      const emitView = () => {
        const c = map.getCenter();
        onViewChange({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
      };
      map.once("load", emitView);
      map.on("moveend", emitView);
      map.on("error", (e) => setError(e?.error?.message || "Errore nel caricamento della mappa."));
    }).catch(() => setError("Impossibile caricare la mappa satellitare (mapbox-gl)."));

    return () => {
      cancelled = true;
      map?.remove();
    };
    // Montaggio una tantum per istanza (vedi commento sopra sulla `key`):
    // le props lat/lng/zoom vanno usate solo come valori iniziali.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  if (!accessToken) {
    // Nota: il testo va racchiuso in un unico elemento figlio (qui <p>) e non
    // lasciato come più nodi/testo diretti dentro .sat-preview-fallback, che
    // è un flex container per centrarlo verticalmente — con più figli diretti
    // (testo + <code> + testo + <code>) ciascuno diventerebbe un item flex a
    // sé, spezzando la frase invece di andare a capo come paragrafo normale.
    return (
      <div className="sat-preview-fallback">
        <p>
          Anteprima non disponibile: configura la variabile d&apos;ambiente{" "}
          <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> (stesso token pubblico di{" "}
          <code>MAPBOX_ACCESS_TOKEN</code>).
        </p>
      </div>
    );
  }

  return (
    <div className="sat-preview">
      <div ref={containerRef} className="sat-preview-map" />
      {error && <div className="sat-preview-error">{error}</div>}
    </div>
  );
}
