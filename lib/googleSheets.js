// Integrazione con Google Sheets (REST API v4) per il bottone "Pipe" nella
// lista progetti: ogni clic aggiunge in fondo al foglio lead del team una
// riga con i dati del preventivo — sempre in append, mai una riscrittura del
// file (vedi spreadsheets.values.append più sotto), così non c'è rischio di
// sovrascrivere righe inserite da altri nel frattempo.
//
// Autenticazione via Service Account Google (JWT firmato con RSA-SHA256,
// scambiato per un access token OAuth2) — nessuna dipendenza esterna
// (`googleapis`/`google-auth-library`): bastano `fetch` e il modulo `crypto`
// di Node, già disponibili.
//
// Richiede tre variabili d'ambiente (vedi README):
//   - GOOGLE_SHEETS_CLIENT_EMAIL: email del service account
//   - GOOGLE_SHEETS_PRIVATE_KEY: chiave privata del service account (PEM;
//     se incollata in un .env su una riga sola con "\n" letterali, qui
//     vengono convertiti in veri a capo)
//   - GOOGLE_SHEETS_PIPE_SPREADSHEET_ID: ID del file Google Sheet (dalla URL,
//     https://docs.google.com/spreadsheets/d/<ID>/edit...)
// Il foglio va condiviso con l'email del service account con permesso
// "Editor", altrimenti l'append fallisce con un errore di permessi.
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_SHEET_NAME = "PIPE";

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken() {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!clientEmail || !privateKeyRaw) {
    throw new Error(
      "Integrazione Google Sheets non configurata (mancano GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY)."
    );
  }
  const privateKey = privateKeyRaw.includes("\\n") ? privateKeyRaw.replace(/\\n/g, "\n") : privateKeyRaw;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;

  const { createSign } = await import("crypto");
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(privateKey)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${unsigned}.${signature}`;

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Autenticazione Google Sheets fallita: ${data.error_description || data.error || r.status}`);
  }
  return data.access_token;
}

// L'API restituisce l'intervallo dove ha scritto (es. "PIPE!A3:Q3" oppure
// "'Nome Foglio'!A3:Q3"): ci serve solo il numero di riga, per poter poi
// formattare come valuta la cella giusta senza doverlo indovinare a priori.
function parseAppendedRowNumber(updatedRange) {
  const m = /![A-Za-z]+(\d+):[A-Za-z]+(\d+)$/.exec(updatedRange || "");
  return m ? Number(m[1]) : null;
}

// Il nome del foglio (usato nelle richieste values.*) non basta per
// batchUpdate, che vuole l'id numerico interno del foglio (sheetId, diverso
// dal gid mostrato nella URL solo per coincidenza quando è l'unico foglio):
// lo risolviamo leggendo i metadati dello spreadsheet.
async function getSheetId(spreadsheetId, sheetName, accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Lettura struttura foglio fallita: ${data.error?.message || r.status}`);
  }
  const sheet = (data.sheets || []).find((s) => s.properties?.title === sheetName);
  if (!sheet) {
    throw new Error(`Foglio "${sheetName}" non trovato nello spreadsheet.`);
  }
  return sheet.properties.sheetId;
}

// Applica il formato valuta (€) a una o più celle della riga appena
// aggiunta (es. la colonna VALORE OFF), così in foglio appare "€ 15.000,00"
// invece del numero grezzo "15000" — senza toccare il valore numerico, che
// resta utilizzabile in eventuali somme/formule sulla colonna.
async function formatCurrencyCells({ spreadsheetId, sheetName, rowNumber, columnIndexes, accessToken }) {
  const sheetId = await getSheetId(spreadsheetId, sheetName, accessToken);
  const requests = columnIndexes.map((columnIndex) => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rowNumber - 1,
        endRowIndex: rowNumber,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "€#,##0.00" } } },
      fields: "userEnteredFormat.numberFormat",
    },
  }));

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Formattazione valuta fallita: ${data.error?.message || r.status}`);
  }
}

// Aggiunge una riga in fondo al foglio "PIPE": usa spreadsheets.values.append
// (INSERT_ROWS), che individua da sé la prima riga libera dopo l'ultima con
// dati nell'intervallo indicato — qui non serve quindi sapere a priori
// quante righe esistano già.
//
// `currencyColumnIndexes` (opzionale): indici di colonna 0-based (A=0, B=1,
// ...) da formattare come valuta € subito dopo l'append. Se questo secondo
// passaggio fallisce (es. permessi insufficienti per batchUpdate), la riga è
// comunque già stata scritta: logghiamo l'errore senza far fallire l'intera
// operazione, la formattazione è un dettaglio estetico.
export async function appendPipeRow(values, { currencyColumnIndexes = [] } = {}) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_PIPE_SPREADSHEET_ID;
  const sheetName = process.env.GOOGLE_SHEETS_PIPE_SHEET_NAME || DEFAULT_SHEET_NAME;
  if (!spreadsheetId) {
    throw new Error("Integrazione Google Sheets non configurata (manca GOOGLE_SHEETS_PIPE_SPREADSHEET_ID).");
  }

  const accessToken = await getAccessToken();
  const range = encodeURIComponent(`${sheetName}!A1:Q1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ values: [values] }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Scrittura su Google Sheets fallita: ${data.error?.message || r.status}`);
  }

  if (currencyColumnIndexes.length > 0) {
    const rowNumber = parseAppendedRowNumber(data.updates?.updatedRange);
    if (rowNumber) {
      try {
        await formatCurrencyCells({ spreadsheetId, sheetName, rowNumber, columnIndexes: currencyColumnIndexes, accessToken });
      } catch (err) {
        console.error("Formattazione valuta riga Pipe fallita (riga comunque aggiunta):", err.message);
      }
    }
  }

  return data;
}
