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
 * que usa lista fechada local. Retorna { "playerId::categoria": true/false }.
 */
export async function validateBatch(letter, itemsToCheck) {
  const result = {};
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

  if (needsAI.length === 0) return result;

  const apiKey = getSavedGeminiKey();
  if (!apiKey) {
    // Sem chave configurada: aceita respostas bem formadas (começam com a letra certa)
    // e sinaliza pra revisão manual do host.
    for (const item of needsAI) result[`${item.playerId}::${item.category}`] = true;
    return result;
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
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    parsed.forEach((entry, idx) => {
      const item = needsAI[idx];
      result[`${item.playerId}::${item.category}`] = !!entry.valido;
    });
  } catch (err) {
    console.error("Erro validando com IA:", err);
    for (const item of needsAI) result[`${item.playerId}::${item.category}`] = true;
  }

  return result;
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
