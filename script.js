const BASE_STORAGE_KEY = "cctQuizUnifiedProgress.v2";
const AUTH_SETTINGS_KEY = "cctQuizUnifiedAccountAuth.v1";

const state = {
  currentQuestion: null,
  shuffledChoices: [],
  answered: false,
  selectedChoice: null,
  sessionCorrect: 0,
  sessionAnswered: 0,
  auth: loadAuthSettings(),
  store: null,
  syncing: false,
  autoLoaded: false,
};
state.store = loadStore();

const el = {
  remainingCount: document.getElementById("remainingCount"),
  masteredCount: document.getElementById("masteredCount"),
  accuracyRate: document.getElementById("accuracyRate"),
  sessionScore: document.getElementById("sessionScore"),
  totalCount: document.getElementById("totalCount"),
  progressRate: document.getElementById("progressRate"),
  progressBar: document.getElementById("progressBar"),
  unansweredCount: document.getElementById("unansweredCount"),
  returnedCount: document.getElementById("returnedCount"),
  streak1Count: document.getElementById("streak1Count"),
  streak2Count: document.getElementById("streak2Count"),
  streak3Count: document.getElementById("streak3Count"),
  quizCard: document.getElementById("quizCard"),
  completeCard: document.getElementById("completeCard"),
  questionMeta: document.getElementById("questionMeta"),
  newBadge: document.getElementById("newBadge"),
  streakBadge: document.getElementById("streakBadge"),
  categoryLabel: document.getElementById("categoryLabel"),
  questionText: document.getElementById("questionText"),
  choiceForm: document.getElementById("choiceForm"),
  answerBtn: document.getElementById("answerBtn"),
  nextBtn: document.getElementById("nextBtn"),
  resultBox: document.getElementById("resultBox"),
  resultIcon: document.getElementById("resultIcon"),
  resultTitle: document.getElementById("resultTitle"),
  correctAnswer: document.getElementById("correctAnswer"),
  explanationText: document.getElementById("explanationText"),
  resetProgressBtn: document.getElementById("resetProgressBtn"),
  completeResetBtn: document.getElementById("completeResetBtn"),
  dailyTableBody: document.getElementById("dailyTableBody"),
  exportProgressBtn: document.getElementById("exportProgressBtn"),
  importProgressInput: document.getElementById("importProgressInput"),
  loginStatus: document.getElementById("loginStatus"),
  authOpenBtn: document.getElementById("authOpenBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  authCloseBtn: document.getElementById("authCloseBtn"),
  authPanel: document.getElementById("authPanel"),
  workerUrl: document.getElementById("workerUrl"),
  autoSync: document.getElementById("autoSync"),
  loginTabBtn: document.getElementById("loginTabBtn"),
  registerTabBtn: document.getElementById("registerTabBtn"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  loginUserId: document.getElementById("loginUserId"),
  loginPassword: document.getElementById("loginPassword"),
  registerUserId: document.getElementById("registerUserId"),
  registerPassword: document.getElementById("registerPassword"),
  registerPasswordConfirm: document.getElementById("registerPasswordConfirm"),
  registerCode: document.getElementById("registerCode"),
  loginBtn: document.getElementById("loginBtn"),
  registerBtn: document.getElementById("registerBtn"),
  testWorkerBtn: document.getElementById("testWorkerBtn"),
  loadFromWorkerBtn: document.getElementById("loadFromWorkerBtn"),
  saveToWorkerBtn: document.getElementById("saveToWorkerBtn"),
  authStatus: document.getElementById("authStatus"),
};

function emptyStore() {
  return {
    version: 2,
    appId: "cct-unified-quiz",
    updatedAt: new Date().toISOString(),
    progress: {},
    daily: {},
  };
}

function normalizeUserId(userId) {
  return String(userId || "guest").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 64) || "guest";
}

function currentStorageKey() {
  const userPart = state.auth && state.auth.userId ? normalizeUserId(state.auth.userId) : "guest";
  return `${BASE_STORAGE_KEY}:${userPart}`;
}

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(currentStorageKey()));
    if (saved && saved.progress && saved.daily) return migrateStore(saved);
  } catch (e) {
    console.warn(e);
  }
  return emptyStore();
}

function migrateStore(store) {
  return {
    ...emptyStore(),
    ...store,
    version: 2,
    appId: "cct-unified-quiz",
    progress: store.progress || {},
    daily: store.daily || {},
  };
}

function saveStore() {
  state.store.updatedAt = new Date().toISOString();
  localStorage.setItem(currentStorageKey(), JSON.stringify(state.store));
}

function loadAuthSettings() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_SETTINGS_KEY)) || { autoSync: true };
  } catch {
    return { autoSync: true };
  }
}

function saveAuthSettings() {
  localStorage.setItem(AUTH_SETTINGS_KEY, JSON.stringify(state.auth));
}

function clearAuthToken() {
  state.auth = {
    workerUrl: state.auth.workerUrl || "",
    autoSync: Boolean(state.auth.autoSync),
  };
  saveAuthSettings();
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getRecord(questionId) {
  const key = String(questionId);
  if (!state.store.progress[key]) {
    state.store.progress[key] = {
      streak: 0,
      attempts: 0,
      correct: 0,
      wrong: 0,
      maxStreak: 0,
      returnedCount: 0,
      returnedAt: null,
      masteredAt: null,
      lastAnsweredAt: null,
    };
  }
  return state.store.progress[key];
}

function getStatus(question) {
  const r = getRecord(question.id);
  if (r.streak >= 3) return "mastered";
  if (r.streak === 2) return "streak2";
  if (r.streak === 1) return "streak1";
  if ((r.returnedCount || 0) > 0) return "returned";
  return "unanswered";
}

function countStatuses() {
  const counts = { unanswered: 0, returned: 0, streak1: 0, streak2: 0, mastered: 0 };
  CCT_QUESTIONS.forEach(q => { counts[getStatus(q)] += 1; });
  return counts;
}

function getRemainingQuestions() {
  return CCT_QUESTIONS.filter(q => getRecord(q.id).streak < 3);
}

function shuffle(array) {
  const copied = [...array];
  for (let i = copied.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copied[i], copied[j]] = [copied[j], copied[i]];
  }
  return copied;
}

function pickRandomQuestion() {
  const remaining = getRemainingQuestions();
  return remaining.length ? remaining[Math.floor(Math.random() * remaining.length)] : null;
}

function updateDailySnapshot(isCorrect) {
  const day = todayKey();
  if (!state.store.daily[day]) {
    state.store.daily[day] = { answered: 0, correct: 0, wrong: 0, snapshot: {}, updatedAt: null };
  }
  const d = state.store.daily[day];
  d.answered += 1;
  if (isCorrect) d.correct += 1;
  else d.wrong += 1;
  d.snapshot = countStatuses();
  d.updatedAt = new Date().toISOString();
}

function renderStats() {
  const counts = countStatuses();
  const mastered = counts.mastered;
  const remaining = CCT_QUESTIONS.length - mastered;
  const accuracy = state.sessionAnswered === 0 ? 0 : Math.round((state.sessionCorrect / state.sessionAnswered) * 100);
  const progress = Math.round((mastered / CCT_QUESTIONS.length) * 100);

  el.remainingCount.textContent = String(remaining);
  el.masteredCount.textContent = String(mastered);
  el.accuracyRate.textContent = `${accuracy}%`;
  el.sessionScore.textContent = `${state.sessionCorrect} / ${state.sessionAnswered}`;
  el.totalCount.textContent = String(CCT_QUESTIONS.length);
  el.progressRate.textContent = `${progress}%`;
  el.progressBar.style.width = `${progress}%`;
  el.unansweredCount.textContent = String(counts.unanswered);
  el.returnedCount.textContent = String(counts.returned);
  el.streak1Count.textContent = String(counts.streak1);
  el.streak2Count.textContent = String(counts.streak2);
  el.streak3Count.textContent = String(counts.mastered);
  renderDailyTable();
  renderAuthStatus();
}

function renderDailyTable() {
  const days = Object.keys(state.store.daily || {}).sort().reverse();
  if (days.length === 0) {
    el.dailyTableBody.innerHTML = `<tr><td colspan="10" style="text-align:left;color:#64748b;">まだ解答履歴がありません。</td></tr>`;
    return;
  }

  el.dailyTableBody.innerHTML = days.map(day => {
    const d = state.store.daily[day];
    const s = d.snapshot || {};
    const rate = d.answered ? Math.round((d.correct / d.answered) * 100) : 0;
    return `<tr><td>${escapeHtml(day)}</td><td>${d.answered || 0}</td><td>${d.correct || 0}</td><td>${d.wrong || 0}</td><td>${rate}%</td><td>${s.unanswered || 0}</td><td>${s.returned || 0}</td><td>${s.streak1 || 0}</td><td>${s.streak2 || 0}</td><td>${s.mastered || 0}</td></tr>`;
  }).join("");
}

function renderQuestion() {
  renderStats();
  state.currentQuestion = pickRandomQuestion();
  state.answered = false;
  state.selectedChoice = null;

  if (!state.currentQuestion) {
    el.quizCard.hidden = true;
    el.completeCard.hidden = false;
    return;
  }

  el.quizCard.hidden = false;
  el.completeCard.hidden = true;
  const q = state.currentQuestion;
  const r = getRecord(q.id);
  state.shuffledChoices = shuffle(q.choices);

  el.questionMeta.textContent = `No.${q.displayNo}`;
  el.newBadge.hidden = !q.isNew;
  el.streakBadge.textContent = `連続正解 ${r.streak} / 3`;
  el.categoryLabel.textContent = q.category || "";
  el.questionText.textContent = q.question;
  el.resultBox.hidden = true;
  el.resultBox.className = "result-box";
  el.answerBtn.hidden = false;
  el.answerBtn.disabled = true;
  el.nextBtn.hidden = true;
  el.choiceForm.innerHTML = "";

  state.shuffledChoices.forEach((choice, index) => {
    const id = `choice-${index}`;
    const label = document.createElement("label");
    const input = document.createElement("input");
    const key = document.createElement("span");
    const text = document.createElement("span");

    label.className = "choice-item";
    label.setAttribute("for", id);
    input.id = id;
    input.type = "radio";
    input.name = "choice";
    input.value = String(index);
    key.className = "choice-key";
    key.textContent = String.fromCharCode(65 + index);
    text.className = "choice-text";
    text.textContent = choice;
    label.append(input, key, text);
    el.choiceForm.appendChild(label);
  });
}

function onChoiceChange(event) {
  if (state.answered) return;
  const input = event.target.closest("input[name='choice']");
  if (!input) return;
  state.selectedChoice = state.shuffledChoices[Number(input.value)];
  el.answerBtn.disabled = false;
  [...document.querySelectorAll(".choice-item")].forEach(item => item.classList.toggle("selected", item.contains(input)));
}

function answerCurrentQuestion() {
  if (!state.currentQuestion || state.answered || !state.selectedChoice) return;

  const q = state.currentQuestion;
  const r = getRecord(q.id);
  const isCorrect = state.selectedChoice === q.answer;
  const previousStreak = r.streak || 0;
  state.answered = true;
  state.sessionAnswered += 1;
  r.attempts += 1;
  r.lastAnsweredAt = new Date().toISOString();

  if (isCorrect) {
    state.sessionCorrect += 1;
    r.correct += 1;
    r.streak = Math.min(3, previousStreak + 1);
    r.maxStreak = Math.max(r.maxStreak || 0, r.streak);
    if (r.streak >= 3 && !r.masteredAt) r.masteredAt = new Date().toISOString();
  } else {
    r.wrong += 1;
    if (previousStreak > 0) {
      r.returnedCount = (r.returnedCount || 0) + 1;
      r.returnedAt = new Date().toISOString();
    }
    r.streak = 0;
    r.masteredAt = null;
  }

  updateDailySnapshot(isCorrect);
  saveStore();
  renderAnswer(isCorrect, r);
  renderStats();
  autoSaveToWorker();
}

function renderAnswer(isCorrect, record) {
  const q = state.currentQuestion;
  el.resultBox.hidden = false;
  el.resultBox.classList.add(isCorrect ? "correct-result" : "wrong-result");
  el.resultIcon.textContent = isCorrect ? "✓" : "!";
  el.resultIcon.style.background = isCorrect ? "var(--success)" : "var(--danger)";

  if (isCorrect && record.streak >= 3) el.resultTitle.textContent = "正解です。この問題はマスター済みになりました。";
  else if (isCorrect) el.resultTitle.textContent = `正解です。連続正解 ${record.streak} / 3`;
  else el.resultTitle.textContent = "不正解です。連続正解は 0 / 3 にリセットされました。";

  el.correctAnswer.textContent = `正答：${q.answer}`;
  el.explanationText.textContent = q.explanation || "解説は登録されていません。";

  [...document.querySelectorAll(".choice-item")].forEach(item => {
    const input = item.querySelector("input");
    const choice = state.shuffledChoices[Number(input.value)];
    input.disabled = true;
    if (choice === q.answer) item.classList.add("correct");
    if (choice === state.selectedChoice && !isCorrect) item.classList.add("wrong");
  });

  el.answerBtn.hidden = true;
  el.nextBtn.hidden = false;
  el.nextBtn.textContent = getRemainingQuestions().length === 0 ? "完了画面へ" : "次の問題へ";
  el.streakBadge.textContent = `連続正解 ${record.streak} / 3`;
}

function resetProgress() {
  const target = state.auth.token ? "現在ログイン中のユーザー履歴" : "この端末のゲスト履歴";
  if (!confirm(`${target}をすべてリセットしますか？ログイン中で自動保存が有効な場合、Worker側にもリセット後の履歴を保存します。`)) return;
  localStorage.removeItem(currentStorageKey());
  state.store = emptyStore();
  state.currentQuestion = null;
  state.shuffledChoices = [];
  state.answered = false;
  state.selectedChoice = null;
  state.sessionCorrect = 0;
  state.sessionAnswered = 0;
  saveStore();
  renderQuestion();
  autoSaveToWorker(true);
}

function exportProgress() {
  const blob = new Blob([JSON.stringify(state.store, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cct-progress-${state.auth.userId || "guest"}-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importProgress(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.progress || !data.daily) throw new Error("Invalid progress file");
      state.store = migrateStore(data);
      saveStore();
      renderQuestion();
      autoSaveToWorker(true);
      alert("履歴を読み込みました。");
    } catch (e) {
      alert("履歴JSONの読み込みに失敗しました。");
    }
  };
  reader.readAsText(file);
}

function fillAuthForm() {
  el.workerUrl.value = state.auth.workerUrl || "";
  el.autoSync.checked = state.auth.autoSync !== false;
  el.loginUserId.value = state.auth.userId || "";
  el.loginPassword.value = "";
  el.registerPassword.value = "";
  el.registerPasswordConfirm.value = "";
  el.registerCode.value = "";
  renderAuthStatus();
}

function readAuthCommonForm() {
  state.auth.workerUrl = el.workerUrl.value.trim().replace(/\/+$/, "");
  state.auth.autoSync = el.autoSync.checked;
  saveAuthSettings();
}

function setAuthStatus(msg) {
  el.authStatus.textContent = msg;
}

function showAuthTab(mode) {
  const isLogin = mode === "login";
  el.loginForm.hidden = !isLogin;
  el.registerForm.hidden = isLogin;
  el.loginTabBtn.classList.toggle("active", isLogin);
  el.registerTabBtn.classList.toggle("active", !isLogin);
  setAuthStatus("");
}

function renderAuthStatus() {
  if (state.auth.token && state.auth.userId) {
    el.loginStatus.textContent = `ログイン中：${state.auth.userId} / 履歴はWorker + この端末に保存されます。`;
    el.loginStatus.className = "login-status logged-in";
    el.logoutBtn.hidden = false;
  } else {
    el.loginStatus.textContent = "未ログイン：この端末だけに履歴を保存しています。";
    el.loginStatus.className = "login-status";
    el.logoutBtn.hidden = true;
  }
}

function validateWorkerUrl() {
  if (!state.auth.workerUrl) throw new Error("Worker API URL を入力してください。");
  try { new URL(state.auth.workerUrl); } catch { throw new Error("Worker API URL の形式が正しくありません。 "); }
}

function validateLoggedIn() {
  validateWorkerUrl();
  if (!state.auth.token) throw new Error("先にログインしてください。");
}

function workerEndpoint(path) {
  return `${state.auth.workerUrl}${path}`;
}

function jsonHeaders(extra = {}) {
  return { "Content-Type": "application/json", ...extra };
}

function authHeaders() {
  return jsonHeaders({ Authorization: `Bearer ${state.auth.token}` });
}

async function apiJson(path, options = {}) {
  const res = await fetch(workerEndpoint(path), options);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data && data.message ? data.message : `${res.status} ${res.statusText}`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function validateRemoteStore(store) {
  if (!store || store.appId !== "cct-unified-quiz" || !store.progress || !store.daily) {
    throw new Error("Workerから取得した履歴JSONの形式が正しくありません。");
  }
}

async function testWorkerConnection() {
  try {
    readAuthCommonForm();
    validateWorkerUrl();
    setAuthStatus("Workerへ接続確認中...");
    const data = await apiJson("/health", { headers: jsonHeaders() });
    setAuthStatus(`接続できました。\nService: ${data.service || "cct-quiz-auth-api"}`);
  } catch (e) {
    setAuthStatus(`接続確認に失敗しました。\n${e.message}`);
  }
}

async function registerAccount() {
  try {
    readAuthCommonForm();
    validateWorkerUrl();
    const userId = el.registerUserId.value.trim();
    const password = el.registerPassword.value;
    const confirm = el.registerPasswordConfirm.value;
    const registrationCode = el.registerCode.value;

    if (!userId) throw new Error("User ID を入力してください。");
    if (password.length < 8) throw new Error("Password は8文字以上にしてください。");
    if (password !== confirm) throw new Error("Password Confirm が一致していません。");

    setAuthStatus("アカウントを作成中...");
    const data = await apiJson("/register", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ userId, password, registrationCode }),
    });

    if (!data || !data.ok || !data.userId || !data.token) {
      throw new Error(data && data.message ? data.message : "登録レスポンスの形式が正しくありません。");
    }

    state.auth = {
      ...state.auth,
      workerUrl: state.auth.workerUrl,
      autoSync: state.auth.autoSync !== false,
      token: data.token,
      userId: data.userId,
      tokenExpiresAt: data.expiresAt || null,
    };
    saveAuthSettings();
    state.store = loadStore();
    saveStore();
    renderQuestion();
    fillAuthForm();
    showAuthTab("login");
    setAuthStatus("登録してログインしました。回答後の自動保存を使えます。");
    await saveToWorker({ silent: true });
  } catch (e) {
    setAuthStatus(`登録に失敗しました。\n${e.message}`);
  }
}

async function loginAccount() {
  try {
    readAuthCommonForm();
    validateWorkerUrl();
    const userId = el.loginUserId.value.trim();
    const password = el.loginPassword.value;
    if (!userId || !password) throw new Error("User ID と Password を入力してください。");

    setAuthStatus("ログイン中...");
    const data = await apiJson("/login", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ userId, password }),
    });

    if (!data || !data.ok || !data.userId || !data.token) {
      throw new Error(data && data.message ? data.message : "ログインレスポンスの形式が正しくありません。");
    }

    state.auth = {
      ...state.auth,
      workerUrl: state.auth.workerUrl,
      autoSync: state.auth.autoSync !== false,
      token: data.token,
      userId: data.userId,
      tokenExpiresAt: data.expiresAt || null,
    };
    saveAuthSettings();

    state.store = loadStore();
    saveStore();
    renderQuestion();
    fillAuthForm();

    const loaded = await loadFromWorker({ silent: true });
    setAuthStatus(loaded ? "ログインしてWorkerから履歴を読み込みました。" : "ログインしました。Worker上に履歴がないため、この端末の履歴を使います。必要なら『履歴を保存』を押してください。");
  } catch (e) {
    setAuthStatus(`ログインに失敗しました。\n${e.message}`);
  }
}

async function loadFromWorker({ silent = false } = {}) {
  try {
    readAuthCommonForm();
    validateLoggedIn();
    if (!silent) setAuthStatus("Workerから履歴を読み込み中...");

    const data = await apiJson("/load", { headers: authHeaders() });
    const remoteProgress = data && Object.prototype.hasOwnProperty.call(data, "progress")
      ? data.progress
      : null;

    if (!remoteProgress) {
      if (!silent) setAuthStatus("Worker上に履歴がまだありません。先に『履歴を保存』してください。");
      return false;
    }

    validateRemoteStore(remoteProgress);
    state.store = migrateStore(remoteProgress);
    saveStore();
    renderQuestion();
    if (!silent) setAuthStatus("Workerから履歴を読み込みました。");
    return true;
  } catch (e) {
    if (e.status === 401) {
      clearAuthToken();
      renderStats();
    }
    if (!silent) setAuthStatus(`読み込みに失敗しました。\n${e.message}`);
    return false;
  }
}

async function saveToWorker({ silent = false } = {}) {
  if (state.syncing) return false;
  try {
    readAuthCommonForm();
    validateLoggedIn();
    state.syncing = true;
    if (!silent) setAuthStatus("Workerへ履歴を保存中...");
    state.store.updatedAt = new Date().toISOString();
    const data = await apiJson("/save", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ progress: state.store }),
    });
    if (!silent) setAuthStatus(`Workerへ履歴を保存しました。\nSaved: ${data.savedAt || state.store.updatedAt}`);
    return true;
  } catch (e) {
    if (e.status === 401) {
      clearAuthToken();
      renderStats();
    }
    if (!silent) setAuthStatus(`保存に失敗しました。\n${e.message}`);
    return false;
  } finally {
    state.syncing = false;
  }
}

function autoSaveToWorker(force = false) {
  if (!state.auth.token) return;
  if (!force && state.auth.autoSync === false) return;
  if (!state.auth.workerUrl) return;
  saveToWorker({ silent: true });
}

async function autoLoadFromWorkerOnStart() {
  if (state.autoLoaded) return;
  state.autoLoaded = true;
  if (!state.auth.token || !state.auth.workerUrl) return;
  await loadFromWorker({ silent: true });
}

function logout() {
  if (!confirm("ログアウトしますか？この端末に保存されたログイントークンだけを削除します。Worker上の履歴は削除されません。")) return;
  clearAuthToken();
  state.store = loadStore();
  state.sessionCorrect = 0;
  state.sessionAnswered = 0;
  renderQuestion();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[ch]));
}

el.choiceForm.addEventListener("change", onChoiceChange);
el.answerBtn.addEventListener("click", answerCurrentQuestion);
el.nextBtn.addEventListener("click", renderQuestion);
el.resetProgressBtn.addEventListener("click", resetProgress);
el.completeResetBtn.addEventListener("click", resetProgress);
el.exportProgressBtn.addEventListener("click", exportProgress);
el.importProgressInput.addEventListener("change", e => importProgress(e.target.files[0]));
el.authOpenBtn.addEventListener("click", () => { fillAuthForm(); el.authPanel.hidden = false; });
el.authCloseBtn.addEventListener("click", () => { el.authPanel.hidden = true; });
el.loginTabBtn.addEventListener("click", () => showAuthTab("login"));
el.registerTabBtn.addEventListener("click", () => showAuthTab("register"));
el.loginBtn.addEventListener("click", loginAccount);
el.registerBtn.addEventListener("click", registerAccount);
el.testWorkerBtn.addEventListener("click", testWorkerConnection);
el.loadFromWorkerBtn.addEventListener("click", () => loadFromWorker());
el.saveToWorkerBtn.addEventListener("click", () => saveToWorker());
el.logoutBtn.addEventListener("click", logout);
el.autoSync.addEventListener("change", () => { readAuthCommonForm(); renderAuthStatus(); });
el.workerUrl.addEventListener("change", readAuthCommonForm);

renderQuestion();
autoLoadFromWorkerOnStart();
