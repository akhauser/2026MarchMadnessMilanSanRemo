const STORAGE_KEY = "march-madness-milan-game-state-v2";
const PLAYERS = ["Drew", "Will", "Ciara", "Madaline"];
const NCAA_API_BASE = "https://ncaa-api.henrygd.me";
const SPORTS_DB_BASE = "https://www.thesportsdb.com/api/v1/json/123";
const SYNC_INTERVAL_MS = 120000;

const GROUPS = [
  { id: "thursday", title: "Thursday teams", type: "basketball", picksRequired: 2, helper: "Choose 2 teams that play on Thursday." },
  { id: "friday", title: "Friday teams", type: "basketball", picksRequired: 2, helper: "Choose 2 teams that play on Friday." },
  { id: "saturday", title: "Saturday team", type: "basketball", picksRequired: 1, helper: "Choose 1 team that plays on Saturday." },
  { id: "sunday", title: "Sunday team", type: "basketball", picksRequired: 1, helper: "Choose 1 team that plays on Sunday." },
  { id: "milanSanRemo", title: "Milano-Sanremo rider", type: "rider", picksRequired: 1, helper: "Choose 1 rider before race start." },
];

const DAY_CONFIG = {
  thursday: { date: "2026-03-19", label: "Thursday" },
  friday: { date: "2026-03-20", label: "Friday" },
  saturday: { date: "2026-03-21", label: "Saturday" },
  sunday: { date: "2026-03-22", label: "Sunday" },
};

const STARTER_POOLS = {
  thursday: [
    { name: "Duke", seed: 1 },
    { name: "Houston", seed: 1 },
    { name: "Michigan", seed: 2 },
    { name: "St. John's", seed: 3 },
    { name: "Virginia", seed: 3 },
    { name: "Purdue", seed: 4 },
    { name: "Miami (FL)", seed: 6 },
    { name: "Louisville", seed: 7 },
  ],
  friday: [
    { name: "Arizona", seed: 1 },
    { name: "Florida", seed: 1 },
    { name: "Gonzaga", seed: 3 },
    { name: "Vanderbilt", seed: 5 },
    { name: "Texas Tech", seed: 6 },
    { name: "Illinois", seed: 7 },
    { name: "SMU", seed: 11 },
    { name: "Long Island", seed: 16 },
  ],
  saturday: [
    { name: "Saturday Winner A", seed: 1 },
    { name: "Saturday Winner B", seed: 4 },
    { name: "Saturday Winner C", seed: 7 },
    { name: "Saturday Winner D", seed: 10 },
  ],
  sunday: [
    { name: "Sunday Winner A", seed: 2 },
    { name: "Sunday Winner B", seed: 3 },
    { name: "Sunday Winner C", seed: 6 },
    { name: "Sunday Winner D", seed: 9 },
  ],
  milanSanRemo: [
    { name: "Tadej Pogacar" },
    { name: "Mathieu van der Poel" },
    { name: "Isaac del Toro" },
    { name: "Tom Pidcock" },
    { name: "Wout van Aert" },
    { name: "Jonathan Milan" },
    { name: "Filippo Ganna" },
    { name: "Jasper Philipsen" },
    { name: "Romain Gregoire" },
    { name: "Matthew Brennan" },
  ],
};

let syncTimerId = null;

function createDefaultState() {
  return {
    deadlines: {
      thursday: "2026-03-19T11:00",
      friday: "2026-03-20T11:00",
      saturday: "2026-03-21T11:00",
      sunday: "2026-03-22T11:00",
      milanSanRemo: "2026-03-21T04:10",
    },
    pools: {
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
      milanSanRemo: [],
    },
    picks: Object.fromEntries(
      PLAYERS.map((player) => [
        player,
        {
          thursday: ["", ""],
          friday: ["", ""],
          saturday: [""],
          sunday: [""],
          milanSanRemo: [""],
        },
      ]),
    ),
    results: {
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
      milanSanRemo: "",
    },
    sync: {
      autoSync: true,
      isSyncing: false,
      lastSyncedAt: "",
      lastError: "",
      sourceSummary: "",
    },
  };
}

function mergeWithDefaults(saved) {
  const base = createDefaultState();
  return {
    deadlines: { ...base.deadlines, ...(saved.deadlines || {}) },
    pools: { ...base.pools, ...(saved.pools || {}) },
    picks: PLAYERS.reduce((acc, player) => {
      acc[player] = { ...base.picks[player], ...(saved.picks?.[player] || {}) };
      return acc;
    }, {}),
    results: { ...base.results, ...(saved.results || {}) },
    sync: { ...base.sync, ...(saved.sync || {}) },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? mergeWithDefaults(JSON.parse(raw)) : createDefaultState();
  } catch (error) {
    console.error("Failed to load saved state", error);
    return createDefaultState();
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatDatePath(dateString) {
  const [year, month, day] = dateString.split("-");
  return `${year}/${month}/${day}`;
}

function parsePoolTextarea(text, type) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (type === "rider") return { name: line };
      const [namePart, seedPart] = line.split("|").map((piece) => piece.trim());
      const seed = Number(seedPart);
      return namePart && Number.isFinite(seed) ? { name: namePart, seed } : null;
    })
    .filter(Boolean);
}

function poolToTextarea(items, type) {
  return items.map((item) => (type === "rider" ? item.name : `${item.name}|${item.seed}`)).join("\n");
}

function getPoolById(groupId) {
  return state.pools[groupId] || [];
}

function isLocked(groupId) {
  const deadline = state.deadlines[groupId];
  return deadline ? new Date() >= new Date(deadline) : false;
}

function formatDeadline(deadline) {
  if (!deadline) return "No deadline set";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(deadline));
}

function formatSyncTime(value) {
  if (!value) return "Never synced";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function updateDeadline(groupId, dateValue, timeValue) {
  if (!dateValue || !timeValue) return;
  state.deadlines[groupId] = `${dateValue}T${timeValue}`;
  saveState();
  rerender();
}

function enforceUniqueSelections(selections) {
  const seen = new Set();
  return selections.map((choice) => {
    if (!choice || seen.has(choice)) return choice && seen.has(choice) ? "" : choice;
    seen.add(choice);
    return choice;
  });
}

function sanitizeSelections(groupId) {
  const valid = new Set(getPoolById(groupId).map((entry) => entry.name));
  PLAYERS.forEach((player) => {
    state.picks[player][groupId] = (state.picks[player][groupId] || []).map((choice) => (valid.has(choice) ? choice : ""));
  });

  if (groupId === "milanSanRemo") {
    const [riderName = ""] = (state.results.milanSanRemo || "").split("::");
    if (riderName && !valid.has(riderName)) state.results.milanSanRemo = "";
  } else {
    state.results[groupId] = (state.results[groupId] || []).map((choice) => (valid.has(choice) ? choice : ""));
  }
}

function getPickScore(groupId, selection) {
  if (!selection) return 0;
  if (groupId === "milanSanRemo") {
    if (!state.results.milanSanRemo) return 0;
    const [riderName, band] = state.results.milanSanRemo.split("::");
    if (selection !== riderName) return 0;
    if (band === "win") return 15;
    if (band === "podium") return 10;
    if (band === "top10") return 5;
    return 0;
  }
  if (!(state.results[groupId] || []).includes(selection)) return 0;
  const team = getPoolById(groupId).find((entry) => entry.name === selection);
  return team?.seed || 0;
}

function getPlayerTotals() {
  return PLAYERS.map((player) => {
    let basketball = 0;
    let race = 0;
    GROUPS.forEach((group) => {
      const subtotal = (state.picks[player][group.id] || []).reduce((sum, selection) => sum + getPickScore(group.id, selection), 0);
      if (group.type === "basketball") basketball += subtotal;
      if (group.type === "rider") race += subtotal;
    });
    return { player, basketball, race, total: basketball + race };
  }).sort((a, b) => b.total - a.total || b.basketball - a.basketball || a.player.localeCompare(b.player));
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[.'"]/g, "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\bst\b/g, "saint")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueByName(items) {
  const map = new Map();
  items.forEach((item) => {
    if (!item?.name) return;
    const key = normalizeName(item.name);
    if (!map.has(key)) map.set(key, item);
  });
  return [...map.values()];
}

function toIsoLocalMinute(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderScoreboard() {
  const root = document.getElementById("scoreboard");
  const totals = getPlayerTotals();
  const leaderScore = totals[0]?.total ?? 0;

  root.innerHTML = totals
    .map((entry, index) => `
      <article class="score-card ${entry.total === leaderScore && leaderScore > 0 ? "is-leading" : ""}">
        <span class="score-rank">${index === 0 ? "Leader" : `Place ${index + 1}`}</span>
        <strong class="score-name">${entry.player}</strong>
        <div class="score-total">${entry.total}</div>
        <div class="score-breakdown">Basketball ${entry.basketball} | Milano-Sanremo ${entry.race}</div>
      </article>
    `)
    .join("");
}

function renderSyncStatus() {
  const statusText = document.getElementById("syncStatusText");
  const metaText = document.getElementById("syncMetaText");
  const toggleButton = document.getElementById("toggleAutoSyncBtn");

  if (state.sync.isSyncing) {
    statusText.textContent = "Syncing live NCAA and Milano-Sanremo data...";
  } else if (state.sync.lastError) {
    statusText.textContent = state.sync.lastError;
  } else if (state.sync.lastSyncedAt) {
    statusText.textContent = "Live data synced successfully.";
  } else {
    statusText.textContent = "Waiting for first sync.";
  }

  metaText.textContent = [
    `Last sync: ${formatSyncTime(state.sync.lastSyncedAt)}`,
    state.sync.sourceSummary || "Manual fallback still works if an API misses data.",
  ].join(" | ");

  toggleButton.textContent = state.sync.autoSync ? "Auto-Sync On" : "Auto-Sync Off";
}

function renderDeadlines() {
  const root = document.getElementById("deadlineGrid");
  const template = document.getElementById("deadlineTemplate");
  root.innerHTML = "";

  GROUPS.forEach((group) => {
    const fragment = template.content.cloneNode(true);
    const title = fragment.querySelector("h3");
    const [dateInput, timeInput] = fragment.querySelectorAll("input");
    const status = fragment.querySelector(".deadline-status");
    const deadline = state.deadlines[group.id];
    const [datePart = "", timePart = ""] = deadline ? deadline.split("T") : [];
    const locked = isLocked(group.id);

    title.textContent = group.title;
    dateInput.value = datePart;
    timeInput.value = timePart.slice(0, 5);
    status.innerHTML = `<span class="status-pill ${locked ? "locked" : ""}">${locked ? "Locked" : "Open"}</span> ${formatDeadline(deadline)}`;

    dateInput.addEventListener("change", () => updateDeadline(group.id, dateInput.value, timeInput.value));
    timeInput.addEventListener("change", () => updateDeadline(group.id, dateInput.value, timeInput.value));

    root.appendChild(fragment);
  });
}

function renderPoolEditors() {
  const root = document.getElementById("poolEditors");
  const template = document.getElementById("poolEditorTemplate");
  root.innerHTML = "";

  GROUPS.forEach((group) => {
    const fragment = template.content.cloneNode(true);
    const title = fragment.querySelector("h3");
    const helper = fragment.querySelector(".pool-helper");
    const label = fragment.querySelector(".pool-label span");
    const textarea = fragment.querySelector("textarea");
    const count = fragment.querySelector(".pool-count");
    const items = getPoolById(group.id);

    title.textContent = group.title;
    helper.textContent = group.type === "basketball" ? "Format: Team Name|Seed, one per line." : "One rider per line.";
    label.textContent = group.helper;
    textarea.value = poolToTextarea(items, group.type);
    count.textContent = items.length ? `${items.length} options ready` : "No options yet. Paste or load starter options.";

    textarea.addEventListener("input", () => {
      state.pools[group.id] = parsePoolTextarea(textarea.value, group.type);
      sanitizeSelections(group.id);
      saveState();
      rerender();
    });

    root.appendChild(fragment);
  });
}

function renderPlayers() {
  const root = document.getElementById("playerCards");
  const playerTemplate = document.getElementById("playerTemplate");
  const groupTemplate = document.getElementById("pickGroupTemplate");
  const totals = Object.fromEntries(getPlayerTotals().map((entry) => [entry.player, entry.total]));
  root.innerHTML = "";

  PLAYERS.forEach((player) => {
    const fragment = playerTemplate.content.cloneNode(true);
    const title = fragment.querySelector("h3");
    const summary = fragment.querySelector(".player-lock-summary");
    const badge = fragment.querySelector(".player-score-badge");
    const groupsRoot = fragment.querySelector(".pick-groups");

    title.textContent = player;
    summary.textContent = "Selections save automatically in this browser.";
    badge.textContent = `${totals[player] || 0} pts`;

    GROUPS.forEach((group) => {
      const groupFragment = groupTemplate.content.cloneNode(true);
      const heading = groupFragment.querySelector("h4");
      const lock = groupFragment.querySelector(".pick-group-lock");
      const selectsRoot = groupFragment.querySelector(".pick-selects");
      const options = getPoolById(group.id);
      const selections = state.picks[player][group.id];
      const locked = isLocked(group.id);

      heading.textContent = group.title;
      lock.innerHTML = `<span class="status-pill ${locked ? "locked" : ""}">${locked ? "Locked" : "Open"}</span>`;

      for (let index = 0; index < group.picksRequired; index += 1) {
        const label = document.createElement("label");
        label.className = "pick-select-label";
        const labelText = document.createElement("span");
        labelText.textContent = group.picksRequired > 1 ? `Pick ${index + 1}` : "Selection";
        const select = document.createElement("select");
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = options.length ? "Choose one" : "Add pool options above first";
        select.appendChild(blank);

        options.forEach((option) => {
          const optionEl = document.createElement("option");
          optionEl.value = option.name;
          optionEl.textContent = group.type === "basketball" ? `${option.name} (${option.seed})` : option.name;
          select.appendChild(optionEl);
        });

        select.value = selections[index] || "";
        select.disabled = locked;
        if (locked) select.classList.add("locked-select");

        select.addEventListener("change", () => {
          const nextSelections = [...state.picks[player][group.id]];
          nextSelections[index] = select.value;
          state.picks[player][group.id] = enforceUniqueSelections(nextSelections);
          saveState();
          rerender();
        });

        label.appendChild(labelText);
        label.appendChild(select);

        if (group.type === "basketball") {
          const note = document.createElement("div");
          note.className = "seed-note";
          const team = options.find((item) => item.name === select.value);
          note.textContent = team ? `Worth ${team.seed} if they win` : "Seed points apply if this team wins.";
          label.appendChild(note);
        }

        selectsRoot.appendChild(label);
      }

      groupsRoot.appendChild(groupFragment);
    });

    root.appendChild(fragment);
  });
}

function renderResults() {
  const root = document.getElementById("resultsBoard");
  const template = document.getElementById("resultsTemplate");
  root.innerHTML = "";

  GROUPS.forEach((group) => {
    const fragment = template.content.cloneNode(true);
    const title = fragment.querySelector("h3");
    const subtitle = fragment.querySelector("p");
    const controls = fragment.querySelector(".result-controls");
    const options = getPoolById(group.id);

    title.textContent = group.title;
    subtitle.textContent = group.type === "basketball" ? "Winners auto-sync after games finish, and you can still edit manually." : "Race result auto-syncs when available, with manual fallback.";

    if (group.type === "basketball") {
      if (!options.length) {
        const empty = document.createElement("div");
        empty.className = "seed-note";
        empty.textContent = "Add team options above or run sync to track winners.";
        controls.appendChild(empty);
      } else {
        const winnerList = document.createElement("div");
        winnerList.className = "winner-list";
        const winners = new Set(state.results[group.id] || []);

        options.forEach((option) => {
          const label = document.createElement("label");
          label.className = "winner-toggle";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = winners.has(option.name);
          checkbox.addEventListener("change", () => {
            const next = new Set(state.results[group.id] || []);
            if (checkbox.checked) next.add(option.name);
            else next.delete(option.name);
            state.results[group.id] = [...next];
            saveState();
            rerender();
          });

          const text = document.createElement("span");
          text.textContent = `${option.name} (${option.seed}) won`;

          label.appendChild(checkbox);
          label.appendChild(text);
          winnerList.appendChild(label);
        });

        controls.appendChild(winnerList);
      }
    } else {
      const riderLabel = document.createElement("label");
      riderLabel.className = "result-select-label";
      const riderText = document.createElement("span");
      riderText.textContent = "Rider";
      const riderSelect = document.createElement("select");
      const riderBlank = document.createElement("option");
      riderBlank.value = "";
      riderBlank.textContent = options.length ? "Select rider" : "Add rider options above or sync";
      riderSelect.appendChild(riderBlank);

      options.forEach((option) => {
        const optionEl = document.createElement("option");
        optionEl.value = option.name;
        optionEl.textContent = option.name;
        riderSelect.appendChild(optionEl);
      });

      const bandLabel = document.createElement("label");
      bandLabel.className = "result-select-label";
      const bandText = document.createElement("span");
      bandText.textContent = "Finish";
      const bandSelect = document.createElement("select");
      [
        { value: "", label: "Select result band" },
        { value: "win", label: "Win (15)" },
        { value: "podium", label: "2nd or 3rd (10)" },
        { value: "top10", label: "4th through 10th (5)" },
      ].forEach((item) => {
        const optionEl = document.createElement("option");
        optionEl.value = item.value;
        optionEl.textContent = item.label;
        bandSelect.appendChild(optionEl);
      });

      const [savedRider = "", savedBand = ""] = (state.results.milanSanRemo || "").split("::");
      riderSelect.value = savedRider;
      bandSelect.value = savedBand;

      const persistRaceResult = () => {
        state.results.milanSanRemo = riderSelect.value && bandSelect.value ? `${riderSelect.value}::${bandSelect.value}` : "";
        saveState();
        rerender();
      };

      riderSelect.addEventListener("change", persistRaceResult);
      bandSelect.addEventListener("change", persistRaceResult);

      riderLabel.appendChild(riderText);
      riderLabel.appendChild(riderSelect);
      bandLabel.appendChild(bandText);
      bandLabel.appendChild(bandSelect);
      controls.appendChild(riderLabel);
      controls.appendChild(bandLabel);
    }

    root.appendChild(fragment);
  });
}

function rerender() {
  renderScoreboard();
  renderSyncStatus();
  renderDeadlines();
  renderPoolEditors();
  renderPlayers();
  renderResults();
}

function setSyncState(patch) {
  state.sync = { ...state.sync, ...patch };
  saveState();
  rerender();
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function extractTeamName(team) {
  return normalizeWhitespace(
    team?.short || team?.shortName || team?.names?.short || team?.names?.seo || team?.name || team?.school || team?.description || "",
  );
}

function getCompetitorName(competitor) {
  return normalizeWhitespace(competitor?.team?.displayName || competitor?.team?.shortDisplayName || competitor?.displayName || competitor?.shortName);
}

function parseNcaaGames(payload) {
  const containers = [
    ...safeArray(payload?.games),
    ...safeArray(payload?.gameCenter),
    ...safeArray(payload?.scoreboard?.games),
    ...safeArray(payload?.data?.games),
  ];

  return containers.map((game) => {
    const competitors = safeArray(game?.competitions?.[0]?.competitors);
    const homeCompetitor = competitors.find((item) => item.homeAway === "home");
    const awayCompetitor = competitors.find((item) => item.homeAway === "away");
    const homeRaw = game.home || game.homeTeam || homeCompetitor || {};
    const awayRaw = game.away || game.awayTeam || awayCompetitor || {};
    const homeName = extractTeamName(homeRaw) || getCompetitorName(homeCompetitor);
    const awayName = extractTeamName(awayRaw) || getCompetitorName(awayCompetitor);
    const homeSeed = firstNumber(homeRaw.seed, homeRaw.teamSeed, homeCompetitor?.curatedRank?.current, homeCompetitor?.seed);
    const awaySeed = firstNumber(awayRaw.seed, awayRaw.teamSeed, awayCompetitor?.curatedRank?.current, awayCompetitor?.seed);
    const homeScore = firstNumber(homeRaw.score, homeRaw.currentScore, homeCompetitor?.score);
    const awayScore = firstNumber(awayRaw.score, awayRaw.currentScore, awayCompetitor?.score);
    const status = normalizeWhitespace(game?.gameState || game?.status || game?.status?.type?.name || game?.status?.description || "").toLowerCase();
    const startValue = game?.startDate || game?.startTime || game?.date || game?.gameDate || game?.startTimeEpoch;
    const startDate = startValue ? new Date(startValue) : null;
    const titleText = normalizeWhitespace([
      game?.title,
      game?.description,
      game?.round,
      game?.bracketRound,
      game?.tournament,
      game?.event?.name,
    ].join(" "));

    return {
      homeName,
      awayName,
      homeSeed,
      awaySeed,
      homeScore,
      awayScore,
      startDate: startDate instanceof Date && !Number.isNaN(startDate.valueOf()) ? startDate : null,
      status,
      titleText,
      isTournamentLike: Boolean(homeSeed && awaySeed) || /championship|tournament|march madness|first round|second round|sweet 16/i.test(titleText),
      winner: status.includes("final") && homeScore && awayScore ? (homeScore > awayScore ? homeName : awayName) : "",
    };
  }).filter((game) => game.homeName && game.awayName);
}

function pickTournamentGames(games) {
  const filtered = games.filter((game) => game.isTournamentLike);
  return filtered.length ? filtered : games;
}

function mergeTeamPool(existing, imported) {
  const existingMap = new Map(existing.map((team) => [normalizeName(team.name), team]));
  imported.forEach((team) => {
    existingMap.set(normalizeName(team.name), team);
  });
  return [...existingMap.values()].sort((a, b) => (a.seed || 999) - (b.seed || 999) || a.name.localeCompare(b.name));
}

async function syncBasketballData() {
  const importedPools = {};
  const importedResults = {};
  const entries = Object.entries(DAY_CONFIG);

  for (const [groupId, config] of entries) {
    const url = `${NCAA_API_BASE}/scoreboard/basketball-men/d1/${formatDatePath(config.date)}/all-conf`;
    const payload = await fetchJson(url);
    const games = pickTournamentGames(parseNcaaGames(payload));

    const teams = uniqueByName(
      games.flatMap((game) => [
        game.homeName ? { name: game.homeName, seed: game.homeSeed || 16 } : null,
        game.awayName ? { name: game.awayName, seed: game.awaySeed || 16 } : null,
      ]).filter(Boolean),
    );

    importedPools[groupId] = mergeTeamPool(state.pools[groupId], teams);
    importedResults[groupId] = uniqueByName(games.filter((game) => game.winner).map((game) => ({ name: game.winner }))).map((entry) => entry.name);

    const starts = games.map((game) => game.startDate).filter(Boolean).sort((a, b) => a - b);
    if (starts[0]) state.deadlines[groupId] = toIsoLocalMinute(starts[0]);
  }

  Object.keys(importedPools).forEach((groupId) => {
    state.pools[groupId] = importedPools[groupId];
    state.results[groupId] = importedResults[groupId] || [];
    sanitizeSelections(groupId);
  });

  return {
    teamCount: Object.values(importedPools).reduce((sum, items) => sum + items.length, 0),
  };
}

function extractEventCandidates(payload) {
  return [...safeArray(payload?.event), ...safeArray(payload?.events), ...safeArray(payload?.results)];
}

function extractLineupNames(payload) {
  const entries = [...safeArray(payload?.lineup), ...safeArray(payload?.player), ...safeArray(payload?.players)];
  return uniqueByName(
    entries.map((entry) => ({ name: normalizeWhitespace(entry?.strPlayer || entry?.strPlayerAlternate || entry?.strName || entry?.name) })).filter((entry) => entry.name),
  ).map((entry) => entry.name);
}

function extractRaceResult(payload) {
  const rows = [...safeArray(payload?.results), ...safeArray(payload?.eventresults), ...safeArray(payload?.result)];
  const ranked = rows
    .map((row) => ({
      name: normalizeWhitespace(row?.strPlayer || row?.strPlayerAlternate || row?.strName || row?.name),
      rank: firstNumber(row?.intRank, row?.intPosition, row?.position, row?.strPosition),
    }))
    .filter((row) => row.name && row.rank)
    .sort((a, b) => a.rank - b.rank);
  return ranked[0] || null;
}

function rankToBand(rank) {
  if (rank === 1) return "win";
  if (rank === 2 || rank === 3) return "podium";
  if (rank >= 4 && rank <= 10) return "top10";
  return "";
}

async function syncCyclingData() {
  const queryUrls = [
    `${SPORTS_DB_BASE}/searchevents.php?e=${encodeURIComponent("Milano-Sanremo")}`,
    `${SPORTS_DB_BASE}/searchevents.php?e=${encodeURIComponent("Milan San Remo")}`,
    `${SPORTS_DB_BASE}/searchevents.php?e=${encodeURIComponent("Milan-San Remo")}`,
  ];

  let events = [];
  for (const url of queryUrls) {
    const payload = await fetchJson(url);
    events = extractEventCandidates(payload);
    if (events.length) break;
  }

  const event = events.find((item) => /san ?remo/i.test(normalizeWhitespace(item?.strEvent || item?.strEventAlternate)) && /2026-03-21/.test(String(item?.dateEvent || item?.strDate || "")))
    || events.find((item) => /san ?remo/i.test(normalizeWhitespace(item?.strEvent || item?.strEventAlternate)));

  if (!event?.idEvent) throw new Error("Cycling API did not return a Milano-Sanremo event.");

  const lineupPayload = await fetchJson(`${SPORTS_DB_BASE}/lookuplineup.php?id=${encodeURIComponent(event.idEvent)}`);
  const resultPayload = await fetchJson(`${SPORTS_DB_BASE}/eventresults.php?id=${encodeURIComponent(event.idEvent)}`);
  const lineupNames = extractLineupNames(lineupPayload);
  const bestResult = extractRaceResult(resultPayload);
  const resultBand = bestResult ? rankToBand(bestResult.rank) : "";

  if (lineupNames.length) {
    state.pools.milanSanRemo = mergeTeamPool(state.pools.milanSanRemo, lineupNames.map((name) => ({ name })));
    sanitizeSelections("milanSanRemo");
  }

  if (bestResult && resultBand) state.results.milanSanRemo = `${bestResult.name}::${resultBand}`;
  if (event?.strTimestamp) {
    const eventDate = new Date(event.strTimestamp);
    if (!Number.isNaN(eventDate.valueOf())) state.deadlines.milanSanRemo = toIsoLocalMinute(eventDate);
  }

  return {
    riderCount: lineupNames.length,
  };
}

async function syncLiveData() {
  if (state.sync.isSyncing) return;
  setSyncState({ isSyncing: true, lastError: "" });

  try {
    const [basketballSummary, cyclingSummary] = await Promise.all([syncBasketballData(), syncCyclingData()]);
    setSyncState({
      isSyncing: false,
      lastSyncedAt: new Date().toISOString(),
      lastError: "",
      sourceSummary: `Imported ${basketballSummary.teamCount} team slots and ${cyclingSummary.riderCount || 0} riders. Latest completed results were applied automatically.`,
    });
  } catch (error) {
    console.error(error);
    setSyncState({
      isSyncing: false,
      lastError: `Sync issue: ${error.message}`,
    });
  }
}

function seedStarterOptions() {
  Object.keys(STARTER_POOLS).forEach((key) => {
    state.pools[key] = STARTER_POOLS[key];
    sanitizeSelections(key);
  });
  saveState();
  rerender();
}

function resetResultsOnly() {
  state.results = createDefaultState().results;
  saveState();
  rerender();
}

function resetEverything() {
  state = createDefaultState();
  saveState();
  rerender();
  refreshAutoSyncTimer();
}

function refreshAutoSyncTimer() {
  if (syncTimerId) {
    clearInterval(syncTimerId);
    syncTimerId = null;
  }

  if (state.sync.autoSync) {
    syncTimerId = window.setInterval(() => {
      syncLiveData();
    }, SYNC_INTERVAL_MS);
  }
}

function toggleAutoSync() {
  state.sync.autoSync = !state.sync.autoSync;
  saveState();
  rerender();
  refreshAutoSyncTimer();
}

document.getElementById("seedDemoBtn").addEventListener("click", seedStarterOptions);
document.getElementById("resetResultsBtn").addEventListener("click", resetResultsOnly);
document.getElementById("resetAllBtn").addEventListener("click", resetEverything);
document.getElementById("syncNowBtn").addEventListener("click", syncLiveData);
document.getElementById("toggleAutoSyncBtn").addEventListener("click", toggleAutoSync);

rerender();
refreshAutoSyncTimer();
syncLiveData();
