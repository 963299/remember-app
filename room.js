import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, set, get, update, onValue, onDisconnect,
  runTransaction, push, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { maxSupportedPlayers } from "./picking-logic.js";

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

export function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I pra evitar confusão
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function generatePlayerId() {
  return "p_" + Math.random().toString(36).slice(2, 10);
}

export const MAX_PLAYERS = maxSupportedPlayers(); // 6

export async function createRoom({ name, color, colorVisible }) {
  const roomCode = generateRoomCode();
  const playerId = generatePlayerId();
  const roomRef = ref(db, `rooms/${roomCode}`);

  await set(roomRef, {
    hostId: playerId,
    status: "lobby",
    createdAt: serverTimestamp(),
    settings: {
      categories: ["País", "Animal", "Objeto", "Nome", "Fruta"],
      timerMode: "none", // "none" | "timed"
      timerSeconds: 60
    },
    players: {
      [playerId]: {
        name, color, colorVisible: !!colorVisible,
        score: 0, connected: true, joinedAt: serverTimestamp()
      }
    }
  });

  onDisconnect(ref(db, `rooms/${roomCode}/players/${playerId}/connected`)).set(false);
  return { roomCode, playerId };
}

export async function joinRoom(roomCode, { name, color, colorVisible }) {
  const code = roomCode.trim().toUpperCase();
  const roomRef = ref(db, `rooms/${code}`);
  const snap = await get(roomRef);
  if (!snap.exists()) throw new Error("Sala não encontrada. Confira o código.");

  const room = snap.val();
  const currentPlayers = room.players ? Object.keys(room.players).length : 0;
  if (currentPlayers >= MAX_PLAYERS) throw new Error(`Sala cheia (máximo ${MAX_PLAYERS} jogadores).`);
  if (room.status !== "lobby") throw new Error("Essa sala já começou a partida.");

  const playerId = generatePlayerId();
  await set(ref(db, `rooms/${code}/players/${playerId}`), {
    name, color, colorVisible: !!colorVisible,
    score: 0, connected: true, joinedAt: serverTimestamp()
  });

  onDisconnect(ref(db, `rooms/${code}/players/${playerId}/connected`)).set(false);
  return { roomCode: code, playerId };
}

export async function getRoom(roomCode) {
  const snap = await get(ref(db, `rooms/${roomCode}`));
  return snap.val();
}

export function listenRoom(roomCode, callback) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  return onValue(roomRef, (snap) => callback(snap.val()));
}

export async function updateSettings(roomCode, settings) {
  await update(ref(db, `rooms/${roomCode}/settings`), settings);
}

export async function leaveRoom(roomCode, playerId) {
  await update(ref(db, `rooms/${roomCode}/players/${playerId}`), { connected: false });
}

/** Sorteia a ordem dos jogadores e inicia a fase de escolha de números. */
export async function startPickingPhase(roomCode, playerIds, roundNumber = 1) {
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
  await update(ref(db, `rooms/${roomCode}`), {
    status: "picking",
    round: {
      roundNumber,
      turnOrder: shuffled,
      currentTurnIndex: 0,
      picks: {},
      sumSoFar: 0,
      letter: null
    }
  });
}

/** Registra a escolha de número do jogador da vez, avança o turno via transação segura.
 * Retorna { wasLastPick, round } pra quem chamou saber se foi a última escolha da rodada. */
export async function submitNumberPick(roomCode, playerId, value) {
  const roundRef = ref(db, `rooms/${roomCode}/round`);
  const { committed, snapshot } = await runTransaction(roundRef, (round) => {
    if (!round) return round;
    const turnPlayer = round.turnOrder[round.currentTurnIndex];
    if (turnPlayer !== playerId) return round; // não é a vez dele, ignora
    if (!round.picks) round.picks = {};
    round.picks[playerId] = value;
    round.sumSoFar = (round.sumSoFar || 0) + value;
    round.currentTurnIndex += 1;
    if (round.currentTurnIndex >= round.turnOrder.length) {
      round.letter = round.sumSoFar; // número final, letra calculada na UI
    }
    return round;
  });
  const round = snapshot.val();
  const wasLastPick = committed && round.currentTurnIndex >= round.turnOrder.length &&
    round.turnOrder[round.turnOrder.length - 1] === playerId;
  return { wasLastPick, round };
}

export async function setStatus(roomCode, status) {
  await update(ref(db, `rooms/${roomCode}`), { status });
}

export async function startAnsweringPhase(roomCode) {
  const roomSnap = await get(ref(db, `rooms/${roomCode}`));
  const settings = roomSnap.val().settings;
  const updates = { status: "answering" };
  if (settings.timerMode === "timed") {
    updates["round/timerEndsAt"] = Date.now() + settings.timerSeconds * 1000;
  }
  updates["round/answers"] = {};
  updates["round/stopCalledBy"] = null;
  await update(ref(db, `rooms/${roomCode}`), updates);
}

export async function submitAnswers(roomCode, playerId, answers) {
  await update(ref(db, `rooms/${roomCode}/round/answers/${playerId}`), answers);
}

export async function callStop(roomCode, playerId) {
  await update(ref(db, `rooms/${roomCode}/round`), { stopCalledBy: playerId, status: "reviewing" });
  await update(ref(db, `rooms/${roomCode}`), { status: "reviewing" });
}

export async function saveRoundResults(roomCode, validation, roundScores, updatedTotals) {
  const updates = {
    "round/validation": validation,
    "round/roundScores": roundScores,
    status: "scoreboard"
  };
  for (const [pid, total] of Object.entries(updatedTotals)) {
    updates[`players/${pid}/score`] = total;
  }
  await update(ref(db, `rooms/${roomCode}`), updates);
}

export async function nextRound(roomCode, playerIds, nextRoundNumber) {
  await startPickingPhase(roomCode, playerIds, nextRoundNumber);
}

export async function finishGame(roomCode) {
  await update(ref(db, `rooms/${roomCode}`), { status: "finished" });
}

/** Zera placares e volta pra sala de espera, mantendo os mesmos jogadores. */
export async function restartGame(roomCode, playerIds) {
  const updates = { status: "lobby", round: null };
  playerIds.forEach((pid) => { updates[`players/${pid}/score`] = 0; });
  await update(ref(db, `rooms/${roomCode}`), updates);
}
