import { normalize } from "./countries.js";

const POINTS_UNIQUE = 10;
const POINTS_SHARED = 5;
const POINTS_INVALID = 0;

/**
 * @param {object} answers { playerId: { categoria: resposta } }
 * @param {object} validation { "playerId::categoria": true/false }
 * @param {string[]} categories
 * @returns {{ roundScores: {playerId:number}, breakdown: {playerId:{categoria:{points,status}}} }}
 */
export function computeScores(answers, validation, categories, playerIds) {
  const roundScores = {};
  const breakdown = {};
  playerIds.forEach((pid) => { roundScores[pid] = 0; breakdown[pid] = {}; });

  for (const category of categories) {
    // Agrupa respostas válidas normalizadas nesta categoria
    const normalizedByPlayer = {};
    for (const pid of playerIds) {
      const answer = (answers[pid] && answers[pid][category]) || "";
      const isValid = !!validation[`${pid}::${category}`];
      if (isValid && answer.trim()) {
        normalizedByPlayer[pid] = normalize(answer);
      }
    }

    const countByAnswer = {};
    Object.values(normalizedByPlayer).forEach((a) => {
      countByAnswer[a] = (countByAnswer[a] || 0) + 1;
    });

    for (const pid of playerIds) {
      const answerRaw = (answers[pid] && answers[pid][category]) || "";
      const isValid = !!validation[`${pid}::${category}`];
      let points = POINTS_INVALID;
      let status = "invalida";

      if (isValid && answerRaw.trim()) {
        const norm = normalizedByPlayer[pid];
        if (countByAnswer[norm] > 1) {
          points = POINTS_SHARED;
          status = "repetida";
        } else {
          points = POINTS_UNIQUE;
          status = "unica";
        }
      }

      roundScores[pid] += points;
      breakdown[pid][category] = { points, status, answer: answerRaw };
    }
  }

  return { roundScores, breakdown };
}
