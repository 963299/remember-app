import {
  createRoom, joinRoom, listenRoom, getRoom, updateSettings, startPickingPhase,
  submitNumberPick, startAnsweringPhase, submitAnswers, callStop,
  saveRoundResults, nextRound, setStatus, MAX_PLAYERS
} from "./room.js";
import { getPickRange, numberToLetter } from "./picking-logic.js";
import { validateBatch, getSavedGeminiKey, saveGeminiKey } from "./ai-validate.js";
import { computeScores } from "./scoring.js";

const COLORS = [
  "#f76e6e", "#f7a86e", "#f7d76e", "#a8e05f", "#34d399", "#4fd8e8",
  "#5fb0f7", "#7c8cf7", "#a78bfa", "#e06ef7", "#f76ea8", "#c0c4d6"
];

let state = {
  roomCode: null,
  playerId: null,
  isHost: false,
  mode: null, // "create" | "join"
  selectedColor: null,
  lastStatus: null,
  submittedThisRound: false,
  hostProcessingRound: false,
  timerInterval: null
};

// ---------- Navegação ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

// ---------- Home / Setup ----------
document.getElementById("btn-go-create").onclick = () => {
  state.mode = "create";
  document.getElementById("setup-title").textContent = "Criar sala";
  document.getElementById("join-code-field").classList.add("hidden");
  showScreen("screen-setup");
};

document.getElementById("btn-go-join").onclick = () => {
  state.mode = "join";
  document.getElementById("setup-title").textContent = "Entrar em sala";
  document.getElementById("join-code-field").classList.remove("hidden");
  showScreen("screen-setup");
};

document.querySelectorAll("[data-back]").forEach((btn) => {
  btn.onclick = () => showScreen(btn.dataset.back);
});

const colorGrid = document.getElementById("color-grid");
COLORS.forEach((hex) => {
  const swatch = document.createElement("div");
  swatch.className = "color-swatch";
  swatch.style.background = hex;
  swatch.onclick = () => {
    document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
    swatch.classList.add("selected");
    state.selectedColor = hex;
  };
  colorGrid.appendChild(swatch);
});

document.getElementById("btn-confirm-setup").onclick = async () => {
  const name = document.getElementById("input-name").value.trim();
  const colorVisible = document.getElementById("input-color-visible").checked;

  if (!name) return toast("Digite seu nome.");
  if (!state.selectedColor) return toast("Escolha uma cor.");

  try {
    if (state.mode === "create") {
      const { roomCode, playerId } = await createRoom({ name, color: state.selectedColor, colorVisible });
      enterRoom(roomCode, playerId, true);
    } else {
      const code = document.getElementById("input-room-code").value.trim();
      if (!code) return toast("Digite o código da sala.");
      const { roomCode, playerId } = await joinRoom(code, { name, color: state.selectedColor, colorVisible });
      enterRoom(roomCode, playerId, false);
    }
  } catch (err) {
    toast(err.message);
  }
};

function enterRoom(roomCode, playerId, isHost) {
  state.roomCode = roomCode;
  state.playerId = playerId;
  state.isHost = isHost;
  localStorage.setItem("remember_session", JSON.stringify({ roomCode, playerId }));
  listenRoom(roomCode, onRoomUpdate);
}

// ---------- Reconexão automática ----------
(function tryResume() {
  const saved = localStorage.getItem("remember_session");
  if (!saved) return;
  try {
    const { roomCode, playerId } = JSON.parse(saved);
    listenRoom(roomCode, (room) => {
      if (!room || !room.players || !room.players[playerId]) {
        localStorage.removeItem("remember_session");
        return;
      }
      state.roomCode = roomCode;
      state.playerId = playerId;
      state.isHost = room.hostId === playerId;
      onRoomUpdate(room);
    });
  } catch { localStorage.removeItem("remember_session"); }
})();

// ---------- Render central baseado no status da sala ----------
function onRoomUpdate(room) {
  if (!room) return;
  const statusChanged = state.lastStatus !== room.status;
  if (statusChanged) state.submittedThisRound = false;
  state.lastStatus = room.status;

  switch (room.status) {
    case "lobby": renderLobby(room); break;
    case "picking": renderPicking(room); break;
    case "reveal": renderReveal(room); break;
    case "answering": renderAnswering(room); break;
    case "reviewing": renderReviewing(room); break;
    case "scoreboard": renderScoreboard(room); break;
  }
}

// ---------- LOBBY ----------
function renderLobby(room) {
  showScreen("screen-lobby");
  document.getElementById("lobby-room-code").textContent = state.roomCode;

  const list = document.getElementById("lobby-players");
  list.innerHTML = "";
  Object.entries(room.players || {}).forEach(([pid, p]) => {
    const li = document.createElement("li");
    const showColor = p.colorVisible || pid === state.playerId;
    li.innerHTML = `<span class="player-dot ${showColor ? "" : "hidden-color"}" style="background:${showColor ? p.color : ""}"></span>
      <span class="player-name">${p.name}${pid === room.hostId ? " (host)" : ""}${p.connected === false ? " — offline" : ""}</span>`;
    list.appendChild(li);
  });

  const hostPanel = document.getElementById("host-settings");
  const waitMsg = document.getElementById("lobby-waiting-msg");
  if (state.isHost) {
    hostPanel.classList.remove("hidden");
    waitMsg.classList.add("hidden");
  } else {
    hostPanel.classList.add("hidden");
    waitMsg.classList.remove("hidden");
  }
}

document.getElementById("input-timer-mode").onchange = (e) => {
  document.getElementById("timer-seconds-field").classList.toggle("hidden", e.target.value !== "timed");
};

document.getElementById("btn-start-game").onclick = async () => {
  const categories = document.getElementById("input-categories").value
    .split(",").map((c) => c.trim()).filter(Boolean);
  if (categories.length === 0) return toast("Defina ao menos uma categoria.");

  const timerMode = document.getElementById("input-timer-mode").value;
  const timerSeconds = parseInt(document.getElementById("input-timer-seconds").value, 10) || 60;

  await updateSettings(state.roomCode, { categories, timerMode, timerSeconds });

  const roomSnap = await getRoom(state.roomCode);
  const playerIds = Object.keys(roomSnap.players || {});
  if (playerIds.length < 2) return toast("Precisa de pelo menos 2 jogadores.");
  if (playerIds.length > MAX_PLAYERS) return toast(`Máximo de ${MAX_PLAYERS} jogadores.`);

  await startPickingPhase(state.roomCode, playerIds);
};

// ---------- PICKING ----------
function renderPicking(room) {
  showScreen("screen-picking");
  const round = room.round;
  document.getElementById("picking-sum").textContent = round.sumSoFar || 0;

  const orderList = document.getElementById("picking-order");
  orderList.innerHTML = "";
  round.turnOrder.forEach((pid, idx) => {
    const li = document.createElement("li");
    const done = idx < round.currentTurnIndex;
    const isCurrent = idx === round.currentTurnIndex;
    li.className = done ? "done" : (isCurrent ? "current-turn" : "");
    const p = room.players[pid];
    const pickVal = round.picks && round.picks[pid] != null ? round.picks[pid] : "";
    li.innerHTML = `<span>${p ? p.name : "?"}</span><span>${pickVal}</span>`;
    orderList.appendChild(li);
  });

  const currentPid = round.turnOrder[round.currentTurnIndex];
  const myTurn = currentPid === state.playerId;

  document.getElementById("picking-my-turn").classList.toggle("hidden", !myTurn);
  document.getElementById("picking-wait-msg").classList.toggle("hidden", myTurn);

  if (myTurn) {
    const playersRemaining = round.turnOrder.length - round.currentTurnIndex;
    const { min, max } = getPickRange(round.sumSoFar || 0, playersRemaining);
    document.getElementById("picking-min").textContent = min;
    document.getElementById("picking-max").textContent = max;
    const input = document.getElementById("input-pick-number");
    input.min = min; input.max = max; input.value = "";
  } else {
    document.getElementById("picking-current-name").textContent =
      room.players[currentPid] ? room.players[currentPid].name : "";
  }
}

document.getElementById("btn-confirm-pick").onclick = async () => {
  const input = document.getElementById("input-pick-number");
  const value = parseInt(input.value, 10);
  const min = parseInt(input.min, 10), max = parseInt(input.max, 10);
  if (!value || value < min || value > max) return toast(`Escolha um número entre ${min} e ${max}.`);

  const { wasLastPick } = await submitNumberPick(state.roomCode, state.playerId, value);
  if (wasLastPick) {
    await setStatus(state.roomCode, "reveal");
    setTimeout(() => startAnsweringPhase(state.roomCode), 2400);
  }
};

// ---------- REVEAL ----------
function renderReveal(room) {
  showScreen("screen-reveal");
  document.getElementById("reveal-letter").textContent = numberToLetter(room.round.letter);
}

// ---------- ANSWERING ----------
function renderAnswering(room) {
  showScreen("screen-answering");
  const letter = numberToLetter(room.round.letter);
  document.getElementById("answering-letter").textContent = letter;
  document.getElementById("answering-status").textContent = "";

  const fieldsWrap = document.getElementById("answer-fields");
  if (fieldsWrap.dataset.builtFor !== room.round.letter + "") {
    fieldsWrap.innerHTML = "";
    room.settings.categories.forEach((cat) => {
      const label = document.createElement("label");
      label.className = "field";
      label.innerHTML = `<span>${cat}</span><input type="text" data-category="${cat}" placeholder="${letter}...">`;
      fieldsWrap.appendChild(label);
    });
    fieldsWrap.dataset.builtFor = room.round.letter + "";
  }

  const stopBtn = document.getElementById("btn-call-stop");
  stopBtn.classList.toggle("hidden", room.settings.timerMode !== "none");
  stopBtn.onclick = async () => { await callStop(state.roomCode, state.playerId); };

  const timerEl = document.getElementById("timer-display");
  clearInterval(state.timerInterval);
  if (room.settings.timerMode === "timed" && room.round.timerEndsAt) {
    timerEl.classList.remove("hidden");
    const tick = () => {
      const remaining = Math.max(0, Math.round((room.round.timerEndsAt - Date.now()) / 1000));
      timerEl.textContent = `${remaining}s`;
      timerEl.classList.toggle("low", remaining <= 10);
      if (remaining <= 0) {
        clearInterval(state.timerInterval);
        if (state.isHost) finishAnsweringDueToTimeout(room);
      }
    };
    tick();
    state.timerInterval = setInterval(tick, 500);
  } else {
    timerEl.classList.add("hidden");
  }
}

async function finishAnsweringDueToTimeout(room) {
  if (room.status !== "answering") return;
  await setStatus(state.roomCode, "reviewing");
}

document.getElementById("btn-submit-answers").onclick = async () => {
  await collectAndSubmitAnswers();
  toast("Respostas enviadas! Aguardando os outros jogadores...");
  document.getElementById("btn-submit-answers").disabled = true;
};

async function collectAndSubmitAnswers() {
  if (state.submittedThisRound) return;
  const answers = {};
  document.querySelectorAll("#answer-fields input").forEach((input) => {
    answers[input.dataset.category] = input.value.trim();
  });
  await submitAnswers(state.roomCode, state.playerId, answers);
  state.submittedThisRound = true;
}

// ---------- REVIEWING ----------
async function renderReviewing(room) {
  showScreen("screen-reviewing");
  await collectAndSubmitAnswers(); // garante que quem ainda não enviou, envie o que digitou até agora
  document.getElementById("btn-submit-answers").disabled = false;

  if (!state.isHost || state.hostProcessingRound) return;
  state.hostProcessingRound = true;

  // Pequeno atraso pra garantir que todos os clientes já gravaram suas respostas
  setTimeout(() => processRoundAsHost(room), 1200);
}

async function processRoundAsHost() {
  try {
    // Relê o estado mais atual da sala antes de processar
    const roomNow = await getRoom(state.roomCode);
    const round = roomNow.round;
    const categories = roomNow.settings.categories;
    const playerIds = Object.keys(roomNow.players);
    const letter = numberToLetter(round.letter);
    const answers = round.answers || {};

    const itemsToCheck = [];
    playerIds.forEach((pid) => {
      categories.forEach((cat) => {
        itemsToCheck.push({ playerId: pid, category: cat, answer: (answers[pid] && answers[pid][cat]) || "" });
      });
    });

    const validation = await validateBatch(letter, itemsToCheck);
    const { roundScores } = computeScores(answers, validation, categories, playerIds);

    const updatedTotals = {};
    playerIds.forEach((pid) => {
      updatedTotals[pid] = (roomNow.players[pid].score || 0) + roundScores[pid];
    });

    await saveRoundResults(state.roomCode, validation, roundScores, updatedTotals);
  } catch (err) {
    console.error(err);
    toast("Erro ao validar respostas: " + err.message);
  } finally {
    state.hostProcessingRound = false;
  }
}

// ---------- SCOREBOARD ----------
function renderScoreboard(room) {
  showScreen("screen-scoreboard");
  const letter = numberToLetter(room.round.letter);
  document.getElementById("scoreboard-letter").textContent = letter;

  const details = document.getElementById("scoreboard-details");
  details.innerHTML = "";
  const categories = room.settings.categories;
  const answers = room.round.answers || {};
  const validation = room.round.validation || {};

  Object.entries(room.players).forEach(([pid, p]) => {
    const card = document.createElement("div");
    card.className = "card";
    let rows = `<h3 class="card-subtitle">${p.name} — +${room.round.roundScores?.[pid] ?? 0} pts</h3>`;
    categories.forEach((cat) => {
      const answer = (answers[pid] && answers[pid][cat]) || "(em branco)";
      const isValid = !!validation[`${pid}::${cat}`];
      const statusClass = !answer || answer === "(em branco)" || !isValid ? "pts-invalida" : "pts-unica";
      rows += `<div class="score-row"><span>${cat}</span><span class="${statusClass}">${answer}</span></div>`;
    });
    card.innerHTML = rows;
    details.appendChild(card);
  });

  const totalList = document.getElementById("scoreboard-total");
  totalList.innerHTML = "";
  Object.entries(room.players)
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
    .forEach(([pid, p]) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="player-dot" style="background:${p.color}"></span>
        <span class="player-name">${p.name}</span><span class="player-score">${p.score || 0}</span>`;
      totalList.appendChild(li);
    });

  document.getElementById("btn-next-round").classList.toggle("hidden", !state.isHost);
  document.getElementById("scoreboard-wait-msg").classList.toggle("hidden", state.isHost);
}

document.getElementById("btn-next-round").onclick = async () => {
  const roomNow = await getRoom(state.roomCode);
  const playerIds = Object.keys(roomNow.players);
  await nextRound(state.roomCode, playerIds);
};

// ---------- Chave Gemini ----------
document.getElementById("gemini-key-link").onclick = () => {
  document.getElementById("input-gemini-key").value = getSavedGeminiKey();
  document.getElementById("modal-gemini").classList.remove("hidden");
};
document.getElementById("btn-close-gemini").onclick = () => document.getElementById("modal-gemini").classList.add("hidden");
document.getElementById("btn-save-gemini-key").onclick = () => {
  saveGeminiKey(document.getElementById("input-gemini-key").value);
  toast("Chave salva neste aparelho.");
  document.getElementById("modal-gemini").classList.add("hidden");
};
