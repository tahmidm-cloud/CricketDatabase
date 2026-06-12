const JSON_FILE_PATH = "data/players.json";
const STATS_JSON_FILE_PATH = "data/stats.json";

let allPlayers = [];
let filteredPlayers = [];

let currentSort = {
  key: null,
  direction: "asc"
};

let currentPage = 1;
let playersPerPage = 25;
let currentSortedPlayers = [];

let REAL_WORLD_STATS_BY_ID = {};
let REAL_WORLD_STATS_BY_NAME = new Map();
let realWorldStatsLoadPromise = null;

function runAfterFirstPaint(callback) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 1200 });
  } else {
    setTimeout(callback, 50);
  }
}

const playerTableBody = document.getElementById("playerTableBody");
const playerCount = document.getElementById("playerCount");
const searchInput = document.getElementById("searchInput");
const nationFilter = document.getElementById("nationFilter");
const roleFilter = document.getElementById("roleFilter");
const resetBtn = document.getElementById("resetBtn");

const PLAYER_EDITOR_STORAGE_KEY = "cm25_database_player_edits_v1";
let editingPlayerId = null;
const ORIGINAL_PLAYER_COPY_BY_ID = new Map();

const playerModal = document.getElementById("playerModal");
const modalContent = document.getElementById("modalContent");
const closeModalBtn = document.getElementById("closeModalBtn");

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

const BOWLING_STYLE_LIBRARY = [
  { type: "__NULL__", style: "__NULL__", abbrev: "__NULL__", label: "- / Does Not Bowl" },

  // Pace
  { type: "pace", style: "Right-arm Fast", abbrev: "RF", label: "Pace — Right-arm Fast (RF)" },
  { type: "pace", style: "Left-arm Fast", abbrev: "LF", label: "Pace — Left-arm Fast (LF)" },
  { type: "pace", style: "Right-arm Fast-Medium", abbrev: "RFM", label: "Pace — Right-arm Fast-Medium (RFM)" },
  { type: "pace", style: "Left-arm Fast-Medium", abbrev: "LFM", label: "Pace — Left-arm Fast-Medium (LFM)" },
  { type: "pace", style: "Right-arm Medium-Fast", abbrev: "RMF", label: "Pace — Right-arm Medium-Fast (RMF)" },
  { type: "pace", style: "Left-arm Medium-Fast", abbrev: "LMF", label: "Pace — Left-arm Medium-Fast (LMF)" },
  { type: "pace", style: "Right-arm Medium", abbrev: "RM", label: "Pace — Right-arm Medium (RM)" },
  { type: "pace", style: "Left-arm Medium", abbrev: "LM", label: "Pace — Left-arm Medium (LM)" },

  // Spin
  { type: "spin", style: "Off Break", abbrev: "OB", label: "Spin — Off Break (OB)" },
  { type: "spin", style: "Leg Break", abbrev: "LB", label: "Spin — Leg Break (LB)" },
  { type: "spin", style: "Leg Break Googly", abbrev: "LBG", label: "Spin — Leg Break Googly (LBG)" },
  { type: "spin", style: "Slow Left-arm Orthodox", abbrev: "SLA", label: "Spin — Slow Left-arm Orthodox (SLA)" },
  { type: "spin", style: "Left-arm Wrist Spin", abbrev: "LAWS", label: "Spin — Left-arm Wrist Spin (LAWS)" }
];

function makeBowlingStyleValue(option) {
  return `${option.type}|||${option.style}|||${option.abbrev}`;
}

function parseBowlingStyleValue(value) {
  const [type, style, abbrev] = String(value || "").split("|||");

  return {
    type: type || "__NULL__",
    style: style || "__NULL__",
    abbrev: abbrev || "__NULL__"
  };
}

const FIELD_NAMES = {
  name: ["name", "player", "playerName", "player_name", "fullName", "full_name", "displayName"],
  age: ["age"],
  nation: ["nation", "nationality", "country", "teamCountry", "team_country"],
  role: ["role", "playerRole", "player_role", "typeRole"],
  hand: ["hand", "battingHand", "batting_hand", "bat_hand", "batHand", "dominantHand"],
  bowlingType: ["type", "bowlingType", "bowling_type", "bowlerType", "bowlType", "bowl_type"],
  style: ["style", "bowlingStyle", "bowling_style", "mainStyle", "main_style", "bowlingStyleAbbrev"]
};

async function loadPlayers() {
  try {
    loadRealWorldStats();

    const response = await fetch(JSON_FILE_PATH, { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Could not load players.json");
    }

    const rawData = await response.json();

    allPlayers = normalizePlayers(rawData).map((player, index) => ({
      ...player,
      id: String(
        player.id ??
        player.playerId ??
        player.player_id ??
        player.final_cricinfo_id ??
        player.cricinfo_id ??
        player.master_cricinfo_id ??
        `player_${index}`
      )
    }));

    filteredPlayers = [...allPlayers];
    currentSortedPlayers = [...filteredPlayers];
    currentPage = 1;

    ensurePaginationControls();
    renderCurrentPage();
    updateSortButtons();

    runAfterFirstPaint(() => {
      try {
        recalculateAllPlayerPlaystyles();
        snapshotOriginalPlayers();
        applySavedPlayerEdits();
        recalculateAllPlayerPlaystyles();

        filteredPlayers = [...allPlayers];
        currentSortedPlayers = sortPlayers(filteredPlayers);

        buildFilters();
        renderCurrentPage();
        updateSortButtons();
      } catch (slowLoadError) {
        console.error("Background database setup error:", slowLoadError);
        buildFilters();
        renderCurrentPage();
        updateSortButtons();
      }
    });
  } catch (error) {
    console.error(error);

    playerTableBody.innerHTML = `
      <tr>
        <td colspan="8">
          Could not load JSON file. Make sure your file is at:
          <strong>data/players.json</strong>
          and you are running a local server.
        </td>
      </tr>
    `;
  }
}
function normalizePlayers(rawData) {
  if (Array.isArray(rawData)) return rawData;
  if (rawData.players && Array.isArray(rawData.players)) return rawData.players;
  if (rawData.data && Array.isArray(rawData.data)) return rawData.data;

  for (const key in rawData) {
    if (Array.isArray(rawData[key])) return rawData[key];
  }

  if (typeof rawData === "object" && rawData !== null) {
    return Object.entries(rawData).map(([id, player]) => {
      if (typeof player === "object" && player !== null) {
        return { id, ...player };
      }
      return { id, value: player };
    });
  }

  return [];
}

function normalizeStatsLookupKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeStatsName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function rememberStatsName(name, statsObject) {
  const normalized = normalizeStatsName(name);
  if (normalized && !REAL_WORLD_STATS_BY_NAME.has(normalized)) {
    REAL_WORLD_STATS_BY_NAME.set(normalized, statsObject);
  }
}

function buildRealWorldStatsIndexes(data) {
  REAL_WORLD_STATS_BY_ID = data && typeof data === "object" ? data : {};
  REAL_WORLD_STATS_BY_NAME = new Map();

  Object.entries(REAL_WORLD_STATS_BY_ID).forEach(([id, statsObject]) => {
    if (!statsObject || typeof statsObject !== "object") return;

    const info = statsObject.player_info || {};

    rememberStatsName(info.final_player_name, statsObject);
    rememberStatsName(info.final_short_name, statsObject);
    rememberStatsName(info.name, statsObject);
    rememberStatsName(info.player_name, statsObject);
    rememberStatsName(statsObject.name, statsObject);
    rememberStatsName(statsObject.fullName, statsObject);

    const idKey = normalizeStatsLookupKey(id);
    if (idKey && !REAL_WORLD_STATS_BY_NAME.has(idKey)) {
      REAL_WORLD_STATS_BY_NAME.set(idKey, statsObject);
    }
  });
}

async function loadRealWorldStats() {
  if (realWorldStatsLoadPromise) return realWorldStatsLoadPromise;

  realWorldStatsLoadPromise = fetch(STATS_JSON_FILE_PATH, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) return {};
      return response.json();
    })
    .then((data) => {
      buildRealWorldStatsIndexes(data);
      return REAL_WORLD_STATS_BY_ID;
    })
    .catch((error) => {
      console.warn("Could not load data/stats.json:", error);
      buildRealWorldStatsIndexes({});
      return {};
    });

  return realWorldStatsLoadPromise;
}

function findRealWorldStats(player, display = null) {
  const playerDisplay = display || getDisplayPlayer(player);

  const possibleIds = [
    player.id,
    player.playerId,
    player.player_id,
    player.final_cricinfo_id,
    player.cricinfo_id,
    player.master_cricinfo_id,
    player.master_id,
    player.espn_id,
    player.info?.final_cricinfo_id,
    player.player_info?.final_cricinfo_id
  ];

  for (const possibleId of possibleIds) {
    const key = String(possibleId ?? "").trim();
    if (key && REAL_WORLD_STATS_BY_ID[key]) return REAL_WORLD_STATS_BY_ID[key];
  }

  const possibleNames = [
    playerDisplay.name,
    player.name,
    player.fullName,
    player.playerName,
    player.player_name,
    player.final_player_name,
    player.final_short_name,
    player.info?.final_player_name,
    player.player_info?.final_player_name,
    player.player_info?.final_short_name
  ];

  for (const possibleName of possibleNames) {
    const key = normalizeStatsName(possibleName);
    if (key && REAL_WORLD_STATS_BY_NAME.has(key)) return REAL_WORLD_STATS_BY_NAME.get(key);
  }

  return null;
}

function getField(player, possibleNames) {
  for (const fieldName of possibleNames) {
    if (player[fieldName] !== undefined && player[fieldName] !== null && player[fieldName] !== "") {
      return player[fieldName];
    }
  }

  return "-";
}

function roundRating(rating) {
  if (rating === undefined || rating === null || rating === "") return "-";
  return Math.round(Number(rating));
}

function isNoBowlingValue(value) {
  const text = String(value ?? "").trim().toLowerCase();

  return (
    text === "" ||
    text === "-" ||
    text === "null" ||
    text === "none" ||
    text === "n/a" ||
    text === "does not bowl" ||
    text === "does not bowl (0)"
  );
}

function cleanBowlingDisplay(value) {
  return isNoBowlingValue(value) ? "-" : value;
}

function getTopPlaystyle(player, category) {
  if (
    player.topPlaystyles?.[category] &&
    Array.isArray(player.topPlaystyles[category]) &&
    player.topPlaystyles[category].length > 0
  ) {
    const first = player.topPlaystyles[category][0];

    if (category === "bowling" && isNoBowlingValue(first?.name)) {
      return null;
    }

    return first;
  }

  if (player.primaryPlaystyle?.[category] && player.playstyleRatings?.[category]) {
    const styleName = player.primaryPlaystyle[category];

    if (category === "bowling" && isNoBowlingValue(styleName)) {
      return null;
    }

    return { name: styleName, rating: player.playstyleRatings[category][styleName] };
  }

  if (player.playstyleRatings?.[category]) {
    const ratings = player.playstyleRatings[category];
    let bestName = null;
    let bestRating = -1;

    for (const styleName in ratings) {
      if (category === "bowling" && isNoBowlingValue(styleName)) continue;

      const rating = Number(ratings[styleName]);

      if (Number.isFinite(rating) && rating > bestRating) {
        bestName = styleName;
        bestRating = rating;
      }
    }

    if (bestName !== null) return { name: bestName, rating: bestRating };
  }

  return null;
}

function getTopThreePlaystyles(player, category) {
  let playstyles = [];

  if (player.topPlaystyles?.[category] && Array.isArray(player.topPlaystyles[category])) {
    playstyles = player.topPlaystyles[category].slice(0, 3);
  } else if (player.playstyleRatings?.[category]) {
    playstyles = Object.entries(player.playstyleRatings[category])
      .map(([name, rating]) => ({ name, rating }))
      .filter((item) => item.rating !== null && item.rating !== undefined)
      .sort((a, b) => Number(b.rating) - Number(a.rating))
      .slice(0, 3);
  }

  if (category === "bowling") {
    playstyles = playstyles.filter((item) => !isNoBowlingValue(item.name) && Number(item.rating) > 0);
  }

  return playstyles;
}

/* =========================================================
   PLAYSTYLE RECALCULATION FORMULAS
========================================================= */

function ratingNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function roundPlaystyleRating(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function getPositionBonuses(player) {
  const position = Number(player.primaryBattingPosition);

  return {
    openerBonus: position === 1 || position === 2 ? 20 : 0,
    topOrderBonus: position === 3 || position === 4 ? 20 : 0,
    middleOrderBonus: position === 5 || position === 6 ? 20 : 0,
    lowerOrderBonus: position === 7 || position === 8 ? 20 : 0,
    runnerBonus: position === 9 ? 20 : 0,
    pinchHitterBonus: position === 9 ? 20 : 0,
    wallBonus: position === 9 ? 20 : 0
  };
}

function calculateBattingPlaystyleRatings(player) {
  const batting = player.attributes?.batting || {};
  const physical = player.attributes?.physical || {};
  const mental = player.attributes?.mental || {};
  const overall = player.attributes?.overall || {};
  const bonuses = getPositionBonuses(player);

  const batting_overall = ratingNumber(overall.batting_overall);

  const technique = ratingNumber(batting.technique);
  const timing = ratingNumber(batting.timing);
  const footwork = ratingNumber(batting.footwork);
  const placement = ratingNumber(batting.placement);
  const range360 = ratingNumber(batting.range360);
  const defensiveShots = ratingNumber(batting.defensiveShots);
  const neutralShots = ratingNumber(batting.neutralShots);
  const attackingShots = ratingNumber(batting.attackingShots);
  const vsPace = ratingNumber(batting.vsPace);
  const vsSpin = ratingNumber(batting.vsSpin);
  const creativity = ratingNumber(batting.creativity);

  const strength = ratingNumber(physical.strength);
  const speed = ratingNumber(physical.speed);
  const agility = ratingNumber(physical.agility);

  const concentration = ratingNumber(mental.concentration);
  const aggression = ratingNumber(mental.aggression);
  const judgement = ratingNumber(mental.judgement);

  return {
    "Opener - Slogger": roundPlaystyleRating(
      bonuses.openerBonus +
      batting_overall +
      technique * 0.5 +
      timing * 0.5 +
      vsPace * 0.5 +
      aggression * 0.5 +
      placement * 0.25 +
      creativity * 0.25 +
      attackingShots * 0.25 +
      strength * 0.25
    ),

    "Opener - Balanced": roundPlaystyleRating(
      bonuses.openerBonus +
      batting_overall +
      technique * 0.5 +
      timing * 0.5 +
      footwork * 0.25 +
      placement * 0.25 +
      neutralShots * 0.25 +
      vsPace * 0.25 +
      speed * 0.125 +
      agility * 0.125 +
      concentration * 0.25 +
      aggression * 0.25 +
      judgement * 0.25
    ),

    "Opener - Anchor": roundPlaystyleRating(
      bonuses.openerBonus +
      batting_overall +
      technique * 0.5 +
      timing * 0.5 +
      footwork * 0.5 +
      defensiveShots * 0.25 +
      vsPace * 0.25 +
      vsSpin * 0.25 +
      concentration * 0.25 +
      judgement * 0.5
    ),

    "Top Order - Slogger": roundPlaystyleRating(
      bonuses.topOrderBonus +
      batting_overall +
      technique * 0.5 +
      timing * 0.25 +
      range360 * 0.25 +
      attackingShots * 0.5 +
      vsPace * 0.25 +
      vsSpin * 0.25 +
      creativity * 0.25 +
      strength * 0.25 +
      aggression * 0.5
    ),

    "Top Order - Balanced": roundPlaystyleRating(
      bonuses.topOrderBonus +
      batting_overall +
      technique * 0.5 +
      timing * 0.25 +
      footwork * 0.25 +
      range360 * 0.25 +
      neutralShots * 0.5 +
      vsPace * 0.25 +
      vsSpin * 0.25 +
      concentration * 0.25 +
      aggression * 0.25 +
      judgement * 0.25
    ),

    "Top Order - Anchor": roundPlaystyleRating(
      bonuses.topOrderBonus +
      batting_overall +
      technique * 0.5 +
      timing * 0.25 +
      footwork * 0.5 +
      defensiveShots * 0.5 +
      vsSpin * 0.25 +
      speed * 0.125 +
      agility * 0.125 +
      concentration * 0.25 +
      judgement * 0.5
    ),

    "Middle Order - Slogger": roundPlaystyleRating(
      bonuses.middleOrderBonus +
      batting_overall +
      technique * 0.25 +
      timing * 0.25 +
      placement * 0.25 +
      range360 * 0.25 +
      neutralShots * 0.25 +
      attackingShots * 0.5 +
      vsSpin * 0.5 +
      creativity * 0.25 +
      strength * 0.25 +
      aggression * 0.25
    ),

    "Middle Order - Balanced": roundPlaystyleRating(
      bonuses.middleOrderBonus +
      batting_overall +
      technique * 0.25 +
      timing * 0.25 +
      footwork * 0.25 +
      placement * 0.25 +
      defensiveShots * 0.25 +
      neutralShots * 0.25 +
      attackingShots * 0.25 +
      vsSpin * 0.25 +
      creativity * 0.25 +
      strength * 0.25 +
      speed * 0.125 +
      agility * 0.125 +
      judgement * 0.25
    ),

    "Middle Order - Anchor": roundPlaystyleRating(
      bonuses.middleOrderBonus +
      batting_overall +
      technique * 0.25 +
      timing * 0.25 +
      footwork * 0.5 +
      defensiveShots * 0.5 +
      neutralShots * 0.25 +
      vsSpin * 0.25 +
      creativity * 0.25 +
      speed * 0.125 +
      agility * 0.125 +
      judgement * 0.5
    ),

    "Lower Order - Slogger": roundPlaystyleRating(
      bonuses.lowerOrderBonus +
      batting_overall +
      timing * 0.25 +
      placement * 0.25 +
      range360 * 0.5 +
      neutralShots * 0.25 +
      attackingShots * 0.5 +
      vsPace * 0.25 +
      vsSpin * 0.25 +
      creativity * 0.25 +
      strength * 0.25 +
      aggression * 0.25
    ),

    "Lower Order - Balanced": roundPlaystyleRating(
      bonuses.lowerOrderBonus +
      batting_overall +
      timing * 0.25 +
      footwork * 0.25 +
      placement * 0.5 +
      range360 * 0.25 +
      neutralShots * 0.5 +
      attackingShots * 0.25 +
      vsPace * 0.25 +
      vsSpin * 0.25 +
      concentration * 0.25 +
      judgement * 0.25
    ),

    "Lower Order - Anchor": roundPlaystyleRating(
      bonuses.lowerOrderBonus +
      batting_overall +
      timing * 0.25 +
      footwork * 0.5 +
      placement * 0.25 +
      range360 * 0.25 +
      defensiveShots * 0.5 +
      neutralShots * 0.25 +
      speed * 0.125 +
      agility * 0.125 +
      concentration * 0.25 +
      judgement * 0.5
    ),

    "Finisher": roundPlaystyleRating(
      batting_overall +
      placement * 0.25 +
      range360 * 0.5 +
      attackingShots * 0.25 +
      vsPace * 0.5 +
      creativity * 0.5 +
      concentration * 0.5 +
      aggression * 0.25 +
      judgement * 0.25
    ),

    "Runner": roundPlaystyleRating(
      bonuses.runnerBonus +
      batting_overall +
      range360 * 0.25 +
      defensiveShots * 0.25 +
      neutralShots * 0.5 +
      vsPace * 0.25 +
      vsSpin * 0.25 +
      strength * 0.5 +
      speed * 0.25 +
      agility * 0.25 +
      concentration * 0.5
    ),

    "Pinch-Hitter": roundPlaystyleRating(
      bonuses.pinchHitterBonus +
      batting_overall +
      placement * 0.25 +
      range360 * 0.25 +
      attackingShots * 0.5 +
      vsPace * 0.5 +
      vsSpin * 0.5 +
      strength * 0.5 +
      aggression * 0.5
    ),

    "Wall": roundPlaystyleRating(
      bonuses.wallBonus +
      batting_overall +
      defensiveShots * 0.5 +
      neutralShots * 0.25 +
      vsPace * 0.5 +
      vsSpin * 0.5 +
      speed * 0.125 +
      agility * 0.125 +
      concentration * 0.5 +
      judgement * 0.5
    )
  };
}

function getBowlingGroup(player) {
  const bowlingType = String(player.bowlingType ?? "").toLowerCase();
  const bowlingStyle = String(player.bowlingStyle ?? "").toLowerCase();

  if (
    bowlingType === "none" ||
    bowlingType === "null" ||
    bowlingType === "" ||
    bowlingStyle === "does not bowl"
  ) {
    return "none";
  }

  if (bowlingType.includes("pace")) return "pace";
  if (bowlingType.includes("spin")) return "spin";

  if (
    bowlingStyle.includes("fast") ||
    bowlingStyle.includes("medium") ||
    bowlingStyle.includes("seam") ||
    bowlingStyle.includes("swing")
  ) {
    return "pace";
  }

  if (
    bowlingStyle.includes("spin") ||
    bowlingStyle.includes("break") ||
    bowlingStyle.includes("orthodox") ||
    bowlingStyle.includes("leg") ||
    bowlingStyle.includes("off") ||
    bowlingStyle.includes("slow")
  ) {
    return "spin";
  }

  return "none";
}

function calculateBowlingPlaystyleRatings(player) {
  const bowlingGroup = getBowlingGroup(player);

  if (bowlingGroup === "none") {
    return {
      "Swing Bowler": null,
      "Hit-the-Deck Seamer": null,
      "Short-Ball Specialist": null,
      "Death Specialist": null,
      "Classical Spinner": null,
      "Flat Spinner": null,
      "Mystery Spinner": null,
      "Containment Spinner": null,
      "Does Not Bowl": null
    };
  }

  const bowling = player.attributes?.bowling || {};
  const physical = player.attributes?.physical || {};
  const mental = player.attributes?.mental || {};
  const overall = player.attributes?.overall || {};

  const bowling_overall = ratingNumber(overall.bowling_overall);

  const accuracy = ratingNumber(bowling.accuracy);
  const bowlingSpeed = ratingNumber(bowling.bowlingSpeed);
  const swing = ratingNumber(bowling.swing);
  const turn = ratingNumber(bowling.turn);
  const flight = ratingNumber(bowling.flight);
  const variations = ratingNumber(bowling.variations);
  const intelligence = ratingNumber(bowling.intelligence);
  const defensiveBowling = ratingNumber(bowling.defensiveBowling);
  const neutralBowling = ratingNumber(bowling.neutralBowling);
  const attackingBowling = ratingNumber(bowling.attackingBowling);

  const stamina = ratingNumber(physical.stamina);
  const temperament = ratingNumber(mental.temperament);

  if (bowlingGroup === "pace") {
    return {
      "Swing Bowler": roundPlaystyleRating(
        bowling_overall +
        bowlingSpeed * 0.8 +
        swing * 0.8 +
        variations * 0.4 +
        intelligence * 0.4 +
        neutralBowling * 0.4 +
        attackingBowling * 0.4 +
        stamina * 0.4 +
        temperament * 0.4
      ),

      "Hit-the-Deck Seamer": roundPlaystyleRating(
        bowling_overall +
        accuracy * 0.4 +
        bowlingSpeed * 0.8 +
        swing * 0.4 +
        variations * 0.4 +
        neutralBowling * 0.8 +
        attackingBowling * 0.4 +
        stamina * 0.8
      ),

      "Short-Ball Specialist": roundPlaystyleRating(
        bowling_overall +
        accuracy * 0.4 +
        bowlingSpeed * 0.8 +
        defensiveBowling * 0.8 +
        attackingBowling * 0.8 +
        stamina * 0.8 +
        temperament * 0.4
      ),

      "Death Specialist": roundPlaystyleRating(
        bowling_overall +
        accuracy * 0.8 +
        variations * 0.8 +
        intelligence * 0.8 +
        defensiveBowling * 0.4 +
        attackingBowling * 0.4 +
        temperament * 0.8
      ),

      "Classical Spinner": null,
      "Flat Spinner": null,
      "Mystery Spinner": null,
      "Containment Spinner": null,
      "Does Not Bowl": null
    };
  }

  return {
    "Swing Bowler": null,
    "Hit-the-Deck Seamer": null,
    "Short-Ball Specialist": null,
    "Death Specialist": null,

    "Classical Spinner": roundPlaystyleRating(
      bowling_overall +
      accuracy * 0.4 +
      turn * 0.4 +
      flight * 0.4 +
      variations * 0.4 +
      intelligence * 0.4 +
      defensiveBowling * 0.4 +
      neutralBowling * 0.8 +
      attackingBowling * 0.4 +
      temperament * 0.4
    ),

    "Flat Spinner": roundPlaystyleRating(
      bowling_overall +
      accuracy * 0.4 +
      flight * 0.8 +
      variations * 0.4 +
      defensiveBowling * 0.8 +
      neutralBowling * 0.4 +
      stamina * 0.8 +
      temperament * 0.4
    ),

    "Mystery Spinner": roundPlaystyleRating(
      bowling_overall +
      turn * 0.4 +
      flight * 0.4 +
      variations * 0.8 +
      intelligence * 0.8 +
      neutralBowling * 0.4 +
      attackingBowling * 0.8 +
      temperament * 0.4
    ),

    "Containment Spinner": roundPlaystyleRating(
      bowling_overall +
      accuracy * 0.8 +
      flight * 0.4 +
      intelligence * 0.8 +
      defensiveBowling * 0.8 +
      neutralBowling * 0.4 +
      stamina * 0.4 +
      temperament * 0.4
    ),

    "Does Not Bowl": null
  };
}

function calculateFieldingPlaystyleRatings(player) {
  const fielding = player.attributes?.fielding || {};

  const reflexes = ratingNumber(fielding.reflexes);
  const keeping = ratingNumber(fielding.keeping);
  const collecting = ratingNumber(fielding.collecting);
  const stumping = ratingNumber(fielding.stumping);

  return {
    Wicketkeeper: roundPlaystyleRating(
      reflexes * 0.75 +
      keeping * 2 +
      collecting * 1.25 +
      stumping * 1
    )
  };
}

function getPrimaryStyleFromRatings(styleRatings) {
  let bestName = null;
  let bestRating = -Infinity;

  for (const [name, rating] of Object.entries(styleRatings || {})) {
    if (typeof rating === "number" && Number.isFinite(rating) && rating > bestRating) {
      bestName = name;
      bestRating = rating;
    }
  }

  return {
    name: bestName,
    rating: bestRating
  };
}

function getTopThreeFromRatings(styleRatings) {
  return Object.entries(styleRatings || {})
    .filter(([, rating]) => typeof rating === "number" && Number.isFinite(rating))
    .map(([name, rating]) => ({ name, rating }))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 3);
}

function recalculatePlayerPlaystyles(player) {
  if (!player.playstyleRatings) player.playstyleRatings = {};
  if (!player.topPlaystyles) player.topPlaystyles = {};
  if (!player.primaryPlaystyle) player.primaryPlaystyle = {};

  const battingRatings = calculateBattingPlaystyleRatings(player);
  const bowlingRatings = calculateBowlingPlaystyleRatings(player);
  const fieldingRatings = calculateFieldingPlaystyleRatings(player);

  player.playstyleRatings.batting = battingRatings;
  player.playstyleRatings.bowling = bowlingRatings;
  player.playstyleRatings.fielding = fieldingRatings;

  player.topPlaystyles.batting = getTopThreeFromRatings(battingRatings);
  player.topPlaystyles.bowling = getTopThreeFromRatings(bowlingRatings);
  player.topPlaystyles.fielding = getTopThreeFromRatings(fieldingRatings);

  const primaryBatting = getPrimaryStyleFromRatings(battingRatings);
  const primaryBowling = getPrimaryStyleFromRatings(bowlingRatings);
  const primaryFielding = getPrimaryStyleFromRatings(fieldingRatings);

  player.primaryPlaystyle.batting = primaryBatting.name;
  player.primaryPlaystyle.bowling = primaryBowling.name;
  player.primaryPlaystyle.fielding = primaryFielding.name;

  if (getBowlingGroup(player) === "none") {
    player.primaryPlaystyle.bowling = null;
    player.topPlaystyles.bowling = [];
  }

  return player;
}

function recalculateAllPlayerPlaystyles() {
  allPlayers.forEach((player) => recalculatePlayerPlaystyles(player));
}

function getBatStyle(player) {
  const topBatting = getTopPlaystyle(player, "batting");
  if (!topBatting) return "-";

  const code = BATTING_STYLE_CODES[topBatting.name] || topBatting.name;
  return `${code} (${roundRating(topBatting.rating)})`;
}

function getBowlStyle(player) {
  const topBowling = getTopPlaystyle(player, "bowling");

  if (!topBowling || isNoBowlingValue(topBowling.name)) return "-";

  const rating = roundRating(topBowling.rating);
  if (rating === "-" || Number(rating) <= 0) return "-";

  const code = BOWLING_STYLE_CODES[topBowling.name] || topBowling.name;
  return `${code} (${rating})`;
}

function getFieldStyle(player) {
  const topFielding = getTopPlaystyle(player, "fielding");
  if (!topFielding) return "-";

  const rating = roundRating(topFielding.rating);

  if (Number(rating) >= 60) return `WKP (${rating})`;
  return `Fielder (${rating})`;
}

function getBatStyleTooltip(player) {
  const topBatting = getTopPlaystyle(player, "batting");
  if (!topBatting) return "";

  const code = BATTING_STYLE_CODES[topBatting.name] || topBatting.name;
  return `${code} = ${topBatting.name}`;
}

function getBowlStyleTooltip(player) {
  const topBowling = getTopPlaystyle(player, "bowling");
  if (!topBowling || isNoBowlingValue(topBowling.name)) return "";

  const code = BOWLING_STYLE_CODES[topBowling.name] || topBowling.name;
  return `${code} = ${topBowling.name}`;
}

function getBatStyleClass(player) {
  const topBatting = getTopPlaystyle(player, "batting");
  if (!topBatting) return "ps-none";

  const name = topBatting.name;

  if (name.includes("Slogger")) return "ps-slogger";
  if (name.includes("Balanced")) return "ps-balanced";
  if (name.includes("Anchor")) return "ps-anchor";
  if (name === "Finisher") return "ps-finisher";
  if (name === "Runner") return "ps-runner";
  if (name === "Pinch-Hitter") return "ps-pinch";
  if (name === "Wall") return "ps-wall";

  return "ps-none";
}

function getBowlStyleClass(player) {
  const topBowling = getTopPlaystyle(player, "bowling");
  if (!topBowling || isNoBowlingValue(topBowling.name)) return "ps-none";

  const name = topBowling.name;

  if (name === "Swing Bowler") return "ps-swing";
  if (name === "Hit-the-Deck Seamer") return "ps-hitdeck";
  if (name === "Short-Ball Specialist") return "ps-shortball";
  if (name === "Death Specialist") return "ps-death";
  if (name === "Classical Spinner") return "ps-classical";
  if (name === "Flat Spinner") return "ps-flat";
  if (name === "Mystery Spinner") return "ps-mystery";
  if (name === "Containment Spinner") return "ps-containment";

  return "ps-none";
}

function getFieldStyleClass(player) {
  const topFielding = getTopPlaystyle(player, "fielding");
  if (!topFielding) return "ps-none";

  const rating = roundRating(topFielding.rating);

  if (Number(rating) >= 60) return "ps-wicketkeeper";
  return "ps-fielder";
}

function getDisplayPlayer(player) {
  return {
    name: getField(player, FIELD_NAMES.name),
    age: getField(player, FIELD_NAMES.age),
    nation: getField(player, FIELD_NAMES.nation),
    role: getField(player, FIELD_NAMES.role),
    hand: getField(player, FIELD_NAMES.hand),
    bowlingType: cleanBowlingDisplay(getField(player, FIELD_NAMES.bowlingType)),
    style: cleanBowlingDisplay(getField(player, FIELD_NAMES.style)),
    batStyle: getBatStyle(player),
    bowlStyle: getBowlStyle(player),
    fieldStyle: getFieldStyle(player),
    batStyleTooltip: getBatStyleTooltip(player),
    bowlStyleTooltip: getBowlStyleTooltip(player),
    batStyleClass: getBatStyleClass(player),
    bowlStyleClass: getBowlStyleClass(player),
    fieldStyleClass: getFieldStyleClass(player)
  };
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatLabel(text) {
  if (!text) return "-";

  return String(text)
    .replace(/([A-Z])/g, " $1")
    .replaceAll("_", " ")
    .replace(/^./, firstLetter => firstLetter.toUpperCase());
}

function extractNumberFromStyle(value) {
  const text = String(value);
  const match = text.match(/\((\d+)\)/);

  if (match) return Number(match[1]);
  return 0;
}

function getPlayerOverall(player) {
  const role = String(getField(player, FIELD_NAMES.role)).toLowerCase();
  const battingOverall = Number(player.attributes?.overall?.batting_overall) || 0;
  const bowlingOverall = Number(player.attributes?.overall?.bowling_overall) || 0;

  if (role.includes("all-rounder") || role.includes("all rounder")) {
    const higherOverall = Math.max(battingOverall, bowlingOverall);
    const lowerOverall = Math.min(battingOverall, bowlingOverall);
    const boostedLowerOverall = lowerOverall * 1.3;
    const allRounderOverall = (higherOverall + boostedLowerOverall) / 2;
    return Math.min(allRounderOverall, 20);
  }

  if (role.includes("bowler") || role.includes("bowl")) return Math.min(bowlingOverall, 20);
  if (role.includes("wicket") || role.includes("keeper")) return Math.min(battingOverall, 20);
  if (role.includes("batsman") || role.includes("batter") || role.includes("bat")) return Math.min(battingOverall, 20);

  return Math.min(Math.max(battingOverall, bowlingOverall), 20);
}

function renderStarRating(overallNumber) {
  const maxOverall = 20;
  const maxStars = 5;
  const safeOverall = Math.max(0, Math.min(Number(overallNumber) || 0, maxOverall));
  const starValue = safeOverall / 4;
  let starsHTML = "";

  for (let i = 1; i <= maxStars; i++) {
    let fillPercent = 0;

    if (starValue >= i) fillPercent = 100;
    else if (starValue > i - 1) fillPercent = (starValue - (i - 1)) * 100;

    starsHTML += `<span class="star"><span class="star-fill" style="width: ${fillPercent}%"></span></span>`;
  }

  return `<span class="overall-star-box" title="Overall star rating"><span class="star-rating">${starsHTML}</span></span>`;
}

function getVisibleSectionsByRole(role) {
  const normalizedRole = String(role).toLowerCase();

  if (normalizedRole.includes("all-rounder") || normalizedRole.includes("all rounder")) {
    return { playstyles: ["batting", "bowling"], attributes: ["batting", "bowling"] };
  }

  if (normalizedRole.includes("wicket") || normalizedRole.includes("keeper")) {
    return { playstyles: ["batting", "fielding"], attributes: ["batting", "fielding"] };
  }

  if (normalizedRole.includes("bowler") || normalizedRole.includes("bowl")) {
    return { playstyles: ["bowling", "fielding"], attributes: ["bowling", "fielding"] };
  }

  if (normalizedRole.includes("batsman") || normalizedRole.includes("batter") || normalizedRole.includes("bat")) {
    return { playstyles: ["batting", "fielding"], attributes: ["batting", "fielding"] };
  }

  return { playstyles: ["batting", "fielding"], attributes: ["batting", "fielding"] };
}

function renderTable(players, totalPlayers = players.length) {
  playerCount.textContent = totalPlayers;

  if (totalPlayers === 0) {
    playerTableBody.innerHTML = `<tr><td colspan="8">No players found.</td></tr>`;
    updatePaginationControls(0);
    return;
  }

  playerTableBody.innerHTML = "";

  players.forEach((player) => {
    const display = getDisplayPlayer(player);
    const row = document.createElement("tr");

    row.innerHTML = `
      <td class="player-name"><button class="player-link">${escapeHTML(display.name)}</button></td>
      <td>${escapeHTML(display.age)}</td>
      <td>${escapeHTML(display.nation)}</td>
      <td><span class="badge">${escapeHTML(display.role)}</span></td>
      <td>${escapeHTML(display.style)}</td>
      <td title="${escapeHTML(display.batStyleTooltip)}"><span class="playstyle-pill ${display.batStyleClass}">${escapeHTML(display.batStyle)}</span></td>
      <td title="${escapeHTML(display.bowlStyleTooltip)}"><span class="playstyle-pill ${display.bowlStyleClass}">${escapeHTML(display.bowlStyle)}</span></td>
      <td><span class="playstyle-pill ${display.fieldStyleClass}">${escapeHTML(display.fieldStyle)}</span></td>
    `;

    row.querySelector(".player-link").addEventListener("click", () => openPlayerModal(player));
    playerTableBody.appendChild(row);
  });

  updatePaginationControls(totalPlayers);
}

function ensurePaginationControls() {
  if (document.getElementById("databasePagination")) return;

  const pagination = document.createElement("section");
  pagination.className = "database-pagination";
  pagination.id = "databasePagination";

  pagination.innerHTML = `
    <div class="pagination-left">
      <span id="paginationInfo">Showing 0 players</span>
    </div>

    <div class="pagination-right">
      <label>
        Per page:
        <select id="playersPerPageSelect">
          <option value="25" selected>25</option>
          <option value="50">50</option>
        </select>
      </label>

      <button type="button" id="prevPageBtn">← Prev</button>
      <span id="pageNumberText">Page 1</span>
      <button type="button" id="nextPageBtn">Next →</button>
    </div>
  `;

  const controls = document.querySelector(".controls");
  const tableCard = document.querySelector(".table-card");

  if (controls) {
    controls.insertAdjacentElement("afterend", pagination);
  } else if (tableCard) {
    tableCard.insertAdjacentElement("beforebegin", pagination);
  }

  document.getElementById("playersPerPageSelect").addEventListener("change", (event) => {
    playersPerPage = Number(event.target.value) || 25;
    currentPage = 1;
    renderCurrentPage();
  });

  document.getElementById("prevPageBtn").addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderCurrentPage();
    }
  });

  document.getElementById("nextPageBtn").addEventListener("click", () => {
    const totalPages = getTotalPages(currentSortedPlayers.length);

    if (currentPage < totalPages) {
      currentPage++;
      renderCurrentPage();
    }
  });
}

function getTotalPages(totalPlayers) {
  return Math.max(1, Math.ceil(totalPlayers / playersPerPage));
}

function renderCurrentPage() {
  ensurePaginationControls();

  const totalPlayers = currentSortedPlayers.length;
  const totalPages = getTotalPages(totalPlayers);

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * playersPerPage;
  const endIndex = startIndex + playersPerPage;
  const pagePlayers = currentSortedPlayers.slice(startIndex, endIndex);

  renderTable(pagePlayers, totalPlayers);
}

function updatePaginationControls(totalPlayers) {
  ensurePaginationControls();

  const totalPages = getTotalPages(totalPlayers);
  const startNumber = totalPlayers === 0 ? 0 : (currentPage - 1) * playersPerPage + 1;
  const endNumber = Math.min(currentPage * playersPerPage, totalPlayers);

  const paginationInfo = document.getElementById("paginationInfo");
  const pageNumberText = document.getElementById("pageNumberText");
  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");

  if (paginationInfo) {
    paginationInfo.textContent = `Showing ${startNumber}-${endNumber} of ${totalPlayers} players`;
  }

  if (pageNumberText) {
    pageNumberText.textContent = `Page ${currentPage} of ${totalPages}`;
  }

  if (prevPageBtn) {
    prevPageBtn.disabled = currentPage <= 1 || totalPlayers === 0;
  }

  if (nextPageBtn) {
    nextPageBtn.disabled = currentPage >= totalPages || totalPlayers === 0;
  }
}
function renderPlaystyleRows(playstyles) {
  if (!playstyles || playstyles.length === 0) return `<p>-</p>`;

  return playstyles.map((style, index) => {
    const star = index === 0 ? "★ " : "";
    const rating = roundRating(style.rating);
    return `<div class="playstyle-row"><span>${star}${escapeHTML(style.name)}</span><span class="rating">${escapeHTML(rating)}</span></div>`;
  }).join("");
}

function renderProfileCard(title, playstyles, className) {
  return `<div class="profile-card ${className}"><h3>${escapeHTML(title)}</h3>${renderPlaystyleRows(playstyles)}</div>`;
}

function renderAttributeGroup(title, attributes, className) {
  if (!attributes) return "";

  const items = Object.entries(attributes).map(([key, value]) => {
    return `<div class="attribute-item"><span class="attribute-name">${escapeHTML(formatLabel(key))}</span><span class="attribute-value">${escapeHTML(value)}</span></div>`;
  }).join("");

  return `<div class="attribute-group ${className}"><h4>${escapeHTML(title)}</h4><div class="attribute-list">${items}</div></div>`;
}

function statFieldLabel(field) {
  const labels = {
    Matches: "Mat",
    Innings: "Inns",
    NotOuts: "NO",
    Runs: "Runs",
    HighScore: "HS",
    Average: "Avg",
    BallsFaced: "BF",
    StrikeRate: "SR",
    Hundreds: "100s",
    Fifties: "50s",
    Ducks: "0s",
    FoursTotal: "4s",
    SixesTotal: "6s",
    Overs: "Overs",
    MaidensTotal: "Mdn",
    Wickets: "Wkts",
    Economy: "Econ",
    BestBowlingInnings: "BBI",
    FourWickets: "4W",
    FiveWickets: "5W",
    TenWickets: "10W"
  };

  return labels[field] || field;
}

function formatStatsValue(value) {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function ballsToOversDisplay(ballsValue) {
  const totalBalls = Number(ballsValue);

  if (!Number.isFinite(totalBalls) || totalBalls <= 0) {
    return "-";
  }

  const overs = Math.floor(totalBalls / 6);
  const balls = totalBalls % 6;

  return `${overs}.${balls}`;
}

function getStatsDisplayValue(formatStats, field) {
  if (!formatStats || typeof formatStats !== "object") {
    return "-";
  }

  if (field === "Overs") {
    if (
      formatStats.Overs !== undefined &&
      formatStats.Overs !== null &&
      formatStats.Overs !== ""
    ) {
      return formatStats.Overs;
    }

    return ballsToOversDisplay(formatStats.Balls);
  }

  const value = formatStats[field];

  if (value === undefined || value === null || value === "") {
    return "-";
  }

  return value;
}

function renderStatsTable(title, sectionData, preferredFields) {
  const formats = ["test", "odi", "t20"];
  const fields = preferredFields;

  return `
    <div class="real-stats-card">
      <h4>${escapeHTML(title)}</h4>

      <div class="real-stats-table-wrap">
        <table class="real-stats-table">
          <thead>
            <tr>
              <th>Fmt</th>
              ${fields.map(field => `
                <th title="${escapeHTML(formatLabel(field))}">
                  ${escapeHTML(statFieldLabel(field))}
                </th>
              `).join("")}
            </tr>
          </thead>

          <tbody>
            ${formats.map(format => {
              const formatStats = sectionData?.[format] || {};

              return `
                <tr>
                  <td><strong>${escapeHTML(format.toUpperCase())}</strong></td>
                  ${fields.map(field => `
                    <td>${escapeHTML(formatStatsValue(getStatsDisplayValue(formatStats, field)))}</td>
                  `).join("")}
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderRealWorldStatsPanel(player) {
  const display = getDisplayPlayer(player);
  const stats = findRealWorldStats(player, display);

  if (!stats) {
    return `
      <section class="real-stats-section hidden" id="realWorldStatsPanel">
        <div class="real-stats-empty">
          No real-world stats found yet. Make sure this player has a matching ID or name in <strong>data/stats.json</strong>.
        </div>
      </section>
    `;
  }

  const info = stats.player_info || {};

  const battingFields = [
    "Matches",
    "Innings",
    "NotOuts",
    "Runs",
    "HighScore",
    "Average",
    "BallsFaced",
    "StrikeRate",
    "Hundreds",
    "Fifties",
    "Ducks",
    "FoursTotal",
    "SixesTotal"
  ];

  const bowlingFields = [
    "Matches",
    "Innings",
    "Overs",
    "Runs",
    "MaidensTotal",
    "Wickets",
    "Average",
    "Economy",
    "StrikeRate",
    "BestBowlingInnings",
    "FourWickets",
    "FiveWickets",
    "TenWickets"
  ];

  return `
    <section class="real-stats-section hidden" id="realWorldStatsPanel">
      <div class="real-stats-head">
        <div>
          <h3>Real World Stats</h3>
          <p>${escapeHTML(info.final_player_name || display.name)}${info.overall_career_status ? ` • ${escapeHTML(info.overall_career_status)}` : ""}</p>
        </div>
        <span class="real-stats-id">Stats ID: ${escapeHTML(player.id)}</span>
      </div>

      <div class="real-stats-grid">
        ${renderStatsTable("Batting", stats.batting, battingFields)}
        ${renderStatsTable("Bowling", stats.bowling, bowlingFields)}
      </div>
    </section>
  `;
}

function openPlayerModal(player) {
  const display = getDisplayPlayer(player);
  const visibleSections = getVisibleSectionsByRole(display.role);
  const overallNumber = getPlayerOverall(player);

  const battingPlaystyles = getTopThreePlaystyles(player, "batting");
  const bowlingPlaystyles = getTopThreePlaystyles(player, "bowling");
  const fieldingPlaystyles = getTopThreePlaystyles(player, "fielding");

  const battingAttributes = player.attributes?.batting;
  const bowlingAttributes = player.attributes?.bowling;
  const fieldingAttributes = player.attributes?.fielding;

  let profileCardsHTML = "";
  if (visibleSections.playstyles.includes("batting")) profileCardsHTML += renderProfileCard("Top Batting Playstyles", battingPlaystyles, "batting");
  if (visibleSections.playstyles.includes("bowling")) profileCardsHTML += renderProfileCard("Top Bowling Playstyles", bowlingPlaystyles, "bowling");
  if (visibleSections.playstyles.includes("fielding")) profileCardsHTML += renderProfileCard("Top Fielding Playstyles", fieldingPlaystyles, "fielding");

  let attributesHTML = "";
  if (visibleSections.attributes.includes("batting")) attributesHTML += renderAttributeGroup("Batting", battingAttributes, "batting");
  if (visibleSections.attributes.includes("bowling")) attributesHTML += renderAttributeGroup("Bowling", bowlingAttributes, "bowling");
  if (visibleSections.attributes.includes("fielding")) attributesHTML += renderAttributeGroup("Fielding", fieldingAttributes, "fielding");

  modalContent.innerHTML = `
    <div class="player-profile-header">
      <div class="player-profile-title-row">
        <h2>${escapeHTML(display.name)}</h2>

        <div class="player-profile-actions">
          <button class="db-stats-toggle-btn" id="dbStatsToggleBtn" type="button">
            Show Stats
          </button>

          <button class="db-edit-player-btn" onclick="openPlayerEditor('${escapeHTML(player.id)}')">
            Edit Player
          </button>
        </div>
      </div>

      <div class="player-meta">
        <span class="meta-badge">${escapeHTML(display.role)}</span>
        ${renderStarRating(overallNumber)}
        <span>${escapeHTML(display.nation)}</span>
        <span>${escapeHTML(display.age)} years</span>
        <span>Bats: ${escapeHTML(display.hand)}</span>
        <span>Bowls: ${escapeHTML(display.style)}</span>
      </div>
    </div>

    <div class="profile-grid" id="profileGridSection">${profileCardsHTML}</div>

    <div class="attributes-section" id="attributesSection">
      <h3>Attributes</h3>
      <div class="attributes-grid">${attributesHTML}</div>
    </div>

    ${renderRealWorldStatsPanel(player)}
  `;

  const toggleButton = document.getElementById("dbStatsToggleBtn");

  if (toggleButton) {
    toggleButton.addEventListener("click", () => {
      const profileGridSection = document.getElementById("profileGridSection");
      const attributesSection = document.getElementById("attributesSection");
      const liveStatsPanel = document.getElementById("realWorldStatsPanel");

      if (!liveStatsPanel) return;

      const showingStats = !liveStatsPanel.classList.contains("hidden");

      liveStatsPanel.classList.toggle("hidden", showingStats);
      profileGridSection?.classList.toggle("hidden", !showingStats);
      attributesSection?.classList.toggle("hidden", !showingStats);

      toggleButton.classList.toggle("active", !showingStats);
      toggleButton.textContent = showingStats ? "Show Stats" : "Show Attributes";
    });
  }

  loadRealWorldStats().then(() => {
    const panel = document.getElementById("realWorldStatsPanel");
    if (!panel || playerModal.classList.contains("hidden")) return;

    const wasHidden = panel.classList.contains("hidden");
    panel.outerHTML = renderRealWorldStatsPanel(player);

    const updatedPanel = document.getElementById("realWorldStatsPanel");
    if (updatedPanel && !wasHidden) {
      updatedPanel.classList.remove("hidden");
    }
  });

  playerModal.classList.remove("hidden");
}
function closePlayerModal() {
  playerModal.classList.add("hidden");
}

/* =========================================================
   PLAYER EDITOR MODAL
========================================================= */

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotOriginalPlayers() {
  allPlayers.forEach((player) => {
    const id = String(player.id);

    if (!ORIGINAL_PLAYER_COPY_BY_ID.has(id)) {
      ORIGINAL_PLAYER_COPY_BY_ID.set(id, deepClone(player));
    }
  });
}

function getSavedPlayerEdits() {
  const raw = localStorage.getItem(PLAYER_EDITOR_STORAGE_KEY);
  if (!raw) return {};

  try {
    return JSON.parse(raw) || {};
  } catch (error) {
    console.error("Could not read saved player edits:", error);
    return {};
  }
}

function writeSavedPlayerEdits(edits) {
  localStorage.setItem(PLAYER_EDITOR_STORAGE_KEY, JSON.stringify(edits));
}

function applySavedPlayerEdits() {
  const edits = getSavedPlayerEdits();

  allPlayers = allPlayers.map((player) => {
    const edited = edits[String(player.id)];
    return edited ? edited : player;
  });
}

function findEditorPlayerById(playerId) {
  return allPlayers.find((player) => String(player.id) === String(playerId));
}

function getNestedValue(obj, path, fallback = "") {
  const value = path.split(".").reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, obj);

  return value === undefined || value === null ? fallback : value;
}

function setNestedValue(obj, path, value) {
  const keys = path.split(".");
  let current = obj;

  keys.slice(0, -1).forEach((key) => {
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }

    current = current[key];
  });

  current[keys[keys.length - 1]] = value;
}

function normalizeEditorValue(value, type) {
  if (value === "" || value === "__NULL__") return null;

  if (type === "number") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  if (type === "boolean") {
    return value === "true";
  }

  return value;
}

function editorOptions(options, currentValue) {
  return options.map((option) => {
    const selected = String(currentValue) === String(option.value) ? "selected" : "";

    return `
      <option value="${escapeHTML(option.value)}" ${selected}>
        ${escapeHTML(option.label)}
      </option>
    `;
  }).join("");
}

function editorField(label, path, type = "text", options = null) {
  const player = findEditorPlayerById(editingPlayerId);
  const value = getNestedValue(player, path, "");
  const safeValue = value === "" || value === null ? "__NULL__" : value;

  if (options) {
    return `
      <label class="editor-field">
        <span>${escapeHTML(label)}</span>
        <select data-edit-path="${escapeHTML(path)}" data-edit-type="${escapeHTML(type)}">
          ${editorOptions(options, safeValue)}
        </select>
      </label>
    `;
  }

  return `
    <label class="editor-field">
      <span>${escapeHTML(label)}</span>
      <input
        type="${type === "number" ? "number" : "text"}"
        data-edit-path="${escapeHTML(path)}"
        data-edit-type="${escapeHTML(type)}"
        value="${escapeHTML(value)}"
      >
    </label>
  `;
}

function editorBowlingStylePicker() {
  const player = findEditorPlayerById(editingPlayerId);

  const currentType = getNestedValue(player, "bowlingType", "__NULL__") || "__NULL__";
  const currentStyle = getNestedValue(player, "bowlingStyle", "__NULL__") || "__NULL__";
  const currentAbbrev = getNestedValue(player, "bowlingStyleAbbrev", "__NULL__") || "__NULL__";

  const currentValue = makeBowlingStyleValue({
    type: currentType,
    style: currentStyle,
    abbrev: currentAbbrev
  });

  let options = [...BOWLING_STYLE_LIBRARY];

  const alreadyExists = options.some((option) => {
    return makeBowlingStyleValue(option) === currentValue;
  });

  if (!alreadyExists && currentStyle !== "__NULL__" && currentStyle !== null && currentStyle !== "") {
    options.unshift({
      type: currentType,
      style: currentStyle,
      abbrev: currentAbbrev,
      label: `Current — ${currentStyle} (${currentAbbrev || "-"})`
    });
  }

  const optionHTML = options.map((option) => {
    const value = makeBowlingStyleValue(option);
    const selected = value === currentValue ? "selected" : "";

    return `
      <option value="${escapeHTML(value)}" ${selected}>
        ${escapeHTML(option.label)}
      </option>
    `;
  }).join("");

  return `
    <label class="editor-field editor-field-wide">
      <span>Bowling Style / Abbrev</span>

      <select id="bowlingStylePicker" data-bowling-style-picker>
        ${optionHTML}
      </select>

      <input
        type="hidden"
        data-edit-path="bowlingStyle"
        data-edit-type="text"
        value="${escapeHTML(currentStyle)}"
      >

      <input
        type="hidden"
        data-edit-path="bowlingStyleAbbrev"
        data-edit-type="text"
        value="${escapeHTML(currentAbbrev)}"
      >
    </label>
  `;
}

function syncBowlingStylePicker() {
  const overlay = document.getElementById("playerEditorOverlay");
  if (!overlay) return;

  const picker = overlay.querySelector("[data-bowling-style-picker]");
  if (!picker) return;

  const selected = parseBowlingStyleValue(picker.value);

  const bowlingTypeInput = overlay.querySelector('[data-edit-path="bowlingType"]');
  const bowlingStyleInput = overlay.querySelector('[data-edit-path="bowlingStyle"]');
  const bowlingAbbrevInput = overlay.querySelector('[data-edit-path="bowlingStyleAbbrev"]');

  if (bowlingTypeInput) {
    bowlingTypeInput.value = selected.type;
  }

  if (bowlingStyleInput) {
    bowlingStyleInput.value = selected.style;
  }

  if (bowlingAbbrevInput) {
    bowlingAbbrevInput.value = selected.abbrev;
  }
}

function editorNumberField(label, path, min = 0, max = 20, step = 1) {
  const player = findEditorPlayerById(editingPlayerId);
  const value = getNestedValue(player, path, "");

  return `
    <label class="editor-field">
      <span>${escapeHTML(label)}</span>
      <input
        type="number"
        min="${min}"
        max="${max}"
        step="${step}"
        data-edit-path="${escapeHTML(path)}"
        data-edit-type="number"
        value="${escapeHTML(value)}"
      >
    </label>
  `;
}

function uniqueOptionList(values) {
  return [...new Set(values.filter(Boolean))]
    .sort()
    .map((value) => ({ value, label: value }));
}

function getNationalityOptions() {
  return uniqueOptionList(allPlayers.map((player) => player.nationality));
}

function renderEditorPreviewRows(player, category) {
  const rows = getTopThreePlaystyles(player, category);

  if (!rows.length) {
    return `<div class="editor-preview-empty">No ${category} playstyles</div>`;
  }

  return rows.map((style, index) => `
    <div class="editor-preview-row ${index === 0 ? "top" : ""}">
      <span>${index === 0 ? "★ " : ""}${escapeHTML(style.name)}</span>
      <b>${escapeHTML(roundRating(style.rating))}</b>
    </div>
  `).join("");
}

function renderEditorPlaystylePreviewInner(player) {
  return `
    <h3>Playstyle Preview</h3>
    <p>Playstyles are calculated from attributes and shown here as read-only.</p>

    <div class="editor-preview-grid">
      <div>
        <h4>Top Batting</h4>
        ${renderEditorPreviewRows(player, "batting")}
      </div>

      <div>
        <h4>Top Bowling</h4>
        ${renderEditorPreviewRows(player, "bowling")}
      </div>

      <div>
        <h4>Top Fielding</h4>
        ${renderEditorPreviewRows(player, "fielding")}
      </div>
    </div>
  `;
}

function renderEditorPlaystylePreview(player) {
  return `
    <section class="editor-section editor-playstyle-preview" id="editorPlaystylePreview">
      ${renderEditorPlaystylePreviewInner(player)}
    </section>
  `;
}

function renderNationalFormatFields() {
  return `
    <section class="editor-section">
      <h3>National Formats</h3>
      <div class="editor-grid compact">
        ${editorField("Test", "nationalFormats.test", "boolean", [
          { value: "true", label: "true" },
          { value: "false", label: "false" }
        ])}

        ${editorField("ODI", "nationalFormats.odi", "boolean", [
          { value: "true", label: "true" },
          { value: "false", label: "false" }
        ])}

        ${editorField("T20", "nationalFormats.t20", "boolean", [
          { value: "true", label: "true" },
          { value: "false", label: "false" }
        ])}
      </div>
    </section>
  `;
}

function renderPlayerEditorForm(player) {
  const roleOptions = [
    { value: "batsman", label: "batsman" },
    { value: "bowler", label: "bowler" },
    { value: "all-rounder", label: "all-rounder" },
    { value: "wicket-keeper", label: "wicket-keeper" }
  ];

  const handOptions = [
    { value: "__NULL__", label: "-" },
    { value: "right", label: "Right" },
    { value: "left", label: "Left" }
  ];

  const bowlingTypeOptions = [
    { value: "__NULL__", label: "-" },
    { value: "pace", label: "pace" },
    { value: "spin", label: "spin" },
    { value: "none", label: "none" }
  ];

  return `
    <div class="player-editor-modal">
      <div class="player-editor-header">
        <div>
          <h2>Edit Player</h2>
          <p>${escapeHTML(player.name)} • ID ${escapeHTML(player.id)}</p>
        </div>

        <button class="editor-close-btn" onclick="closePlayerEditor()">×</button>
      </div>

      <div class="player-editor-body">
        <section class="editor-section">
          <h3>Basic Information</h3>

          <div class="editor-grid">
            ${editorField("Name", "name")}
            ${editorField("Full Name", "fullName")}
            ${editorField("Age", "age", "number")}
            ${editorField("DOB", "DOB")}
            ${editorField("Nationality", "nationality", "text", getNationalityOptions())}
            ${editorField("Role", "role", "text", roleOptions)}
            ${editorField("Batting Hand", "battingHand", "text", handOptions)}
            ${editorField("Bowling Hand", "bowlingHand", "text", handOptions)}
            ${editorField("Bowling Type", "bowlingType", "text", bowlingTypeOptions)}
            ${editorBowlingStylePicker()}
            ${editorField("Batting Position", "primaryBattingPosition", "number")}
          </div>
        </section>

        ${renderEditorPlaystylePreview(player)}

        <section class="editor-section">
          <h3>Batting</h3>
          <div class="editor-grid compact">
            ${editorNumberField("Technique", "attributes.batting.technique")}
            ${editorNumberField("Timing", "attributes.batting.timing")}
            ${editorNumberField("Footwork", "attributes.batting.footwork")}
            ${editorNumberField("Placement", "attributes.batting.placement")}
            ${editorNumberField("360° Range", "attributes.batting.range360")}
            ${editorNumberField("Defensive", "attributes.batting.defensiveShots")}
            ${editorNumberField("Neutral", "attributes.batting.neutralShots")}
            ${editorNumberField("Attacking", "attributes.batting.attackingShots")}
            ${editorNumberField("vs Pace", "attributes.batting.vsPace")}
            ${editorNumberField("vs Spin", "attributes.batting.vsSpin")}
            ${editorNumberField("Creativity", "attributes.batting.creativity")}
            ${editorNumberField("Bat Overall", "attributes.overall.batting_overall")}
          </div>
        </section>

        <section class="editor-section">
          <h3>Bowling</h3>
          <div class="editor-grid compact">
            ${editorNumberField("Accuracy", "attributes.bowling.accuracy")}
            ${editorNumberField("Speed", "attributes.bowling.bowlingSpeed")}
            ${editorNumberField("Swing", "attributes.bowling.swing")}
            ${editorNumberField("Turn", "attributes.bowling.turn")}
            ${editorNumberField("Flight", "attributes.bowling.flight")}
            ${editorNumberField("Variations", "attributes.bowling.variations")}
            ${editorNumberField("Intelligence", "attributes.bowling.intelligence")}
            ${editorNumberField("Defensive", "attributes.bowling.defensiveBowling")}
            ${editorNumberField("Neutral", "attributes.bowling.neutralBowling")}
            ${editorNumberField("Attacking", "attributes.bowling.attackingBowling")}
            ${editorNumberField("Bowl Overall", "attributes.overall.bowling_overall")}
          </div>
        </section>

        <section class="editor-section">
          <h3>Physical</h3>
          <div class="editor-grid compact">
            ${editorNumberField("Strength", "attributes.physical.strength")}
            ${editorNumberField("Speed", "attributes.physical.speed")}
            ${editorNumberField("Agility", "attributes.physical.agility")}
            ${editorNumberField("Max Fitness", "attributes.physical.maxFitness")}
            ${editorNumberField("Endurance", "attributes.physical.endurance")}
            ${editorNumberField("Stamina", "attributes.physical.stamina")}
          </div>
        </section>

        <section class="editor-section">
          <h3>Mental</h3>
          <div class="editor-grid compact">
            ${editorNumberField("Concentration", "attributes.mental.concentration")}
            ${editorNumberField("Temperament", "attributes.mental.temperament")}
            ${editorNumberField("Aggression", "attributes.mental.aggression")}
            ${editorNumberField("Judgement", "attributes.mental.judgement")}
            ${editorNumberField("Leadership", "attributes.mental.leadership")}
          </div>
        </section>

        <section class="editor-section">
          <h3>Fielding</h3>
          <div class="editor-grid compact">
            ${editorNumberField("Catching", "attributes.fielding.catching")}
            ${editorNumberField("Reflexes", "attributes.fielding.reflexes")}
            ${editorNumberField("Ground Field", "attributes.fielding.groundFielding")}
            ${editorNumberField("Throw Power", "attributes.fielding.throwPower")}
            ${editorNumberField("Throw Acc", "attributes.fielding.throwAccuracy")}
            ${editorNumberField("Keeping", "attributes.fielding.keeping")}
            ${editorNumberField("Collecting", "attributes.fielding.collecting")}
            ${editorNumberField("Stumping", "attributes.fielding.stumping")}
          </div>
        </section>

        <section class="editor-section">
          <h3>Condition</h3>
          <div class="editor-grid compact">
            ${editorNumberField("Fitness", "condition.fitness", 0, 100, 0.5)}
            ${editorNumberField("Fatigue", "condition.fatigue", 0, 100, 0.1)}
            ${editorField("Injury", "condition.injury")}
            ${editorNumberField("Injury Duration", "condition.injuryDuration", 0, 365)}
            ${editorNumberField("Rest Days", "condition.consecutiveRestDays", 0, 365)}
            ${editorNumberField("Morale", "condition.morale", 0, 100)}
          </div>
        </section>

        <section class="editor-section">
          <h3>Career Stats</h3>
          <div class="editor-grid compact">
            ${editorNumberField("Matches", "careerStats.matches", 0, 1000)}
            ${editorNumberField("Innings", "careerStats.innings", 0, 1000)}
            ${editorNumberField("Runs", "careerStats.runs", 0, 100000)}
            ${editorNumberField("Wickets", "careerStats.wickets", 0, 10000)}
            ${editorNumberField("Catches", "careerStats.catches", 0, 10000)}
            ${editorNumberField("Stumpings", "careerStats.stumpings", 0, 10000)}
          </div>
        </section>

        <section class="editor-section">
          <h3>Season Stats</h3>
          <div class="editor-grid compact">
            ${editorNumberField("Matches", "seasonStats.matches", 0, 1000)}
            ${editorNumberField("Innings", "seasonStats.innings", 0, 1000)}
            ${editorNumberField("Runs", "seasonStats.runs", 0, 100000)}
            ${editorNumberField("Wickets", "seasonStats.wickets", 0, 10000)}
            ${editorNumberField("Catches", "seasonStats.catches", 0, 10000)}
            ${editorNumberField("Stumpings", "seasonStats.stumpings", 0, 10000)}
          </div>
        </section>

        ${renderNationalFormatFields()}
      </div>

      <div class="player-editor-footer">
        <button class="editor-reset-btn" onclick="resetPlayerEditorToDefault()">Reset to Default</button>
        <button class="editor-cancel-btn" onclick="closePlayerEditor()">Cancel</button>
        <button class="editor-save-btn" onclick="savePlayerEditorChanges()">Save Changes</button>
      </div>
    </div>
  `;
}

function getEditorDraftPlayer() {
  const originalPlayer = findEditorPlayerById(editingPlayerId);

  if (!originalPlayer) return null;

  const draftPlayer = deepClone(originalPlayer);

  document.querySelectorAll("#playerEditorOverlay [data-edit-path]").forEach((input) => {
    const path = input.dataset.editPath;
    const type = input.dataset.editType;
    const value = normalizeEditorValue(input.value, type);

    setNestedValue(draftPlayer, path, value);
  });

  normalizeNoBowlerFields(draftPlayer);
  recalculatePlayerPlaystyles(draftPlayer);

  return draftPlayer;
}

function refreshEditorPlaystylePreview() {
  const preview = document.getElementById("editorPlaystylePreview");
  const draftPlayer = getEditorDraftPlayer();

  if (!preview || !draftPlayer) return;

  preview.innerHTML = renderEditorPlaystylePreviewInner(draftPlayer);
}

function attachPlayerEditorLivePreview() {
  const overlay = document.getElementById("playerEditorOverlay");

  if (!overlay) return;

  overlay.querySelectorAll("[data-edit-path]").forEach((input) => {
    input.addEventListener("input", refreshEditorPlaystylePreview);
    input.addEventListener("change", refreshEditorPlaystylePreview);
  });

  const bowlingStylePicker = overlay.querySelector("[data-bowling-style-picker]");

  if (bowlingStylePicker) {
    bowlingStylePicker.addEventListener("change", () => {
      syncBowlingStylePicker();
      refreshEditorPlaystylePreview();
    });
  }
}

function ensurePlayerEditorRoot() {
  let root = document.getElementById("playerEditorOverlay");

  if (!root) {
    root = document.createElement("div");
    root.id = "playerEditorOverlay";
    root.className = "player-editor-overlay";
    document.body.appendChild(root);
  }

  return root;
}

function openPlayerEditor(playerId) {
  snapshotOriginalPlayers();

  const player = findEditorPlayerById(playerId);

  if (!player) {
    alert("Player not found.");
    return;
  }

  editingPlayerId = String(playerId);

  const root = ensurePlayerEditorRoot();
  root.innerHTML = renderPlayerEditorForm(player);
  attachPlayerEditorLivePreview();
  root.classList.add("show");
  document.body.classList.add("editor-open");
}

function closePlayerEditor() {
  const root = document.getElementById("playerEditorOverlay");

  if (root) {
    root.classList.remove("show");
    root.innerHTML = "";
  }

  editingPlayerId = null;
  document.body.classList.remove("editor-open");
}

function normalizeNoBowlerFields(player) {
  if (
    player.bowlingType === null ||
    player.bowlingType === "none" ||
    player.bowlingStyle === null ||
    isNoBowlingValue(player.bowlingStyle)
  ) {
    player.bowlingHand = null;
    player.bowlingType = null;
    player.bowlingStyle = null;
    player.bowlingStyleAbbrev = null;

    if (!player.primaryPlaystyle) player.primaryPlaystyle = {};
    player.primaryPlaystyle.bowling = null;

    if (!player.topPlaystyles) player.topPlaystyles = {};
    player.topPlaystyles.bowling = [];

    if (!player.playstyleRatings) player.playstyleRatings = {};
    if (!player.playstyleRatings.bowling) player.playstyleRatings.bowling = {};
    player.playstyleRatings.bowling["Does Not Bowl"] = null;

    if (player.attributes?.overall) {
      player.attributes.overall.bowling_overall = null;
    }
  }
}

function savePlayerEditorChanges() {
  const player = findEditorPlayerById(editingPlayerId);

  if (!player) return;

  document.querySelectorAll("#playerEditorOverlay [data-edit-path]").forEach((input) => {
    const path = input.dataset.editPath;
    const type = input.dataset.editType;
    const value = normalizeEditorValue(input.value, type);

    setNestedValue(player, path, value);
  });

  normalizeNoBowlerFields(player);
  recalculatePlayerPlaystyles(player);

  const edits = getSavedPlayerEdits();
  edits[String(player.id)] = deepClone(player);
  writeSavedPlayerEdits(edits);

  filteredPlayers = filteredPlayers.map((filteredPlayer) => {
    return String(filteredPlayer.id) === String(player.id) ? player : filteredPlayer;
  });

  closePlayerEditor();
  closePlayerModal();
  applyFilters();
  openPlayerModal(player);
}

function resetPlayerEditorToDefault() {
  const original = ORIGINAL_PLAYER_COPY_BY_ID.get(String(editingPlayerId));

  if (!original) {
    alert("Original player copy not found.");
    return;
  }

  const index = allPlayers.findIndex((player) => String(player.id) === String(editingPlayerId));

  if (index >= 0) {
    allPlayers[index] = deepClone(original);
  }

  const edits = getSavedPlayerEdits();
  delete edits[String(editingPlayerId)];
  writeSavedPlayerEdits(edits);

  filteredPlayers = [...allPlayers];
  closePlayerEditor();
  applyFilters();

  if (index >= 0) {
    openPlayerModal(allPlayers[index]);
  }
}

function downloadEditedPlayersJson() {
  const exportData = {
    format: "cm25-player-database",
    version: "edited-local",
    exportedAt: new Date().toISOString(),
    players: allPlayers
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = "players_edited.json";
  anchor.click();

  URL.revokeObjectURL(url);
}

function buildFilters() {
  const nations = new Set();
  const roles = new Set();

  nationFilter.innerHTML = `<option value="all">All Nations</option>`;
  roleFilter.innerHTML = `<option value="all">All Roles</option>`;

  allPlayers.forEach((player) => {
    const display = getDisplayPlayer(player);

    if (display.nation !== "-") nations.add(display.nation);
    if (display.role !== "-") roles.add(display.role);
  });

  [...nations].sort().forEach((nation) => {
    const option = document.createElement("option");
    option.value = nation;
    option.textContent = nation;
    nationFilter.appendChild(option);
  });

  [...roles].sort().forEach((role) => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    roleFilter.appendChild(option);
  });
}

function applyFilters() {
  const searchText = searchInput.value.toLowerCase();
  const selectedNation = nationFilter.value;
  const selectedRole = roleFilter.value;

  filteredPlayers = allPlayers.filter((player) => {
    const display = getDisplayPlayer(player);
    const searchableText = JSON.stringify(player).toLowerCase();
    const matchesSearch = searchableText.includes(searchText);
    const matchesNation = selectedNation === "all" || display.nation === selectedNation;
    const matchesRole = selectedRole === "all" || display.role === selectedRole;

    return matchesSearch && matchesNation && matchesRole;
  });

  currentPage = 1;
  applySortAndRender();
}

function sortPlayers(players) {
  if (!currentSort.key) return players;

  return [...players].sort((a, b) => {
    const playerA = getDisplayPlayer(a);
    const playerB = getDisplayPlayer(b);

    let valueA = playerA[currentSort.key];
    let valueB = playerB[currentSort.key];

    const numericColumns = ["age", "batStyle", "bowlStyle", "fieldStyle"];

    if (numericColumns.includes(currentSort.key)) {
      if (currentSort.key === "age") {
        valueA = Number(valueA) || 0;
        valueB = Number(valueB) || 0;
      } else {
        valueA = extractNumberFromStyle(valueA);
        valueB = extractNumberFromStyle(valueB);
      }
    } else {
      valueA = String(valueA).toLowerCase();
      valueB = String(valueB).toLowerCase();
    }

    if (valueA < valueB) return currentSort.direction === "asc" ? -1 : 1;
    if (valueA > valueB) return currentSort.direction === "asc" ? 1 : -1;
    return 0;
  });
}

function updateSortButtons() {
  const sortButtons = document.querySelectorAll(".column-sort-btn");

  sortButtons.forEach((button) => {
    const sortKey = button.dataset.sort;
    const icon = button.querySelector(".sort-icon");

    button.classList.remove("active");

    if (sortKey === currentSort.key) {
      button.classList.add("active");
      icon.textContent = currentSort.direction === "asc" ? "↑" : "↓";
    } else {
      icon.textContent = "↕";
    }
  });
}

function applySortAndRender() {
  currentSortedPlayers = sortPlayers(filteredPlayers);
  renderCurrentPage();
  updateSortButtons();
}

document.querySelectorAll(".column-sort-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const selectedSortKey = button.dataset.sort;

    if (currentSort.key === selectedSortKey) {
      currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
    } else {
      currentSort.key = selectedSortKey;
      currentSort.direction = "asc";
    }

    currentPage = 1;
    applySortAndRender();
  });
});

searchInput.addEventListener("input", applyFilters);
nationFilter.addEventListener("change", applyFilters);
roleFilter.addEventListener("change", applyFilters);

resetBtn.addEventListener("click", () => {
  searchInput.value = "";
  nationFilter.value = "all";
  roleFilter.value = "all";
  currentSort.key = null;
  currentSort.direction = "asc";
  currentPage = 1;
  filteredPlayers = [...allPlayers];
  applySortAndRender();
});

closeModalBtn.addEventListener("click", closePlayerModal);

playerModal.addEventListener("click", (event) => {
  if (event.target === playerModal) closePlayerModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const editorOverlay = document.getElementById("playerEditorOverlay");

    if (editorOverlay && editorOverlay.classList.contains("show")) {
      closePlayerEditor();
      return;
    }

    closePlayerModal();
  }
});

loadPlayers();