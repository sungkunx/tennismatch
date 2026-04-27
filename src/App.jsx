import { useState, useCallback, useMemo } from "react";

// ─── Algorithm Core ───
function generateBracket(males, females, courts, timeSlots, gameCounts) {
  const totalGames = courts * timeSlots;
  const allPlayers = [
    ...males.map((n) => ({ id: `${n}(M)`, name: n, gender: "M", rank: males.indexOf(n) })),
    ...females.map((n) => ({ id: `${n}(F)`, name: n, gender: "F", rank: females.indexOf(n) })),
  ];
  const maleP = allPlayers.filter((p) => p.gender === "M");
  const femaleP = allPlayers.filter((p) => p.gender === "F");

  // Use directly provided game type counts
  const { md, fd, mx } = gameCounts;

  // Build game type queue
  let typeQueue = [];
  for (let i = 0; i < mx; i++) typeQueue.push("MX");
  for (let i = 0; i < md; i++) typeQueue.push("MD");
  for (let i = 0; i < fd; i++) typeQueue.push("FD");
  // Shuffle for variety
  typeQueue = shuffleArray(typeQueue);

  // State tracking
  const partnerCount = {};
  const opponentCount = {};
  const gamesPlayed = {};
  allPlayers.forEach((p) => (gamesPlayed[p.id] = 0));
  const pairKey = (a, b) => [a, b].sort().join("|");

  const getPartner = (a, b) => partnerCount[pairKey(a, b)] || 0;
  const getOpponent = (a, b) => opponentCount[pairKey(a, b)] || 0;

  const targetGames = Math.round((totalGames * 4) / allPlayers.length);

  const schedule = [];
  let gameIdx = 0;

  for (let t = 0; t < timeSlots; t++) {
    const usedThisSlot = new Set();
    const slotGames = [];

    for (let c = 0; c < courts; c++) {
      if (gameIdx >= totalGames) break;
      const gType = typeQueue[gameIdx];

      let candidates;
      if (gType === "MD") candidates = getCandidatesMD(maleP, usedThisSlot);
      else if (gType === "FD") candidates = getCandidatesFD(femaleP, usedThisSlot);
      else candidates = getCandidatesMX(maleP, femaleP, usedThisSlot);

      if (candidates.length === 0) {
        // fallback: try any type
        const fallback =
          getCandidatesMX(maleP, femaleP, usedThisSlot).length > 0
            ? getCandidatesMX(maleP, femaleP, usedThisSlot)
            : getCandidatesMD(maleP, usedThisSlot).length > 0
              ? getCandidatesMD(maleP, usedThisSlot)
              : getCandidatesFD(femaleP, usedThisSlot);
        if (fallback.length === 0) {
          gameIdx++;
          continue;
        }
        candidates = fallback;
      }

      // Score and pick best
      let bestScore = -Infinity;
      let bestMatch = null;

      const limit = Math.min(candidates.length, 200);
      for (let i = 0; i < limit; i++) {
        const m = candidates[i];
        const all4 = [...m.team1, ...m.team2];
        let score = 0;

        // (1) Hard block: skip if any player already at target+1 while others are below target
        const minGames = Math.min(...Object.values(gamesPlayed));
        let blocked = false;
        all4.forEach((p) => {
          if (gamesPlayed[p.id] >= targetGames + 1 && minGames < targetGames) blocked = true;
        });
        if (blocked) { continue; }

        // (2) Strong balance: heavily prefer under-played players
        all4.forEach((p) => {
          const diff = targetGames - gamesPlayed[p.id];
          score += diff * 100;
          // Extra penalty for over-target
          if (diff < 0) score += diff * 200;
        });

        // (3) Partner penalty
        score -= getPartner(m.team1[0].id, m.team1[1].id) * 50;
        score -= getPartner(m.team2[0].id, m.team2[1].id) * 50;

        // (4) Opponent penalty
        for (const a of m.team1)
          for (const b of m.team2) score -= getOpponent(a.id, b.id) * 30;

        // (5) Skill balance (soft)
        const r1 = (m.team1[0].rank + m.team1[1].rank) / 2;
        const r2 = (m.team2[0].rank + m.team2[1].rank) / 2;
        score -= Math.abs(r1 - r2) * 5;

        // Small random factor
        score += Math.random() * 2;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = m;
        }
      }

      if (bestMatch) {
        const all4 = [...bestMatch.team1, ...bestMatch.team2];
        all4.forEach((p) => {
          usedThisSlot.add(p.id);
          gamesPlayed[p.id]++;
        });
        partnerCount[pairKey(bestMatch.team1[0].id, bestMatch.team1[1].id)] =
          getPartner(bestMatch.team1[0].id, bestMatch.team1[1].id) + 1;
        partnerCount[pairKey(bestMatch.team2[0].id, bestMatch.team2[1].id)] =
          getPartner(bestMatch.team2[0].id, bestMatch.team2[1].id) + 1;
        for (const a of bestMatch.team1)
          for (const b of bestMatch.team2) {
            opponentCount[pairKey(a.id, b.id)] = getOpponent(a.id, b.id) + 1;
          }

        slotGames.push({
          court: c + 1,
          type: bestMatch.type,
          team1: bestMatch.team1,
          team2: bestMatch.team2,
        });
      }
      gameIdx++;
    }
    schedule.push({ timeSlot: t + 1, games: slotGames });
  }

  // Stats
  const stats = allPlayers.map((p) => {
    const partners = {};
    const opponents = {};
    schedule.forEach((slot) =>
      slot.games.forEach((g) => {
        const all4 = [...g.team1, ...g.team2];
        if (!all4.find((x) => x.id === p.id)) return;
        const myTeam = g.team1.find((x) => x.id === p.id) ? g.team1 : g.team2;
        const otherTeam = g.team1.find((x) => x.id === p.id) ? g.team2 : g.team1;
        myTeam.forEach((x) => {
          if (x.id !== p.id) partners[x.id] = (partners[x.id] || 0) + 1;
        });
        otherTeam.forEach((x) => {
          opponents[x.id] = (opponents[x.id] || 0) + 1;
        });
      })
    );
    return { player: p, games: gamesPlayed[p.id], partners, opponents };
  });

  return { schedule, stats, targetGames, typeDistribution: { md, fd, mx } };
}

function distributeGameTypes(nMale, nFemale, totalGames, mixRatio) {
  const mxTarget = Math.round(totalGames * mixRatio);
  const remaining = totalGames - mxTarget;
  const mdTarget = Math.round(remaining * (nMale / (nMale + nFemale)));
  const fdTarget = remaining - mdTarget;

  // Validate feasibility
  const mx = Math.max(0, Math.min(mxTarget, Math.floor(nMale / 2), Math.floor(nFemale / 2)));
  const md2 = nMale >= 4 ? mdTarget : 0;
  const fd2 = nFemale >= 4 ? fdTarget : 0;
  const leftover = totalGames - mx - md2 - fd2;

  // Redistribute leftover
  let md = md2, fd = fd2, mx2 = mx;
  if (leftover > 0) {
    for (let i = 0; i < leftover; i++) {
      if (nMale >= 4 && nFemale >= 4) mx2++;
      else if (nMale >= 4) md++;
      else fd++;
    }
  }
  return { md, fd, mx: mx2 };
}

function getCandidatesMD(males, used) {
  const avail = males.filter((p) => !used.has(p.id));
  if (avail.length < 4) return [];
  const combos = combinations(avail, 4);
  const results = [];
  for (const c of combos) {
    // Split into two teams
    results.push({ type: "MD", team1: [c[0], c[1]], team2: [c[2], c[3]] });
    results.push({ type: "MD", team1: [c[0], c[2]], team2: [c[1], c[3]] });
    results.push({ type: "MD", team1: [c[0], c[3]], team2: [c[1], c[2]] });
  }
  return results;
}

function getCandidatesFD(females, used) {
  const avail = females.filter((p) => !used.has(p.id));
  if (avail.length < 4) return [];
  const combos = combinations(avail, 4);
  const results = [];
  for (const c of combos) {
    results.push({ type: "FD", team1: [c[0], c[1]], team2: [c[2], c[3]] });
    results.push({ type: "FD", team1: [c[0], c[2]], team2: [c[1], c[3]] });
    results.push({ type: "FD", team1: [c[0], c[3]], team2: [c[1], c[2]] });
  }
  return results;
}

function getCandidatesMX(males, females, used) {
  const am = males.filter((p) => !used.has(p.id));
  const af = females.filter((p) => !used.has(p.id));
  if (am.length < 2 || af.length < 2) return [];
  const mCombos = combinations(am, 2);
  const fCombos = combinations(af, 2);
  const results = [];
  for (const mc of mCombos) {
    for (const fc of fCombos) {
      results.push({ type: "MX", team1: [mc[0], fc[0]], team2: [mc[1], fc[1]] });
      results.push({ type: "MX", team1: [mc[0], fc[1]], team2: [mc[1], fc[0]] });
    }
  }
  return results;
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Stats Recalculation ───
function recalcStats(schedule) {
  const allPlayersMap = {};
  schedule.forEach((slot) =>
    slot.games.forEach((g) => {
      [...g.team1, ...g.team2].forEach((p) => { allPlayersMap[p.id] = p; });
    })
  );
  const allPlayers = Object.values(allPlayersMap);
  const gamesPlayed = {};
  allPlayers.forEach((p) => (gamesPlayed[p.id] = 0));

  schedule.forEach((slot) =>
    slot.games.forEach((g) => {
      [...g.team1, ...g.team2].forEach((p) => { gamesPlayed[p.id]++; });
    })
  );

  return allPlayers.map((p) => {
    const partners = {};
    const opponents = {};
    schedule.forEach((slot) =>
      slot.games.forEach((g) => {
        const all4 = [...g.team1, ...g.team2];
        if (!all4.find((x) => x.id === p.id)) return;
        const myTeam = g.team1.find((x) => x.id === p.id) ? g.team1 : g.team2;
        const otherTeam = g.team1.find((x) => x.id === p.id) ? g.team2 : g.team1;
        myTeam.forEach((x) => { if (x.id !== p.id) partners[x.id] = (partners[x.id] || 0) + 1; });
        otherTeam.forEach((x) => { opponents[x.id] = (opponents[x.id] || 0) + 1; });
      })
    );
    return { player: p, games: gamesPlayed[p.id], partners, opponents };
  });
}

// ─── Swap Analysis ───
function determineGameType(players) {
  const males = players.filter((p) => p.gender === "M").length;
  const females = players.filter((p) => p.gender === "F").length;
  if (males === 4) return "MD";
  if (females === 4) return "FD";
  if (males === 2 && females === 2) return "MX";
  return null; // invalid combo like 3M+1F
}

function findPlayerInSlot(schedule, timeSlotIdx, playerId) {
  const slot = schedule[timeSlotIdx];
  for (let gi = 0; gi < slot.games.length; gi++) {
    const g = slot.games[gi];
    for (let pi = 0; pi < g.team1.length; pi++) {
      if (g.team1[pi].id === playerId) return { gameIdx: gi, teamKey: "team1", playerIdx: pi };
    }
    for (let pi = 0; pi < g.team2.length; pi++) {
      if (g.team2[pi].id === playerId) return { gameIdx: gi, teamKey: "team2", playerIdx: pi };
    }
  }
  return null;
}

function analyzeSwap(result, swapSel, newPlayerId) {
  const warnings = [];
  const { timeSlotIdx, gameIdx, teamKey, playerIdx } = swapSel;
  const oldPlayer = result.schedule[timeSlotIdx].games[gameIdx][teamKey][playerIdx];

  if (oldPlayer.id === newPlayerId) return { mode: "none", warnings: [] };

  const newPlayerStat = result.stats.find((s) => s.player.id === newPlayerId);
  if (!newPlayerStat) return { mode: "none", warnings: [{ type: "error", msg: "선수를 찾을 수 없습니다." }] };
  const newPlayer = newPlayerStat.player;

  // Detect conflict: is newPlayer in the same timeslot?
  const conflictPos = findPlayerInSlot(result.schedule, timeSlotIdx, newPlayerId);
  const isExchange = !!conflictPos;

  // Build hypothetical schedule
  const newSchedule = JSON.parse(JSON.stringify(result.schedule));

  if (isExchange) {
    // Mutual swap
    newSchedule[timeSlotIdx].games[gameIdx][teamKey][playerIdx] = { ...newPlayer };
    newSchedule[timeSlotIdx].games[conflictPos.gameIdx][conflictPos.teamKey][conflictPos.playerIdx] = { ...oldPlayer };

    // Check for duplicate in either game after swap
    const g1 = newSchedule[timeSlotIdx].games[gameIdx];
    const g2 = newSchedule[timeSlotIdx].games[conflictPos.gameIdx];
    const ids1 = [...g1.team1, ...g1.team2].map((p) => p.id);
    const ids2 = [...g2.team1, ...g2.team2].map((p) => p.id);
    if (new Set(ids1).size < 4 || new Set(ids2).size < 4) {
      return { mode: "none", warnings: [{ type: "error", msg: "맞교체 후 같은 경기에 중복 선수가 발생합니다." }] };
    }

    // Determine new game types
    const newType1 = determineGameType([...g1.team1, ...g1.team2]);
    const newType2 = determineGameType([...g2.team1, ...g2.team2]);
    if (!newType1 || !newType2) {
      return { mode: "none", warnings: [{ type: "error", msg: "맞교체 후 유효하지 않은 성별 조합이 됩니다. (남3+여1 등)" }] };
    }
    g1.type = newType1;
    g2.type = newType2;
  } else {
    // Simple replacement
    newSchedule[timeSlotIdx].games[gameIdx][teamKey][playerIdx] = { ...newPlayer };
    const g = newSchedule[timeSlotIdx].games[gameIdx];
    const newType = determineGameType([...g.team1, ...g.team2]);
    if (!newType) {
      return { mode: "none", warnings: [{ type: "error", msg: "유효하지 않은 성별 조합이 됩니다. (남3+여1 등)" }] };
    }
    g.type = newType;
  }

  // Recalc and analyze
  const newStats = recalcStats(newSchedule);
  const oldStats = result.stats;
  const avgGames = result.targetGames;

  // Game count warnings for both players
  [oldPlayer.id, newPlayerId].forEach((pid) => {
    const oldG = oldStats.find((s) => s.player.id === pid)?.games || 0;
    const newG = newStats.find((s) => s.player.id === pid)?.games || 0;
    if (oldG !== newG) {
      const diff = newG - avgGames;
      if (Math.abs(diff) >= 2) {
        warnings.push({ type: "warn", msg: `${pid}의 경기 수가 ${newG}게임이 됩니다. (목표 ${avgGames} 대비 ${diff > 0 ? "+" : ""}${diff})` });
      }
    }
  });

  // Partner/Opponent repetition
  let maxPartner = 0, maxOpponent = 0;
  oldStats.forEach((s) => {
    Object.values(s.partners).forEach((v) => { if (v > maxPartner) maxPartner = v; });
    Object.values(s.opponents).forEach((v) => { if (v > maxOpponent) maxOpponent = v; });
  });

  [oldPlayer.id, newPlayerId].forEach((pid) => {
    const ps = newStats.find((s) => s.player.id === pid);
    if (ps) {
      Object.entries(ps.partners).forEach(([ppid, cnt]) => {
        if (cnt > maxPartner) {
          warnings.push({ type: "warn", msg: `${pid}와 ${ppid}의 파트너 횟수가 ${cnt}회로, 기존 최대(${maxPartner})를 초과합니다.` });
        }
      });
      Object.entries(ps.opponents).forEach(([ppid, cnt]) => {
        if (cnt > maxOpponent) {
          warnings.push({ type: "warn", msg: `${pid}와 ${ppid}의 상대 횟수가 ${cnt}회로, 기존 최대(${maxOpponent})를 초과합니다.` });
        }
      });
    }
  });

  // Game type change info
  const origType = result.schedule[timeSlotIdx].games[gameIdx].type;
  const newGameType = newSchedule[timeSlotIdx].games[gameIdx].type;
  if (origType !== newGameType) {
    warnings.push({ type: "info", msg: `경기 타입이 ${TYPE_COLORS[origType].label} → ${TYPE_COLORS[newGameType].label}(으)로 변경됩니다.` });
  }

  if (warnings.length === 0) {
    warnings.push({ type: "ok", msg: isExchange ? "맞교체해도 문제없습니다." : "교체해도 문제없습니다." });
  }

  return { mode: isExchange ? "exchange" : "replace", warnings, conflictPos };
}

// ─── UI ───
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function recommendDistribution(nMale, nFemale, totalGames) {
  if (totalGames <= 0 || nMale < 2 || nFemale < 2) return { md: 0, fd: 0, mx: totalGames, maleGamesEach: 0, femaleGamesEach: 0 };

  let bestMd = 0, bestFd = 0, bestMx = totalGames, bestScore = Infinity;
  for (let mx = 0; mx <= totalGames; mx++) {
    const remaining = totalGames - mx;
    for (let md = 0; md <= remaining; md++) {
      const fd = remaining - md;
      if (nMale < 4 && md > 0) continue;
      if (nFemale < 4 && fd > 0) continue;
      const maleSlots = 4 * md + 2 * mx;
      const femaleSlots = 4 * fd + 2 * mx;
      const maleRemainder = maleSlots % nMale;
      const femaleRemainder = femaleSlots % nFemale;
      const avgDiff = Math.abs(maleSlots / nMale - femaleSlots / nFemale);
      const score = maleRemainder + femaleRemainder + avgDiff * 10;
      if (score < bestScore) { bestScore = score; bestMd = md; bestFd = fd; bestMx = mx; }
    }
  }
  return {
    md: bestMd, fd: bestFd, mx: bestMx,
    maleGamesEach: (4 * bestMd + 2 * bestMx) / nMale,
    femaleGamesEach: (4 * bestFd + 2 * bestMx) / nFemale,
  };
}

function analyzeDistribution(nMale, nFemale, md, fd, mx) {
  const maleSlots = 4 * md + 2 * mx;
  const femaleSlots = 4 * fd + 2 * mx;
  const maleAvg = nMale > 0 ? maleSlots / nMale : 0;
  const femaleAvg = nFemale > 0 ? femaleSlots / nFemale : 0;
  const maleMin = Math.floor(maleAvg);
  const maleMax = Math.ceil(maleAvg);
  const femaleMin = Math.floor(femaleAvg);
  const femaleMax = Math.ceil(femaleAvg);
  const maleEven = maleSlots % nMale === 0;
  const femaleEven = femaleSlots % nFemale === 0;
  const warnings = [];
  if (Math.abs(maleAvg - femaleAvg) >= 2) {
    warnings.push(`남녀 간 게임 수 차이가 큽니다 (남 ${maleAvg.toFixed(1)} vs 여 ${femaleAvg.toFixed(1)})`);
  }
  if (!maleEven && maleMax - maleMin > 1) {
    warnings.push(`남자 선수 간 게임 수 차이가 ${maleMax - maleMin}까지 발생할 수 있습니다.`);
  }
  if (!femaleEven && femaleMax - femaleMin > 1) {
    warnings.push(`여자 선수 간 게임 수 차이가 ${femaleMax - femaleMin}까지 발생할 수 있습니다.`);
  }
  return { maleAvg, femaleAvg, maleMin, maleMax, femaleMin, femaleMax, maleEven, femaleEven, warnings };
}

const TYPE_COLORS = {
  MD: { bg: "#1a3a5c", text: "#7cb8ff", label: "남복", badge: "#264a6e" },
  FD: { bg: "#4a1942", text: "#e8a0dc", label: "여복", badge: "#5c2854" },
  MX: { bg: "#1a4a3a", text: "#7ce8c0", label: "혼복", badge: "#2a5c4a" },
};

export default function App() {
  const [maleCount, setMaleCount] = useState(6);
  const [femaleCount, setFemaleCount] = useState(6);
  const [courtCount, setCourtCount] = useState(2);
  const [totalHours, setTotalHours] = useState(2);
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [startMinute, setStartMinute] = useState(8 * 60);
  const [totalGames, setTotalGames] = useState(8); // 2코트 × 4타임
  const [mdCount, setMdCount] = useState(2);
  const [fdCount, setFdCount] = useState(2);
  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState("schedule");
  const [nameMap, setNameMap] = useState({});
  const [showShare, setShowShare] = useState(false);
  const [swapSel, setSwapSel] = useState(null);
  const [step, setStep] = useState(0);
  const [showDist, setShowDist] = useState(false);
  const [slotTimes, setSlotTimes] = useState([]); // 0=step1, 1=step2, 2=result

  const suggestedSlots = Math.floor((totalHours * 60) / slotMinutes);
  const suggestedGames = courtCount * suggestedSlots;
  const rawSlots = (totalHours * 60) / slotMinutes;
  const hasRemainder = rawSlots !== Math.floor(rawSlots);

  const timeSlots = totalGames ? totalGames / courtCount : 0;
  const games = totalGames || 0;

  // Clamp md/fd when totalGames changes
  const effectiveMd = Math.min(mdCount, games);
  const effectiveFd = Math.min(fdCount, games - effectiveMd);
  const effectiveMx = games - effectiveMd - effectiveFd;

  const distAnalysis = useMemo(() => {
    return analyzeDistribution(maleCount, femaleCount, effectiveMd, effectiveFd, effectiveMx);
  }, [maleCount, femaleCount, effectiveMd, effectiveFd, effectiveMx]);

  const actualDist = useMemo(() => {
    if (!result) return null;
    let md = 0, fd = 0, mx = 0;
    result.schedule.forEach((slot) => slot.games.forEach((g) => {
      if (g.type === "MD") md++;
      else if (g.type === "FD") fd++;
      else mx++;
    }));
    return { md, fd, mx };
  }, [result]);

  const handleCalc = () => {
    setTotalGames(suggestedGames);
    const third = Math.floor(suggestedGames / 3);
    setMdCount(third);
    setFdCount(third);
  };

  const handleAdjustGames = (delta) => {
    const next = (totalGames || suggestedGames) + delta * courtCount;
    if (next >= courtCount) setTotalGames(next);
  };

  const males = useMemo(() => ALPHA.slice(0, maleCount), [maleCount]);
  const females = useMemo(() => ALPHA.slice(0, femaleCount), [femaleCount]);

  const dn = useCallback((id) => nameMap[id] || id, [nameMap]);

  const handleGenerate = useCallback(() => {
    if (!totalGames) return;
    const r = generateBracket(males, females, courtCount, timeSlots, { md: effectiveMd, fd: effectiveFd, mx: effectiveMx });
    setResult(r);
    setActiveTab("schedule");
    const newMap = {};
    r.stats.forEach((s) => { newMap[s.player.id] = nameMap[s.player.id] || ""; });
    setNameMap(newMap);
    const startMin = slotTimes.length > 0 ? slotTimes[0].start : startMinute;
    setSlotTimes(buildSlotTimes(timeSlots, slotMinutes, startMin));
  }, [males, females, courtCount, timeSlots, totalGames, effectiveMd, effectiveFd, effectiveMx, nameMap, slotTimes, slotMinutes, startMinute]);

  const handleFinishWizard = useCallback(() => {
    const g = totalGames || suggestedGames;
    if (!g) return;
    if (!totalGames) setTotalGames(suggestedGames);
    const ts = g / courtCount;
    const rec = recommendDistribution(maleCount, femaleCount, g);
    setMdCount(rec.md);
    setFdCount(rec.fd);
    const r = generateBracket(males, females, courtCount, ts, { md: rec.md, fd: rec.fd, mx: rec.mx });
    setResult(r);
    setActiveTab("schedule");
    const newMap = {};
    r.stats.forEach((s) => { newMap[s.player.id] = nameMap[s.player.id] || ""; });
    setNameMap(newMap);
    setSlotTimes(buildSlotTimes(ts, slotMinutes, startMinute));
    setStep(2);
  }, [males, females, courtCount, totalGames, suggestedGames, maleCount, femaleCount, nameMap, slotMinutes, startMinute]);

  const handleSwapApply = useCallback((newPlayerId) => {
    if (!swapSel || !result) return;
    const { timeSlotIdx, gameIdx, teamKey, playerIdx } = swapSel;
    const newPlayerStat = result.stats.find((s) => s.player.id === newPlayerId);
    if (!newPlayerStat) return;

    const oldPlayer = result.schedule[timeSlotIdx].games[gameIdx][teamKey][playerIdx];
    const newSchedule = JSON.parse(JSON.stringify(result.schedule));

    const conflictPos = findPlayerInSlot(result.schedule, timeSlotIdx, newPlayerId);
    if (conflictPos) {
      newSchedule[timeSlotIdx].games[gameIdx][teamKey][playerIdx] = { ...newPlayerStat.player };
      newSchedule[timeSlotIdx].games[conflictPos.gameIdx][conflictPos.teamKey][conflictPos.playerIdx] = { ...oldPlayer };
      // Update game types for both games
      const g1 = newSchedule[timeSlotIdx].games[gameIdx];
      const g2 = newSchedule[timeSlotIdx].games[conflictPos.gameIdx];
      g1.type = determineGameType([...g1.team1, ...g1.team2]) || g1.type;
      g2.type = determineGameType([...g2.team1, ...g2.team2]) || g2.type;
    } else {
      newSchedule[timeSlotIdx].games[gameIdx][teamKey][playerIdx] = { ...newPlayerStat.player };
      const g = newSchedule[timeSlotIdx].games[gameIdx];
      g.type = determineGameType([...g.team1, ...g.team2]) || g.type;
    }

    const newStats = recalcStats(newSchedule);
    setResult({ ...result, schedule: newSchedule, stats: newStats });
    setSwapSel(null);
  }, [swapSel, result]);

  return (
    <div style={styles.root}>
      <div style={styles.headerBar}>
        <button onClick={() => { setStep(0); setResult(null); }} style={styles.restartBtn}>↺ 처음부터</button>
        <div style={{ flex: 1 }} />
      </div>
      <div style={styles.header}>
        <div style={styles.headerIcon}>🎾</div>
        <h1 style={styles.title}>테니스 대진표 생성기</h1>
        <p style={styles.subtitle}>Tournament Bracket Generator</p>
      </div>

      {/* ── Step 0: Wizard - Players & Names ── */}
      {step === 0 && (
        <div style={styles.wizardOverlay}>
          <div style={styles.wizardPopup}>
            <div style={styles.wizardHeader}>
              <div style={styles.wizardTopHint}>이후에 설정 수정이 가능합니다</div>
              <div style={styles.wizardStepIndicator}>
                <span style={styles.wizardStepActive}>1</span>
                <span style={styles.wizardStepLine} />
                <span style={styles.wizardStepInactive}>2</span>
              </div>
              <span style={styles.wizardTitle}>참여자 설정</span>
            </div>
            <div style={styles.wizardBody}>
              <div style={styles.wizardCountRow}>
                <div style={{ flex: 1 }}>
                  <NumberInput label="남자 인원" value={maleCount} onChange={setMaleCount} min={2} max={26} labelColor="#7cb8ff" />
                  <div style={styles.wizardPlayerPreview}>{males.map((l) => `${l}`).join("  ")}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <NumberInput label="여자 인원" value={femaleCount} onChange={setFemaleCount} min={2} max={26} labelColor="#e8a0dc" />
                  <div style={styles.wizardPlayerPreview}>{females.map((l) => `${l}`).join("  ")}</div>
                </div>
              </div>
            </div>
            <button onClick={() => setStep(1)} style={styles.wizardNextBtn}>다음 →</button>
          </div>
        </div>
      )}

      {/* ── Step 1: Wizard - Court & Game Distribution ── */}
      {step === 1 && (
        <div style={styles.wizardOverlay}>
          <div style={styles.wizardPopup}>
            <div style={styles.wizardHeader}>
              <div style={styles.wizardTopHint}>이후에 설정 수정이 가능합니다</div>
              <div style={styles.wizardStepIndicator}>
                <span style={styles.wizardStepDone}>✓</span>
                <span style={styles.wizardStepLine} />
                <span style={styles.wizardStepActive}>2</span>
              </div>
              <span style={styles.wizardTitle}>코트 & 게임 설정</span>
            </div>
            <div style={styles.wizardBody}>
              <div style={styles.wizardCourtRow}>
                <div style={{ flex: 1 }}>
                  <NumberInput label="코트 수" value={courtCount} onChange={(v) => setCourtCount(v)} min={1} max={10} />
                  <NumberInput label="총 시간(h)" value={totalHours} onChange={(v) => setTotalHours(v)} min={1} max={8} />
                  <NumberInput label="게임시간(분)" value={slotMinutes} onChange={(v) => setSlotMinutes(v)} min={15} max={60} step={5} />
                  <div style={styles.wizardStartTimeRow}>
                    <span style={styles.wizardStartTimeLabel}>게임 시작 시간 :</span>
                    <TimePicker value={startMinute} onChange={setStartMinute} />
                  </div>
                </div>
                <div style={styles.wizardCalcPreview}>
                  <div style={styles.wizardCalcFormula}>{courtCount}코트 × {rawSlots.toFixed(1)}타임</div>
                  {hasRemainder && <div style={styles.wizardCalcHint}>내림 처리</div>}
                  <div style={styles.wizardCalcPreviewNum}>{suggestedGames}게임</div>
                  <button onClick={handleCalc} style={styles.wizardCalcBtnLg}>⬇️ 게임수 아래에 입력</button>
                </div>
              </div>

              <div style={styles.wizardFinalGamesBox}>
                <div style={styles.wizardFinalGamesLabel}>최종 게임 수</div>
                <div style={styles.wizardFinalGamesValue}>{totalGames !== null ? totalGames : suggestedGames}</div>
                <div style={styles.wizardCalcAdjustLabel}>게임 수 상세 조정</div>
                <div style={styles.wizardCalcAdjust}>
                  <button style={styles.inputBtn} onClick={() => handleAdjustGames(-1)}>−{courtCount}</button>
                  <button style={styles.adjBtnSm} onClick={() => { const n = (totalGames || suggestedGames) - 1; if (n >= 1) setTotalGames(n); }}>−1</button>
                  <button style={styles.adjBtnSm} onClick={() => setTotalGames((totalGames || suggestedGames) + 1)}>+1</button>
                  <button style={styles.inputBtn} onClick={() => handleAdjustGames(1)}>+{courtCount}</button>
                </div>
              </div>
            </div>
            <div style={styles.wizardBtnRow}>
              <button onClick={() => setStep(0)} style={styles.wizardBackBtn}>← 이전</button>
              <button onClick={handleFinishWizard} style={{ ...styles.wizardNextBtn, flex: 1, margin: 0 }}>⚡ 대진표 생성</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: Result View ── */}
      {step === 2 && result && (
        <div>
          {/* Settings - go to wizard */}
          <button onClick={() => setStep(0)} style={styles.settingsToggle}>
            ⚙️ 설정 수정하기
          </button>

          {/* Name Editor */}
          <div style={styles.nameEditorCard}>
            <div style={styles.nameEditorTitle}>선수 이름 설정</div>
            <div style={styles.nameEditorGrid}>
              {result.stats.map((s) => (
                <div key={s.player.id} style={styles.nameEditorRow}>
                  <span style={{ ...styles.nameEditorId, background: s.player.gender === "M" ? "#1e3a5f" : "#4a1a42", color: s.player.gender === "M" ? "#7cb8ff" : "#e8a0dc" }}>
                    {s.player.id}
                  </span>
                  <input type="text" placeholder="이름 입력" value={nameMap[s.player.id] || ""} onChange={(e) => setNameMap((prev) => ({ ...prev, [s.player.id]: e.target.value }))} style={styles.nameEditorInput} />
                  <span style={{ ...styles.nameEditorGames, color: Math.abs(s.games - result.targetGames) >= 2 ? "#f0c040" : "#7ce8c0" }}>({s.games}게임)</span>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.tabs}>
            {[
              { key: "schedule", label: "대진표" },
              { key: "stats", label: "참여자 통계" },
              { key: "matrix", label: "매칭 매트릭스" },
            ].map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                style={activeTab === tab.key ? styles.tabActive : styles.tab}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Distribution Panel */}
          <div style={styles.distPanel}>
            <div style={styles.ratioBar}>
              <div style={{ ...styles.ratioSegment, background: effectiveMd > 0 ? TYPE_COLORS.MD.bg : "#222830", width: games > 0 ? `${Math.max((effectiveMd / games) * 100, 0)}%` : "0%", minWidth: 36 }}>
                <span style={{ color: effectiveMd > 0 ? TYPE_COLORS.MD.text : "#556", fontSize: 14, fontWeight: 700 }}>남 {effectiveMd}</span>
              </div>
              <div style={{ ...styles.ratioSegment, background: effectiveFd > 0 ? TYPE_COLORS.FD.bg : "#222830", width: games > 0 ? `${Math.max((effectiveFd / games) * 100, 0)}%` : "0%", minWidth: 36 }}>
                <span style={{ color: effectiveFd > 0 ? TYPE_COLORS.FD.text : "#556", fontSize: 14, fontWeight: 700 }}>여 {effectiveFd}</span>
              </div>
              <div style={{ ...styles.ratioSegment, background: effectiveMx > 0 ? TYPE_COLORS.MX.bg : "#222830", width: games > 0 ? `${Math.max((effectiveMx / games) * 100, 0)}%` : "0%", minWidth: 36 }}>
                <span style={{ color: effectiveMx > 0 ? TYPE_COLORS.MX.text : "#556", fontSize: 14, fontWeight: 700 }}>혼 {effectiveMx}</span>
              </div>
            </div>
            <div style={styles.distPanelSummary}>
              <span style={{ color: "#7cb8ff" }}>남 1인당 {distAnalysis.maleEven ? distAnalysis.maleAvg : `${distAnalysis.maleMin}~${distAnalysis.maleMax}`}게임</span>
              <span style={{ color: "#556" }}>·</span>
              <span style={{ color: "#e8a0dc" }}>여 1인당 {distAnalysis.femaleEven ? distAnalysis.femaleAvg : `${distAnalysis.femaleMin}~${distAnalysis.femaleMax}`}게임</span>
            </div>
            <div style={styles.distPanelBody}>
              <div style={styles.distAdjustRow}>
                <div style={{ flex: 1 }}><NumberInput label="남복" value={mdCount} onChange={(v) => setMdCount(Math.min(v, games - fdCount))} min={0} max={games} /></div>
                <div style={{ flex: 1 }}><NumberInput label="여복" value={fdCount} onChange={(v) => setFdCount(Math.min(v, games - mdCount))} min={0} max={games} /></div>
              </div>
              {distAnalysis.warnings.length > 0 && (
                <div style={styles.distWarnings}>
                  {distAnalysis.warnings.map((w, i) => (
                    <div key={i} style={styles.distWarningItem}>⚠️ {w}</div>
                  ))}
                </div>
              )}
              {effectiveMx < 0 && <div style={{ color: "#ff6b6b", fontSize: 12 }}>🚫 남복+여복이 총 게임 수를 초과합니다</div>}
              <div style={styles.distBtnRow}>
                <button onClick={() => handleGenerate()} style={styles.distRegenBtn}>
                  ⚡ 배분 변경 후 재생성
                </button>
                <button onClick={() => handleGenerate()} style={styles.distRefreshBtn}>
                  🔄 같은 설정으로 재생성
                </button>
              </div>
              {actualDist && (
                <div style={{ ...styles.distActualNote, color: (actualDist.md !== effectiveMd || actualDist.fd !== effectiveFd || actualDist.mx !== effectiveMx) ? "#f0c040" : "#667" }}>
                  설정: 남복 {effectiveMd} / 여복 {effectiveFd} / 혼복 {effectiveMx}
                  {(actualDist.md !== effectiveMd || actualDist.fd !== effectiveFd || actualDist.mx !== effectiveMx)
                    ? ` → 실제: 남복 ${actualDist.md} / 여복 ${actualDist.fd} / 혼복 ${actualDist.mx}`
                    : " (설정대로 생성됨)"}
                </div>
              )}
            </div>
          </div>

          {activeTab === "schedule" && <ScheduleView result={result} slotTimes={slotTimes} setSlotTimes={setSlotTimes} dn={dn} onSwapSelect={setSwapSel} />}
          {activeTab === "stats" && <StatsView result={result} dn={dn} />}
          {activeTab === "matrix" && <MatrixView result={result} dn={dn} />}

          <button onClick={() => setShowShare(true)} style={styles.shareBtn}>
            📋 대진표 공유하기
          </button>

          {showShare && <SharePopup result={result} slotTimes={slotTimes} setSlotTimes={setSlotTimes} dn={dn} onClose={() => setShowShare(false)} />}
          {swapSel && <SwapPopup result={result} swapSel={swapSel} dn={dn} onApply={handleSwapApply} onCancel={() => setSwapSel(null)} />}
        </div>
      )}
    </div>
  );
}

function cascadeSlotTimes(slotTimes, slotIdx, field, newMinutes) {
  const newTimes = slotTimes.map((t) => ({ ...t }));
  if (field === "start") {
    const duration = newTimes[slotIdx].end - newTimes[slotIdx].start;
    newTimes[slotIdx].start = newMinutes;
    newTimes[slotIdx].end = newMinutes + duration;
    for (let i = slotIdx + 1; i < newTimes.length; i++) {
      const dur = newTimes[i].end - newTimes[i].start;
      newTimes[i].start = newTimes[i - 1].end;
      newTimes[i].end = newTimes[i].start + dur;
    }
  } else {
    newTimes[slotIdx].end = newMinutes;
    if (slotIdx + 1 < newTimes.length) {
      const dur = newTimes[slotIdx + 1].end - newTimes[slotIdx + 1].start;
      newTimes[slotIdx + 1].start = newMinutes;
      newTimes[slotIdx + 1].end = newMinutes + dur;
      for (let i = slotIdx + 2; i < newTimes.length; i++) {
        const d = newTimes[i].end - newTimes[i].start;
        newTimes[i].start = newTimes[i - 1].end;
        newTimes[i].end = newTimes[i].start + d;
      }
    }
  }
  return newTimes;
}

function TimePicker({ value, onChange, compact }) {
  const [open, setOpen] = useState(false);
  const [selHour, setSelHour] = useState(Math.floor(value / 60));
  const [selMin, setSelMin] = useState(value % 60);
  const [mode, setMode] = useState("hour"); // "hour" or "min"

  const handleOpen = () => {
    setSelHour(Math.floor(value / 60));
    setSelMin(value % 60);
    setMode("hour");
    setOpen(true);
  };

  const handleHourPick = (h) => {
    setSelHour(h);
    setMode("min");
  };

  const handleMinPick = (m) => {
    setSelMin(m);
    onChange(selHour * 60 + m);
    setOpen(false);
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const mins = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button onClick={handleOpen} style={compact ? styles.timePickerBtnSm : styles.timePickerBtn}>
        🕐 {formatMinutes(value)}
      </button>
      {open && (
        <div style={styles.tpOverlay} onClick={() => setOpen(false)}>
          <div style={styles.tpPopup} onClick={(e) => e.stopPropagation()}>
            <div style={styles.tpHeader}>
              <span style={styles.tpTitle}>
                {mode === "hour" ? "시간 선택" : `${selHour}시 - 분 선택`}
              </span>
              <button onClick={() => setOpen(false)} style={styles.tpClose}>✕</button>
            </div>
            <div style={styles.tpPreview}>
              <span onClick={() => setMode("hour")} style={{ ...styles.tpPreviewNum, color: mode === "hour" ? "#7cb8ff" : "#fff", cursor: "pointer" }}>
                {String(selHour).padStart(2, "0")}
              </span>
              <span style={styles.tpPreviewColon}>:</span>
              <span onClick={() => setMode("min")} style={{ ...styles.tpPreviewNum, color: mode === "min" ? "#7cb8ff" : "#fff", cursor: "pointer" }}>
                {String(selMin).padStart(2, "0")}
              </span>
            </div>
            {mode === "hour" ? (
              <div style={styles.tpGrid}>
                {hours.map((h) => (
                  <button key={h} onClick={() => handleHourPick(h)}
                    style={{ ...styles.tpCell, ...(h === selHour ? styles.tpCellActive : {}) }}>
                    {h}
                  </button>
                ))}
              </div>
            ) : (
              <div style={styles.tpGrid}>
                {mins.map((m) => (
                  <button key={m} onClick={() => handleMinPick(m)}
                    style={{ ...styles.tpCell, ...styles.tpCellMin, ...(m === selMin ? styles.tpCellActive : {}) }}>
                    {String(m).padStart(2, "0")}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

function ScheduleView({ result, slotTimes, setSlotTimes, dn, onSwapSelect }) {
  return (
    <div style={styles.scheduleWrap}>
      {result.schedule.map((slot, si) => {
        const st = slotTimes[si];
        return (
        <div key={slot.timeSlot} style={styles.timeSlotCard}>
          <div style={styles.timeSlotHeader}>
            <span style={styles.timeSlotBadge}>타임 {slot.timeSlot}</span>
            {st && (
              <div style={styles.timeEditRow}>
                <TimePicker value={st.start} onChange={(v) => setSlotTimes(cascadeSlotTimes(slotTimes, si, "start", v))} />
                <span style={styles.timeEditTilde}>~</span>
                <TimePicker value={st.end} onChange={(v) => setSlotTimes(cascadeSlotTimes(slotTimes, si, "end", v))} />
              </div>
            )}
          </div>
          <div style={styles.gamesGrid}>
            {slot.games.map((g, gi) => {
              const tc = TYPE_COLORS[g.type];
              return (
                <div key={gi} style={{ ...styles.gameCard, borderLeft: `3px solid ${tc.text}` }}>
                  <div style={styles.gameTop}>
                    <span style={styles.courtLabel}>코트 {g.court}</span>
                    <span style={{ ...styles.typeBadge, background: tc.badge, color: tc.text }}>{tc.label}</span>
                  </div>
                  <div style={styles.matchup}>
                    <div style={styles.team}>
                      {g.team1.map((p, pi) => (
                        <span key={p.id} onClick={() => onSwapSelect({ timeSlotIdx: si, gameIdx: gi, teamKey: "team1", playerIdx: pi })}
                          style={{ ...styles.playerChip, background: p.gender === "M" ? "#1e3a5f" : "#4a1a42", color: p.gender === "M" ? "#7cb8ff" : "#e8a0dc", cursor: "pointer" }}>
                          {dn(p.id)}
                        </span>
                      ))}
                    </div>
                    <span style={styles.vs}>vs</span>
                    <div style={styles.team}>
                      {g.team2.map((p, pi) => (
                        <span key={p.id} onClick={() => onSwapSelect({ timeSlotIdx: si, gameIdx: gi, teamKey: "team2", playerIdx: pi })}
                          style={{ ...styles.playerChip, background: p.gender === "M" ? "#1e3a5f" : "#4a1a42", color: p.gender === "M" ? "#7cb8ff" : "#e8a0dc", cursor: "pointer" }}>
                          {dn(p.id)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
      })}
    </div>
  );
}

function SwapPopup({ result, swapSel, dn, onApply, onCancel }) {
  const selectedPlayer = result.schedule[swapSel.timeSlotIdx].games[swapSel.gameIdx][swapSel.teamKey][swapSel.playerIdx];
  const game = result.schedule[swapSel.timeSlotIdx].games[swapSel.gameIdx];
  const allPlayers = result.stats.map((s) => s.player);
  const tc = TYPE_COLORS[game.type];

  // All players except self are candidates
  const candidates = allPlayers.filter((p) => {
    if (p.id === selectedPlayer.id) return false;
    return true;
  });

  const candidateAnalysis = useMemo(() => {
    return candidates.map((p) => {
      const analysis = analyzeSwap(result, swapSel, p.id);
      const { mode, warnings, conflictPos } = analysis;
      const hasError = warnings.some((w) => w.type === "error");
      const hasWarn = warnings.some((w) => w.type === "warn");
      const isOk = warnings.some((w) => w.type === "ok");

      const stat = result.stats.find((s) => s.player.id === p.id);
      const currentGames = stat ? stat.games : 0;

      // Describe where this player currently is in the same timeslot
      let conflictLabel = null;
      if (mode === "exchange" && conflictPos) {
        const cGame = result.schedule[swapSel.timeSlotIdx].games[conflictPos.gameIdx];
        const isSameGame = conflictPos.gameIdx === swapSel.gameIdx;
        conflictLabel = isSameGame ? "같은 경기" : `코트${cGame.court}`;
      }

      return { player: p, mode, warnings, hasError, hasWarn, isOk, currentGames, conflictLabel };
    });
  }, [result, swapSel, candidates]);

  // Sort: ok first, then warn, then error. Within each group, exchanges last.
  const sorted = useMemo(() => {
    return [...candidateAnalysis].sort((a, b) => {
      const order = (x) => x.hasError ? 2 : x.hasWarn ? 1 : 0;
      if (order(a) !== order(b)) return order(a) - order(b);
      if (a.mode !== b.mode) return a.mode === "replace" ? -1 : 1;
      return 0;
    });
  }, [candidateAnalysis]);

  const [expandedId, setExpandedId] = useState(null);

  return (
    <div style={styles.swapOverlay} onClick={onCancel}>
      <div style={styles.swapPopup} onClick={(e) => e.stopPropagation()}>
        <div style={styles.swapPopupHeader}>
          <span style={styles.swapPopupTitle}>🔄 선수 교체</span>
          <button onClick={onCancel} style={styles.swapCloseBtn}>✕</button>
        </div>

        <div style={styles.swapContext}>
          <span style={{ ...styles.playerChip, background: selectedPlayer.gender === "M" ? "#1e3a5f" : "#4a1a42", color: selectedPlayer.gender === "M" ? "#7cb8ff" : "#e8a0dc" }}>
            {dn(selectedPlayer.id)}
          </span>
          <span style={styles.swapContextInfo}>
            타임{swapSel.timeSlotIdx + 1} 코트{game.court}
            <span style={{ ...styles.swapContextType, background: tc.badge, color: tc.text }}>{tc.label}</span>
          </span>
        </div>

        <div style={styles.swapListWrap}>
          {sorted.length === 0 && <div style={styles.swapNoCandidate}>교체 가능한 선수가 없습니다.</div>}
          {sorted.map((ca) => {
            const isExpanded = expandedId === ca.player.id;
            return (
              <div key={ca.player.id}
                style={{ ...styles.swapRow, ...(isExpanded ? { background: "#1a1e28", border: "1px solid #333" } : {}) }}
                onClick={() => setExpandedId(isExpanded ? null : ca.player.id)}>
                <div style={styles.swapRowTop}>
                  <span style={{ ...styles.playerChip, background: ca.player.gender === "M" ? "#1e3a5f" : "#4a1a42", color: ca.player.gender === "M" ? "#7cb8ff" : "#e8a0dc" }}>
                    {dn(ca.player.id)}
                  </span>
                  <div style={styles.swapRowMeta}>
                    <span style={styles.swapRowGames}>현재 {ca.currentGames}게임</span>
                    {ca.mode === "exchange" && (
                      <span style={styles.swapExchangeBadge}>🔁 맞교체 ({ca.conflictLabel})</span>
                    )}
                  </div>
                  <div style={styles.swapRowStatus}>
                    {ca.hasError && <span>🚫</span>}
                    {ca.hasWarn && !ca.hasError && <span>⚠️</span>}
                    {ca.isOk && <span>✅</span>}
                  </div>
                </div>
                {isExpanded && (
                  <div style={styles.swapRowDetail}>
                    {ca.warnings.map((w, i) => (
                      <div key={i} style={{ ...styles.swapWarningItem, color: w.type === "error" ? "#ff6b6b" : w.type === "ok" ? "#7ce8c0" : w.type === "info" ? "#7cb8ff" : "#f0c040" }}>
                        {w.type === "error" ? "🚫" : w.type === "ok" ? "✅" : w.type === "info" ? "ℹ️" : "⚠️"} {w.msg}
                      </div>
                    ))}
                    {!ca.hasError && (
                      <button onClick={(e) => { e.stopPropagation(); onApply(ca.player.id); }}
                        style={styles.swapApplyBtn}>
                        {ca.mode === "exchange" ? "🔁 맞교체 적용" : "교체 적용"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatsView({ result, dn }) {
  const maxGames = Math.max(...result.stats.map((s) => s.games));
  return (
    <div style={styles.statsGrid}>
      {result.stats.map((s) => (
        <div key={s.player.id} style={styles.statCard}>
          <div style={styles.statHeader}>
            <span style={{ ...styles.playerChipLg, background: s.player.gender === "M" ? "#1e3a5f" : "#4a1a42", color: s.player.gender === "M" ? "#7cb8ff" : "#e8a0dc" }}>
              {dn(s.player.id)}
            </span>
            <span style={styles.gameCount}>{s.games}게임</span>
          </div>
          <div style={styles.statBar}>
            <div style={{ ...styles.statBarFill, width: `${(s.games / maxGames) * 100}%`, background: s.player.gender === "M" ? "#3a7bd5" : "#c060a8" }} />
          </div>
          <div style={styles.statDetails}>
            <div style={styles.statLabel}>파트너</div>
            <div style={styles.statPills}>
              {Object.entries(s.partners).map(([id, cnt]) => (
                <span key={id} style={styles.miniPill}>{dn(id)}×{cnt}</span>
              ))}
            </div>
            <div style={styles.statLabel}>상대</div>
            <div style={styles.statPills}>
              {Object.entries(s.opponents).map(([id, cnt]) => (
                <span key={id} style={styles.miniPill}>{dn(id)}×{cnt}</span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MatrixView({ result, dn }) {
  const players = result.stats.map((s) => s.player);
  // Build partner matrix
  const partnerMap = {};
  result.stats.forEach((s) => {
    partnerMap[s.player.id] = s.partners;
  });
  const opponentMap = {};
  result.stats.forEach((s) => {
    opponentMap[s.player.id] = s.opponents;
  });

  return (
    <div style={styles.matrixWrap}>
      <div style={styles.matrixLabel}>🤝 파트너 횟수</div>
      <div style={styles.matrixScroll}>
        <table style={styles.matrixTable}>
          <thead>
            <tr>
              <th style={styles.matrixTh}></th>
              {players.map((p) => (
                <th key={p.id} style={{ ...styles.matrixTh, color: p.gender === "M" ? "#7cb8ff" : "#e8a0dc" }}>{dn(p.id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p1) => (
              <tr key={p1.id}>
                <td style={{ ...styles.matrixTd, fontWeight: 700, color: p1.gender === "M" ? "#7cb8ff" : "#e8a0dc" }}>{dn(p1.id)}</td>
                {players.map((p2) => {
                  const v = (partnerMap[p1.id] || {})[p2.id] || 0;
                  return (
                    <td key={p2.id} style={{ ...styles.matrixTd, background: v > 0 ? `rgba(100,200,150,${v * 0.25})` : "transparent", color: v > 0 ? "#fff" : "#555" }}>
                      {p1.id === p2.id ? "·" : v || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ ...styles.matrixLabel, marginTop: 24 }}>⚔️ 상대 횟수</div>
      <div style={styles.matrixScroll}>
        <table style={styles.matrixTable}>
          <thead>
            <tr>
              <th style={styles.matrixTh}></th>
              {players.map((p) => (
                <th key={p.id} style={{ ...styles.matrixTh, color: p.gender === "M" ? "#7cb8ff" : "#e8a0dc" }}>{dn(p.id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p1) => (
              <tr key={p1.id}>
                <td style={{ ...styles.matrixTd, fontWeight: 700, color: p1.gender === "M" ? "#7cb8ff" : "#e8a0dc" }}>{dn(p1.id)}</td>
                {players.map((p2) => {
                  const v = (opponentMap[p1.id] || {})[p2.id] || 0;
                  return (
                    <td key={p2.id} style={{ ...styles.matrixTd, background: v > 0 ? `rgba(220,100,100,${v * 0.25})` : "transparent", color: v > 0 ? "#fff" : "#555" }}>
                      {p1.id === p2.id ? "·" : v || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Share Popup ───
function SharePopup({ result, slotTimes, setSlotTimes, dn, onClose }) {
  const [copied, setCopied] = useState(false);

  const buildText = () => {
    let text = "🎾 테니스 대진표\n";
    text += "━━━━━━━━━━━━━━━━━━\n";
    result.schedule.forEach((slot, si) => {
      const st = slotTimes[si];
      const timeStr = st ? `${formatMinutes(st.start)}~${formatMinutes(st.end)}` : "";
      text += `\n▸ 타임 ${slot.timeSlot} (${timeStr})\n`;
      slot.games.forEach((g) => {
        const tl = TYPE_COLORS[g.type].label;
        const t1 = g.team1.map((p) => dn(p.id)).join(" & ");
        const t2 = g.team2.map((p) => dn(p.id)).join(" & ");
        text += `  코트${g.court} [${tl}] ${t1}  vs  ${t2}\n`;
      });
    });
    text += "\n━━━━━━━━━━━━━━━━━━";
    return text;
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { /* fallback */ }
  };

  return (
    <div style={styles.shareOverlay} onClick={onClose}>
      <div style={styles.sharePopup} onClick={(e) => e.stopPropagation()}>
        <div style={styles.sharePopupHeader}>
          <span style={styles.sharePopupTitle}>🎾 대진표</span>
          <button onClick={onClose} style={styles.shareCloseBtn}>✕</button>
        </div>

        <div style={styles.shareTableWrap}>
          <table style={styles.shareTable}>
            <thead>
              <tr>
                <th style={styles.shareTh}>타임</th>
                <th style={styles.shareTh}>시간</th>
                <th style={styles.shareTh}>코트</th>
                <th style={styles.shareTh}>구분</th>
                <th style={styles.shareTh}>팀 1</th>
                <th style={{ ...styles.shareTh, width: 24 }}></th>
                <th style={styles.shareTh}>팀 2</th>
              </tr>
            </thead>
            <tbody>
              {result.schedule.flatMap((slot, si) =>
                slot.games.map((g, gi) => (
                  <tr key={`${slot.timeSlot}-${gi}`} style={gi === 0 ? { borderTop: "2px solid #333" } : {}}>
                    {gi === 0 ? (
                      <td style={{ ...styles.shareTd, fontWeight: 700, verticalAlign: "middle" }} rowSpan={slot.games.length}>
                        {slot.timeSlot}
                      </td>
                    ) : null}
                    {gi === 0 ? (
                      <td style={{ ...styles.shareTd, verticalAlign: "middle", padding: "4px 2px" }} rowSpan={slot.games.length}>
                        {slotTimes[si] && (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                            <TimePicker compact value={slotTimes[si].start} onChange={(v) => setSlotTimes(cascadeSlotTimes(slotTimes, si, "start", v))} />
                            <span style={{ fontSize: 9, color: "#445" }}>~</span>
                            <TimePicker compact value={slotTimes[si].end} onChange={(v) => setSlotTimes(cascadeSlotTimes(slotTimes, si, "end", v))} />
                          </div>
                        )}
                      </td>
                    ) : null}
                    <td style={styles.shareTd}>{g.court}</td>
                    <td style={{ ...styles.shareTd, color: TYPE_COLORS[g.type].text, fontWeight: 700 }}>
                      {TYPE_COLORS[g.type].label}
                    </td>
                    <td style={styles.shareTd}>{g.team1.map((p) => dn(p.id)).join(" · ")}</td>
                    <td style={{ ...styles.shareTd, color: "#556", fontSize: 11 }}>vs</td>
                    <td style={styles.shareTd}>{g.team2.map((p) => dn(p.id)).join(" · ")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <button onClick={handleCopy} style={styles.copyBtn}>
          {copied ? "✓ 복사됨!" : "📋 텍스트 복사하기"}
        </button>
      </div>
    </div>
  );
}

// ─── Helper Components ───
function ConfigCard({ title, children }) {
  return (
    <div style={styles.configCard}>
      <div style={styles.configCardTitle}>{title}</div>
      {children}
    </div>
  );
}

function NumberInput({ label, value, onChange, min, max, step = 1, preview, labelColor }) {
  return (
    <div style={styles.inputRow}>
      <label style={{ ...styles.inputLabel, ...(labelColor ? { color: labelColor } : {}) }}>{label}</label>
      <div style={styles.inputControls}>
        <button style={styles.inputBtn} onClick={() => onChange(Math.max(min, value - step))}>−</button>
        <span style={styles.inputValue}>{value}</span>
        <button style={styles.inputBtn} onClick={() => onChange(Math.min(max, value + step))}>+</button>
      </div>
      {preview && <div style={styles.preview}>{preview}</div>}
    </div>
  );
}

function formatTime(slot, minutes) {
  const start = (slot - 1) * minutes;
  const h = Math.floor(start / 60);
  const m = start % 60;
  const endMin = start + minutes;
  const eh = Math.floor(endMin / 60);
  const em = endMin % 60;
  return `${h}:${String(m).padStart(2, "0")} ~ ${eh}:${String(em).padStart(2, "0")}`;
}

function formatMinutes(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function parseTimeStr(str) {
  const parts = str.split(":");
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function buildSlotTimes(numSlots, slotMinutes, startMinute) {
  const arr = [];
  let cursor = startMinute || 0;
  for (let i = 0; i < numSlots; i++) {
    arr.push({ start: cursor, end: cursor + slotMinutes });
    cursor += slotMinutes;
  }
  return arr;
}

// ─── Styles ───
const styles = {
  root: {
    fontFamily: "'Noto Sans KR', 'DM Sans', sans-serif",
    background: "#0c0f14",
    color: "#e0e0e0",
    minHeight: "100vh",
    padding: "24px 16px",
    maxWidth: 900,
    margin: "0 auto",
  },
  header: { textAlign: "center", marginBottom: 28 },
  headerBar: { display: "flex", alignItems: "center", marginBottom: 8 },
  restartBtn: {
    padding: "6px 12px", borderRadius: 8, border: "1px solid #333",
    background: "#1e222a", color: "#8a95a8", fontSize: 12, fontWeight: 600, cursor: "pointer",
  },
  headerIcon: { fontSize: 40, marginBottom: 4 },
  title: { fontSize: 26, fontWeight: 800, margin: 0, color: "#ffffff", letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: "#667", margin: "4px 0 0", letterSpacing: 1 },
  configGrid: { display: "flex", flexDirection: "column", gap: 12 },
  configCard: {
    background: "#161a22",
    borderRadius: 12,
    padding: "16px 18px",
    border: "1px solid #222830",
  },
  configCardTitle: { fontSize: 13, fontWeight: 700, color: "#8a95a8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12 },
  inputRow: { marginBottom: 10 },
  inputLabel: { fontSize: 13, color: "#99a", display: "block", marginBottom: 4 },
  inputControls: { display: "flex", alignItems: "center", gap: 12 },
  inputBtn: {
    width: 32, height: 32, borderRadius: 8, border: "1px solid #333", background: "#1e222a",
    color: "#ccc", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  },
  inputValue: { fontSize: 20, fontWeight: 700, color: "#fff", minWidth: 30, textAlign: "center" },
  preview: { fontSize: 11, color: "#556", marginTop: 4, wordBreak: "break-all", lineHeight: 1.6 },
  gameSummary: {
    display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "8px 12px",
    background: "#1e222a", borderRadius: 8, fontSize: 14, color: "#8a95a8",
  },
  gameSummaryX: { color: "#445" },
  gameSummaryTotal: { color: "#7ce8c0", fontWeight: 700, fontSize: 16 },
  calcRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14,
    padding: "10px 14px", background: "#1e222a", borderRadius: 8, gap: 10,
  },
  calcInfo: { display: "flex", flexDirection: "column", gap: 2 },
  calcFormula: { fontSize: 13, color: "#8a95a8" },
  calcHint: { fontSize: 11, color: "#b8863e" },
  calcPreview: { fontSize: 18, fontWeight: 800, color: "#7ce8c0", marginTop: 2 },
  calcBtn: {
    padding: "8px 16px", borderRadius: 8, border: "1px solid #3a7bd5",
    background: "#1a2a40", color: "#7cb8ff", fontSize: 13, fontWeight: 700,
    cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
  },
  gameEditRow: {
    marginTop: 12, padding: "12px 14px", background: "#1a2a18", borderRadius: 10,
    border: "1px solid #2a4a2e", display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
  },
  gameEditLabel: { fontSize: 12, color: "#7ce8c0", fontWeight: 600 },
  gameEditControls: { display: "flex", alignItems: "center", gap: 14 },
  gameEditValue: { fontSize: 28, fontWeight: 800, color: "#fff", minWidth: 50, textAlign: "center" },
  gameEditSub: { fontSize: 11, color: "#556" },
  ratioContainer: {},
  ratioLabel: { fontSize: 13, color: "#99a", marginBottom: 6 },
  slider: { width: "100%", accentColor: "#7ce8c0", marginBottom: 8 },
  ratioBar: { display: "flex", height: 36, borderRadius: 6, overflow: "hidden", gap: 2 },
  ratioSegment: { display: "flex", alignItems: "center", justifyContent: "center", minWidth: 30 },
  generateBtn: {
    width: "100%", marginTop: 20, padding: "14px 0", borderRadius: 12,
    background: "linear-gradient(135deg, #1a5c3a, #2a7a4e)", border: "none",
    color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5,
  },
  resultSection: { marginTop: 24 },
  wizardOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 900, padding: 16,
  },
  wizardPopup: {
    background: "#13161c", borderRadius: 16, width: "100%", maxWidth: 460,
    maxHeight: "90vh", display: "flex", flexDirection: "column", border: "1px solid #222830",
  },
  wizardHeader: {
    padding: "18px 20px 14px", borderBottom: "1px solid #222830",
    display: "flex", flexDirection: "column", gap: 10,
  },
  wizardStepIndicator: { display: "flex", alignItems: "center", gap: 0, justifyContent: "center" },
  wizardStepActive: {
    width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#2a7a4e", color: "#fff", fontSize: 13, fontWeight: 800,
  },
  wizardStepInactive: {
    width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#1e222a", color: "#556", fontSize: 13, fontWeight: 700,
  },
  wizardStepDone: {
    width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#1a5c3a", color: "#7ce8c0", fontSize: 13, fontWeight: 800,
  },
  wizardStepLine: { width: 40, height: 2, background: "#222830" },
  wizardTitle: { fontSize: 18, fontWeight: 800, color: "#fff", textAlign: "center" },
  wizardTopHint: {
    fontSize: 12, color: "#7ce8c0", textAlign: "center", background: "#1a2a1e",
    padding: "5px 12px", borderRadius: 6, fontWeight: 600,
  },
  wizardBody: { padding: "16px 20px", overflowY: "auto", flex: 1 },
  wizardCountRow: { display: "flex", gap: 16 },
  wizardPlayerPreview: { fontSize: 11, color: "#556", marginTop: 4, textAlign: "center", letterSpacing: 2 },
  wizardCourtRow: { display: "flex", gap: 14 },
  wizardStartTimeRow: {
    marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 10, padding: "8px 10px", background: "#161a22", borderRadius: 8, border: "1px solid #222830",
  },
  wizardStartTimeLabel: { fontSize: 13, color: "#99a", fontWeight: 600, whiteSpace: "nowrap" },
  wizardCalcPanel: {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    background: "#1a2a18", borderRadius: 10, border: "1px solid #2a4a2e", padding: "12px 10px", gap: 6,
  },
  wizardCalcPreview: {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    background: "#161a22", borderRadius: 10, border: "1px solid #222830", padding: "12px 10px", gap: 8,
  },
  wizardCalcPreviewNum: { fontSize: 22, fontWeight: 800, color: "#8a95a8" },
  wizardFinalGamesBox: {
    marginTop: 16, padding: "14px 16px", background: "#1a2a18", borderRadius: 12,
    border: "1px solid #2a4a2e", display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
  },
  wizardFinalGamesLabel: { fontSize: 13, fontWeight: 700, color: "#7ce8c0", letterSpacing: 0.5 },
  wizardFinalGamesValue: { fontSize: 36, fontWeight: 800, color: "#fff", lineHeight: 1 },
  wizardCalcFormula: { fontSize: 11, color: "#8a95a8", textAlign: "center" },
  wizardCalcHint: { fontSize: 10, color: "#b8863e" },
  wizardCalcBtn: {
    padding: "6px 14px", borderRadius: 6, border: "1px solid #3a7bd5",
    background: "#1a2a40", color: "#7cb8ff", fontSize: 12, fontWeight: 700, cursor: "pointer",
  },
  wizardCalcBtnLg: {
    padding: "10px 16px", borderRadius: 8, border: "1px solid #3a7bd5",
    background: "linear-gradient(135deg, #1a2a40, #1e3450)", color: "#7cb8ff",
    fontSize: 13, fontWeight: 800, cursor: "pointer", width: "100%", marginTop: 4,
  },
  wizardCalcResult: { fontSize: 28, fontWeight: 800, color: "#7ce8c0" },
  wizardCalcAdjustWrap: {},
  wizardCalcAdjustLabel: { fontSize: 10, color: "#556", textAlign: "center", marginBottom: 4 },
  wizardCalcAdjust: { display: "flex", gap: 6, justifyContent: "center" },
  adjBtnSm: {
    width: 28, height: 28, borderRadius: 6, border: "1px solid #333", background: "#1e222a",
    color: "#8a95a8", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  },
  wizardSubTitle: { fontSize: 14, fontWeight: 700, color: "#ccc", marginBottom: 2 },
  wizardHint: { fontSize: 11, color: "#556", marginBottom: 10 },
  wizardNameGrid: { display: "flex", gap: 12 },
  wizardNameCol: { flex: 1 },
  wizardNameColTitle: { fontSize: 11, fontWeight: 700, color: "#667", marginBottom: 6, textTransform: "uppercase" },
  wizardNameRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 6 },
  wizardNameId: { padding: "2px 8px", borderRadius: 5, fontSize: 12, fontWeight: 700, minWidth: 24, textAlign: "center" },
  wizardNameInput: {
    flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid #333",
    background: "#1e222a", color: "#fff", fontSize: 13, outline: "none",
  },
  wizardNextBtn: {
    margin: "12px 20px 18px", padding: "13px 0", borderRadius: 10,
    background: "linear-gradient(135deg, #1a5c3a, #2a7a4e)", border: "none",
    color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer",
  },
  wizardBackBtn: {
    padding: "13px 20px", borderRadius: 10, border: "1px solid #333",
    background: "#1e222a", color: "#8a95a8", fontSize: 14, fontWeight: 600, cursor: "pointer",
  },
  wizardBtnRow: { display: "flex", gap: 8, padding: "12px 20px 18px" },
  settingsToggle: {
    width: "100%", padding: "12px 0", borderRadius: 10, border: "1px solid #3a7bd5",
    background: "linear-gradient(135deg, #1a2a40, #1e3450)", color: "#7cb8ff",
    fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 14, letterSpacing: 0.3,
  },
  settingsPanel: {
    background: "#161a22", borderRadius: 12, padding: 16, border: "1px solid #222830", marginBottom: 16,
  },
  settingsPanelHint: { fontSize: 11, color: "#556", marginBottom: 12, textAlign: "center" },
  recBox: {
    background: "#1a2a18", borderRadius: 10, padding: "10px 12px", border: "1px solid #2a4a2e", marginBottom: 10,
  },
  recHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  recLabel: { fontSize: 12, fontWeight: 700, color: "#7ce8c0" },
  recApplyBtn: {
    padding: "4px 12px", borderRadius: 6, border: "1px solid #2a7a4e",
    background: "#1a5c3a", color: "#7ce8c0", fontSize: 11, fontWeight: 700, cursor: "pointer",
  },
  recChips: { display: "flex", gap: 6, marginBottom: 4 },
  recChip: { padding: "3px 10px", borderRadius: 6, fontSize: 13, fontWeight: 700 },
  recDesc: { fontSize: 11, color: "#8a95a8" },
  nameEditorCard: {
    background: "#161a22", borderRadius: 12, padding: "14px 16px", border: "1px solid #222830", marginBottom: 16,
  },
  nameEditorTitle: { fontSize: 13, fontWeight: 700, color: "#8a95a8", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 },
  nameEditorGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
  nameEditorRow: { display: "flex", alignItems: "center", gap: 6 },
  nameEditorId: {
    padding: "3px 8px", borderRadius: 6, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0,
  },
  nameEditorInput: {
    width: 72, padding: "5px 8px", borderRadius: 6, border: "1px solid #333",
    background: "#1e222a", color: "#fff", fontSize: 13, outline: "none",
  },
  nameEditorGames: {
    fontSize: 11, color: "#7ce8c0", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0,
  },
  tabs: { display: "flex", gap: 4, marginBottom: 16 },
  tab: {
    flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #222830",
    background: "#161a22", color: "#667", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "center",
  },
  tabActive: {
    flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #3a7bd5",
    background: "#1a2a40", color: "#7cb8ff", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "center",
  },
  distRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  distChip: {
    padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
    background: "#1e222a", color: "#8a95a8",
  },
  distPanel: {
    background: "#161a22", borderRadius: 12, border: "1px solid #222830", marginBottom: 16, overflow: "hidden",
  },
  distPanelTop: { padding: "12px 14px 4px" },
  distPanelSummary: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, flexWrap: "wrap" },
  distPanelBody: { padding: "10px 14px 14px" },
  distAdjustRow: { display: "flex", gap: 16 },
  distWarnings: {
    background: "#2a1e10", borderRadius: 8, padding: "8px 10px", marginTop: 8,
  },
  distWarningItem: { fontSize: 12, color: "#f0c040", lineHeight: 1.8 },
  distRegenBtn: {
    flex: 1, padding: "10px 0", borderRadius: 8,
    background: "linear-gradient(135deg, #1a5c3a, #2a7a4e)", border: "none",
    color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  distBtnRow: { display: "flex", gap: 8, marginTop: 10 },
  distRefreshBtn: {
    flex: 1, padding: "10px 0", borderRadius: 8,
    background: "#1e222a", border: "1px solid #333",
    color: "#8a95a8", fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  distActualNote: {
    fontSize: 11, color: "#667", marginTop: 8, textAlign: "center", lineHeight: 1.6,
  },
  scheduleWrap: { display: "flex", flexDirection: "column", gap: 16 },
  timeSlotCard: { background: "#161a22", borderRadius: 12, padding: 16, border: "1px solid #222830" },
  timeSlotHeader: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 },
  timeSlotBadge: {
    background: "#1e222a", padding: "4px 10px", borderRadius: 6, fontSize: 13, fontWeight: 700, color: "#7cb8ff",
  },
  timeSlotTime: { fontSize: 12, color: "#556" },
  timeEditRow: { display: "flex", alignItems: "center", gap: 4 },
  timeEditTilde: { color: "#445", fontSize: 12 },
  timePickerBtn: {
    padding: "4px 10px", borderRadius: 6, border: "1px solid #333",
    background: "#1e222a", color: "#8a95a8", fontSize: 12, fontWeight: 600, cursor: "pointer",
    whiteSpace: "nowrap",
  },
  timePickerBtnSm: {
    padding: "2px 6px", borderRadius: 4, border: "1px solid #333",
    background: "#1e222a", color: "#8a95a8", fontSize: 10, fontWeight: 600, cursor: "pointer",
    whiteSpace: "nowrap",
  },
  tpOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 2000,
  },
  tpPopup: {
    background: "#13161c", borderRadius: 16, width: 280, border: "1px solid #222830",
    overflow: "hidden",
  },
  tpHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "12px 16px", borderBottom: "1px solid #222830",
  },
  tpTitle: { fontSize: 14, fontWeight: 700, color: "#8a95a8" },
  tpClose: {
    width: 26, height: 26, borderRadius: 6, border: "none",
    background: "#1e222a", color: "#888", fontSize: 14, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  tpPreview: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
    padding: "12px 0 8px",
  },
  tpPreviewNum: { fontSize: 32, fontWeight: 800 },
  tpPreviewColon: { fontSize: 28, fontWeight: 800, color: "#445" },
  tpGrid: {
    display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4,
    padding: "8px 12px 16px",
  },
  tpCell: {
    padding: "8px 0", borderRadius: 8, border: "none",
    background: "#1e222a", color: "#ccc", fontSize: 14, fontWeight: 600,
    cursor: "pointer", textAlign: "center",
  },
  tpCellMin: { fontSize: 15, fontWeight: 700 },
  tpCellActive: { background: "#1a3a5c", color: "#7cb8ff" },
  gamesGrid: { display: "flex", flexDirection: "column", gap: 8 },
  gameCard: { background: "#1a1e26", borderRadius: 8, padding: "10px 14px" },
  gameTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  courtLabel: { fontSize: 12, color: "#667", fontWeight: 600 },
  typeBadge: { padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700 },
  matchup: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" },
  team: { display: "flex", gap: 4 },
  vs: { color: "#445", fontSize: 12, fontWeight: 700 },
  playerChip: {
    padding: "3px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
  },
  playerChipLg: {
    padding: "4px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700,
  },
  statsGrid: { display: "flex", flexDirection: "column", gap: 10 },
  statCard: { background: "#161a22", borderRadius: 10, padding: 14, border: "1px solid #222830" },
  statHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  gameCount: { fontSize: 14, fontWeight: 700, color: "#7ce8c0" },
  statBar: { height: 4, background: "#1e222a", borderRadius: 2, marginBottom: 10 },
  statBarFill: { height: "100%", borderRadius: 2, transition: "width .3s" },
  statDetails: {},
  statLabel: { fontSize: 11, color: "#556", fontWeight: 600, marginTop: 6, marginBottom: 3 },
  statPills: { display: "flex", flexWrap: "wrap", gap: 4 },
  miniPill: { padding: "2px 6px", borderRadius: 4, background: "#1e222a", fontSize: 11, color: "#8a95a8" },
  matrixWrap: { overflowX: "auto" },
  matrixLabel: { fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#ccc" },
  matrixScroll: { overflowX: "auto", paddingBottom: 8 },
  matrixTable: { borderCollapse: "collapse", width: "100%", fontSize: 12 },
  matrixTh: { padding: "6px 8px", borderBottom: "1px solid #222830", fontSize: 11, fontWeight: 700, textAlign: "center" },
  matrixTd: { padding: "5px 8px", borderBottom: "1px solid #1a1e26", textAlign: "center", fontSize: 12, fontWeight: 600 },
  shareBtn: {
    width: "100%", marginTop: 20, padding: "14px 0", borderRadius: 12,
    background: "#1e222a", border: "1px solid #333",
    color: "#ccc", fontSize: 15, fontWeight: 700, cursor: "pointer",
  },
  swapOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: 16,
  },
  swapPopup: {
    background: "#13161c", borderRadius: 14, width: "100%", maxWidth: 440,
    maxHeight: "85vh", display: "flex", flexDirection: "column", border: "1px solid #f0c040",
  },
  swapPopupHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "14px 18px", borderBottom: "1px solid #222830",
  },
  swapPopupTitle: { fontSize: 16, fontWeight: 800, color: "#f0c040" },
  swapCloseBtn: {
    width: 30, height: 30, borderRadius: 8, border: "none",
    background: "#1e222a", color: "#888", fontSize: 16, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  swapContext: {
    display: "flex", alignItems: "center", gap: 10, padding: "12px 18px",
    borderBottom: "1px solid #1e222a", flexWrap: "wrap",
  },
  swapContextInfo: { fontSize: 12, color: "#8a95a8", display: "flex", alignItems: "center", gap: 6 },
  swapContextType: { padding: "2px 6px", borderRadius: 6, fontSize: 10, fontWeight: 700 },
  swapListWrap: { overflowY: "auto", padding: "8px 12px", flex: 1 },
  swapNoCandidate: { fontSize: 13, color: "#556", padding: 16, textAlign: "center" },
  swapRow: {
    borderRadius: 10, padding: "10px 12px", marginBottom: 6, cursor: "pointer",
    background: "#161a22", border: "1px solid transparent", transition: "background .15s",
  },
  swapRowTop: { display: "flex", alignItems: "center", gap: 8 },
  swapRowMeta: { flex: 1, display: "flex", flexDirection: "column", gap: 1 },
  swapRowGames: { fontSize: 11, color: "#8a95a8" },
  swapExchangeBadge: { fontSize: 10, color: "#c8a0ff", background: "#2a1a3a", padding: "1px 6px", borderRadius: 4, fontWeight: 700 },
  swapRowStatus: { flexShrink: 0, fontSize: 14 },
  swapRowDetail: { marginTop: 8, paddingTop: 8, borderTop: "1px solid #222830" },
  swapWarningItem: { fontSize: 12, lineHeight: 1.8 },
  swapApplyBtn: {
    width: "100%", padding: "10px 0", borderRadius: 8, border: "none",
    background: "linear-gradient(135deg, #3a6a1a, #4a8a2e)", color: "#fff",
    fontSize: 13, fontWeight: 700, cursor: "pointer", marginTop: 8,
  },
  shareOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: 16,
  },
  sharePopup: {
    background: "#13161c", borderRadius: 14, width: "100%", maxWidth: 480,
    maxHeight: "90vh", display: "flex", flexDirection: "column", border: "1px solid #222830",
  },
  sharePopupHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "14px 18px", borderBottom: "1px solid #222830",
  },
  sharePopupTitle: { fontSize: 16, fontWeight: 800, color: "#fff" },
  shareCloseBtn: {
    width: 30, height: 30, borderRadius: 8, border: "none",
    background: "#1e222a", color: "#888", fontSize: 16, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  shareTableWrap: { overflowY: "auto", padding: "12px 14px", flex: 1 },
  shareTable: { borderCollapse: "collapse", width: "100%", fontSize: 12 },
  shareTh: {
    padding: "6px 6px", borderBottom: "2px solid #333", fontSize: 11,
    fontWeight: 700, color: "#8a95a8", textAlign: "center", whiteSpace: "nowrap",
  },
  shareTd: {
    padding: "5px 6px", borderBottom: "1px solid #1e222a", textAlign: "center",
    fontSize: 12, color: "#ddd", whiteSpace: "nowrap",
  },
  copyBtn: {
    margin: "12px 14px 14px", padding: "12px 0", borderRadius: 10,
    background: "linear-gradient(135deg, #1a3a5c, #2a5a7e)", border: "none",
    color: "#7cb8ff", fontSize: 14, fontWeight: 700, cursor: "pointer",
  },
};
