// Monta a fila de categorias (uma por rodada), sorteada a partir das
// categorias escolhidas pelos jogadores.
//
// - allowRepeat = true  -> sorteia livremente para todas as rodadas pedidas,
//                          evitando repetir a mesma categoria em rodadas
//                          consecutivas sempre que possível.
// - allowRepeat = false -> cada categoria aparece no máximo uma vez; se não
//                          houver categorias suficientes para o número de
//                          rodadas pedido, o número de rodadas é reduzido.

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildCategoryQueue(categories, totalRounds, allowRepeat) {
  if (!categories || categories.length === 0) {
    return { queue: [], adjustedTotalRounds: 0 };
  }

  if (!allowRepeat) {
    const adjustedTotalRounds = Math.min(totalRounds, categories.length);
    const queue = shuffle(categories).slice(0, adjustedTotalRounds);
    return { queue, adjustedTotalRounds };
  }

  // allowRepeat = true: preenche `totalRounds` posições, embaralhando em
  // "ciclos" pelas categorias disponíveis para distribuir bem antes de
  // repetir, e evitando repetir a mesma categoria duas vezes seguidas
  // quando há mais de uma opção.
  const queue = [];
  let cycle = shuffle(categories);
  let cursor = 0;

  while (queue.length < totalRounds) {
    if (cursor >= cycle.length) {
      cycle = shuffle(categories);
      cursor = 0;
    }
    let next = cycle[cursor];
    if (categories.length > 1 && queue[queue.length - 1] === next) {
      // troca com a próxima do ciclo pra não repetir seguido
      const swapIdx = cursor + 1 < cycle.length ? cursor + 1 : 0;
      [cycle[cursor], cycle[swapIdx]] = [cycle[swapIdx], cycle[cursor]];
      next = cycle[cursor];
    }
    queue.push(next);
    cursor++;
  }

  return { queue, adjustedTotalRounds: totalRounds };
}
