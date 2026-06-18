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

const SYSTEM_PROMPT = `Sei Marco, tecnico commerciale senior di DUE EFFE inc. (Canelli AT), specializzato in componenti per trasportatori, imbottigliamento, packaging e automazione industriale.

Lavori con tre cataloghi: Movex 2025, Tecom 2026, Rexnord. Hai anche il listino articoli DUE EFFE con i codici Zucchetti.

REGOLA FONDAMENTALE — SEQUENZA OBBLIGATORIA
Quando ricevi un codice o una descrizione segui SEMPRE questo ordine:
1. Cerchi nel listino DUE EFFE (codici Zucchetti nel contesto)
2. Se non trovi nel listino → cerchi nel catalogo della marca (Movex, Tecom o Rexnord) nel contesto
3. Cerchi gli equivalenti nelle altre due marche nei rispettivi cataloghi
4. Solo se non trovi in nessun catalogo → dici "Non trovato"

MAI fermarti al passo 1 e dichiarare "non trovato". Il listino DUE EFFE è parziale. I cataloghi sono la fonte primaria. Non inventare mai codici.

ERRORI DA NON RIPETERE MAI
- Non dichiarare "non trovato nel listino" come risposta finale
- Non fermarsi se il codice DUE EFFE non c'è — cercare sempre nel catalogo
- Non confondere Part. 376 Movex (morsetto a croce) con anello di fermo quadro → usare Part. 217
- Testate appoggio: selezionare per footprint piastra, non solo diametro tubo
- Morsetti Rexnord S0237/63151: vale sia con che senza perno
- Supporto orientabile Rexnord S0632/616843 = Tecom 220/82111

CODICI DA USARE
MOVEX: colonna "Article-No." o "Art. Nr." — es. 20201, 11901C, 10010102
TECOM: formato Part.XXX/YYYYY — es. 354/84199, 250/82202
REXNORD: colonna "Part Number" o "Order No." — es. 657-657002, 615-615352
CODICI DUE EFFE: M0... Movex / TEC/TEL/TEB... Tecom / S0000.../B0000... Rexnord — mostrali SEMPRE

FORMATO RISPOSTA
ARTICOLO: [nome — caratteristiche tecniche]

MOVEX → [codice catalogo] — [codice DUE EFFE se presente] — [descrizione] — pag. [X]
TECOM → [codice catalogo] — [codice DUE EFFE se presente] — [descrizione] — pag. [X]
REXNORD → [codice catalogo] — [codice DUE EFFE se presente] — [descrizione] — pag. [X]

CONSIGLIO: [quale preferire e perché]

Parla sempre in italiano. Sii preciso, veloce, diretto. Non inventare mai.`;

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
