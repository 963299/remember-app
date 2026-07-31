import { isValidCountry } from "./countries.js";

const GEMINI_KEY_STORAGE = "remember_gemini_api_key";

export function getSavedGeminiKey() {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || "";
}

export function saveGeminiKey(key) {
  localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
}

/**
 * Valida um lote de respostas usando a IA (Gemini), exceto a categoria "País"
 * que usa lista fechada local.
 *
 * Retorna { validation, needsReview }:
 *  - validation: { "playerId::categoria": true/false }
 *  - needsReview: array de chaves "playerId::categoria" que NÃO foram checadas
 *    de verdade pela IA (sem chave configurada, ou a chamada falhou) e por isso
 *    precisam de revisão manual do host antes do placar valer.
 *
 * IMPORTANTE: por segurança, qualquer item que não pôde ser validado de verdade
 * entra como false (inválido) e vai pra needsReview — nunca aceitamos automaticamente
 * só porque a palavra começa com a letra certa.
 */
export async function validateBatch(letter, itemsToCheck) {
  const result = {};
  const needsReview = [];
  const needsAI = [];

  for (const item of itemsToCheck) {
    const { playerId, category, answer } = item;
    const key = `${playerId}::${category}`;
    const trimmed = (answer || "").trim();

    if (!trimmed) { result[key] = false; continue; }
    if (trimmed[0].toUpperCase() !== letter) { result[key] = false; continue; }

    if (category.toLowerCase() === "país" || category.toLowerCase() === "pais") {
      result[key] = isValidCountry(trimmed);
    } else {
      needsAI.push(item);
    }
  }

  if (needsAI.length === 0) return { validation: result, needsReview };

  const apiKey = getSavedGeminiKey();
  if (!apiKey) {
    // Sem chave configurada: NÃO aceita automaticamente. Marca como inválido
    // e sinaliza pro host revisar manualmente na tela de placar.
    for (const item of needsAI) {
      const key = `${item.playerId}::${item.category}`;
      result[key] = false;
      needsReview.push(key);
    }
    return { validation: result, needsReview };
  }

  const prompt = buildPrompt(letter, needsAI);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );
    if (!response.ok) throw new Error(`Gemini respondeu ${response.status}`);
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());

    // Casa pelo campo "indice" retornado pela IA, não pela posição no array —
    // se a IA pular ou reordenar um item, a atribuição não desalinha.
    const byIndex = {};
    parsed.forEach((entry) => { byIndex[entry.indice] = entry; });

    needsAI.forEach((item, idx) => {
      const key = `${item.playerId}::${item.category}`;
      const entry = byIndex[idx];
      if (entry) {
        result[key] = !!entry.valido;
      } else {
        // IA não devolveu esse item: não assume nada, manda pra revisão.
        result[key] = false;
        needsReview.push(key);
      }
    });
  } catch (err) {
    console.error("Erro validando com IA:", err);
    for (const item of needsAI) {
      const key = `${item.playerId}::${item.category}`;
      result[key] = false;
      needsReview.push(key);
    }
  }

  return { validation: result, needsReview };
}

function buildPrompt(letter, items) {
  const list = items.map((it, i) =>
    `${i}. Categoria: "${it.category}" | Resposta: "${it.answer}"`
  ).join("\n");

  return `Você está avaliando respostas de um jogo estilo "Stop/Adedanha" em português do Brasil.
A letra sorteada da rodada é "${letter}".
Para cada item abaixo, diga se a resposta é válida: precisa (a) existir de fato / ser uma palavra real do idioma português ou nome próprio real da categoria, (b) começar com a letra "${letter}", e (c) pertencer de fato à categoria indicada.
Responda APENAS um array JSON, sem texto adicional, no formato:
[{"indice":0,"valido":true},{"indice":1,"valido":false}, ...]

Itens:
${list}`;
}
