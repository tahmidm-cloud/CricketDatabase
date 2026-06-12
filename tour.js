let PLAYER_DATA = [];
let DATA_SOURCE_LABEL = "No data loaded";

const DEFAULT_JSON_FILES = ["./data/players.json"];

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function averageNumbers(values) {
  const nums = values.map(Number).filter(n => Number.isFinite(n));

  if (!nums.length) return 0;

  return Math.round(nums.reduce((total, n) => total + n, 0) / nums.length);
}

function looksLikePlayersArray(arr) {
  return Array.isArray(arr) && arr.some(
    p =>
      p &&
      typeof p === "object" &&
      ("name" in p || "fullName" in p) &&
      ("nationality" in p || "country" in p || "role" in p)
  );
}

function findPlayersArray(value, depth = 0) {
  if (!value || depth > 4) return null;

  if (looksLikePlayersArray(value)) return value;
  if (Array.isArray(value)) return null;

  if (typeof value === "object") {
    const preferred = [
      "players",
      "PLAYER_DATA",
      "playerData",
      "player_data",
      "data",
      "items",
      "records"
    ];

    for (const key of preferred) {
      if (key in value) {
        const found = findPlayersArray(value[key], depth + 1);
        if (found) return found;
      }
    }

    for (const key of Object.keys(value)) {
      const found = findPlayersArray(value[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function normalizeRole(role) {
  const r = String(role || "").trim().toLowerCase().replaceAll("_", "-");

  if (r.includes("keeper") || r === "wk") return "wicket-keeper";
  if (r.includes("round")) return "all-rounder";
  if (r.includes("bowl")) return "bowler";
  if (r.includes("bat")) return "batsman";

  return r || "batsman";
}

function normalizePlayer(p, index) {
  const attributes = p.attributes || {};
  const fieldingAttrs = attributes.fielding || {};
  const physicalAttrs = attributes.physical || {};

  const battingOverall = toNumber(
    p.battingOverall ??
      p.bat ??
      p.batting ??
      p.battingRating ??
      p.batting_rating ??
      attributes.overall?.batting_overall
  );

  const bowlingOverall = toNumber(
    p.bowlingOverall ??
      p.bowl ??
      p.bowling ??
      p.bowlingRating ??
      p.bowling_rating ??
      attributes.overall?.bowling_overall
  );

  const fieldingOverall = toNumber(
    p.fieldingOverall ??
      p.field ??
      p.fielding ??
      p.fieldingRating ??
      p.fielding_rating ??
      averageNumbers([
        fieldingAttrs.catching,
        fieldingAttrs.reflexes,
        fieldingAttrs.groundFielding,
        fieldingAttrs.throwPower,
        fieldingAttrs.throwAccuracy
      ])
  );

  const stamina = toNumber(
    p.stamina ??
      p.endurance ??
      physicalAttrs.stamina ??
      physicalAttrs.endurance
  );

  const fitness = toNumber(
    p.fitness ??
      p.fitnessOverall ??
      p.condition?.fitness,
    100
  );

  const batStyle =
    p.primaryPlaystyle?.batting ||
    p.topPlaystyles?.batting?.[0]?.name ||
    p.batStyle ||
    p.battingStyleName ||
    p.battingPlaystyle ||
    p.playstyle?.batting ||
    "None";

  const bowlStyle =
    p.primaryPlaystyle?.bowling ||
    p.topPlaystyles?.bowling?.[0]?.name ||
    p.bowlStyle ||
    p.bowlingStyleName ||
    p.bowlingPlaystyle ||
    p.playstyle?.bowling ||
    "None";

  return {
    ...p,
    id: String(p.id ?? p.playerId ?? p.player_id ?? p.slug ?? `player_${index}`),
    name: p.name ?? p.fullName ?? p.playerName ?? p.player_name ?? `Player ${index + 1}`,
    fullName: p.fullName ?? p.name ?? p.playerName ?? p.player_name ?? `Player ${index + 1}`,
    nationality: p.nationality ?? p.country ?? p.team ?? p.nation ?? "Unknown",
    role: normalizeRole(p.role ?? p.playerRole ?? p.player_role),
    battingHand: p.battingHand ?? p.batHand ?? p.batting_hand ?? p.hand ?? "",
    bowlingType: p.bowlingType ?? p.bowlType ?? p.bowling_type ?? "",
    bowlingStyle:
      p.bowlingStyle ??
      p.bowlStyleFull ??
      p.bowling_style ??
      p.bowlingType ??
      p.bowlStyle ??
      "None",
    battingOverall,
    bowlingOverall,
    fieldingOverall,
    stamina,
    fitness,
    primaryPlaystyle: {
      ...(p.primaryPlaystyle || {}),
      batting: batStyle,
      bowling: bowlStyle,
      fielding: p.primaryPlaystyle?.fielding || p.fieldingStyle || "Wicketkeeper"
    }
  };
}

function loadPlayersFromData(rawData, sourceLabel = "JSON file") {
  const arr = findPlayersArray(rawData);

  if (!arr) {
    throw new Error("No player array found. Use an array of player objects or an object with a players array.");
  }

  PLAYER_DATA = arr.map(normalizePlayer).filter(p => p.name && p.nationality);

  if (!PLAYER_DATA.length) {
    throw new Error("The JSON loaded, but no valid players were found.");
  }

  DATA_SOURCE_LABEL = sourceLabel;

  state.userTeam = "";
  state.computerTeam = "";
  state.series = [];
  state.userSquad = [];
  state.computerSquad = [];

  state.formatSquads = {
    Test: null,
    ODI: null,
    T20: null
  };

  state.activeSquadFormat = null;
  state.activeSquadMatchIndex = null;

  fillTeamDropdowns();

  const restored = restoreTourStateAfterDataLoad();

  if (!restored) {
    showScreen("setup", false);
  }

  hideMsg("setupMsg");
  $("dataSource").textContent = `Loaded from ${sourceLabel}`;
  finishAppLoading();
}

async function tryFetchDefaultData() {
  for (const file of DEFAULT_JSON_FILES) {
    try {
      const response = await fetch(file, { cache: "no-store" });

      if (!response.ok) continue;

      const data = await response.json();

      loadPlayersFromData(data, file.replace("./", ""));
      return true;
    } catch (err) {
      console.error(`Could not load ${file}:`, err);
    }
  }

  return false;
}

async function initData() {
  $("databaseCount").textContent = "Looking for JSON...";
  $("dataSource").textContent = "Put data/players.json inside the frontend folder, or click Load JSON.";

  const loaded = await tryFetchDefaultData();

  if (!loaded) {
    PLAYER_DATA = [];
    fillTeamDropdowns();
    $("databaseCount").textContent = "No JSON loaded";
    showScreen("setup", false);
    showMsg(
      "setupMsg",
      "No player JSON loaded yet. Make sure the file is at data/players.json inside this frontend folder, or click Load JSON."
    );
    finishAppLoading();
  }
}

function handleJsonUpload(event) {
  const file = event.target.files?.[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      loadPlayersFromData(data, file.name);
      showMsg("setupMsg", `Loaded ${PLAYER_DATA.length} players from ${file.name}.`, false);
    } catch (err) {
      showMsg("setupMsg", `Could not load JSON: ${err.message}`);
    }
  };

  reader.onerror = () => showMsg("setupMsg", "Could not read that JSON file.");
  reader.readAsText(file);
}

const TEAM_LOGOS = {
  Afghanistan: "assets/team-logos/afghanistan.png",
  Australia: "assets/team-logos/australia.png",
  Bangladesh: "assets/team-logos/bangladesh.png",
  Canada: "assets/team-logos/canada.png",
  England: "assets/team-logos/england.png",
  India: "assets/team-logos/india.png",
  Ireland: "assets/team-logos/ireland.png",
  Namibia: "assets/team-logos/namibia.png",
  Nepal: "assets/team-logos/nepal.png",
  Netherlands: "assets/team-logos/netherlands.png",
  "New Zealand": "assets/team-logos/new-zealand.png",
  Oman: "assets/team-logos/oman.png",
  Pakistan: "assets/team-logos/pakistan.png",
  Scotland: "assets/team-logos/scotland.png",
  "South Africa": "assets/team-logos/south-africa.png",
  "Sri Lanka": "assets/team-logos/sri-lanka.png",
  "United Arab Emirates": "assets/team-logos/united-arab-emirates.png",
  "United States of America": "assets/team-logos/united-states-of-america.png",
  "West Indies": "assets/team-logos/west-indies.png",
  Zimbabwe: "assets/team-logos/zimbabwe.png"
};

const state = {
  userTeam: "",
  computerTeam: "",
  series: [],

  // Used temporarily by the old squad picker screen
  userSquad: [],
  computerSquad: [],

  // New format-based saved squads
  formatSquads: {
    Test: null,
    ODI: null,
    T20: null
  },

  activeSquadFormat: null,
  activeSquadMatchIndex: null
};

let squadSort = {
  key: "overall",
  direction: "desc"
};

let tourProgress = {
  completedMatchIndexes: [],
  activeMatchIndex: null,
  matchResults: {}
};

function ensureTourProgressShape() {
  if (!tourProgress || typeof tourProgress !== "object") {
    tourProgress = {};
  }

  if (!Array.isArray(tourProgress.completedMatchIndexes)) {
    tourProgress.completedMatchIndexes = [];
  }

  if (!tourProgress.matchResults || typeof tourProgress.matchResults !== "object") {
    tourProgress.matchResults = {};
  }

  if (!("activeMatchIndex" in tourProgress)) {
    tourProgress.activeMatchIndex = null;
  }
}

function syncTourProgressFromStorage() {
  const raw = localStorage.getItem(TOUR_STORAGE_KEY);

  if (!raw) {
    ensureTourProgressShape();
    return;
  }

  try {
    const saved = JSON.parse(raw);

    if (saved?.tourProgress) {
      tourProgress = {
        completedMatchIndexes: Array.isArray(saved.tourProgress.completedMatchIndexes)
          ? saved.tourProgress.completedMatchIndexes
          : [],

        activeMatchIndex: saved.tourProgress.activeMatchIndex ?? null,

        matchResults:
          saved.tourProgress.matchResults &&
          typeof saved.tourProgress.matchResults === "object"
            ? saved.tourProgress.matchResults
            : {}
      };
    }
  } catch (error) {
    console.error("Could not sync tour progress:", error);
  }

  ensureTourProgressShape();
}

function getSavedMatchResult(matchIndex) {
  ensureTourProgressShape();
  return tourProgress.matchResults?.[String(matchIndex)] || null;
}

const TOUR_STORAGE_KEY = "cricketTourSetupSave_v1";
let currentScreenName = "setup";

let isRestoringTour = false;

let lastUserTeam = "";
let lastComputerTeam = "";
let teamCardsReady = false;

const $ = id => document.getElementById(id);

const uniqueTeams = () =>
  [...new Set(PLAYER_DATA.map(p => p.nationality).filter(Boolean))].sort();

const teamPlayers = team => PLAYER_DATA.filter(p => p.nationality === team);


function isPlayerEligibleForFormat(player, format) {
  const formatKey = String(format || "").toLowerCase();
  const nationalFormats = player.nationalFormats || player.formats || null;

  if (!nationalFormats) return true;

  if (formatKey === "test") {
    return (
      nationalFormats.test === true ||
      nationalFormats.Test === true ||
      nationalFormats.TEST === true
    );
  }

  if (formatKey === "odi") {
    return (
      nationalFormats.odi === true ||
      nationalFormats.ODI === true
    );
  }

  if (formatKey === "t20") {
    return (
      nationalFormats.t20 === true ||
      nationalFormats.T20 === true ||
      nationalFormats.t20i === true ||
      nationalFormats.T20I === true
    );
  }

  return true;
}

function formatTeamPlayers(team, format) {
  const allTeamPlayers = teamPlayers(team);

  if (!format) return allTeamPlayers;

  const eligiblePlayers = allTeamPlayers.filter(player =>
    isPlayerEligibleForFormat(player, format)
  );

  return eligiblePlayers.length >= 11 ? eligiblePlayers : allTeamPlayers;
}

function formatTeamPlayers(team, format) {
  const allTeamPlayers = teamPlayers(team);

  if (!format) return allTeamPlayers;

  const eligiblePlayers = allTeamPlayers.filter(player =>
    isPlayerEligibleForFormat(player, format)
  );

  // If too few eligible players exist, fallback to all team players.
  return eligiblePlayers.length >= 11 ? eligiblePlayers : allTeamPlayers;
}


const esc = v =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const cssSafe = v => String(v ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");

const overallScore = p =>
  Number(p.battingOverall || 0) +
  Number(p.bowlingOverall || 0) +
  Number(p.fieldingOverall || 0) / 2 +
  Number(p.stamina || 0) / 3;

function initials(team) {
  return String(team || "TM")
    .split(/\s+/)
    .filter(Boolean)
    .map(x => x[0])
    .slice(0, 3)
    .join("")
    .toUpperCase();
}

function showLogo(imgId, fallbackId, team) {
  const img = $(imgId);
  const fallback = $(fallbackId);

  fallback.textContent = initials(team);

  const logoPath = TEAM_LOGOS[team];

  if (!team || !logoPath) {
    img.removeAttribute("src");
    img.style.display = "none";
    fallback.style.display = "flex";
    return;
  }

  img.onerror = () => {
    img.style.display = "none";
    fallback.style.display = "flex";
  };

  img.onload = () => {
    img.style.display = "block";
    fallback.style.display = "none";
  };

  fallback.style.display = "none";
  img.style.display = "block";
  img.src = logoPath;
}

function fillTeamDropdowns() {
  const teams = uniqueTeams();

  if (!teams.length) {
    $("userTeamSelect").innerHTML = `<option value="">Load JSON first</option>`;
    $("computerTeamSelect").innerHTML = `<option value="">Load JSON first</option>`;
    $("databaseCount").textContent = "No JSON loaded";
    updateTeamCards();
    return;
  }

  const html = teams.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");

  $("userTeamSelect").innerHTML = html;
  $("computerTeamSelect").innerHTML = html;

  $("userTeamSelect").value = teams.includes("England") ? "England" : teams[0];

  $("computerTeamSelect").value =
    teams.includes("Australia") && $("userTeamSelect").value !== "Australia"
      ? "Australia"
      : teams.find(t => t !== $("userTeamSelect").value) || teams[0];

  $("userTeamSelect").onchange = () => {
    updateTeamCards();
    saveTourState("setup");
  };

  $("computerTeamSelect").onchange = () => {
    updateTeamCards();
    saveTourState("setup");
  };

  $("databaseCount").textContent = `${PLAYER_DATA.length} players • ${teams.length} teams`;

  updateTeamCards();
}

function teamStatsHtml(team) {
  const list = teamPlayers(team);
  const bats = list.filter(p => p.role === "batsman").length;
  const bowlers = list.filter(p => p.role === "bowler").length;
  const ars = list.filter(p => p.role === "all-rounder").length;
  const keepers = list.filter(p => p.role === "wicket-keeper").length;

  return `
    <span class="mini-stat">${list.length} players</span>
    <span class="mini-stat">${bats} bat</span>
    <span class="mini-stat">${bowlers} bowl</span>
    <span class="mini-stat">${ars} AR</span>
    <span class="mini-stat">${keepers} WK</span>
  `;
}

function animateTeamChange(cardId, logoId, statsId) {
  const card = $(cardId);
  const logo = $(logoId);
  const stats = $(statsId);

  if (!card) return;

  card.classList.remove("team-changed");
  void card.offsetWidth;
  card.classList.add("team-changed");

  if (logo) {
    logo.classList.remove("logo-fade-in");
    void logo.offsetWidth;
    logo.classList.add("logo-fade-in");
  }

  if (stats) {
    stats.classList.remove("stats-smooth");
    void stats.offsetWidth;
    stats.classList.add("stats-smooth");
  }
}


function updateTeamCards() {
  const user = $("userTeamSelect").value;
  const computer = $("computerTeamSelect").value;

  const userChanged = teamCardsReady && user !== lastUserTeam;
  const computerChanged = teamCardsReady && computer !== lastComputerTeam;

  $("userTeamName").textContent = user || "Load JSON";
  $("computerTeamName").textContent = computer || "Load JSON";

  $("userTeamDetails").textContent = user
    ? `${teamPlayers(user).length} available players for the tour.`
    : "Load a player JSON file to start.";

  $("computerTeamDetails").textContent = computer
    ? `${teamPlayers(computer).length} available computer players.`
    : "Opponent teams appear after JSON loads.";

  $("userTeamStats").innerHTML = user ? teamStatsHtml(user) : "";
  $("computerTeamStats").innerHTML = computer ? teamStatsHtml(computer) : "";

  showLogo("userLogo", "userFallback", user);
  showLogo("computerLogo", "computerFallback", computer);

  if (userChanged) {
    animateTeamChange("userTeamCard", "userLogo", "userTeamStats");
  }

  if (computerChanged) {
    animateTeamChange("computerTeamCard", "computerLogo", "computerTeamStats");
  }

  lastUserTeam = user;
  lastComputerTeam = computer;
  teamCardsReady = true;
}

function showScreen(name, shouldSave = true) {
  currentScreenName = name;

  $("setupScreen").classList.toggle("active", name === "setup");
  $("squadScreen").classList.toggle("active", name === "squad");
  $("summaryScreen").classList.toggle("active", name === "summary");

  $("stepSetup").classList.toggle("active", name === "setup");
  $("stepSquad").classList.toggle("active", name === "squad");
  $("stepSummary").classList.toggle("active", name === "summary");

  document.body.classList.toggle("main-page", name === "setup");
  document.body.classList.toggle("sub-page", name !== "setup");
  document.body.classList.toggle("squad-page", name === "squad");
  document.body.classList.toggle("summary-page", name === "summary");

  if (name === "squad" && state.userTeam && PLAYER_DATA.length) {
    renderPlayerTable();
  }

  if (name === "summary") {
    syncTourProgressFromStorage();
    renderSummary();
  }

  if (shouldSave) {
    saveTourState(name);
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showMsg(id, text, error = true) {
  const el = $(id);

  el.textContent = text;
  el.classList.toggle("error", error);
  el.classList.add("show");
}

function hideMsg(id) {
  $(id).classList.remove("show");
}

function makeMatches(testCount, odiCount, t20Count) {
  const matches = [];
  let n = 1;

  for (let i = 1; i <= testCount; i++) {
    matches.push({ matchNo: n++, format: "Test", label: `Test ${i}` });
  }

  for (let i = 1; i <= odiCount; i++) {
    matches.push({ matchNo: n++, format: "ODI", label: `ODI ${i}` });
  }

  for (let i = 1; i <= t20Count; i++) {
    matches.push({ matchNo: n++, format: "T20", label: `T20 ${i}` });
  }

  return matches;
}

const SERIES_LIMITS = {
  tests: { min: 0, max: 5, label: "Test", plural: "Tests" },
  odis: { min: 0, max: 5, label: "ODI", plural: "ODIs" },
  t20s: { min: 0, max: 5, label: "T20", plural: "T20s" }
};

function changeSeriesCount(id, amount) {
  const input = $(id);

  if (!input) return;

  const limits = SERIES_LIMITS[id];
  const currentValue = Number(input.value) || 0;

  let nextValue = currentValue + amount;
  nextValue = Math.max(limits.min, Math.min(limits.max, nextValue));

  input.value = String(nextValue);

  updateSeriesCounterUI();
  saveTourState("setup");
}

function getSeriesLabel(id, value) {
  const limits = SERIES_LIMITS[id];

  if (value === 0) {
    return id === "tests" ? "No Tests" : `No ${limits.plural}`;
  }

  if (value === 1) {
    return id === "tests" ? "1 Test" : `1 ${limits.label}`;
  }

  return `${value} ${limits.plural}`;
}

function updateSeriesCounterUI() {
  const tests = Number($("tests")?.value) || 0;
  const odis = Number($("odis")?.value) || 0;
  const t20s = Number($("t20s")?.value) || 0;

  if ($("testsCount")) $("testsCount").textContent = tests;
  if ($("odisCount")) $("odisCount").textContent = odis;
  if ($("t20sCount")) $("t20sCount").textContent = t20s;

  if ($("testsLabel")) $("testsLabel").textContent = getSeriesLabel("tests", tests);
  if ($("odisLabel")) $("odisLabel").textContent = getSeriesLabel("odis", odis);
  if ($("t20sLabel")) $("t20sLabel").textContent = getSeriesLabel("t20s", t20s);

  const total = tests + odis + t20s;

  if ($("seriesPreviewText")) {
    $("seriesPreviewText").textContent = `${tests} Test • ${odis} ODI • ${t20s} T20`;
  }

  if ($("seriesTotalText")) {
    $("seriesTotalText").textContent = `${total} total match${total === 1 ? "" : "es"}`;
  }
}


function createSeries() {
  hideMsg("setupMsg");

  const user = $("userTeamSelect").value;
  const computer = $("computerTeamSelect").value;
  const tests = Number($("tests").value);
  const odis = Number($("odis").value);
  const t20s = Number($("t20s").value);

  if (!PLAYER_DATA.length) return showMsg("setupMsg", "Load your player JSON first.");
  if (!user || !computer) return showMsg("setupMsg", "Choose two teams after loading JSON.");
  if (user === computer) return showMsg("setupMsg", "Choose two different national teams.");
  if (tests + odis + t20s === 0) return showMsg("setupMsg", "Choose at least one match. All formats cannot be None.");
  if (teamPlayers(user).length < 12) return showMsg("setupMsg", `${user} has fewer than 12 available players.`);
  if (teamPlayers(computer).length < 12) return showMsg("setupMsg", `${computer} has fewer than 12 available players.`);

  state.userTeam = user;
  state.computerTeam = computer;
  state.series = makeMatches(tests, odis, t20s);

  // No squad selection here anymore.
  state.userSquad = [];
  state.computerSquad = [];

  state.formatSquads = {
    Test: null,
    ODI: null,
    T20: null
  };

  state.activeSquadFormat = null;
  state.activeSquadMatchIndex = null;

  tourProgress = {
    completedMatchIndexes: [],
    activeMatchIndex: null,
    matchResults: {}
  };

  saveTourState("summary");
  showScreen("summary");
}

/* =========================================================
   COMPUTER BEST SQUAD PICKER
   Uses national format eligibility + role balance
========================================================= */

const COMPUTER_SQUAD_SIZE = 18;

const COMPUTER_SQUAD_TARGETS = {
  batsman: 7,
  wicketkeeper: 2,
  allrounder: 4,
  bowler: 5
};

function getSelectedNationalFormats() {
  const formats = new Set();

  state.series.forEach((match) => {
    const format = String(match.format || "").toLowerCase();

    if (format.includes("test")) formats.add("test");
    if (format.includes("odi")) formats.add("odi");
    if (format.includes("t20")) formats.add("t20");
  });

  return [...formats];
}

function isPlayerEligibleForSelectedFormats(player, selectedFormats) {
  if (!selectedFormats.length) return true;

  const nationalFormats = player.nationalFormats || player.formats || null;

  // If old JSON does not have nationalFormats, do not block the player.
  if (!nationalFormats) return true;

  return selectedFormats.some((format) => {
    if (format === "test") {
      return nationalFormats.test === true || nationalFormats.Test === true || nationalFormats.TEST === true;
    }

    if (format === "odi") {
      return nationalFormats.odi === true || nationalFormats.ODI === true;
    }

    if (format === "t20") {
      return (
        nationalFormats.t20 === true ||
        nationalFormats.T20 === true ||
        nationalFormats.t20i === true ||
        nationalFormats.T20I === true
      );
    }

    return false;
  });
}

function getPlayerRoleGroup(player) {
  const role = String(player.role || player.playerRole || "").toLowerCase();
  const keeping = Number(player.attributes?.fielding?.keeping) || 0;

  if (
    role.includes("wicket") ||
    role.includes("keeper") ||
    role.includes("wk") ||
    keeping >= 14
  ) {
    return "wicketkeeper";
  }

  if (
    role.includes("all-rounder") ||
    role.includes("all rounder") ||
    role.includes("allrounder")
  ) {
    return "allrounder";
  }

  if (role.includes("bowler") || role === "bowl") {
    return "bowler";
  }

  return "batsman";
}

function getPlayerFormatBonus(player, selectedFormats) {
  const nationalFormats = player.nationalFormats || player.formats || null;

  if (!nationalFormats || !selectedFormats.length) return 0;

  let bonus = 0;

  selectedFormats.forEach((format) => {
    if (format === "test" && (nationalFormats.test || nationalFormats.Test || nationalFormats.TEST)) bonus += 4;
    if (format === "odi" && (nationalFormats.odi || nationalFormats.ODI)) bonus += 4;
    if (format === "t20" && (nationalFormats.t20 || nationalFormats.T20 || nationalFormats.t20i || nationalFormats.T20I)) bonus += 4;
  });

  return bonus;
}

function getFieldingAverage(player) {
  const fielding = player.attributes?.fielding || {};

  const values = [
    Number(fielding.catching) || 0,
    Number(fielding.reflexes) || 0,
    Number(fielding.groundFielding) || 0,
    Number(fielding.throwPower) || 0,
    Number(fielding.throwAccuracy) || 0
  ];

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getComputerSquadScore(player, selectedFormats) {
  const roleGroup = getPlayerRoleGroup(player);

  const batting = Number(player.attributes?.overall?.batting_overall) || 0;
  const bowling = Number(player.attributes?.overall?.bowling_overall) || 0;
  const fielding = getFieldingAverage(player);

  const leadership = Number(player.attributes?.mental?.leadership) || 0;
  const fitness = Number(player.condition?.fitness) || 0;
  const keeping = Number(player.attributes?.fielding?.keeping) || 0;

  const formatBonus = getPlayerFormatBonus(player, selectedFormats);

  let roleScore = 0;

  if (roleGroup === "batsman") {
    roleScore =
      batting * 5 +
      fielding * 0.8 +
      leadership * 0.25;
  }

  if (roleGroup === "wicketkeeper") {
    roleScore =
      batting * 4 +
      keeping * 3 +
      fielding * 1 +
      leadership * 0.25;
  }

  if (roleGroup === "allrounder") {
    const higher = Math.max(batting, bowling);
    const lower = Math.min(batting, bowling);

    roleScore =
      higher * 4 +
      lower * 3 +
      fielding * 0.8 +
      leadership * 0.25;
  }

  if (roleGroup === "bowler") {
    roleScore =
      bowling * 5 +
      fielding * 0.8 +
      leadership * 0.25;
  }

  return roleScore + formatBonus + fitness * 0.03;
}

function getPlayerUniqueKey(player) {
  return String(
    player.id ||
    player.playerId ||
    player.name ||
    player.fullName ||
    Math.random()
  );
}

function addBestPlayersFromPool(squad, usedKeys, pool, needed) {
  for (const player of pool) {
    if (squad.length >= COMPUTER_SQUAD_SIZE) break;
    if (needed <= 0) break;

    const key = getPlayerUniqueKey(player);

    if (usedKeys.has(key)) continue;

    squad.push(player);
    usedKeys.add(key);
    needed--;
  }
}

function autoPickComputerSquad(team, forcedFormat = null) {
  const selectedFormats = forcedFormat
    ? [String(forcedFormat).toLowerCase()]
    : getSelectedNationalFormats();

  const allTeamPlayers = teamPlayers(team);

  const eligiblePlayers = allTeamPlayers.filter((player) => {
    return isPlayerEligibleForSelectedFormats(player, selectedFormats);
  });

  // If strict format filtering gives too few players, use all available team players as fallback.
  const sourcePlayers = eligiblePlayers.length >= 11 ? eligiblePlayers : allTeamPlayers;

  const rankedPlayers = [...sourcePlayers].sort((a, b) => {
    return getComputerSquadScore(b, selectedFormats) - getComputerSquadScore(a, selectedFormats);
  });

  const roleBuckets = {
    batsman: rankedPlayers.filter((player) => getPlayerRoleGroup(player) === "batsman"),
    wicketkeeper: rankedPlayers.filter((player) => getPlayerRoleGroup(player) === "wicketkeeper"),
    allrounder: rankedPlayers.filter((player) => getPlayerRoleGroup(player) === "allrounder"),
    bowler: rankedPlayers.filter((player) => getPlayerRoleGroup(player) === "bowler")
  };

  const squad = [];
  const usedKeys = new Set();

  addBestPlayersFromPool(
    squad,
    usedKeys,
    roleBuckets.batsman,
    COMPUTER_SQUAD_TARGETS.batsman
  );

  addBestPlayersFromPool(
    squad,
    usedKeys,
    roleBuckets.wicketkeeper,
    COMPUTER_SQUAD_TARGETS.wicketkeeper
  );

  addBestPlayersFromPool(
    squad,
    usedKeys,
    roleBuckets.allrounder,
    COMPUTER_SQUAD_TARGETS.allrounder
  );

  addBestPlayersFromPool(
    squad,
    usedKeys,
    roleBuckets.bowler,
    COMPUTER_SQUAD_TARGETS.bowler
  );

  // Fill shortages with best remaining players, regardless of role.
  addBestPlayersFromPool(
    squad,
    usedKeys,
    rankedPlayers,
    COMPUTER_SQUAD_SIZE - squad.length
  );

  return squad.slice(0, COMPUTER_SQUAD_SIZE);
}

function selectedSet() {
  return new Set(state.userSquad.map(p => p.id));
}

const BATTING_STYLE_CODES = {
  "Opener - Slogger": "O-SLG",
  "Opener - Balanced": "O-BAL",
  "Opener - Anchor": "O-ANC",

  "Top Order - Slogger": "T-SLG",
  "Top Order - Balanced": "T-BAL",
  "Top Order - Anchor": "T-ANC",

  "Middle Order - Slogger": "M-SLG",
  "Middle Order - Balanced": "M-BAL",
  "Middle Order - Anchor": "M-ANC",

  "Lower Order - Slogger": "L-SLG",
  "Lower Order - Balanced": "L-BAL",
  "Lower Order - Anchor": "L-ANC",

  "Finisher": "S-FIN",
  "Runner": "S-RUN",
  "Pinch-Hitter": "S-PNH",
  "Wall": "S-WAL"
};

const BOWLING_STYLE_CODES = {
  "Swing Bowler": "P-SWG",
  "Hit-the-Deck Seamer": "P-HTD",
  "Short-Ball Specialist": "P-SBS",
  "Death Specialist": "P-DTH",

  "Classical Spinner": "S-CLS",
  "Flat Spinner": "S-FLT",
  "Mystery Spinner": "S-MYS",
  "Containment Spinner": "S-CTN"
};

function getPlaystyleCode(name) {
  return BATTING_STYLE_CODES[name] || BOWLING_STYLE_CODES[name] || name || "None";
}

function playstyleClass(name) {
  const s = String(name || "").toLowerCase();

  if (s.includes("slogger")) return "ps-slogger";
  if (s.includes("balanced")) return "ps-balanced";
  if (s.includes("anchor")) return "ps-anchor";
  if (s.includes("finisher")) return "ps-finisher";
  if (s.includes("runner")) return "ps-runner";
  if (s.includes("pinch")) return "ps-pinch";
  if (s.includes("wall")) return "ps-wall";
  if (s.includes("swing")) return "ps-swing";
  if (s.includes("hit")) return "ps-hitdeck";
  if (s.includes("short")) return "ps-shortball";
  if (s.includes("death")) return "ps-death";
  if (s.includes("classical")) return "ps-classical";
  if (s.includes("flat")) return "ps-flat";
  if (s.includes("mystery")) return "ps-mystery";
  if (s.includes("containment")) return "ps-containment";
  if (s.includes("wicket")) return "ps-wicketkeeper";

  return "ps-none";
}

function pill(name) {
  if (!name || name === "None") {
    return `<span class="playstyle-pill ps-none">None</span>`;
  }

  const code = getPlaystyleCode(name);

  return `
    <span
      class="playstyle-pill ${playstyleClass(name)}"
      title="${esc(code)} = ${esc(name)}"
    >
      ${esc(code)}
    </span>
  `;
}

function ratingLevel(value, maxValue) {
  const num = Number(value) || 0;
  const pct = maxValue ? (num / maxValue) * 100 : num;

  if (pct >= 90) return "elite";
  if (pct >= 75) return "high";
  if (pct >= 50) return "mid";

  return "low";
}

function statCard(value, maxValue = 20) {
  if (value === null || value === undefined || value === "") {
    return `<span class="rating-card low" title="No rating"><span class="rating-number">—</span></span>`;
  }

  const num = Number(value);
  const clean = Number.isInteger(num) ? String(num) : num.toFixed(1).replace(/\.0$/, "");
  const label = maxValue === 100 ? `${clean} / 100` : `${clean} / ${maxValue}`;

  return `<span class="rating-card ${ratingLevel(num, maxValue)}" title="${label}"><span class="rating-number">${clean}</span></span>`;
}

function getSquadSortValue(player, key) {
  const batStyle = player.primaryPlaystyle?.batting || "None";
  const bowlStyle = player.primaryPlaystyle?.bowling || "None";

  if (key === "name") return player.name || "";
  if (key === "role") return player.role || "";
  if (key === "batting") return Number(player.battingOverall) || 0;
  if (key === "bowling") return Number(player.bowlingOverall) || 0;
  if (key === "fielding") return Number(player.fieldingOverall) || 0;
  if (key === "stamina") return Number(player.stamina) || 0;
  if (key === "fitness") return Number(player.fitness) || 0;
  if (key === "batStyle") return getPlaystyleCode(batStyle);
  if (key === "bowlStyle") return getPlaystyleCode(bowlStyle);

  return overallScore(player);
}

function compareSquadPlayers(a, b) {
  let valueA = getSquadSortValue(a, squadSort.key);
  let valueB = getSquadSortValue(b, squadSort.key);

  const numericKeys = [
    "overall",
    "batting",
    "bowling",
    "fielding",
    "stamina",
    "fitness"
  ];

  if (numericKeys.includes(squadSort.key)) {
    valueA = Number(valueA) || 0;
    valueB = Number(valueB) || 0;
  } else {
    valueA = String(valueA).toLowerCase();
    valueB = String(valueB).toLowerCase();
  }

  if (valueA < valueB) {
    return squadSort.direction === "asc" ? -1 : 1;
  }

  if (valueA > valueB) {
    return squadSort.direction === "asc" ? 1 : -1;
  }

  return 0;
}

function updateSquadSortButtons() {
  document.querySelectorAll(".squad-sort-btn").forEach((button) => {
    const sortKey = button.dataset.squadSort;
    const icon = button.querySelector(".squad-sort-icon");

    button.classList.remove("active");

    if (sortKey === squadSort.key) {
      button.classList.add("active");
      icon.textContent = squadSort.direction === "asc" ? "↑" : "↓";
    } else {
      icon.textContent = "↕";
    }
  });
}

function setupSquadSortButtons() {
  document.querySelectorAll(".squad-sort-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const selectedSortKey = button.dataset.squadSort;

      if (squadSort.key === selectedSortKey) {
        squadSort.direction = squadSort.direction === "asc" ? "desc" : "asc";
      } else {
        squadSort.key = selectedSortKey;

        const numericKeys = [
          "batting",
          "bowling",
          "fielding",
          "stamina",
          "fitness"
        ];

        squadSort.direction = numericKeys.includes(selectedSortKey)
          ? "desc"
          : "asc";
      }

      renderPlayerTable();
    });
  });
}

function setSquadSortFromDropdown() {
  const sortDropdown = $("sortBy");

  if (!sortDropdown) return;

  const selectedSort = sortDropdown.value;

  squadSort.key = selectedSort;

  if (selectedSort === "name") {
    squadSort.direction = "asc";
  } else {
    squadSort.direction = "desc";
  }

  renderPlayerTable();
}

function openOldSquadPickerForFormat(format, matchIndex) {
  const formatKey = getFormatKey(format);
  const existingFormatSquad = getFormatSquad(formatKey);

  state.activeSquadFormat = formatKey;
  state.activeSquadMatchIndex = matchIndex;

  state.userSquad = existingFormatSquad?.userSquad
    ? [...existingFormatSquad.userSquad]
    : [];

  state.computerSquad = existingFormatSquad?.computerSquad
    ? [...existingFormatSquad.computerSquad]
    : [];

  if ($("formatSquadTitle")) {
    $("formatSquadTitle").textContent = `Select ${state.userTeam} ${formatKey} Squad`;
  }

  $("searchBox").value = "";
  $("roleFilter").value = "all";
  if ($("sortBy")) {
    $("sortBy").value = "overall";
  }

  squadSort = {
    key: "overall",
    direction: "desc"
  };

  saveTourState("squad");
  showScreen("squad");
}

function autoPickUserSquad() {
  hideMsg("squadMsg");

  if (!state.userTeam) {
    return showMsg("squadMsg", "Choose a user team first.");
  }

  if (!state.activeSquadFormat) {
    return showMsg("squadMsg", "No active format found. Go back to Tour Summary and choose Select Squad.");
  }

  const formatKey = getFormatKey(state.activeSquadFormat);

  /*
    Reuses the same balanced squad picker logic:
    7 batsmen, 2 wicketkeepers, 4 all-rounders, 5 bowlers when available.
  */
  const pickedSquad = autoPickComputerSquad(state.userTeam, formatKey);

  if (!pickedSquad.length) {
    return showMsg("squadMsg", `Could not auto pick players for ${state.userTeam}.`);
  }

  state.userSquad = pickedSquad.slice(0, 18);

  renderPlayerTable();
  saveTourState("squad");

  showMsg(
    "squadMsg",
    `Auto picked ${state.userSquad.length} ${formatKey} players for ${state.userTeam}. You can still edit the squad before saving.`,
    false
  );
}


function renderPlayerTable() {
  hideMsg("squadMsg");

  const q = $("searchBox").value.trim().toLowerCase();
  const role = $("roleFilter").value;
  const ids = selectedSet();

  let list = formatTeamPlayers(state.userTeam, state.activeSquadFormat);

  if (role !== "all") {
    list = list.filter(p => p.role === role);
  }

  if (q) {
    list = list.filter(p =>
      `${p.name} ${p.role} ${p.bowlingStyle}`.toLowerCase().includes(q)
    );
  }

  list.sort(compareSquadPlayers);
  updateSquadSortButtons();

  $("selectedChip").innerHTML = `<span>Selected</span><b>${state.userSquad.length}</b>`;

  $("selectedChip").className =
    state.userSquad.length < 12
      ? "chip warn"
      : state.userSquad.length > 18
        ? "chip bad"
        : "chip good";

  $("availableChip").innerHTML = `<span>Available</span><b>${formatTeamPlayers(state.userTeam, state.activeSquadFormat).length}</b>`;
  $("summaryBtn").disabled = state.userSquad.length < 12 || state.userSquad.length > 18;

  if (!list.length) {
    $("playersTbody").innerHTML = `<tr><td colspan="10">No players match this filter.</td></tr>`;
    return;
  }

  $("playersTbody").innerHTML = list.map(p => {
    const checked = ids.has(p.id);
    const disabled = !checked && state.userSquad.length >= 18;
    const batStyle = p.primaryPlaystyle?.batting || "None";
    const bowlStyle = p.primaryPlaystyle?.bowling || "None";
    const bowlingText = p.bowlingStyle || p.bowlingType || "None";

    return `
      <tr class="${checked ? "selected-row" : ""}">
        <td class="select-cell">
          <input
            type="checkbox"
            id="player_${cssSafe(p.id)}"
            ${checked ? "checked" : ""}
            ${disabled ? "disabled" : ""}
            onchange="togglePlayer('${p.id}')"
          >
        </td>

        <td>
          <label class="player-name" for="player_${cssSafe(p.id)}">${esc(p.name)}</label>
          <div class="tiny">${esc(p.battingHand || "")} hand bat • ${esc(bowlingText)}</div>
        </td>

        <td>
          <span class="badge green role-badge">${esc(p.role)}</span>
        </td>

        <td class="stat-cell" data-label="Bat">${statCard(p.battingOverall, 20)}</td>
        <td class="stat-cell" data-label="Bowl">${statCard(p.bowlingOverall, 20)}</td>
        <td class="stat-cell" data-label="Field">${statCard(p.fieldingOverall, 20)}</td>
        <td class="stat-cell" data-label="Stamina">${statCard(p.stamina, 20)}</td>
        <td class="stat-cell" data-label="Fitness">${statCard(p.fitness, 100)}</td>

        <td>${pill(batStyle)}</td>
        <td>${pill(bowlStyle)}</td>
      </tr>
    `;
  }).join("");
}

function togglePlayer(id) {
  hideMsg("squadMsg");

  const existing = state.userSquad.findIndex(p => p.id === id);

  if (existing >= 0) {
    state.userSquad.splice(existing, 1);
  } else {
    if (state.userSquad.length >= 18) {
      showMsg("squadMsg", "Maximum 18 players. Uncheck one player first.");
      renderPlayerTable();
      return;
    }

    const player = PLAYER_DATA.find(p => p.id === id);

    if (player) {
      state.userSquad.push(player);
    }
  }

  renderPlayerTable();
  saveTourState("squad");
}

function clearSquad() {
  state.userSquad = [];
  renderPlayerTable();
  saveTourState("squad");
}

function finishSquad() {
  hideMsg("squadMsg");

  if (state.userSquad.length < 11) {
    return showMsg(
      "squadMsg",
      `Pick at least 11 players. You currently have ${state.userSquad.length}.`
    );
  }

  if (state.userSquad.length > 18) {
    return showMsg("squadMsg", "Maximum 18 players allowed.");
  }

  if (!state.activeSquadFormat) {
    return showMsg("squadMsg", "No active format found. Go back to the tour summary and try again.");
  }

  ensureFormatSquads();

  const formatKey = getFormatKey(state.activeSquadFormat);
  const matchIndex = Number(state.activeSquadMatchIndex);

  const schedule = buildTourSchedule();
  const match = schedule.find(item => Number(item.matchIndex) === matchIndex);

  if (!match) {
    return showMsg("squadMsg", "Could not find this match in the tour schedule.");
  }

  const userFormatSquad = [...state.userSquad];
  const computerFormatSquad = autoPickComputerSquad(state.computerTeam, formatKey);

  state.computerSquad = [...computerFormatSquad];

  state.formatSquads[formatKey] = {
    userSquad: userFormatSquad,
    computerSquad: computerFormatSquad,
    selectedAt: new Date().toISOString()
  };

  state.activeSquadFormat = null;
  state.activeSquadMatchIndex = null;

  tourProgress.activeMatchIndex = matchIndex;

  saveTourState("summary");

  /*
    Important:
    Save Squad goes directly to select-xi.html,
    so it must also write a fresh currentTourMatch.
    Otherwise select-xi.html keeps using the old one.
  */
  localStorage.removeItem("currentTourMatch");
  localStorage.removeItem("currentTossResult");

  const currentMatchData = {
    matchIndex: matchIndex,
    match: match,
    format: formatKey,

    teamA: state.userTeam,
    teamB: state.computerTeam,

    userTeam: state.userTeam,
    computerTeam: state.computerTeam,

    userSquad: userFormatSquad,
    computerSquad: computerFormatSquad,

    selectedUserXI: [],
    selectedComputerXI: [],

    toss: null,
    savedAt: new Date().toISOString()
  };

  localStorage.setItem("currentTourMatch", JSON.stringify(currentMatchData));

  window.location.href = `select-xi.html?format=${encodeURIComponent(formatKey)}&matchIndex=${encodeURIComponent(matchIndex)}&v=${Date.now()}`;
}

function countFormat(format) {
  return state.series.filter(m => m.format === format).length;
}

function countText(n, label) {
  return n === 0
    ? `No ${label}`
    : n === 1
      ? `Only 1 ${label}`
      : `${n} ${label}${label === "T20" ? "s" : "s"}`;
}

function summaryRow(left, right) {
  return `<div class="summary-row"><strong>${esc(left)}</strong><span>${right}</span></div>`;
}

function rosterRow(p, i) {
  return summaryRow(
    `${i + 1}. ${p.name}`,
    `${esc(p.role)} • Bat ${p.battingOverall} • Bowl ${p.bowlingOverall}`
  );
}

function getVenueForTeam(team) {
  const venues = {
    Bangladesh: "Shere Bangla National Stadium, Dhaka",
    India: "M. Chinnaswamy Stadium, Bengaluru",
    Pakistan: "Gaddafi Stadium, Lahore",
    Australia: "Melbourne Cricket Ground, Melbourne",
    England: "Lord's, London",
    "New Zealand": "Eden Park, Auckland",
    "South Africa": "Newlands, Cape Town",
    "Sri Lanka": "R. Premadasa Stadium, Colombo",
    "West Indies": "Sabina Park, Kingston, Jamaica",
    Afghanistan: "Sharjah Cricket Stadium, Sharjah",
    Ireland: "Malahide Cricket Club Ground, Dublin",
    Scotland: "The Grange Club, Edinburgh",
    Netherlands: "VRA Cricket Ground, Amstelveen",
    Zimbabwe: "Harare Sports Club, Harare",
    Nepal: "Tribhuvan University International Cricket Ground, Kirtipur",
    Oman: "Al Amerat Cricket Ground, Muscat",
    Canada: "Maple Leaf North-West Ground, King City",
    Namibia: "Wanderers Cricket Ground, Windhoek",
    "United Arab Emirates": "Dubai International Cricket Stadium, Dubai",
    "United States of America": "Central Broward Park, Florida"
  };

  return venues[team] || "National Cricket Stadium";
}

function getOrdinalNumber(number) {
  if (number === 1) return "1st";
  if (number === 2) return "2nd";
  if (number === 3) return "3rd";
  return `${number}th`;
}

function formatScheduleDate(date) {
  return date
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric"
    })
    .replace(",", "")
    .toUpperCase();
}

function formatFullDate(date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function formatTime(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}


function formatShortMonthDay(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

function formatScheduleDateRange(startDate, endDate) {
  const sameMonth =
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getFullYear() === endDate.getFullYear();

  const startDay = startDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "2-digit"
  });

  const endDay = endDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric"
  });

  if (sameMonth) {
    const month = startDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
    const startNumber = String(startDate.getDate()).padStart(2, "0");
    const endNumber = String(endDate.getDate()).padStart(2, "0");
    const year = endDate.getFullYear();

    return `${month} ${startNumber}-${endNumber}, ${year}`;
  }

  return `${startDay} - ${endDay}`.replaceAll(",", "").toUpperCase();
}

function getTestDayStatus(startDate, endDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  if (today <= start) return "Day 1";
  if (today >= end) return "Day 5";

  const diffMs = today - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return `Day ${Math.min(5, diffDays + 1)}`;
}


function buildTourSchedule() {
  const schedule = [];
  let scheduleMatchIndex = 0;

  const startDate = new Date();
  startDate.setHours(9, 30, 0, 0);

  let dayOffset = 0;
  let odiNumber = 1;
  let t20Number = 1;
  let testNumber = 1;

  state.series.forEach((match) => {
    if (match.format === "Test") {
      const matchStartDate = addDays(startDate, dayOffset);
      const matchEndDate = addDays(startDate, dayOffset + 4);

      schedule.push({
        matchIndex: scheduleMatchIndex++,

        date: matchStartDate,
        endDate: matchEndDate,
        dateLabel: formatScheduleDateRange(matchStartDate, matchEndDate),

        seriesName: `${state.computerTeam} tour of ${state.userTeam}, ${matchStartDate.getFullYear()}`,
        title: `${state.userTeam} vs ${state.computerTeam}, ${getOrdinalNumber(testNumber)} Test`,
        venue: getVenueForTeam(state.userTeam),
        format: "Test",

        localTime: formatTime(matchStartDate),
        gmtTime: formatTime(addDays(matchStartDate, 0)),

        localNote: `${getTestDayStatus(matchStartDate, matchEndDate)} • ${formatShortMonthDay(matchStartDate)}-${matchEndDate.getDate()}`
      });

      testNumber += 1;

      // 5 playing days + 1 rest/travel day before next match
      dayOffset += 6;
    }

    if (match.format === "ODI") {
      const matchDate = addDays(startDate, dayOffset);

      schedule.push({
        matchIndex: scheduleMatchIndex++,
        date: matchDate,
        dateLabel: formatScheduleDate(matchDate),

        seriesName: `${state.computerTeam} tour of ${state.userTeam}, ${matchDate.getFullYear()}`,
        title: `${state.userTeam} vs ${state.computerTeam}, ${getOrdinalNumber(odiNumber)} ODI`,
        venue: getVenueForTeam(state.userTeam),
        format: "ODI",

        localTime: formatTime(matchDate),
        gmtTime: formatTime(addDays(matchDate, 0)),
        localNote: formatFullDate(matchDate)
      });

      odiNumber += 1;
      dayOffset += 2;
    }

    if (match.format === "T20") {
      const matchDate = addDays(startDate, dayOffset);
      matchDate.setHours(19, 0, 0, 0);

      schedule.push({
        matchIndex: scheduleMatchIndex++,
        date: matchDate,
        dateLabel: formatScheduleDate(matchDate),

        seriesName: `${state.computerTeam} tour of ${state.userTeam}, ${matchDate.getFullYear()}`,
        title: `${state.userTeam} vs ${state.computerTeam}, ${getOrdinalNumber(t20Number)} T20I`,
        venue: getVenueForTeam(state.userTeam),
        format: "T20",

        localTime: formatTime(matchDate),
        gmtTime: formatTime(addDays(matchDate, 0)),
        localNote: formatFullDate(matchDate)
      });

      t20Number += 1;
      dayOffset += 1;
    }
  });

  return schedule;
}

function groupScheduleByDate(schedule) {
  const grouped = {};

  schedule.forEach((item) => {
    const key = item.dateLabel || formatScheduleDate(item.date);

    if (!grouped[key]) {
      grouped[key] = [];
    }

    grouped[key].push(item);
  });

  return grouped;
}

function getNextPlayableMatchIndex(schedule) {
  for (const match of schedule) {
    if (!tourProgress.completedMatchIndexes.includes(match.matchIndex)) {
      return match.matchIndex;
    }
  }

  return null;
}

function ensureFormatSquads() {
  if (!state.formatSquads) {
    state.formatSquads = {
      Test: null,
      ODI: null,
      T20: null
    };
  }

  ["Test", "ODI", "T20"].forEach(format => {
    if (state.formatSquads[format] === undefined) {
      state.formatSquads[format] = null;
    }
  });
}

function getFormatKey(format) {
  const text = String(format || "").toLowerCase();

  if (text.includes("test")) return "Test";
  if (text.includes("odi")) return "ODI";
  return "T20";
}

function getFormatSquad(format) {
  ensureFormatSquads();
  return state.formatSquads[getFormatKey(format)] || null;
}

function isFormatSquadReady(format) {
  const formatSquad = getFormatSquad(format);

  const userCount = formatSquad?.userSquad?.length || 0;
  const computerCount = formatSquad?.computerSquad?.length || 0;

  return userCount >= 11 && computerCount >= 11;
}

function getMatchActionLabel(match) {
  return isFormatSquadReady(match.format) ? "Select XI" : "Select Squad";
}

function handleMatchAction(matchIndex) {
  const schedule = buildTourSchedule();
  const match = schedule.find(item => item.matchIndex === matchIndex);

  if (!match) {
    alert("Match not found.");
    return;
  }

  const nextPlayableMatchIndex = getNextPlayableMatchIndex(schedule);

  if (match.matchIndex !== nextPlayableMatchIndex) {
    alert("You must finish the previous match first.");
    return;
  }

  if (!isFormatSquadReady(match.format)) {
    openOldSquadPickerForFormat(match.format, match.matchIndex);
    return;
  }

  selectXIForMatch(match.matchIndex);
}

function getMatchActionButton(match, nextPlayableMatchIndex) {
  const isCompleted = tourProgress.completedMatchIndexes.includes(match.matchIndex);
  const isPlayable = match.matchIndex === nextPlayableMatchIndex && !isCompleted;

  if (isCompleted) {
    return `
      <button class="match-action-btn completed" disabled>
        Completed
      </button>
    `;
  }

  if (!isPlayable) {
    return `
      <button class="match-action-btn locked" disabled>
        Yet to Start
      </button>
    `;
  }

  return `
    <button class="match-action-btn start" onclick="handleMatchAction(${match.matchIndex})">
      ${getMatchActionLabel(match)}
    </button>
  `;
}


function renderScheduleMatch(match, nextPlayableMatchIndex) {
  const formatClass = match.format.toLowerCase();
  const isCompleted = tourProgress.completedMatchIndexes.includes(match.matchIndex);
  const isPlayable = match.matchIndex === nextPlayableMatchIndex && !isCompleted;
  const savedResult = getSavedMatchResult(match.matchIndex);

  const buttonHTML = getMatchActionButton(match, nextPlayableMatchIndex);

  const timeOrResultHTML = savedResult
    ? `
      <div class="match-local-time result-text">
        ${esc(savedResult.resultText)}
      </div>
      <div class="match-gmt-time">
        Match Completed
      </div>
    `
    : `
      <div class="match-local-time">${esc(match.localTime)} <span>(${esc(match.localNote)})</span></div>
      <div class="match-gmt-time">${esc(match.gmtTime)} GMT / LOCAL</div>
    `;

  return `
    <div class="schedule-match-card compact-match-card">
      <div class="match-main-info">
        <div class="match-title">${esc(match.title)}</div>
        <div class="match-venue">${esc(match.venue)}</div>
      </div>

      <div class="match-time-info">
        ${timeOrResultHTML}
      </div>

      <div class="match-format-pill ${esc(formatClass)}">
        ${esc(match.format)}
      </div>

      <div class="match-action-wrap">
        ${buttonHTML}
      </div>
    </div>
  `;
}





function testComputerSquadPick() {
  const computerTeam =
    state.computerTeam ||
    document.getElementById("computerTeamSelect")?.value ||
    "";

  if (!computerTeam) {
    alert("No computer team selected yet.");
    return;
  }

  const pickedSquad = autoPickComputerSquad(computerTeam);

  const selectedFormats =
    typeof getSelectedNationalFormats === "function"
      ? getSelectedNationalFormats()
      : [];

  const counts = {
    batsman: 0,
    wicketkeeper: 0,
    allrounder: 0,
    bowler: 0
  };

  const rows = pickedSquad.map((player, index) => {
    const roleGroup =
      typeof getPlayerRoleGroup === "function"
        ? getPlayerRoleGroup(player)
        : String(player.role || "unknown").toLowerCase();

    if (counts[roleGroup] !== undefined) {
      counts[roleGroup]++;
    }

    const batting = Number(player.attributes?.overall?.batting_overall) || 0;
    const bowling = Number(player.attributes?.overall?.bowling_overall) || 0;
    const keeping = Number(player.attributes?.fielding?.keeping) || 0;
    const leadership = Number(player.attributes?.mental?.leadership) || 0;
    const fitness = Number(player.condition?.fitness) || 0;

    const eligible =
      typeof isPlayerEligibleForSelectedFormats === "function"
        ? isPlayerEligibleForSelectedFormats(player, selectedFormats)
        : true;

    const score =
      typeof getComputerSquadScore === "function"
        ? Math.round(getComputerSquadScore(player, selectedFormats) * 100) / 100
        : "-";

    return {
      pick: index + 1,
      name: player.name || player.fullName || "Unknown",
      role: player.role || "-",
      group: roleGroup,
      bat: batting,
      bowl: bowling,
      keeping,
      leadership,
      fitness,
      eligible,
      score
    };
  });

  console.clear();
  console.log("COMPUTER SQUAD TEST");
  console.log("Team:", computerTeam);
  console.log("Formats:", selectedFormats);
  console.log("Counts:", counts);
  console.table(rows);

  const outputLines = [
    `COMPUTER SQUAD TEST`,
    `Team: ${computerTeam}`,
    `Formats: ${selectedFormats.length ? selectedFormats.join(", ").toUpperCase() : "No format filter"}`,
    ``,
    `Total picked: ${pickedSquad.length}`,
    `Batsmen: ${counts.batsman}`,
    `Wicketkeepers: ${counts.wicketkeeper}`,
    `All-rounders: ${counts.allrounder}`,
    `Bowlers: ${counts.bowler}`,
    ``,
    `Picked Players:`,
    ...rows.map(row => {
      return `${row.pick}. ${row.name} | ${row.group} | Bat ${row.bat} | Bowl ${row.bowl} | WK ${row.keeping} | Score ${row.score} | Eligible: ${row.eligible}`;
    })
  ];

  let out = document.getElementById("computerSquadTestOut");

  if (!out) {
    out = document.createElement("pre");
    out.id = "computerSquadTestOut";
    document.body.appendChild(out);
  }

  out.textContent = outputLines.join("\n");

  alert(
    `Computer squad picked:\n\n` +
    `Total: ${pickedSquad.length}\n` +
    `Batsmen: ${counts.batsman}\n` +
    `Wicketkeepers: ${counts.wicketkeeper}\n` +
    `All-rounders: ${counts.allrounder}\n` +
    `Bowlers: ${counts.bowler}\n\n` +
    `Full list printed on page and in console.`
  );
}








function selectXIForMatch(matchIndex) {
  const schedule = buildTourSchedule();
  const match = schedule.find(item => Number(item.matchIndex) === Number(matchIndex));

  if (!match) {
    alert("Match not found.");
    return;
  }

  const formatKey = getFormatKey(match.format);
  const formatSquad = getFormatSquad(formatKey);

  if (!formatSquad || !formatSquad.userSquad?.length || !formatSquad.computerSquad?.length) {
    openOldSquadPickerForFormat(formatKey, matchIndex);
    return;
  }

  tourProgress.activeMatchIndex = matchIndex;

  // Important: remove stale match before writing the new one.
  localStorage.removeItem("currentTourMatch");

  const currentMatchData = {
    matchIndex: Number(matchIndex),
    match: match,
    format: formatKey,

    teamA: state.userTeam,
    teamB: state.computerTeam,

    userTeam: state.userTeam,
    computerTeam: state.computerTeam,

    // Always use latest saved format squad
    userSquad: [...formatSquad.userSquad],
    computerSquad: [...formatSquad.computerSquad],

    // Select XI page should start fresh every time
    selectedUserXI: [],
    selectedComputerXI: [],

    toss: null,
    savedAt: new Date().toISOString()
  };

  localStorage.setItem("currentTourMatch", JSON.stringify(currentMatchData));
  saveTourState("summary");

  window.location.href = `select-xi.html?format=${encodeURIComponent(formatKey)}&matchIndex=${encodeURIComponent(matchIndex)}&v=${Date.now()}`;
}

function renderSummary() {
  const schedule = buildTourSchedule();
  const grouped = groupScheduleByDate(schedule);
  const nextPlayableMatchIndex = getNextPlayableMatchIndex(schedule);

  const tests = countFormat("Test");
  const odis = countFormat("ODI");
  const t20s = countFormat("T20");

  $("tourName").textContent = `${state.computerTeam} tour of ${state.userTeam}, ${new Date().getFullYear()}`;
  $("scheduleSubTitle").textContent = `${state.userTeam} vs ${state.computerTeam} official tour schedule`;
  $("tourTeamSummary").textContent = `${state.userTeam} vs ${state.computerTeam}`;
  $("tourMatchSummary").textContent = `${tests} Test • ${odis} ODI • ${t20s} T20`;

  ensureFormatSquads();

  const squadStatus = ["Test", "ODI", "T20"]
    .filter(format => countFormat(format) > 0)
    .map(format => {
      const ready = isFormatSquadReady(format);
      return `${format}: ${ready ? "Squad selected" : "No squad"}`;
    })
    .join(" • ");

  $("tourSquadSummary").textContent = squadStatus || "No format squads selected";


  $("scheduleList").innerHTML = Object.entries(grouped).map(([dateLabel, matches]) => {
    const matchesHTML = matches.map((match) => {
      return `
        ${renderScheduleMatch(match, nextPlayableMatchIndex)}
      `;
    }).join("");

    return `
      <section class="schedule-day">
        <div class="schedule-date">${esc(dateLabel)}</div>
        ${matchesHTML}
      </section>
    `;
  }).join("");

  $("jsonOut").textContent = JSON.stringify(getTourPayload(), null, 2);
}

function getTourPayload() {
  return {
    createdAt: new Date().toISOString(),
    userTeam: state.userTeam,
    computerTeam: state.computerTeam,
    series: {
      tests: countFormat("Test"),
      odis: countFormat("ODI"),
      t20s: countFormat("T20"),
      matches: state.series
    },
    schedule: buildTourSchedule(),
    formatSquads: state.formatSquads,
    activeSquadFormat: state.activeSquadFormat,
    activeSquadMatchIndex: state.activeSquadMatchIndex,
    tourProgress,

    // Temporary holders used by the old squad picker screen.
    userSquad: state.userSquad,
    computerSquad: state.computerSquad
  };
}

function copyJson() {
  navigator.clipboard?.writeText($("jsonOut").textContent);
  showMsg("copyMsg", "Copied tour JSON.", false);
}

function resetAll() {
  localStorage.removeItem(TOUR_STORAGE_KEY);

  state.userTeam = "";
  state.computerTeam = "";
  state.series = [];
  state.userSquad = [];
  state.computerSquad = [];

  state.formatSquads = {
    Test: null,
    ODI: null,
    T20: null
  };

  state.activeSquadFormat = null;
  state.activeSquadMatchIndex = null;

  tourProgress = {
    completedMatchIndexes: [],
    activeMatchIndex: null,
    matchResults: {}
  };

  currentScreenName = "setup";

  fillTeamDropdowns();
  showScreen("setup");
}

document.body.classList.add("main-page");

setupSquadSortButtons();
function finishAppLoading() {
  document.body.classList.remove("app-loading");
  document.body.classList.add("app-ready");
}

initData();

function getPlayersByIds(ids) {
  const lookup = new Map(PLAYER_DATA.map(player => [String(player.id), player]));

  return (ids || [])
    .map(id => lookup.get(String(id)))
    .filter(Boolean);
}

function saveTourState(screenName = currentScreenName) {
  if (!PLAYER_DATA.length || isRestoringTour) return;

  const userTeamValue = state.userTeam || $("userTeamSelect")?.value || "";
  const computerTeamValue = state.computerTeam || $("computerTeamSelect")?.value || "";

  const saveData = {
    currentScreen: screenName,
    userTeam: userTeamValue,
    computerTeam: computerTeamValue,
    series: state.series,
    userSquadIds: state.userSquad.map(player => String(player.id)),
    computerSquadIds: state.computerSquad.map(player => String(player.id)),
    squadSort,
    tourProgress,
    formatSquads: state.formatSquads,
    activeSquadFormat: state.activeSquadFormat,
    activeSquadMatchIndex: state.activeSquadMatchIndex
  };

  localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(saveData));
}

function restoreTourStateAfterDataLoad() {
  const raw = localStorage.getItem(TOUR_STORAGE_KEY);

  if (!raw || !PLAYER_DATA.length) {
    return false;
  }

  isRestoringTour = true;

  try {
    const saved = JSON.parse(raw);
    const teams = uniqueTeams();

    if (saved.userTeam && teams.includes(saved.userTeam)) {
      $("userTeamSelect").value = saved.userTeam;
      state.userTeam = saved.userTeam;
    }

    if (saved.computerTeam && teams.includes(saved.computerTeam)) {
      $("computerTeamSelect").value = saved.computerTeam;
      state.computerTeam = saved.computerTeam;
    }

    if (Array.isArray(saved.series)) {
      state.series = saved.series;
    }


    if (Array.isArray(saved.series) && saved.series.length) {
      const savedTests = saved.series.filter(match => match.format === "Test").length;
      const savedOdis = saved.series.filter(match => match.format === "ODI").length;
      const savedT20s = saved.series.filter(match => match.format === "T20").length;

      if ($("tests")) $("tests").value = String(savedTests);
      if ($("odis")) $("odis").value = String(savedOdis);
      if ($("t20s")) $("t20s").value = String(savedT20s);

      updateSeriesCounterUI();
    }

    const savedUserSquadIds =
      saved.userSquadIds ||
      (Array.isArray(saved.userSquad) ? saved.userSquad.map(player => player.id) : []);

    const savedComputerSquadIds =
      saved.computerSquadIds ||
      (Array.isArray(saved.computerSquad) ? saved.computerSquad.map(player => player.id) : []);

    state.userSquad = getPlayersByIds(savedUserSquadIds);
    state.computerSquad = getPlayersByIds(savedComputerSquadIds);

    if (!state.computerSquad.length && state.computerTeam) {
      state.computerSquad = autoPickComputerSquad(state.computerTeam);
    }

    if (saved.squadSort) {
      squadSort = saved.squadSort;
    }

    if (saved.tourProgress) {
      tourProgress = saved.tourProgress;
    }
    if (saved.formatSquads) {
      state.formatSquads = saved.formatSquads;
    } else {
      state.formatSquads = {
        Test: null,
        ODI: null,
        T20: null
      };
    }

    state.activeSquadFormat = saved.activeSquadFormat || null;
    state.activeSquadMatchIndex = saved.activeSquadMatchIndex ?? null;

    ensureFormatSquads();

    updateTeamCards();

    const savedScreen = saved.currentScreen || "setup";

    if (savedScreen === "summary" && state.series.length) {
      showScreen("summary", false);
      return true;
    }

    if (savedScreen === "squad" && state.series.length) {
      showScreen("squad", false);
      return true;
    }

    showScreen("setup", false);
    return true;

  } catch (error) {
    console.error("Could not restore saved tour:", error);
    localStorage.removeItem(TOUR_STORAGE_KEY);
    return false;

  } finally {
    isRestoringTour = false;
  }
}