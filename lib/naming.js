// Nome "pulito" dell'azienda per i nomi dei file scaricati (PDF di analisi
// energetica, PDF noleggio): la ragione sociale inserita nell'anagrafica
// (es. "Rossi Impianti S.r.l.") contiene quasi sempre una forma societaria
// in coda che nel nome del file è solo rumore — qui si toglie, lasciando
// solo il nome dell'azienda (es. "Rossi Impianti").
//
// Approccio: si spezza la ragione sociale in parole e si tolgono, una alla
// volta partendo dall'ultima, quelle che corrispondono a una forma
// societaria nota (confrontate senza punti/maiuscole) — così funziona sia
// con "S.r.l." che "SRL" che "Srl", e anche con più forme in coda
// (es. "Soc. Coop."). Si toglie anche una "e"/"&" finale isolata, tipica
// del pattern "Rossi & C." una volta tolto "C.". Non si tocca mai l'unica
// parola rimasta, per non restituire un nome vuoto.
const FORME_SOCIETARIE = new Set([
  "srl", "srls", "spa", "sapa", "sas", "snc", "ss",
  "coop", "coop.", "cooperativa", "soc", "societa", "società",
  "ltd", "llc", "inc", "gmbh", "co", "c",
]);

export function nomeAziendaPulito(ragioneSociale) {
  const originale = (ragioneSociale || "").trim();
  if (!originale) return "";

  const tokens = originale.split(/\s+/);
  while (tokens.length > 1) {
    const ultimo = tokens[tokens.length - 1].toLowerCase().replace(/[.,]/g, "");
    if (FORME_SOCIETARIE.has(ultimo)) {
      tokens.pop();
      continue;
    }
    break;
  }
  // "Rossi & C." / "Rossi e C." → dopo aver tolto "C.", toglie anche il
  // connettivo "&"/"e" rimasto in fondo.
  if (tokens.length > 1) {
    const ultimo = tokens[tokens.length - 1].toLowerCase();
    if (ultimo === "&" || ultimo === "e") tokens.pop();
  }

  const pulito = tokens.join(" ").replace(/[\s,&]+$/g, "").trim();
  return pulito || originale;
}

// Nome file per un PDF scaricato (es. "Analisi Energetica Rossi Impianti"),
// con il prefisso passato + il nome azienda ripulito da nomeAziendaPulito, e
// senza i caratteri non ammessi nei nomi file di Windows/macOS — spazi e
// accenti restano, per un nome leggibile nella cartella Download.
export function pdfDownloadFilename(prefisso, ragioneSociale) {
  const nome = nomeAziendaPulito(ragioneSociale);
  const combinato = nome ? `${prefisso} ${nome}` : prefisso;
  return combinato.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim() || prefisso;
}
