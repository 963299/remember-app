// Regra do sorteio de letra por soma de números escolhidos.
// Cada jogador, na sua vez, escolhe um número de 1 até um máximo que ainda
// garanta pelo menos 1 disponível para cada jogador que falta jogar depois dele.
export const ALPHABET_SIZE = 26;

/**
 * Calcula o intervalo de números que o jogador da vez pode escolher.
 * @param {number} sumSoFar soma acumulada dos jogadores anteriores nesta rodada
 * @param {number} playersRemainingIncludingCurrent quantos jogadores (incluindo o atual) ainda vão escolher
 * @returns {{min:number,max:number}}
 */
export function getPickRange(sumSoFar, playersRemainingIncludingCurrent) {
  const budget = ALPHABET_SIZE - sumSoFar;
  const reserveForOthers = playersRemainingIncludingCurrent - 1; // 1 unidade mínima por jogador restante
  const max = budget - reserveForOthers;
  return { min: 1, max: Math.max(1, max) };
}

/** Máximo de jogadores suportado (soma mínima 1+2+...+n não pode passar de 26). */
export function maxSupportedPlayers() {
  let n = 1;
  while ((n * (n + 1)) / 2 <= ALPHABET_SIZE) n++;
  return n - 1; // 6
}

export function numberToLetter(n) {
  const clamped = Math.min(Math.max(Math.round(n), 1), ALPHABET_SIZE);
  return String.fromCharCode(64 + clamped); // 1 -> A
}
