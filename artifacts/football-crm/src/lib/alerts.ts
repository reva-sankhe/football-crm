import { buildLoadRows, collapseLoadByDay, computeAcwr, teamSessionDatesFrom } from "./report";
import { formatBronco } from "./utils";
import { STATUS } from "./viz";
import type { Player, TestResult, TrainingSession, SessionRPE, SessionAttendance } from "./types";
import type { PlayerMatchStat } from "./queries";

/**
 * The squad-wide alert engine — extracted out of Dashboard.tsx so it can be
 * reused by the dashboard rebuild and by other pages without either copying
 * the logic or importing a page component. Behavior is unchanged from the
 * original inline version; only the "recovery" gap will start excluding
 * `estimated: true` rows once the missing-RPE fallback lands (Step 1b/1c).
 */

export type AlertSeverity = "danger" | "warning" | "info";
export type AlertCategory = "workload" | "recovery" | "attendance" | "fitness";

export interface AlertItem {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  player: Player;
  headline: string;
  detail: string;
  action: string;
}

// Severity used only for per-alert colour coding within sections
export const SEV_COLOR: Record<AlertSeverity, string> = {
  danger:  STATUS.critical,
  warning: STATUS.warning,
  info:    STATUS.serious,
};

// The 4 functional sections — each maps to one area a coach can act on
export const CAT_CFG: Record<AlertCategory, { label: string; description: string; color: string; dimBg: string; metricNote: string }> = {
  workload: {
    label: "Workload Changes",
    description: "Players whose latest seven-day workload is above their own previous three-week average. This ratio is a workload monitoring signal, not an injury prediction.",
    metricNote: "Workload ratio = latest 7-day load ÷ prior 3-week average",
    color: "inherit",
    dimBg: "bg-muted/30",
  },
  recovery: {
    label: "Recovery Concern",
    description: "Players who are consistently reporting sessions as harder than planned. When a player's actual RPE is regularly above the session's planned RPE, it signals they may not be recovering adequately between sessions — or that planned intensity is beyond their current capacity.",
    metricNote: "RPE gap = player's actual rating minus the session's planned RPE",
    color: "inherit",
    dimBg: "bg-muted/30",
  },
  attendance: {
    label: "Attendance",
    description: "Players below the 75% monthly attendance threshold. Consistent absence disrupts fitness development, reduces cohesion in set-piece and tactical work, and makes it harder to fairly assess match readiness.",
    metricNote: "Minimum required: 75% of logged sessions per month",
    color: "inherit",
    dimBg: "bg-muted/30",
  },
  fitness: {
    label: "Fitness & Testing",
    description: "Players with a notable bronco time decline since their last test, or who haven't been tested in 60+ days. Without regular testing you can't track fitness trends, spot fatigue-related decline early, or make informed decisions about match minutes.",
    metricNote: "Bronco test recommended every 4–8 weeks",
    color: "inherit",
    dimBg: "bg-muted/30",
  },
};

export type AlertRPERow = SessionRPE & { sessions: TrainingSession; players: Pick<Player, "id" | "name" | "team" | "primary_position" | "age_range"> };
export type AlertAttRow = SessionAttendance & { players: Pick<Player, "id" | "name" | "primary_position" | "team"> };
export type AlertResultRow = TestResult & { players?: Pick<Player, "name" | "code" | "team" | "primary_position" | "age_range">; test_sessions?: { test_date: string; test_name: string; type: string | null } };

export interface ComputeAlertsInput {
  players: Player[];
  rpeData: AlertRPERow[];
  attendanceData: AlertAttRow[];
  allResults: AlertResultRow[];
  trainingSessions: TrainingSession[];
  matchStats: PlayerMatchStat[];
  /** Defaults to the real current time; tests pass a fixed date. */
  now?: Date;
}

const BENCHMARK_DAYS_OVERDUE = 60;

/**
 * Within the Spike band (ratio > 1.5), a ratio above this gets the higher
 * severity tier. Kept as a named threshold rather than inlined so it reads
 * as a deliberate cutoff, not a magic number.
 */
export const SPIKE_PRIORITY_THRESHOLD = 2.0;

export function computeAlerts({
  players, rpeData, attendanceData, allResults, trainingSessions, matchStats, now = new Date(),
}: ComputeAlertsInput): AlertItem[] {
  const items: AlertItem[] = [];
  const activePlayers = players.filter((p) => p.is_active);
  const teamSessionDates = teamSessionDatesFrom(trainingSessions);

  // 1. Workload ratio + RPE vs planned gap
  const rpeByPlayer = new Map<string, AlertRPERow[]>();
  for (const r of rpeData) {
    if (!r.players?.id) continue;
    if (!rpeByPlayer.has(r.players.id)) rpeByPlayer.set(r.players.id, []);
    rpeByPlayer.get(r.players.id)!.push(r);
  }
  // Match minutes are load too, and a player can have them with no rated
  // session at all — so the alert loop iterates players, not RPE rows.
  const statsByPlayer = new Map<string, PlayerMatchStat[]>();
  for (const s of matchStats) {
    if (!statsByPlayer.has(s.player_id)) statsByPlayer.set(s.player_id, []);
    statsByPlayer.get(s.player_id)!.push(s);
  }
  // Attendance backs the estimate for match days that never got a grid
  const attByPlayer = new Map<string, AlertAttRow[]>();
  for (const a of attendanceData) {
    if (!attByPlayer.has(a.player_id)) attByPlayer.set(a.player_id, []);
    attByPlayer.get(a.player_id)!.push(a);
  }

  for (const player of activePlayers) {
    const pid = player.id;
    const rows = rpeByPlayer.get(pid) ?? [];
    if (rows.length === 0 && !statsByPlayer.has(pid) && !attByPlayer.has(pid)) continue;

    // ── Workload ratio ────────────────────────────────────────────────────
    // The same function the profile and the report use, so the three can't
    // report different numbers for the same player.
    const { acwr, acute, baselineWeeklyAvg, status } = computeAcwr(
      collapseLoadByDay(buildLoadRows(rows, statsByPlayer.get(pid) ?? [], attByPlayer.get(pid) ?? [], trainingSessions)),
      now,
      undefined,
      teamSessionDates,
    );
    if (acwr !== null && status === "spike") {
      // Merging high_spike/very_high_spike into one "Spike" band (see
      // report.ts) lost the old two-tier urgency split — restored here, at
      // the alert layer rather than the ACWR status itself, so the band
      // stays simple while the alert can still say "this one first."
      const isPriority = acwr > SPIKE_PRIORITY_THRESHOLD;
      items.push({
        id: `acwr-${pid}`,
        severity: isPriority ? "danger" : "warning",
        category: "workload",
        player,
        headline: `Workload ratio ${acwr.toFixed(2)} — Spike${isPriority ? ", priority" : ""}`,
        detail: `Last 7 days: ${Math.round(acute)} AU. Prior 3-week average: ${Math.round(baselineWeeklyAvg)} AU per week. Worth a closer look at recent workload, recovery, and upcoming sessions.`,
        action: isPriority
          ? "Check in with the player before the next session and review the schedule for the next few days. This workload ratio is a monitoring prompt, not an injury prediction."
          : "Keep an eye on this over the next few sessions — no need to act immediately, but worth watching if it continues to climb.",
      });
    } else if (acwr !== null && status === "elevated") {
      items.push({ id: `acwr-${pid}`, severity: "warning", category: "workload", player,
        headline: `Workload ratio ${acwr.toFixed(2)} — Elevated`,
        detail: `Last 7 days: ${Math.round(acute)} AU. Prior 3-week average: ${Math.round(baselineWeeklyAvg)} AU per week.`,
        action: "Review recovery and upcoming sessions before adding unplanned workload." });
    }

    // ── RPE vs planned gap ───────────────────────────────────────────────
    // Only alert when a player is consistently working harder than the session plan intended.
    //
    // `rows` here is raw `session_rpe` data (rpeData, fetched from the DB),
    // never buildLoadRows's synthesized output — so an estimated row (which
    // is itself derived FROM planned_rpe or a team median) can never appear
    // in this comparison. Comparing an estimate against the plan it was
    // estimated from would be circular; this is naturally excluded by
    // construction, not by an explicit filter, since AlertRPERow has no
    // `estimated` field to filter on in the first place.
    const sortedByDate = [...rows].sort((a, b) => (a.sessions?.date ?? "").localeCompare(b.sessions?.date ?? ""));
    const withPlan = sortedByDate.filter((r) => (r.sessions?.planned_rpe ?? 0) > 0);
    const recentWithPlan = withPlan.slice(-5);
    if (recentWithPlan.length >= 3) {
      const gaps = recentWithPlan.map((r) => r.rpe - (r.sessions?.planned_rpe ?? r.rpe));
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (avgGap >= 3.0) {
        items.push({ id: `rpe-${pid}`, severity: "danger", category: "recovery", player,
          headline: `Effort ${avgGap.toFixed(1)} points above plan on average`,
          detail: `Across the last ${recentWithPlan.length} sessions with a set plan, this player has rated their effort ${avgGap.toFixed(1)} RPE points above what was planned on average. A gap this large usually means the training stimulus is beyond what they can currently absorb.`,
          action: "Lower planned RPE or reduce session duration for this player. Either the plan needs adjusting, or they need extra recovery time between sessions — don't wait for an injury to prompt this." });
      } else if (avgGap >= 1.5) {
        items.push({ id: `rpe-${pid}`, severity: "warning", category: "recovery", player,
          headline: `Effort ${avgGap.toFixed(1)} points above plan on average`,
          detail: `Across the last ${recentWithPlan.length} sessions with a set plan, this player has rated sessions ${avgGap.toFixed(1)} RPE points harder than planned on average — a consistent gap, not a one-off hard day.`,
          action: "Before the next session, ask the player how they're feeling. If they report heaviness or fatigue, reduce their involvement in high-intensity drills for that session." });
      }
    }
  }

  // 2. Monthly attendance
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const monthSessions = trainingSessions.filter((s) => (s.date ?? "") >= monthStart && (s.date ?? "") <= monthEnd);
  const sessionIdsWithAtt = new Set(attendanceData.map((a) => a.session_id));
  const loggedMonthSessions = monthSessions.filter((s) => sessionIdsWithAtt.has(s.id));
  if (loggedMonthSessions.length > 0) {
    for (const player of activePlayers) {
      const playerAtt = attendanceData.filter((a) => a.player_id === player.id && loggedMonthSessions.some((s) => s.id === a.session_id));
      if (!playerAtt.length) continue;
      const attended = playerAtt.filter((a) => a.status === "Present" || a.status === "Late").length;
      const pct = attended / loggedMonthSessions.length;
      if (pct < 0.75) {
        const isDanger = pct < 0.5;
        items.push({ id: `att-${player.id}`, severity: isDanger ? "danger" : "warning", category: "attendance", player,
          headline: `${Math.round(pct * 100)}% attendance this month (${attended} of ${loggedMonthSessions.length} sessions)`,
          detail: isDanger
            ? `This player has missed more than half of this month's logged sessions. At this level of absence they're falling behind on fitness, missing tactical and set-piece work, and it becomes difficult to justify match selection.`
            : `Below the 75% minimum. Missed sessions add up quickly — one or two more absences this month will make it very difficult to meet the threshold.`,
          action: isDanger
            ? "Reach out to the player directly and have an honest conversation. Continued absence at this level needs to factor into squad selection decisions."
            : "Have a conversation with the player before the next session. Identify whether it's injury, scheduling, or something else — and agree on what's needed to get back on track." });
      }
    }
  }

  // 3. Fitness decline
  const resultsByPlayer = new Map<string, AlertResultRow[]>();
  for (const r of allResults) {
    if (!r.player_id || r.bronco_mins === null) continue;
    if (!resultsByPlayer.has(r.player_id)) resultsByPlayer.set(r.player_id, []);
    resultsByPlayer.get(r.player_id)!.push(r);
  }
  for (const [pid, res] of resultsByPlayer) {
    const player = activePlayers.find((p) => p.id === pid);
    if (!player) continue;
    const sorted = [...res].sort((a, b) => (a.test_sessions?.test_date ?? "").localeCompare(b.test_sessions?.test_date ?? ""));
    if (sorted.length < 2) continue;
    const prev = sorted[sorted.length - 2], latest = sorted[sorted.length - 1];
    if (prev.bronco_mins !== null && latest.bronco_mins !== null) {
      const dec = Math.round((latest.bronco_mins - prev.bronco_mins) * 60);
      if (dec >= 15) {
        items.push({ id: `fitdec-${pid}`, severity: "warning", category: "fitness", player,
          headline: `Bronco time declined by ${dec}s since last test`,
          detail: `Previous: ${formatBronco(prev.bronco_mins)} → Latest: ${formatBronco(latest.bronco_mins)} at ${latest.test_sessions?.test_name ?? "latest test"}. A drop of ${dec}s+ is a meaningful decline — it can indicate accumulated fatigue, illness during the testing period, or a genuine fitness regression.`,
          action: "Don't act on one result in isolation — schedule a retest to confirm. If the decline holds, review this player's training load and recovery from the past 4 weeks before making changes." });
      }
    }
  }

  // 4. Test overdue (>60 days)
  const latestTestDate = new Map<string, string>();
  for (const r of allResults) {
    if (!r.player_id || !r.test_sessions?.test_date) continue;
    const ex = latestTestDate.get(r.player_id);
    if (!ex || r.test_sessions.test_date > ex) latestTestDate.set(r.player_id, r.test_sessions.test_date);
  }
  const daysOverdue = new Date(now.getTime() - BENCHMARK_DAYS_OVERDUE * 86_400_000).toISOString().slice(0, 10);
  for (const player of activePlayers) {
    const last = latestTestDate.get(player.id);
    if (last && last < daysOverdue) {
      items.push({ id: `overdue-${player.id}`, severity: "info", category: "fitness", player,
        headline: `No fitness test recorded since ${last}`,
        detail: `That's 60+ days without a bronco result. Without recent data you're making squad and load decisions without knowing where this player's fitness actually sits — trends can shift significantly in 8 weeks.`,
        action: "Get this player into the next testing session. If a full bronco isn't possible soon, a shorter time-trial can give a useful reference point." });
    }
  }

  const order: Record<AlertSeverity, number> = { danger: 0, warning: 1, info: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}
