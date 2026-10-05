// Integrazione con PDF Otter (https://pdfotter.github.io/slate/) per il
// bottone "PDF Noleggio": riempie il template PDF del contratto di noleggio
// operativo con gli stessi dati già usati per il CSV Noleggio (vedi
// buildAlaskaFieldMap in app/page.jsx — un campo del template PDF
// corrisponde esattamente a una colonna del CSV, stesso ordine, stesso
// nome) e restituisce il PDF compilato pronto da scaricare, senza passare
// più dal caricamento manuale del CSV sul sito PDF Otter.
//
// Autenticazione: Basic Auth con la API key come username e password vuota
// (vedi https://pdfotter.github.io/slate/#fill-in-a-pdf-template). I nomi
// dei campi del template si leggono con GET /pdf_templates/<id> (array
// "fields"): per questo progetto sono stati verificati corrispondere 1:1 a
// ALASKA_HEADERS (esclusa "pdf_otter_filename", che è solo una colonna
// interna del CSV, non un campo del template).
//
// Richiede due variabili d'ambiente (vedi README):
//   - PDFOTTER_API_KEY: la API key dell'account PDF Otter
//   - PDFOTTER_TEMPLATE_ID: l'id del template da riempire (es. "tem_...")
const PDFOTTER_BASE_URL = "https://www.pdfotter.com/api/v1";

// Riempie un template con i campi passati (oggetto {nomeCampo: valore}) e
// restituisce il PDF compilato come Buffer. Senza `templateIdOverride` usa il
// template del noleggio (PDFOTTER_TEMPLATE_ID); il "PDF Acquisto" passa il
// proprio (vedi app/api/pdf-acquisto/route.js).
export async function fillPdfTemplate(fields, templateIdOverride) {
  const apiKey = process.env.PDFOTTER_API_KEY;
  const templateId = templateIdOverride || process.env.PDFOTTER_TEMPLATE_ID;
  if (!apiKey || !templateId) {
    throw new Error("Integrazione PDF Otter non configurata (mancano PDFOTTER_API_KEY / id del template).");
  }

  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields || {})) {
    body.append(`data[${name}]`, value === null || value === undefined ? "" : String(value));
  }

  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const r = await fetch(`${PDFOTTER_BASE_URL}/pdf_templates/${templateId}/fill`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`PDF Otter ha risposto ${r.status}${text ? `: ${text}` : ""}`);
  }

  const arrayBuffer = await r.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
