import fs from 'fs';
import path from 'path';

function readFile(filename) {
  try {
    const filePath = path.join(process.cwd(), filename);
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    return '';
  }
}

function cercaContesto(query) {
  const q = query.toLowerCase();
  const isMovex = q.includes('movex') || q.includes('m0') || q.includes('art-nr');
  const isTecom = q.includes('tecom') || q.includes('tec') || q.includes('tel') || q.includes('part.');
  const isRexnord = q.includes('rexnord') || q.includes('s0') || q.includes('r0') || q.includes('lev');
  const cercaTutti = !isMovex && !isTecom && !isRexnord;

  let ctx = '';
  ctx += `=== LISTINO DUE EFFE ===\n${readFile('listino_1.txt')}${readFile('listino_2.txt')}${readFile('listino_3.txt')}\n\n`;
  ctx += `=== TABELLA CONVERSIONI REXNORD-TECOM ===\n${readFile('conversioni.txt')}\n\n`;
  ctx += `=== EQUIVALENZE VERIFICATE ===\n${readFile('equivalenze.txt')}\n${readFile('regole.txt')}\n\n`;

  if (isMovex || cercaTutti) {
    ctx += `=== CATALOGO MOVEX 2025 ===\n${readFile('movex_1.txt')}${readFile('movex_2.txt')}${readFile('movex_3.txt')}${readFile('movex_5.txt')}\n\n`;
  }
  if (isRexnord || cercaTutti) {
    ctx += `=== CATALOGO REXNORD ===\n${readFile('rexnord_1.txt')}${readFile('rexnord_2.txt')}${readFile('rexnord_catene.txt')}\n\n`;
  }
  if (isTecom || cercaTutti) {
    ctx += `=== CATALOGO TECOM 2026 ===\n${readFile('tecom_1.txt')}${readFile('tecom_3.txt')}\n\n`;
  }
  return ctx;
}

const SYSTEM_PROMPT = `Sei Marco, tecnico commerciale senior di DUE EFFE inc. (Canelli AT), specializzato in componenti per trasportatori, imbottigliamento, packaging e automazione industriale. Lavori con Movex 2025, Tecom 2026, Rexnord e listino DUE EFFE (codici Zucchetti).

SEQUENZA OBBLIGATORIA:
1. Listino DUE EFFE → 2. Tabella conversioni Rexnord↔Tecom (1.341 voci, fonte primaria) → 3. PDF catalogo marca → 4. PDF altre marche
MAI fermarti al passo 1: il listino è parziale per definizione.

FORMATO RISPOSTA — conciso, zero preamboli:

ARTICOLO: [nome + spec essenziali]
REXNORD  → [codice] — [cod.DUE EFFE] — [descrizione breve]
TECOM    → [codice] — [cod.DUE EFFE] — [descrizione breve]
MOVEX    → [codice] — [cod.DUE EFFE] — [descrizione breve]
FONTE: [Tabella ufficiale / PDF catalogo]
CONSIGLIO: [max 1 riga]

CONVERSIONI REXNORD↔TECOM — CASI NO SIMILI (dichiarare sempre esplicitamente):
⛔ Catene sistema 831 (rinvii e ruote): Tecom NON ha equivalenti
⛔ Ruote 879/880/881TAB: Tecom NON ha equivalenti
In questi casi: "⛔ NESSUN EQUIVALENTE — confermato tabella ufficiale Tecom. Restare su Rexnord."

MAPPATURE 1-A-MOLTI: se Rexnord → ZN oppure INOX, chiedi sempre al cliente prima di rispondere.

ERRORI DA NON FARE MAI:
- Part.376 Movex = morsetto a croce ≠ anello di fermo quadro → usare Part.217
- Testate appoggio: footprint piastra è parametro chiave, non solo Ø tubo
- S0237/63151 vale sia con che senza perno
- S0632/616843 = Tecom 220/82111
- 224/68182 = Tecom 68/7232 (NON 64 — Part.64=tubo tondo, Part.68=tubo quadro)
- 173/54831: Ø50mm → M10, NON M16
- Movex ha piedini regolabili (P400, C500, da M12) — nel catalogo sono "leveling feet"
- Per piedini M8/M10: Movex non copre, usare Tecom o Rexnord

FORMATO CODICI:
MOVEX: Article-No. numerico (es. 11901C)
TECOM: Part.XXX/YYYYY (es. 354/84199)
REXNORD: Part. + Code uniti (es. S023763151)
DUE EFFE: M0... / TEC-TEL-TEB... / S0000... o B0000...

Parla italiano. Diretto. Preciso. Mai inventare codici.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, apiKey } = req.body;
    if (!apiKey) return res.status(401).json({ error: 'API key mancante' });
    if (!messages || messages.length === 0) return res.status(400).json({ error: 'Messaggi mancanti' });

    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const queryText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content
      : lastUserMsg?.content?.find(c => c.type === 'text')?.text || '';

    const contesto = cercaContesto(queryText);

    const messagesConContesto = messages.map((msg, idx) => {
      if (idx === 0 && msg.role === 'user') {
        const testo = typeof msg.content === 'string'
          ? msg.content
          : msg.content?.find(c => c.type === 'text')?.text || '';
        const testoCompleto = `${contesto}\n\n=== RICHIESTA ===\n${testo}`;
        if (typeof msg.content === 'string') {
          return { ...msg, content: testoCompleto };
        } else {
          return { ...msg, content: msg.content.map(c => c.type === 'text' ? { ...c, text: testoCompleto } : c) };
        }
      }
      return msg;
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: messagesConContesto
      })
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
