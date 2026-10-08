"use strict";

/* =========================================================
   Révis'Quiz — questions de révision à partir de photos de cours
   Tout est stocké dans l'appareil (localStorage).
   ========================================================= */

const MODEL = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_PHOTOS = 5;
const MAX_IMAGE_SIDE = 1600;

const MATIERES = [
  "Français", "Mathématiques", "Histoire-Géographie", "EMC", "SVT",
  "Physique-Chimie", "Technologie", "Anglais", "Espagnol", "Allemand",
  "Latin", "Musique", "Arts plastiques", "Autre",
];

const TYPE_LABELS = {
  qcm: "QCM",
  vrai_faux: "Vrai ou faux",
  trous: "Texte à trous",
  courte: "Réponse courte",
  redigee: "Réponse rédigée",
};

const LOADING_MESSAGES_GEN = [
  "Je lis ton cours…",
  "Je cherche les notions importantes…",
  "Je prépare des questions malignes…",
  "Je mélange le tout…",
  "Presque prêt !",
];
const LOADING_MESSAGES_CORR = [
  "Je relis tes réponses…",
  "Je sors mon stylo vert…",
  "Je compte les points…",
];

/* ---------- Stockage ---------- */

const KEYS = {
  apiKey: "rq.apiKey",
  quizzes: "rq.quizzes",
  session: "rq.session",
  prefs: "rq.prefs",
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    toast("Impossible d'enregistrer sur cet appareil.");
    return false;
  }
}

const state = {
  photos: [],          // { dataUrl, base64 }
  difficulte: "moyen",
  quizzes: load(KEYS.quizzes, []),
  session: load(KEYS.session, null),
  view: "creer",
};

function getApiKey() { return load(KEYS.apiKey, ""); }
function saveQuizzes() { save(KEYS.quizzes, state.quizzes); }
function saveSession() { save(KEYS.session, state.session); }
function findQuiz(id) { return state.quizzes.find((q) => q.id === id); }

/* ---------- Utilitaires ---------- */

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString("fr-FR", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatScore(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

let loaderTimer;
function showLoader(messages) {
  let i = 0;
  $("#loader-text").textContent = messages[0];
  $("#loader").classList.remove("hidden");
  clearInterval(loaderTimer);
  loaderTimer = setInterval(() => {
    i = Math.min(i + 1, messages.length - 1);
    $("#loader-text").textContent = messages[i];
  }, 6000);
}
function hideLoader() {
  clearInterval(loaderTimer);
  $("#loader").classList.add("hidden");
}

/* ---------- Navigation ---------- */

function showView(name) {
  state.view = name;
  for (const v of document.querySelectorAll(".view")) v.classList.add("hidden");
  $("#view-" + name).classList.remove("hidden");
  for (const t of document.querySelectorAll(".tab")) {
    t.classList.toggle("active", t.dataset.view === name);
  }
  if (name === "repondre") renderRepondre();
  if (name === "historique") renderHistorique();
  if (name === "creer") refreshCreer();
  window.scrollTo({ top: 0 });
}

function updateTabDot() {
  const tab = document.querySelector('.tab[data-view="repondre"]');
  const existing = tab.querySelector(".dot");
  const pending = state.session && !state.session.correction;
  if (pending && !existing) tab.append(el("i", { class: "dot" }));
  if (!pending && existing) existing.remove();
}

/* =========================================================
   Appels à l'API Claude
   ========================================================= */

class ApiError extends Error {}

async function callClaude({ system, content, schema, maxTokens = 16000, effort = "medium" }) {
  const key = getApiKey();
  if (!key) throw new ApiError("Il manque la clé API (bouton Réglages en haut à droite).");

  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content }],
        output_config: {
          effort,
          format: { type: "json_schema", schema },
        },
      }),
    });
  } catch {
    throw new ApiError("Pas de connexion internet ? Réessaie dans un instant.");
  }

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* ignore */ }
    if (res.status === 401) throw new ApiError("La clé API n'est pas valide. Vérifie-la dans les réglages.");
    if (res.status === 429) throw new ApiError("Trop de demandes d'un coup. Attends une minute et réessaie.");
    if (res.status === 529 || res.status >= 500) throw new ApiError("Claude est très occupé en ce moment. Réessaie dans quelques minutes.");
    if (res.status === 413) throw new ApiError("Les photos sont trop lourdes. Essaie avec moins de photos.");
    if (/credit|billing/i.test(detail)) throw new ApiError("Le crédit du compte Claude est épuisé ou la limite de dépense est atteinte.");
    throw new ApiError("Erreur " + res.status + (detail ? " : " + detail : ""));
  }

  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new ApiError("Claude n'a pas voulu traiter cette demande. Essaie avec d'autres photos.");
  }
  if (data.stop_reason === "max_tokens") {
    throw new ApiError("La réponse était trop longue. Essaie avec moins de questions.");
  }
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("Réponse inattendue de Claude. Réessaie.");
  }
}

/* ---------- Génération ---------- */

const QUIZ_SCHEMA = {
  type: "object",
  properties: {
    erreur: {
      type: "string",
      description: "Vide si tout va bien. Sinon, message court pour l'élève (photos illisibles, pas un cours…).",
    },
    titre: { type: "string", description: "Titre court du quiz (le thème du cours)." },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["qcm", "vrai_faux", "trous", "courte", "redigee"] },
          enonce: { type: "string" },
          choix: { type: "array", items: { type: "string" } },
          reponse: { type: "string" },
          explication: { type: "string" },
        },
        required: ["type", "enonce", "choix", "reponse", "explication"],
        additionalProperties: false,
      },
    },
  },
  required: ["erreur", "titre", "questions"],
  additionalProperties: false,
};

const DIFFICULTES = {
  facile: "facile : questions directes sur les définitions et les idées principales du cours, formulées simplement.",
  moyen: "moyen : mélange de questions de connaissance et de compréhension (expliquer, relier deux notions).",
  difficile: "difficile : questions qui demandent de comprendre en profondeur, d'appliquer le cours à un exemple ou de justifier, avec des pièges plausibles dans les QCM.",
};

const SYSTEM_GENERATION = `Tu es un professeur de collège bienveillant qui prépare des quiz de révision en français pour un ou une élève.

Tu reçois des photos de son cours (manuel, polycopié ou cahier écrit à la main). Lis-les attentivement, y compris l'écriture manuscrite.

Règles :
- Pose des questions uniquement sur ce qui figure dans les photos. N'invente aucune notion absente du cours.
- Couvre l'ensemble du cours plutôt que de te concentrer sur un seul passage.
- Mélange les types de questions. Pour un quiz de 10 questions, vise environ : 3 qcm, 2 vrai_faux, 2 trous, 2 courte, 1 redigee. Adapte en proportion pour un autre nombre.
- Formulation adaptée à l'âge (11-15 ans) : phrases claires, vocabulaire du cours.
- "explication" : 1 à 2 phrases qui rappellent ce que dit le cours, pour aider à retenir.
- Si les photos sont illisibles ou ne contiennent pas de cours, laisse "questions"vide et explique le problème gentiment dans "erreur".

Format de chaque type :
- qcm : "choix"contient exactement 4 propositions ; "reponse"est le texte exact de la bonne proposition. Varie la position de la bonne réponse.
- vrai_faux : "enonce"est une affirmation ; "choix"est vide ; "reponse"vaut "vrai"ou "faux". Équilibre les vrais et les faux.
- trous : "enonce"contient une phrase du cours avec un seul trou noté "_____" ; "choix"est vide ; "reponse"est le ou les mots manquants.
- courte : réponse attendue en quelques mots ; "choix"est vide ; "reponse"est la réponse attendue.
- redigee : réponse attendue en 2 à 4 phrases ; "choix"est vide ; "reponse"liste les éléments attendus dans une bonne réponse.`;

async function generateQuiz() {
  const matiere = $("#sel-matiere").value;
  const niveau = $("#sel-niveau").value;
  const chapitre = $("#inp-chapitre").value.trim();
  const nombre = Number($("#rng-nombre").value);
  const difficulte = state.difficulte;

  save(KEYS.prefs, { matiere, niveau, nombre, difficulte });

  const content = state.photos.map((p) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: p.base64 },
  }));
  content.push({
    type: "text",
    text:
      `Matière : ${matiere}\nClasse : ${niveau}\n` +
      (chapitre ? `Chapitre : ${chapitre}\n` : "") +
      `Nombre de questions : exactement ${nombre}\n` +
      `Difficulté : ${DIFFICULTES[difficulte]}\n\n` +
      `Prépare le quiz à partir des ${state.photos.length} photo(s) ci-dessus.`,
  });

  showLoader(LOADING_MESSAGES_GEN);
  try {
    const out = await callClaude({ system: SYSTEM_GENERATION, content, schema: QUIZ_SCHEMA, effort: "medium", maxTokens: 32000 });
    if (out.erreur && (!out.questions || out.questions.length === 0)) {
      throw new ApiError(out.erreur);
    }
    const questions = (out.questions || [])
      .filter((q) => q.enonce && TYPE_LABELS[q.type])
      .filter((q) => q.type !== "qcm" || q.choix.length >= 2)
      .map((q) => ({ ...q, id: uid() }));
    if (questions.length === 0) throw new ApiError("Je n'ai pas réussi à créer de questions. Essaie avec d'autres photos.");

    const quiz = {
      id: uid(),
      createdAt: Date.now(),
      titre: out.titre || chapitre || matiere,
      matiere, niveau, chapitre, difficulte,
      questions,
      tentatives: [],
    };
    state.quizzes.unshift(quiz);
    saveQuizzes();

    state.photos = [];
    renderPhotos();
    $("#inp-chapitre").value = "";

    startSession(quiz.id, null);
    toast(questions.length + " questions prêtes !");
  } catch (e) {
    toast(e instanceof ApiError ? e.message : "Oups, une erreur est survenue.", 6000);
    console.error(e);
  } finally {
    hideLoader();
  }
}

/* ---------- Correction ---------- */

const CORRECTION_SCHEMA = {
  type: "object",
  properties: {
    resultats: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["juste", "partiel", "faux"] },
          commentaire: { type: "string" },
        },
        required: ["id", "verdict", "commentaire"],
        additionalProperties: false,
      },
    },
  },
  required: ["resultats"],
  additionalProperties: false,
};

const SYSTEM_CORRECTION = `Tu es un professeur de collège bienveillant qui corrige un quiz de révision en français.

Pour chaque question, compare la réponse de l'élève à la réponse attendue :
- "juste" : l'idée est correcte, même si la formulation diffère, ou s'il y a de petites fautes d'orthographe.
- "partiel" : une partie de la réponse est correcte mais il manque un élément important ou il y a une petite erreur.
- "faux" : la réponse est incorrecte, hors sujet ou vide.

"commentaire" : une phrase courte et encourageante qui s'adresse à l'élève avec « tu ». Dis ce qui est bien et, si besoin, ce qui manque. Ne recopie pas toute la réponse attendue, elle est déjà affichée.

Renvoie un résultat pour chaque id reçu.`;

function localVerdict(q, answer) {
  const a = (answer ?? "").toString().trim();
  if (!a) return { verdict: "faux", commentaire: "Tu n'as pas répondu à cette question." };
  if (q.type === "qcm" || q.type === "vrai_faux") {
    return normalize(a) === normalize(q.reponse)
      ? { verdict: "juste", commentaire: "" }
      : { verdict: "faux", commentaire: "" };
  }
  if ((q.type === "trous" || q.type === "courte") && normalize(a) === normalize(q.reponse)) {
    return { verdict: "juste", commentaire: "" };
  }
  return null; // à faire corriger par Claude
}

async function correctSession() {
  const s = state.session;
  const quiz = findQuiz(s.quizId);
  const questions = s.questionIds.map((id) => quiz.questions.find((q) => q.id === id)).filter(Boolean);

  const resultats = {};
  const aCorriger = [];
  for (const q of questions) {
    const v = localVerdict(q, s.answers[q.id]);
    if (v) resultats[q.id] = v;
    else aCorriger.push(q);
  }

  if (aCorriger.length) {
    showLoader(LOADING_MESSAGES_CORR);
    try {
      const payload = aCorriger.map((q) => ({
        id: q.id,
        type: TYPE_LABELS[q.type],
        question: q.enonce,
        reponse_attendue: q.reponse,
        reponse_eleve: s.answers[q.id],
      }));
      const out = await callClaude({
        system: SYSTEM_CORRECTION,
        content: [{
          type: "text",
          text: `Matière : ${quiz.matiere} (${quiz.niveau})\n\nQuestions à corriger :\n${JSON.stringify(payload, null, 2)}`,
        }],
        schema: CORRECTION_SCHEMA,
        effort: "low",
        maxTokens: 16000,
      });
      for (const r of out.resultats || []) {
        if (aCorriger.some((q) => q.id === r.id)) {
          resultats[r.id] = { verdict: r.verdict, commentaire: r.commentaire };
        }
      }
      const manquants = aCorriger.filter((q) => !resultats[q.id]);
      if (manquants.length) throw new ApiError("La correction est incomplète. Réessaie.");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Oups, la correction a échoué.", 6000);
      console.error(e);
      return;
    } finally {
      hideLoader();
    }
  }

  const points = { juste: 1, partiel: 0.5, faux: 0 };
  const score = questions.reduce((sum, q) => sum + points[resultats[q.id].verdict], 0);

  const tentative = {
    date: Date.now(),
    questionIds: s.questionIds,
    answers: { ...s.answers },
    resultats,
    score,
    total: questions.length,
    partielle: s.questionIds.length < quiz.questions.length,
  };
  quiz.tentatives.push(tentative);
  saveQuizzes();

  s.correction = tentative;
  saveSession();
  updateTabDot();
  renderRepondre();
  window.scrollTo({ top: 0 });

  if (score / questions.length >= 0.8) launchConfetti();
}

/* =========================================================
   Onglet Créer
   ========================================================= */

function setupCreer() {
  const selMatiere = $("#sel-matiere");
  for (const m of MATIERES) selMatiere.append(el("option", {}, m));

  const prefs = load(KEYS.prefs, {});
  if (prefs.matiere) selMatiere.value = prefs.matiere;
  if (prefs.niveau) $("#sel-niveau").value = prefs.niveau;
  if (prefs.nombre) $("#rng-nombre").value = prefs.nombre;
  if (prefs.difficulte) state.difficulte = prefs.difficulte;
  $("#nombre-val").textContent = $("#rng-nombre").value;

  $("#rng-nombre").addEventListener("input", (e) => { $("#nombre-val").textContent = e.target.value; });

  for (const chip of document.querySelectorAll("#chips-difficulte .chip")) {
    chip.classList.toggle("active", chip.dataset.value === state.difficulte);
    chip.addEventListener("click", () => {
      state.difficulte = chip.dataset.value;
      for (const c of document.querySelectorAll("#chips-difficulte .chip")) c.classList.toggle("active", c === chip);
    });
  }

  for (const id of ["#input-camera", "#input-gallery"]) {
    $(id).addEventListener("change", async (e) => {
      await addPhotos([...e.target.files]);
      e.target.value = "";
    });
  }

  $("#btn-generer").addEventListener("click", () => {
    if (state.session && !state.session.correction && !confirm("Tu as un quiz en cours. En créer un nouveau quand même ?")) return;
    generateQuiz();
  });
  $("#btn-open-settings").addEventListener("click", openSettings);
}

async function addPhotos(files) {
  const place = MAX_PHOTOS - state.photos.length;
  if (files.length > place) toast(`Maximum ${MAX_PHOTOS} photos`);
  for (const file of files.slice(0, place)) {
    try {
      state.photos.push(await resizeImage(file));
    } catch {
      toast("Impossible de lire cette image");
    }
  }
  renderPhotos();
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve({ dataUrl, base64: dataUrl.split(",")[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src = url;
  });
}

function renderPhotos() {
  const box = $("#photos");
  box.replaceChildren(...state.photos.map((p, i) =>
    el("div", { class: "photo" },
      el("img", { src: p.dataUrl, alt: "Photo " + (i + 1) }),
      el("button", {
        "aria-label": "Retirer la photo",
        onclick: () => { state.photos.splice(i, 1); renderPhotos(); },
      }, "×"),
    ),
  ));
  $("#photo-count").textContent = `(${state.photos.length}/${MAX_PHOTOS})`;
  const full = state.photos.length >= MAX_PHOTOS;
  $("#lbl-camera").classList.toggle("hidden", full);
  $("#lbl-gallery").classList.toggle("hidden", full);
  refreshCreer();
}

function refreshCreer() {
  const hasKey = !!getApiKey();
  $("#no-key-banner").classList.toggle("hidden", hasKey);
  $("#btn-generer").disabled = !hasKey || state.photos.length === 0;
}

/* =========================================================
   Onglet Répondre
   ========================================================= */

function startSession(quizId, questionIds) {
  const quiz = findQuiz(quizId);
  state.session = {
    quizId,
    questionIds: questionIds || quiz.questions.map((q) => q.id),
    answers: {},
    correction: null,
  };
  saveSession();
  updateTabDot();
  showView("repondre");
}

function renderRepondre() {
  const view = $("#view-repondre");
  const s = state.session;
  const quiz = s && findQuiz(s.quizId);

  if (!quiz) {
    view.replaceChildren(
      el("div", { class: "card empty" },
        el("span", { class: "empty-mark" }),
        el("p", {}, "Pas de quiz en cours."),
        el("p", {}, "Crée-en un nouveau ou choisis-en un dans ton historique !"),
        el("div", { class: "row" },
          el("button", { class: "btn", onclick: () => showView("creer") }, "Créer"),
          el("button", { class: "btn secondary", onclick: () => showView("historique") }, "Historique"),
        ),
      ),
    );
    return;
  }

  if (s.correction) {
    view.replaceChildren(...renderCorrection(quiz, s.correction, true));
    return;
  }

  const questions = s.questionIds.map((id) => quiz.questions.find((q) => q.id === id)).filter(Boolean);
  const progressBar = el("div");
  const progressText = el("small");

  const updateProgress = () => {
    const done = questions.filter((q) => String(s.answers[q.id] ?? "").trim()).length;
    progressBar.style.width = (done / questions.length) * 100 + "%";
    progressText.textContent = `${done} / ${questions.length} réponses`;
  };

  const setAnswer = (qid, value) => {
    s.answers[qid] = value;
    saveSession();
    updateProgress();
  };

  const head = el("div", { class: "card quiz-head" },
    el("h2", {}, quiz.titre),
    el("div", { class: "badges" },
      el("span", { class: "badge" }, quiz.matiere),
      el("span", { class: "badge rose" }, quiz.niveau),
      s.questionIds.length < quiz.questions.length ? el("span", { class: "badge orange" }, "Questions ratées") : null,
    ),
    el("div", { class: "progress" }, progressBar),
    progressText,
  );

  const cards = questions.map((q, i) => renderQuestion(q, i, questions.length, s.answers[q.id], setAnswer));

  const submit = el("button", {
    class: "btn big",
    onclick: () => {
      const vides = questions.filter((q) => !String(s.answers[q.id] ?? "").trim()).length;
      if (vides && !confirm(`Il te reste ${vides} question(s) sans réponse. Voir la correction quand même ?`)) return;
      correctSession();
    },
  }, "Voir la correction");

  view.replaceChildren(head, ...cards, submit);
  updateProgress();
}

function renderQuestion(q, index, total, current, setAnswer) {
  const card = el("div", { class: "card question" },
    el("div", { class: "num" }, `Question ${index + 1} / ${total} · ${TYPE_LABELS[q.type]}`),
    el("div", { class: "enonce" }, q.enonce),
  );

  if (q.type === "qcm" || q.type === "vrai_faux") {
    const options = q.type === "qcm" ? q.choix : ["vrai", "faux"];
    const box = el("div", { class: "choices" + (q.type === "vrai_faux" ? " vf" : "") });
    for (const opt of options) {
      const btn = el("button", {
        type: "button",
        class: "choice" + (current === opt ? " selected" : ""),
        onclick: () => {
          for (const b of box.children) b.classList.remove("selected");
          btn.classList.add("selected");
          setAnswer(q.id, opt);
        },
      }, q.type === "vrai_faux" ? (opt === "vrai" ? "Vrai" : "Faux") : opt);
      box.append(btn);
    }
    card.append(box);
  } else if (q.type === "redigee") {
    const ta = el("textarea", { placeholder: "Écris ta réponse en quelques phrases…" });
    ta.value = current || "";
    ta.addEventListener("input", () => setAnswer(q.id, ta.value));
    card.append(ta);
  } else {
    const inp = el("input", {
      type: "text",
      placeholder: q.type === "trous" ? "Le mot manquant…" : "Ta réponse…",
      autocomplete: "off",
    });
    inp.value = current || "";
    inp.addEventListener("input", () => setAnswer(q.id, inp.value));
    card.append(inp);
  }
  return card;
}

/* ---------- Affichage de la correction ---------- */

function encouragement(ratio) {
  if (ratio === 1) return "Parfait ! Tu maîtrises ce cours !";
  if (ratio >= 0.8) return "Excellent travail !";
  if (ratio >= 0.6) return "Bien joué, encore un petit effort !";
  if (ratio >= 0.4) return "Pas mal ! Relis les points ratés et retente.";
  return "Courage ! Relis ton cours et refais le quiz, tu vas progresser.";
}

function renderCorrection(quiz, t, withActions) {
  const ratio = t.total ? t.score / t.total : 0;
  const rates = t.questionIds.filter((id) => t.resultats[id]?.verdict !== "juste");

  const scoreCard = el("div", { class: "card score-card" },
    el("h2", {}, quiz.titre),
    el("div", { class: "score-big" }, formatScore(t.score), el("small", {}, " / " + t.total)),
    el("p", {}, encouragement(ratio)),
    el("small", {}, formatDate(t.date) + (t.partielle ? " · questions ratées seulement" : "")),
  );

  const nodes = [scoreCard];

  if (withActions) nodes.push(actionsRow(quiz, rates));

  t.questionIds.forEach((id, i) => {
    const q = quiz.questions.find((x) => x.id === id);
    if (!q) return;
    const r = t.resultats[id] || { verdict: "faux", commentaire: "" };
    const label = { juste: "Juste", partiel: "Presque", faux: "Pas tout à fait" }[r.verdict];
    const vf = (v) => (v === "vrai" ? "Vrai" : v === "faux" ? "Faux" : v);
    const answer = String(t.answers[id] ?? "").trim();
    const shown = q.type === "vrai_faux" ? vf(answer) : answer;
    const bonne = q.type === "vrai_faux" ? vf(q.reponse) : q.reponse;

    nodes.push(el("div", { class: "card result " + r.verdict },
      el("div", { class: "num" }, `Question ${i + 1} · ${TYPE_LABELS[q.type]}`),
      el("div", { class: "verdict" }, label),
      el("div", { class: "enonce" }, q.enonce),
      el("div", { class: "answer-line" }, el("b", {}, "Ta réponse"), shown || "(pas de réponse)"),
      r.verdict !== "juste" || q.type === "redigee"
        ? el("div", { class: "answer-line" }, el("b", {}, q.type === "redigee" ? "Ce qui était attendu" : "La bonne réponse"), bonne)
        : null,
      r.commentaire ? el("div", { class: "commentaire" }, " " + r.commentaire) : null,
      q.explication ? el("div", { class: "explication" }, " " + q.explication) : null,
    ));
  });

  if (withActions) nodes.push(actionsRow(quiz, rates));
  return nodes;
}

function actionsRow(quiz, rates) {
  return el("div", { class: "row", style: "margin-bottom:14px" },
    el("button", { class: "btn", onclick: () => startSession(quiz.id, null) }, "Refaire tout"),
    rates.length
      ? el("button", { class: "btn orange", onclick: () => startSession(quiz.id, rates) }, `Refaire les ratées (${rates.length})`)
      : null,
  );
}

/* =========================================================
   Onglet Historique
   ========================================================= */

function renderHistorique() {
  const view = $("#view-historique");

  if (state.quizzes.length === 0) {
    view.replaceChildren(
      el("div", { class: "card empty" },
        el("span", { class: "empty-mark" }),
        el("p", {}, "Ton historique est vide pour l'instant."),
        el("button", { class: "btn", onclick: () => showView("creer") }, "Créer mon premier quiz"),
      ),
    );
    return;
  }

  const items = state.quizzes.map((quiz) => {
    const last = quiz.tentatives[quiz.tentatives.length - 1];
    const complets = quiz.tentatives.filter((t) => !t.partielle);
    const best = complets.reduce((m, t) => Math.max(m, t.score / t.total), -1);
    const rates = last ? last.questionIds.filter((id) => last.resultats[id]?.verdict !== "juste") : [];

    let resume = "Pas encore fait";
    if (last) {
      resume = `Dernier score : ${formatScore(last.score)}/${last.total}`;
      if (best >= 0) resume += ` · Record : ${Math.round(best * 100)} %`;
    }

    return el("div", { class: "card hist-item" },
      el("h3", {}, quiz.titre),
      el("div", { class: "badges" },
        el("span", { class: "badge" }, quiz.matiere),
        el("span", { class: "badge rose" }, quiz.niveau),
        el("span", { class: "badge orange" }, quiz.questions.length + " questions"),
      ),
      el("div", { class: "meta" }, formatDate(quiz.createdAt) + " · " + resume),
      el("div", { class: "actions" },
        el("button", {
          class: "btn small",
          onclick: () => startSession(quiz.id, null),
        }, "Refaire"),
        last
          ? el("button", { class: "btn small secondary", onclick: () => showCorrectionFromHistory(quiz.id) }, "Correction")
          : el("button", { class: "btn small secondary", disabled: true }, "Correction"),
        rates.length
          ? el("button", { class: "btn small orange", onclick: () => startSession(quiz.id, rates) }, `Ratées (${rates.length})`)
          : el("button", { class: "btn small orange", disabled: true }, "Ratées"),
        el("button", { class: "btn small danger", onclick: () => deleteQuiz(quiz.id) }, "Supprimer"),
      ),
    );
  });

  view.replaceChildren(el("h1", { style: "margin:8px 4px 14px" }, "Mes quiz"), ...items);
}

function showCorrectionFromHistory(quizId) {
  const quiz = findQuiz(quizId);
  const last = quiz.tentatives[quiz.tentatives.length - 1];
  const view = $("#view-historique");
  view.replaceChildren(
    el("button", { class: "btn secondary small", style: "margin:4px 0 14px", onclick: renderHistorique }, "← Retour à l'historique"),
    ...renderCorrection(quiz, last, true),
  );
  window.scrollTo({ top: 0 });
}

function deleteQuiz(id) {
  const quiz = findQuiz(id);
  if (!confirm(`Supprimer le quiz « ${quiz.titre} » ?`)) return;
  state.quizzes = state.quizzes.filter((q) => q.id !== id);
  saveQuizzes();
  if (state.session?.quizId === id) {
    state.session = null;
    saveSession();
    updateTabDot();
  }
  renderHistorique();
  toast("Quiz supprimé");
}

/* =========================================================
   Réglages
   ========================================================= */

function openSettings() {
  $("#inp-key").value = getApiKey();
  $("#key-status").textContent = "";
  $("#backup-status").textContent = "";
  $("#settings").classList.remove("hidden");
}

function setStatus(sel, msg, ok) {
  const s = $(sel);
  s.textContent = msg;
  s.className = "status " + (ok ? "ok" : "err");
}

function setupSettings() {
  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-close-settings").addEventListener("click", () => $("#settings").classList.add("hidden"));
  $("#settings").addEventListener("click", (e) => {
    if (e.target.id === "settings") $("#settings").classList.add("hidden");
  });

  $("#btn-save-key").addEventListener("click", () => {
    const key = $("#inp-key").value.trim();
    if (key && !key.startsWith("sk-ant-")) {
      setStatus("#key-status", "Cette clé ne ressemble pas à une clé Claude (elle commence par sk-ant-).", false);
      return;
    }
    if (key) save(KEYS.apiKey, key);
    else try { localStorage.removeItem(KEYS.apiKey); } catch { /* ignore */ }
    setStatus("#key-status", key ? "Clé enregistrée" : "Clé effacée.", true);
    refreshCreer();
  });

  $("#btn-test-key").addEventListener("click", async () => {
    const key = $("#inp-key").value.trim();
    if (!key) { setStatus("#key-status", "Entre d'abord une clé.", false); return; }
    setStatus("#key-status", "Test en cours…", true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/models/" + MODEL, {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      if (res.ok) setStatus("#key-status", "La clé fonctionne", true);
      else if (res.status === 401) setStatus("#key-status", "Clé refusée", false);
      else setStatus("#key-status", "Réponse inattendue (" + res.status + ").", false);
    } catch {
      setStatus("#key-status", "Pas de connexion internet ?", false);
    }
  });

  $("#btn-export").addEventListener("click", () => {
    const data = JSON.stringify({ app: "revisquiz", version: 1, quizzes: state.quizzes }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const a = el("a", {
      href: URL.createObjectURL(blob),
      download: "revisquiz-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json",
    });
    document.body.append(a);
    a.click();
    a.remove();
    setStatus("#backup-status", "Sauvegarde téléchargée", true);
  });

  $("#input-import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "revisquiz" || !Array.isArray(data.quizzes)) throw new Error("format");
      const ids = new Set(state.quizzes.map((q) => q.id));
      const nouveaux = data.quizzes.filter((q) => q && q.id && Array.isArray(q.questions) && !ids.has(q.id));
      state.quizzes = [...state.quizzes, ...nouveaux].sort((a, b) => b.createdAt - a.createdAt);
      saveQuizzes();
      setStatus("#backup-status", `${nouveaux.length} quiz importé(s)`, true);
    } catch {
      setStatus("#backup-status", "Ce fichier n'est pas une sauvegarde Révis'Quiz.", false);
    }
  });
}

/* =========================================================
   Confettis
   ========================================================= */

function launchConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = $("#confetti");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ["#6f8f72", "#cf9d3f", "#c0704f", "#50697f", "#2e2b27"];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80,
    y: innerHeight / 3,
    vx: (Math.random() - 0.5) * 12,
    vy: Math.random() * -12 - 4,
    size: 6 + Math.random() * 6,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  (function frame(now) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (now - start < 3000) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(start);
}

/* =========================================================
   Démarrage
   ========================================================= */

function init() {
  setupCreer();
  setupSettings();
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => showView(tab.dataset.view));
  }
  renderPhotos();
  updateTabDot();

  if (state.session && !state.session.correction && findQuiz(state.session.quizId)) {
    showView("repondre");
  } else {
    showView("creer");
  }
  if (!getApiKey()) openSettings();

  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ("serviceWorker"in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
