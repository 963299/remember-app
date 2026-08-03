import {
  createRoom, joinRoom, listenRoom, getRoom, updateSettings, startPickingPhase,
  submitNumberPick, startAnsweringPhase, submitAnswers, callStop,
  saveRoundResults, nextRound, setStatus, finishGame, forfeitGame,
  restartGame, restartWithSameCategories, MAX_PLAYERS,
  getDeviceId, getPaywallStatus, incrementGamesCreated, redeemUnlockCode, FREE_GAMES_LIMIT
} from "./room.js";
import { getPickRange, numberToLetter } from "./picking-logic.js";
import { validateBatch, getSavedGeminiKey, saveGeminiKey } from "./ai-validate.js";
import { computeScores } from "./scoring.js";
import { buildCategoryQueue } from "./category-queue.js";

const PRESET_CATEGORIES = [
  "País", "Animal", "Cor", "Nome", "Objeto", "Fruta",
  "Profissão", "Comida", "Cidade", "Parte do corpo", "Esporte", "Marca"
];

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
  selectedPhoto: null,
  lastStatus: null,
  submittedThisRound: false,
  hostProcessingRound: false,
  timerInterval: null
};

// ---------- Navegação ----------
const IN_PROGRESS_SCREENS = ["screen-picking", "screen-reveal", "screen-answering", "screen-reviewing", "screen-scoreboard"];

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.getElementById("btn-global-leave").classList.toggle("hidden", id === "screen-home" || id === "screen-setup" || id === "screen-paywall");
  document.getElementById("btn-forfeit").classList.toggle("hidden", !IN_PROGRESS_SCREENS.includes(id));
}

document.getElementById("btn-global-leave").onclick = () => {
  if (!confirm("Sair dessa sala e voltar pra tela inicial?")) return;
  clearInterval(state.timerInterval);
  localStorage.removeItem("remember_session");
  location.href = location.pathname; // recarrega limpo, sem parâmetros antigos
};

document.getElementById("btn-forfeit").onclick = async () => {
  if (!confirm("Isso encerra a partida agora e dá a vitória por W.O. pros outros jogadores. Abandonar mesmo?")) return;
  await forfeitGame(state.roomCode, state.playerId);
};

/** Renderiza a foto de perfil (se houver e for visível) ou a bolinha de cor. */
function avatarHtml(pid, p) {
  const isSelf = pid === state.playerId;
  const showIdentity = p.colorVisible || isSelf;
  if (p.photo && showIdentity) {
    return `<img class="player-avatar" src="${p.photo}" alt="">`;
  }
  if (!showIdentity) {
    return `<span class="player-dot hidden-color"></span>`;
  }
  return `<span class="player-dot" style="background:${p.color}"></span>`;
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

// ---------- Home / Setup ----------
document.getElementById("btn-go-create").onclick = async () => {
  const deviceId = getDeviceId();
  let paywall;
  try {
    paywall = await getPaywallStatus(deviceId);
  } catch {
    paywall = { blocked: false }; // se der erro de rede, não trava o jogador
  }
  if (paywall.blocked) {
    document.getElementById("paywall-count").textContent = paywall.gamesCreated;
    showScreen("screen-paywall");
    return;
  }
  state.mode = "create";
  document.getElementById("setup-title").textContent = "Criar sala";
  document.getElementById("join-code-field").classList.add("hidden");
  resetAvatarPicker();
  showScreen("screen-setup");
};

document.getElementById("btn-redeem-code").onclick = async () => {
  const deviceId = getDeviceId();
  const codeInput = document.getElementById("input-unlock-code");
  try {
    await redeemUnlockCode(deviceId, codeInput.value);
    toast("Desbloqueado! Pode criar salas à vontade.");
    codeInput.value = "";
    showScreen("screen-home");
  } catch (err) {
    toast(err.message);
  }
};

document.getElementById("btn-go-join").onclick = () => {
  state.mode = "join";
  document.getElementById("setup-title").textContent = "Entrar em sala";
  document.getElementById("join-code-field").classList.remove("hidden");
  resetAvatarPicker();
  showScreen("screen-setup");
};

function resetAvatarPicker() {
  state.selectedPhoto = null;
  document.getElementById("input-avatar-file").value = "";
  document.getElementById("avatar-preview").classList.add("hidden");
  document.getElementById("btn-remove-avatar").classList.add("hidden");
}

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

const categoryMenu = document.getElementById("category-menu");
const DEFAULT_SELECTED = new Set(["País", "Animal", "Nome", "Objeto", "Fruta"]);
PRESET_CATEGORIES.forEach((cat) => {
  const chip = document.createElement("div");
  chip.className = "category-chip" + (DEFAULT_SELECTED.has(cat) ? " selected" : "");
  chip.textContent = cat;
  chip.onclick = () => chip.classList.toggle("selected");
  categoryMenu.appendChild(chip);
});

/** Lê o arquivo de imagem, recorta em quadrado centralizado e comprime pra caber no banco. */
function fileToSquareDataUrl(file, size = 160) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = () => reject(new Error("Não consegui abrir essa imagem."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Não consegui ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

document.getElementById("input-avatar-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await fileToSquareDataUrl(file);
    state.selectedPhoto = dataUrl;
    const preview = document.getElementById("avatar-preview");
    preview.src = dataUrl;
    preview.classList.remove("hidden");
    document.getElementById("btn-remove-avatar").classList.remove("hidden");
  } catch (err) {
    toast(err.message);
  }
};

document.getElementById("btn-remove-avatar").onclick = () => {
  resetAvatarPicker();
};

document.getElementById("btn-confirm-setup").onclick = async () => {
  const name = document.getElementById("input-name").value.trim();
  const colorVisible = document.getElementById("input-color-visible").checked;

  if (!name) return toast("Digite seu nome.");
  if (!state.selectedColor) return toast("Escolha uma cor.");

  try {
    if (state.mode === "create") {
      const { roomCode, playerId } = await createRoom({ name, color: state.selectedColor, colorVisible, photo: state.selectedPhoto });
      incrementGamesCreated(getDeviceId()).catch(() => {}); // não bloqueia o fluxo se falhar
      enterRoom(roomCode, playerId, true);
    } else {
      const code = document.getElementById("input-room-code").value.trim();
      if (!code) return toast("Digite o código da sala.");
      const { roomCode, playerId } = await joinRoom(code, { name, color: state.selectedColor, colorVisible, photo: state.selectedPhoto });
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
    case "finished": renderFinished(room); break;
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
    li.innerHTML = `${avatarHtml(pid, p)}
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
  const selectedChips = Array.from(document.querySelectorAll(".category-chip.selected")).map((c) => c.textContent);
  const extras = document.getElementById("input-extra-categories").value
    .split(",").map((c) => c.trim()).filter(Boolean);
  const categories = [...new Set([...selectedChips, ...extras])];
  if (categories.length === 0) return toast("Escolha ao menos uma categoria.");

  const timerMode = document.getElementById("input-timer-mode").value;
  const timerSeconds = parseInt(document.getElementById("input-timer-seconds").value, 10) || 60;
  const allowRepeat = document.getElementById("input-allow-repeat").checked;
  let totalRounds = parseInt(document.getElementById("input-total-rounds").value, 10) || 5;

  const { queue, adjustedTotalRounds } = buildCategoryQueue(categories, totalRounds, allowRepeat);
  if (adjustedTotalRounds !== totalRounds) {
    toast(`Sem repetição, só dá pra ter ${adjustedTotalRounds} rodada(s) com essas categorias.`);
    totalRounds = adjustedTotalRounds;
  }

  await updateSettings(state.roomCode, {
    categories, timerMode, timerSeconds, totalRounds, allowRepeat, categoryQueue: queue
  });

  const roomSnap = await getRoom(state.roomCode);
  const playerIds = Object.keys(roomSnap.players || {});
  if (playerIds.length < 2) return toast("Precisa de pelo menos 2 jogadores.");
  if (playerIds.length > MAX_PLAYERS) return toast(`Máximo de ${MAX_PLAYERS} jogadores.`);

  await startPickingPhase(state.roomCode, playerIds, 1, queue[0]);
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
  document.getElementById("reveal-category-name").textContent = room.round.category || "";
}

// ---------- ANSWERING ----------
function renderAnswering(room) {
  showScreen("screen-answering");
  const letter = numberToLetter(room.round.letter);
  const category = room.round.category || "";
  document.getElementById("answering-letter").textContent = letter;
  document.getElementById("answering-category-name").textContent = category;
  document.getElementById("answering-status").textContent = "";

  const fieldsWrap = document.getElementById("answer-fields");
  if (fieldsWrap.dataset.builtFor !== room.round.letter + ":" + category) {
    fieldsWrap.innerHTML = "";
    const label = document.createElement("label");
    label.className = "field";
    label.innerHTML = `<span>${category}</span><input type="text" data-category="${category}" placeholder="${letter}...">`;
    fieldsWrap.appendChild(label);
    fieldsWrap.dataset.builtFor = room.round.letter + ":" + category;
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
    const categories = [round.category];
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
  const category = room.round.category;
  document.getElementById("scoreboard-letter").textContent = `${letter} — ${category}`;

  const details = document.getElementById("scoreboard-details");
  details.innerHTML = "";
  const answers = room.round.answers || {};
  const validation = room.round.validation || {};

  Object.entries(room.players).forEach(([pid, p]) => {
    const card = document.createElement("div");
    card.className = "card";
    const answer = (answers[pid] && answers[pid][category]) || "(em branco)";
    const isValid = !!validation[`${pid}::${category}`];
    const statusClass = !answer || answer === "(em branco)" || !isValid ? "pts-invalida" : "pts-unica";
    card.innerHTML = `<h3 class="card-subtitle">${p.name} — +${room.round.roundScores?.[pid] ?? 0} pts</h3>
      <div class="score-row"><span>${category}</span><span class="${statusClass}">${answer}</span></div>`;
    details.appendChild(card);
  });

  const totalList = document.getElementById("scoreboard-total");
  totalList.innerHTML = "";
  Object.entries(room.players)
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
    .forEach(([pid, p]) => {
      const li = document.createElement("li");
      li.innerHTML = `${avatarHtml(pid, p)}
        <span class="player-name">${p.name}</span><span class="player-score">${p.score || 0}</span>`;
      totalList.appendChild(li);
    });

  const totalRounds = room.settings.totalRounds || 5;
  const isLastRound = (room.round.roundNumber || 1) >= totalRounds;
  const nextBtn = document.getElementById("btn-next-round");
  nextBtn.textContent = isLastRound ? "Ver resultado final" : "Próxima rodada";
  nextBtn.classList.toggle("hidden", !state.isHost);
  document.getElementById("scoreboard-wait-msg").classList.toggle("hidden", state.isHost);
}

document.getElementById("btn-next-round").onclick = async () => {
  const roomNow = await getRoom(state.roomCode);
  const playerIds = Object.keys(roomNow.players);
  const totalRounds = roomNow.settings.totalRounds || 5;
  const currentRoundNumber = roomNow.round.roundNumber || 1;

  if (currentRoundNumber >= totalRounds) {
    await finishGame(state.roomCode);
  } else {
    const nextCategory = roomNow.settings.categoryQueue[currentRoundNumber]; // índice = próxima rodada - 1
    await nextRound(state.roomCode, playerIds, currentRoundNumber + 1, nextCategory);
  }
};

// ---------- FIM DE JOGO ----------
function renderFinished(room) {
  showScreen("screen-finished");

  const forfeiterId = room.round && room.round.forfeitedBy;
  const banner = document.getElementById("finished-banner");
  if (forfeiterId) {
    const forfeiterName = room.players[forfeiterId] ? room.players[forfeiterId].name : "Um jogador";
    banner.textContent = `${forfeiterName} abandonou a partida — vitória por W.O. para os demais!`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }

  const ranking = document.getElementById("finished-ranking");
  ranking.innerHTML = "";
  let sorted = Object.entries(room.players).sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
  if (forfeiterId) {
    // Quem abandonou nunca aparece como vencedor, mesmo se tiver mais pontos.
    sorted = sorted.filter(([pid]) => pid !== forfeiterId).concat(sorted.filter(([pid]) => pid === forfeiterId));
  }
  sorted.forEach(([pid, p], idx) => {
    const li = document.createElement("li");
    const isWinner = idx === 0 && pid !== forfeiterId;
    const medal = isWinner ? "🏆 " : "";
    const label = pid === forfeiterId ? " (abandonou)" : "";
    li.innerHTML = `${avatarHtml(pid, p)}
      <span class="player-name">${medal}${p.name}${label}</span><span class="player-score">${p.score || 0}</span>`;
    ranking.appendChild(li);
  });
  document.getElementById("btn-play-again").classList.toggle("hidden", !state.isHost);
}

document.getElementById("btn-play-again").onclick = async () => {
  const roomNow = await getRoom(state.roomCode);
  const playerIds = Object.keys(roomNow.players);
  const keepCategories = confirm(
    "Manter as mesmas categorias desta partida?\n\nOK = manter (o app sorteia uma nova ordem)\nCancelar = escolher categorias novas na sala"
  );

  if (keepCategories) {
    const { categories, totalRounds, allowRepeat } = roomNow.settings;
    const { queue } = buildCategoryQueue(categories, totalRounds, allowRepeat);
    await restartWithSameCategories(state.roomCode, playerIds, queue, queue[0]);
  } else {
    await restartGame(state.roomCode, playerIds);
  }
};

document.getElementById("btn-leave-finished").onclick = () => {
  localStorage.removeItem("remember_session");
  location.reload();
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
