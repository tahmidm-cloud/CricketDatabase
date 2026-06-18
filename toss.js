/* =========================================================
   TOSS PAGE - CLEAN JS
   Loads selected tour match from localStorage
========================================================= */

function getStoredTourMatch() {
  const raw = localStorage.getItem("currentTourMatch");

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error("Could not read currentTourMatch:", error);
    return null;
  }
}

function getStoredTourSave() {
  const raw = localStorage.getItem("cricketTourSetupSave_v1");

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error("Could not read saved tour:", error);
    return null;
  }
}

function getTeamsFromMatchTitle(title) {
  const text = String(title || "");
  const firstPart = text.split(",")[0];

  if (!firstPart.includes(" vs ")) {
    return {
      teamA: "Team A",
      teamB: "Team B"
    };
  }

  const parts = firstPart.split(" vs ");

  return {
    teamA: parts[0].trim() || "Team A",
    teamB: parts[1].trim() || "Team B"
  };
}

function buildFreshMatchTitle(oldTitle, userTeam, computerTeam, formatKey) {
  const text = String(oldTitle || "");

  let suffix = "";

  if (text.includes(",")) {
    suffix = "," + text.split(",").slice(1).join(",");
  } else {
    suffix = `, 1st ${formatKey === "T20" ? "T20I" : formatKey}`;
  }

  return `${userTeam} vs ${computerTeam}${suffix}`;
}

function safeText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function safeDisplay(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.style.display = value;
  }
}


function setTossActionState(state) {
  const actions = document.getElementById("tossActions");

  if (!actions) {
    return;
  }

  actions.classList.toggle("is-user-decision", state === "user-decision");
  actions.classList.toggle("is-complete", state === "complete");
}

function safeClass(id, className, shouldAdd) {
  const element = document.getElementById(id);

  if (element) {
    element.classList.toggle(className, shouldAdd);
  }
}

function safeDisabled(id, disabled) {
  const element = document.getElementById(id);

  if (element) {
    element.disabled = disabled;
  }
}

function safeWidth(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.style.width = value;
  }
}

function getTeamShortName(teamName) {
  const special = {
    Bangladesh: "BAN",
    India: "IND",
    Pakistan: "PAK",
    Australia: "AUS",
    England: "ENG",
    "New Zealand": "NZ",
    "South Africa": "SA",
    "Sri Lanka": "SL",
    "West Indies": "WI",
    Afghanistan: "AFG",
    Zimbabwe: "ZIM",
    Ireland: "IRE",
    Scotland: "SCO",
    Netherlands: "NED",
    Nepal: "NEP",
    Oman: "OMA",
    Canada: "CAN",
    Namibia: "NAM",
    "United Arab Emirates": "UAE",
    "United States of America": "USA"
  };

  if (special[teamName]) {
    return special[teamName];
  }

  return String(teamName || "TEAM")
    .split(/\s+/)
    .map(word => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
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

function escapeLogoText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderTeamBadge(elementId, teamName, shortName, away = false) {
  const badge = document.getElementById(elementId);

  if (!badge) return;

  const logoPath = TEAM_LOGOS[teamName];

  badge.classList.toggle("away", !!away);

  if (!logoPath) {
    badge.textContent = shortName || "TM";
    return;
  }

  badge.innerHTML = `
    <img
      class="team-badge-logo"
      src="${escapeLogoText(logoPath)}"
      alt="${escapeLogoText(teamName)} logo"
    >
  `;

  const img = badge.querySelector("img");

  img.onerror = () => {
    badge.textContent = shortName || "TM";
  };
}

function getPlayerName(player) {
  return player?.name || player?.fullName || "Captain";
}

function getPlayerOverall(player) {
  const batting = Number(player?.attributes?.overall?.batting_overall) || 0;
  const bowling = Number(player?.attributes?.overall?.bowling_overall) || 0;
  const role = String(player?.role || "").toLowerCase();

  if (role.includes("all-rounder") || role.includes("all rounder")) {
    const higherOverall = Math.max(batting, bowling);
    const lowerOverall = Math.min(batting, bowling);
    return (higherOverall + lowerOverall * 1.3) / 2;
  }

  if (role.includes("bowler")) {
    return bowling;
  }

  return Math.max(batting, bowling);
}

function getCaptain(squad) {
  if (!Array.isArray(squad) || squad.length === 0) {
    return "Captain";
  }

  const sorted = [...squad].sort((a, b) => {
    const leadershipA = Number(a?.attributes?.mental?.leadership) || 0;
    const leadershipB = Number(b?.attributes?.mental?.leadership) || 0;

    if (leadershipB !== leadershipA) {
      return leadershipB - leadershipA;
    }

    return getPlayerOverall(b) - getPlayerOverall(a);
  });

  return getPlayerName(sorted[0]);
}

function getSelectedCaptainName(stored, squad, side = "user") {
  if (!stored) {
    return getCaptain(squad);
  }

  // User selected captain from Select XI page
  if (side === "user") {
    if (stored.captain) {
      return getPlayerName(stored.captain);
    }

    if (stored.captainPlayerId) {
      const foundCaptain = squad.find(player => {
        return String(player.id || player.playerId || player.name || player.fullName) === String(stored.captainPlayerId);
      });

      if (foundCaptain) {
        return getPlayerName(foundCaptain);
      }
    }
  }

  // Computer captain can still be auto-selected
  if (side === "computer") {
    if (stored.computerCaptain) {
      return getPlayerName(stored.computerCaptain);
    }

    if (stored.computerCaptainPlayerId) {
      const foundCaptain = squad.find(player => {
        return String(player.id || player.playerId || player.name || player.fullName) === String(stored.computerCaptainPlayerId);
      });

      if (foundCaptain) {
        return getPlayerName(foundCaptain);
      }
    }
  }

  return getCaptain(squad);
}

function average(numbers) {
  const valid = numbers.filter(number => Number.isFinite(number));

  if (!valid.length) {
    return 0;
  }

  return valid.reduce((sum, number) => sum + number, 0) / valid.length;
}

function getTeamRatings(squad) {
  const players = Array.isArray(squad) ? squad : [];

  if (!players.length) {
    return {
      bat: 0,
      bowl: 0,
      field: 0
    };
  }

  const bat = average(
    players.map(player => Number(player?.attributes?.overall?.batting_overall) || 0)
  );

  const bowl = average(
    players.map(player => Number(player?.attributes?.overall?.bowling_overall) || 0)
  );

  const field = average(
    players.map(player => {
      const fielding = player?.attributes?.fielding || {};

      return average([
        Number(fielding.catching) || 0,
        Number(fielding.reflexes) || 0,
        Number(fielding.groundFielding) || 0,
        Number(fielding.throwPower) || 0,
        Number(fielding.throwAccuracy) || 0
      ]);
    })
  );

  return {
    bat: Math.round(bat * 5),
    bowl: Math.round(bowl * 5),
    field: Math.round(field * 5)
  };
}

function getVenueData(match, userTeam) {
  const venue = match?.venue || "National Cricket Stadium";
  const format = String(match?.format || "T20");

  if (format === "Test") {
    return {
      weather: {
        title: "Clear Skies • 27°C",
        text: "Good long-format conditions. The pitch may change slowly across the match.",
        wind: "Wind 10 km/h",
        humidity: "Humidity 48%"
      },
      pitch: {
        title: "Balanced Test Surface",
        text: "Batting should be easier early, but bowlers may find help as the pitch wears.",
        bounce: "Bounce: True",
        assist: "Assist: Late Spin"
      },
      stadium: {
        name: venue,
        text: `${userTeam} home venue. Long match conditions expected.`,
        capacity: "Capacity 25,000+",
        crowd: "Crowd: Building"
      }
    };
  }

  if (format === "ODI") {
    return {
      weather: {
        title: "Partly Cloudy • 28°C",
        text: "Good one-day conditions. The ball should come onto the bat early.",
        wind: "Wind 12 km/h",
        humidity: "Humidity 54%"
      },
      pitch: {
        title: "Dry Batting Surface",
        text: "Good for batting first. Spin may become stronger later in the match.",
        bounce: "Bounce: Medium",
        assist: "Assist: Spin Late"
      },
      stadium: {
        name: venue,
        text: `${userTeam} home venue. Chasing may depend on dew and pitch pace.`,
        capacity: "Capacity 25,000+",
        crowd: "Crowd: Loud"
      }
    };
  }

  return {
    weather: {
      title: "Night Match • 26°C",
      text: "Fast-paced T20 conditions. Dew may make bowling second harder.",
      wind: "Wind 8 km/h",
      humidity: "Humidity 60%"
    },
    pitch: {
      title: "Hard T20 Surface",
      text: "Good for aggressive batting. Bowlers need variations and death control.",
      bounce: "Bounce: Good",
      assist: "Assist: Dew Later"
    },
    stadium: {
      name: venue,
      text: `${userTeam} home venue. Short-format energy expected from the crowd.`,
      capacity: "Capacity 25,000+",
      crowd: "Crowd: Electric"
    }
  };
}

function buildMatchDataFromStorage() {
  const stored = currentTourMatch || getStoredTourMatch();
  const savedTour = getStoredTourSave();

  if (!stored) {
    return {
      matchType: "Match Toss",
      teamA: {
        name: "Team A",
        short: "A",
        sub: "User Team",
        captain: "Captain",
        bat: 0,
        bowl: 0,
        field: 0
      },
      teamB: {
        name: "Team B",
        short: "B",
        sub: "Computer Team",
        captain: "Captain",
        bat: 0,
        bowl: 0,
        field: 0
      },
      weather: {
        title: "Partly Cloudy • 28°C",
        text: "Good match conditions.",
        wind: "Wind 12 km/h",
        humidity: "Humidity 54%"
      },
      pitch: {
        title: "Dry Batting Surface",
        text: "Good for batting first. Spin may become stronger later.",
        bounce: "Bounce: Medium",
        assist: "Assist: Spin Late"
      },
      stadium: {
        name: "National Cricket Stadium",
        text: "Home venue. Chasing may depend on dew and pitch pace.",
        capacity: "Capacity 25,000+",
        crowd: "Crowd: Loud"
      }
    };
  }

    const titleTeams = getTeamsFromMatchTitle(stored.match?.title);

    /* Important: saved tour teams should win over stale currentTourMatch teams */
    const teamAName =
        savedTour?.userTeam ||
        stored.userTeam ||
        stored.teamA ||
        titleTeams.teamA ||
        "Team A";

    const teamBName =
        savedTour?.computerTeam ||
        stored.computerTeam ||
        stored.teamB ||
        titleTeams.teamB ||
        "Team B";

    const matchFormat = stored.match?.format || stored.format || "Match";

    const freshMatchTitle = buildFreshMatchTitle(
        stored.match?.title,
        teamAName,
        teamBName,
        matchFormat
        );

    const freshMatch = {
        ...(stored.match || {}),
        format: matchFormat,
        title: freshMatchTitle
        };

    const userSquad =
        stored.selectedUserXI ||
        stored.userSquad ||
        savedTour?.userSquad ||
        [];

    const computerSquad =
        stored.selectedComputerXI ||
        stored.computerSquad ||
        savedTour?.computerSquad ||
        [];

    const userRatings = getTeamRatings(userSquad);
    const computerRatings = getTeamRatings(computerSquad);
    const venueData = getVenueData(freshMatch, teamAName);

    return {
        matchType: `${matchFormat} • ${freshMatchTitle}`,

    teamA: {
      name: teamAName,
      short: getTeamShortName(teamAName),
      sub: "User Team",
      captain: getSelectedCaptainName(stored, userSquad,"user"),
      bat: userRatings.bat,
      bowl: userRatings.bowl,
      field: userRatings.field
    },

    teamB: {
      name: teamBName,
      short: getTeamShortName(teamBName),
      sub: "Computer Team",
      captain: getSelectedCaptainName(stored, computerSquad, "computer"),
      bat: computerRatings.bat,
      bowl: computerRatings.bowl,
      field: computerRatings.field
    },

    weather: venueData.weather,
    pitch: venueData.pitch,
    stadium: venueData.stadium
  };
}

let currentTourMatch = null;
let matchData = null;

let userCall = "Heads";
let tossWinner = "";
let isFlipping = false;
let tossCompleted = false;

const canvas = document.getElementById("coinCanvas");
const ctx = canvas.getContext("2d");

let coinAngle = 0;
let currentFace = "Heads";

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function setupCanvas() {
  const cssSize = canvas.getBoundingClientRect().width || 260;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawCoin(coinAngle, 0, 0, false);
}

function drawEllipseCircle(x, y, radius, scaleX, fillStyle, strokeStyle, lineWidth) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scaleX, 1);

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = fillStyle;
  ctx.fill();

  if (strokeStyle) {
    ctx.lineWidth = lineWidth / Math.max(scaleX, 0.12);
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }

  ctx.restore();
}

function drawRidges(cx, cy, r, scaleX) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scaleX, 1);

  for (let i = 0; i < 28; i++) {
    const angle = (Math.PI * 2 * i) / 28;
    const next = angle + Math.PI * 2 / 44;

    ctx.beginPath();
    ctx.arc(0, 0, r + 4, angle, next);
    ctx.lineWidth = 5;
    ctx.strokeStyle = i % 2 === 0
      ? "rgba(255,236,151,0.92)"
      : "rgba(112,77,16,0.88)";
    ctx.stroke();
  }

  ctx.restore();
}

function drawFaceText(cx, cy, face, scaleX, showText) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scaleX, 1);

  const badge = ctx.createRadialGradient(-18, -22, 5, 0, 0, 45);
  badge.addColorStop(0, "rgba(255,255,255,0.58)");
  badge.addColorStop(0.35, "rgba(246,196,83,0.95)");
  badge.addColorStop(1, "rgba(148,98,18,0.98)");

  ctx.beginPath();
  ctx.arc(0, 0, 43, 0, Math.PI * 2);
  ctx.fillStyle = badge;
  ctx.fill();

  ctx.lineWidth = 2.5 / Math.max(scaleX, 0.18);
  ctx.strokeStyle = "rgba(255,240,174,0.75)";
  ctx.stroke();

  if (showText) {
    ctx.fillStyle = "#071018";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255,255,255,0.18)";
    ctx.shadowBlur = 10;
    ctx.font = "950 54px Arial";
    ctx.fillText(face === "Heads" ? "H" : "T", 0, -4);

    ctx.shadowBlur = 0;
    ctx.font = "950 9px Arial";
    ctx.fillStyle = "rgba(7,16,24,0.86)";
    ctx.fillText(face.toUpperCase(), 0, 29);
  }

  ctx.restore();
}

function drawCoin(angle, lift, progress, spinning) {
  const cssSize = canvas.getBoundingClientRect().width || 260;

  ctx.clearRect(0, 0, cssSize, cssSize);

  const cx = cssSize / 2;
  const groundY = cssSize * 0.80;
  const cy = cssSize * 0.50 + lift;
  const radius = cssSize * 0.285;

  const rawScale = Math.abs(Math.cos(angle));
  const scaleX = Math.max(0.09, rawScale);
  const face = Math.cos(angle) >= 0 ? "Heads" : "Tails";

  currentFace = face;

  const isEdgeOn = rawScale < 0.22;
  const showText = !spinning || (progress > 0.78 && rawScale > 0.42);

  const height = Math.max(0, -lift);
  const shadowScale = Math.max(0.45, 1 - height / 180);

  ctx.save();
  ctx.translate(cx, groundY);
  ctx.scale(1.05 * shadowScale, 0.18 * shadowScale);

  const shadow = ctx.createRadialGradient(0, 0, 10, 0, 0, radius * 1.45);
  shadow.addColorStop(0, "rgba(0,0,0,0.56)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");

  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  drawRidges(cx, cy, radius, scaleX);

  const outer = ctx.createRadialGradient(
    cx - radius * 0.45 * scaleX,
    cy - radius * 0.5,
    5,
    cx,
    cy,
    radius * 1.25
  );

  outer.addColorStop(0, "#fff3b0");
  outer.addColorStop(0.24, "#f6d96b");
  outer.addColorStop(0.58, "#bb8420");
  outer.addColorStop(1, "#5b3908");

  drawEllipseCircle(cx, cy, radius, scaleX, outer, "rgba(255,240,174,0.75)", 3);

  const centerGrad = ctx.createRadialGradient(
    cx - radius * 0.25 * scaleX,
    cy - radius * 0.32,
    4,
    cx,
    cy,
    radius * 0.9
  );

  centerGrad.addColorStop(0, "rgba(255,255,255,0.35)");
  centerGrad.addColorStop(0.18, "#1d3550");
  centerGrad.addColorStop(0.62, "#071827");
  centerGrad.addColorStop(1, "#02080d");

  drawEllipseCircle(cx, cy, radius * 0.82, scaleX, centerGrad, "rgba(248,250,252,0.24)", 2);

  if (!isEdgeOn) {
    drawFaceText(cx, cy, face, scaleX, showText);
  } else {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scaleX, 1);
    ctx.fillStyle = "rgba(246,196,83,0.95)";
    ctx.fillRect(-radius * 0.55, -radius * 0.78, radius * 1.1, radius * 1.56);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scaleX, 1);

  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.96, 0, Math.PI * 2);
  ctx.clip();

  const shine = ctx.createRadialGradient(
    -radius * 0.35,
    -radius * 0.42,
    radius * 0.05,
    -radius * 0.12,
    -radius * 0.20,
    radius * 1.15
  );

  shine.addColorStop(0, "rgba(255,255,255,0.46)");
  shine.addColorStop(0.22, "rgba(255,255,255,0.22)");
  shine.addColorStop(0.55, "rgba(255,255,255,0.06)");
  shine.addColorStop(1, "rgba(255,255,255,0)");

  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.96, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function setFinalFace(outcome) {
  coinAngle = outcome === "Heads" ? 0 : Math.PI;
  currentFace = outcome;
  drawCoin(coinAngle, 0, 1, false);
}

function pctWidth(value) {
  return `${Math.max(5, Math.min(100, Number(value) || 0))}%`;
}

function loadMatchData() {
  if (!matchData) {
    currentTourMatch = getStoredTourMatch();
    matchData = buildMatchDataFromStorage();
  }

  safeText("matchType", matchData.matchType);

  safeText("teamAName", matchData.teamA.name);
  safeText("teamASub", matchData.teamA.sub);
  renderTeamBadge("teamABadge", matchData.teamA.name, matchData.teamA.short, false);
  safeText("teamACaptain", matchData.teamA.captain);
  safeText("teamABat", matchData.teamA.bat);
  safeText("teamABowl", matchData.teamA.bowl);
  safeText("teamAField", matchData.teamA.field);
  safeWidth("teamAPower", pctWidth(average([
    matchData.teamA.bat,
    matchData.teamA.bowl,
    matchData.teamA.field
  ])));

  safeText("teamBName", matchData.teamB.name);
  safeText("teamBSub", matchData.teamB.sub);
  renderTeamBadge("teamBBadge", matchData.teamB.name, matchData.teamB.short, true);
  safeText("teamBCaptain", matchData.teamB.captain);
  safeText("teamBBat", matchData.teamB.bat);
  safeText("teamBBowl", matchData.teamB.bowl);
  safeText("teamBField", matchData.teamB.field);
  safeWidth("teamBPower", pctWidth(average([
    matchData.teamB.bat,
    matchData.teamB.bowl,
    matchData.teamB.field
  ])));

  safeText("weatherTitle", matchData.weather.title);
  safeText("weatherText", matchData.weather.text);
  safeText("weatherWind", matchData.weather.wind);
  safeText("weatherHumidity", matchData.weather.humidity);

  safeText("pitchTitle", matchData.pitch.title);
  safeText("pitchText", matchData.pitch.text);
  safeText("pitchBounce", matchData.pitch.bounce);
  safeText("pitchAssist", matchData.pitch.assist);

  safeText("stadiumName", matchData.stadium.name);
  safeText("stadiumText", matchData.stadium.text);
  safeText("stadiumCapacity", matchData.stadium.capacity);
  safeText("stadiumCrowd", matchData.stadium.crowd);
}

function selectCall(call) {
  if (isFlipping || tossCompleted) {
    return;
  }

  userCall = call;

  safeClass("headsBtn", "active", call === "Heads");
  safeClass("tailsBtn", "active", call === "Tails");

  safeText("resultTitle", `${matchData.teamA.name} calls ${call}`);
  safeText("resultText", "Now press Flip Toss. The coin will rotate physically and reveal the result when it lands.");

  safeDisplay("continueBtn", "none");
  flashResult();
}

function flashResult() {
  const resultBox = document.getElementById("resultBox");

  if (!resultBox) {
    return;
  }

  resultBox.classList.remove("flash-result");
  void resultBox.offsetWidth;
  resultBox.classList.add("flash-result");
}

function createSparkBurst() {
  // Disabled for smoother performance.
}

function animateCoinTo(outcome, done) {
  const startAngle = coinAngle;
  const finalBase = outcome === "Heads" ? 0 : Math.PI;

  let rotations = 7 + Math.floor(Math.random() * 2);
  let targetAngle = finalBase + rotations * Math.PI * 2;

  while (targetAngle <= startAngle + Math.PI * 6) {
    targetAngle += Math.PI * 2;
  }

  const startTime = performance.now();
  const duration = 1050;

  function frame(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const easedSpin = easeOutCubic(t);
    const jump = -82 * Math.sin(Math.PI * easeInOutSine(t));
    const wobble = Math.sin(t * Math.PI * 9) * (1 - t) * 0.20;

    coinAngle = startAngle + (targetAngle - startAngle) * easedSpin + wobble;

    drawCoin(coinAngle, jump, t, true);

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      coinAngle = finalBase;
      drawCoin(coinAngle, 0, 1, false);
      done();
    }
  }

  requestAnimationFrame(frame);
}

function doToss() {
  if (isFlipping || tossCompleted) {
    return;
  }

  if (!userCall) {
    safeText("resultTitle", "Choose Heads or Tails first");
    safeText("resultText", "Click one toss call before flipping the coin.");
    flashResult();
    return;
  }

  isFlipping = true;
  tossCompleted = true;

  const coinArea = document.getElementById("coinArea");
  const decisionRow = document.getElementById("decisionRow");

  if (decisionRow) {
    decisionRow.classList.remove("show");
  }

  safeDisplay("continueBtn", "none");
  setTossActionState("default");

  const outcome = Math.random() < 0.5 ? "Heads" : "Tails";

  if (coinArea) {
    coinArea.classList.add("flipping");
  }

  const flipBtn = document.getElementById("flipBtn");

  if (flipBtn) {
    flipBtn.disabled = true;
    flipBtn.classList.add("locked");
    flipBtn.textContent = "Toss Completed";
  }

  safeDisabled("headsBtn", true);
  safeDisabled("tailsBtn", true);

  safeText("resultTitle", "Coin flipping...");
  safeText("resultText", "The coin is rotating, turning edge-on, and slowing into the final result.");

  setTimeout(createSparkBurst, 1260);

  animateCoinTo(outcome, () => {
    if (coinArea) {
      coinArea.classList.remove("flipping");
    }

    setFinalFace(outcome);
    flashResult();

    const userWon = outcome === userCall;

    tossWinner = userWon ? matchData.teamA.name : matchData.teamB.name;

    safeText("resultTitle", `${outcome}! ${tossWinner} won the toss`);

    if (userWon) {
      safeText(
        "resultText",
        `${matchData.teamA.name} called ${userCall} correctly. Choose whether to bat or bowl first.`
      );

      if (decisionRow) {
        decisionRow.classList.add("show");
      }

      setTossActionState("user-decision");
    } else {
      const computerDecision = getComputerDecision();

      saveTossData(computerDecision, matchData.teamB.name);

      safeText(
        "resultText",
        `${matchData.teamA.name} called ${userCall}, but it landed ${outcome}. ${matchData.teamB.name} chooses to ${computerDecision.toLowerCase()} first.`
      );

      setTossActionState("complete");
      safeDisplay("continueBtn", "block");
    }

    isFlipping = false;
  });
}

function getComputerDecision() {
  const pitch = String(matchData.pitch.title || "").toLowerCase();

  if (pitch.includes("dry") || pitch.includes("batting")) {
    return "Bat";
  }

  if (pitch.includes("dew")) {
    return "Bowl";
  }

  return Math.random() < 0.5 ? "Bat" : "Bowl";
}

function saveTossData(decision, winnerName) {
  const tossData = {
    matchIndex: currentTourMatch?.matchIndex ?? null,
    winner: winnerName,
    decision,
    userCall,
    savedAt: new Date().toISOString()
  };

  localStorage.setItem("currentTossResult", JSON.stringify(tossData));

  if (currentTourMatch) {
    currentTourMatch.toss = tossData;
    localStorage.setItem("currentTourMatch", JSON.stringify(currentTourMatch));
  }
}

function chooseDecision(decision) {
  if (!tossWinner) {
    return;
  }

  saveTossData(decision, tossWinner);

  safeText("resultTitle", `${tossWinner} chooses to ${decision}`);
  safeText(
    "resultText",
    `${decision === "Bat" ? "Batting first selected." : "Bowling first selected."} Continue to Match Center.`
  );

  document.querySelectorAll("#decisionRow button").forEach(button => {
    button.disabled = true;
  });

  setTossActionState("complete");
  safeDisplay("continueBtn", "block");
  flashResult();
}

function goToMatchCenter() {
  window.location.href = "match-center.html";
}

function goBackToTourSetup() {
  window.location.href = "index.html";
}

function resetTossUI() {
  userCall = "Heads";
  tossWinner = "";
  isFlipping = false;
  tossCompleted = false;

  safeClass("headsBtn", "active", true);
  safeClass("tailsBtn", "active", false);

  safeDisabled("headsBtn", false);
  safeDisabled("tailsBtn", false);
  safeDisabled("flipBtn", false);

  const flipBtn = document.getElementById("flipBtn");

  if (flipBtn) {
    flipBtn.classList.remove("locked");
    flipBtn.textContent = "Flip Toss";
  }

  const decisionRow = document.getElementById("decisionRow");

  if (decisionRow) {
    decisionRow.classList.remove("show");

    decisionRow.querySelectorAll("button").forEach(button => {
      button.disabled = false;
    });
  }

  safeDisplay("continueBtn", "none");
  setTossActionState("default");

  safeText("resultTitle", "Choose Heads or Tails");
  safeText(
    "resultText",
    `${matchData.teamA.name} will call the toss. Pick Heads or Tails, then flip the coin.`
  );
}

let resizeTimer = null;

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);

  resizeTimer = setTimeout(() => {
    setupCanvas();
  }, 150);
});

function bootTossPage() {
  currentTourMatch = getStoredTourMatch();

  if (currentTourMatch) {
    const savedTour = getStoredTourSave();
    const formatKey = currentTourMatch.match?.format || currentTourMatch.format || "Match";

    if (savedTour?.userTeam && savedTour?.computerTeam) {
      const freshTitle = buildFreshMatchTitle(
        currentTourMatch.match?.title,
        savedTour.userTeam,
        savedTour.computerTeam,
        formatKey
      );

      currentTourMatch.userTeam = savedTour.userTeam;
      currentTourMatch.computerTeam = savedTour.computerTeam;
      currentTourMatch.teamA = savedTour.userTeam;
      currentTourMatch.teamB = savedTour.computerTeam;

      currentTourMatch.match = {
        ...(currentTourMatch.match || {}),
        format: formatKey,
        title: freshTitle
      };

      localStorage.setItem("currentTourMatch", JSON.stringify(currentTourMatch));
    }
  }

  matchData = buildMatchDataFromStorage();

  loadMatchData();
  setupCanvas();
  setFinalFace("Heads");
  resetTossUI();
}

window.addEventListener("pageshow", () => {
  bootTossPage();
});