import { sql } from "drizzle-orm";
import { ALERT_KINDS, ALERT_RULES, PUSH_KINDS, type AlertChannelState, type AlertFacts, type AlertKind } from "@korbat/contracts";
import type { StaffAlertKind, StaffMessage } from "../auth";
import { createJob, type JobLock } from "../lib/jobs";
import type { ModerationDeps } from "./context";
import { urgentWaiting } from "./repo";

/**
 * Staff alerts (3c design, section 7.12; 3f design, sections 5 and 7.2). Every alert has two legs. The push: one row of
 * alert_outbox, which the watcher (apps/api/src/notify) publishes to the phones with the fixed sentence of its kind,
 * counts and times only. The mail: to every live staff account, with counts and times and, for 3c's and 3e's kinds, the
 * staff handle where they name one; never a link or content. The moderation module, which never sees an address, keeps
 * each alert's throttle as one key of the shared limit store, and the alert tick below writes the time-driven alerts
 * (alert_steps()) and mails every 3f alert whose mail is its push's sentence, whoever wrote its row.
 */

/** The key and the window of the urgent lane's alert. The dispatch job repeats the alert under the same key. */
export const URGENT_ALERT_KEY = "moderation-urgent";
export const URGENT_ALERT_WINDOW_MS = 15 * 60_000;

/** The alert tick's name: its lock is `job:alert-tick`, and its log lines carry it. */
export const ALERT_TICK_JOB = "alert-tick";
/** The time between the end of one round of the tick and the start of the next. */
export const ALERT_TICK_INTERVAL_MS = ALERT_RULES.tickSeconds * 1000;
/**
 * The alert tick's mail leg, a job of its own (3f's review, operations2): its lock is `job:alert-mail`, and a round comes
 * ALERT_TICK_INTERVAL_MS after the last one ended. A relay that answers slowly or not at all then holds only the mail
 * leg: alert_steps() and the channel's check keep their own time, so the pushes they write (the 15-minute escalation,
 * the deadline's reminders) are never late behind a mail.
 */
export const ALERT_MAIL_JOB = "alert-mail";

/**
 * The kinds whose mail is their push's sentence that the tick mails from a row, each a template of the mailer: every
 * kind of the contracts' SENTENCE_MAIL_KINDS, which a test holds this list to (3f's review, operations4: Task 5's two
 * kinds were pushed and never mailed).
 */
export const TICK_MAILED_KINDS: readonly StaffAlertKind[] = [
  "contact_mail",
  "contact_mail_escalated",
  "order_due",
  "mailbox_unreachable",
  "alert_channel_down",
  "order_opened",
  "order_corrected",
  "order_unverified",
  // Task 3.
  "order_effected",
  "order_reinstated",
  "hold_ending",
  // Task 6: copy_overdue, which alert_steps() writes daily, and copy_taken, which staffAlert writes after a download.
  "copy_overdue",
  "copy_taken",
  // Task 5's two daily kinds, joined in 3f's review: a report to an authority owed, and a hand-over's copy not destroyed.
  "report_owed",
  "handover_undestroyed",
];

/** A list of the contracts' words as a PostgreSQL array, for `= any(...)`: no word holds a comma or a quote. */
const words = (values: readonly string[]) => sql`${`{${values.join(",")}}`}::text[]`;

/**
 * The facts of an alert's push: the counts and times its kind names in ALERT_KINDS, never a handle, a lane's list or a
 * reason. 3c's and 3e's kinds keep their full message for the mail; the push gets these alone. A 3f alert's message is
 * its facts.
 */
export function alertFacts(message: StaffMessage): AlertFacts {
  switch (message.template) {
    case "moderation_urgent":
      return { count: message.count, oldestAt: message.oldest.toISOString() };
    case "moderation_waiting":
      // What the mail lists, each line's own count: the cases of each lane past its time, the cases that hold a measure
      // taken while deciding, and the replies waiting.
      return { count: message.lanes.reduce((sum, lane) => sum + Math.max(0, lane.count), 0) + message.interim + (message.replies?.count ?? 0) };
    case "moderation_burst":
      return { count: message.count };
    case "moderation_reads":
      return { limit: message.limit };
    case "moderation_reveal":
    case "moderation_csam_lifted":
      return { at: message.at.toISOString() };
    default:
      return message.facts;
  }
}

/** Writes one alert's row, with its kind's priority and scope; the database forces its times and its two legs as owed. */
async function insertAlert(q: Pick<ModerationDeps["apiDb"], "execute">, kind: AlertKind, facts: AlertFacts): Promise<number> {
  const entry = ALERT_KINDS[kind];
  const [row] = await q.execute<{ id: string }>(
    sql`insert into public.alert_outbox (kind, priority, scope, facts) values (${kind}, ${entry.priority}, ${entry.scope}, ${JSON.stringify(facts)}::jsonb) returning id`,
  );
  return Number(row!.id);
}

/**
 * Mails a 3f alert's row once: the row is taken FOR UPDATE SKIP LOCKED while its mail goes, and marked mailed when an
 * address took it, so staffAlert and the tick never both mail it. Answers how many addresses took it, or "elsewhere" when
 * another holds the row or it was mailed meanwhile.
 */
async function mailClaimed(deps: Pick<ModerationDeps, "apiDb" | "auth">, id: number, message: StaffMessage): Promise<number | "elsewhere"> {
  return deps.apiDb.transaction(async (tx) => {
    const claimed = await tx.execute(sql`select id from public.alert_outbox where id = ${id} and mailed_at is null for update skip locked`);
    if (claimed.length === 0) return "elsewhere";
    const accepted = await deps.auth.mailStaff(message);
    if (accepted > 0) await tx.execute(sql`update public.alert_outbox set mailed_at = now() where id = ${id}`);
    return accepted;
  });
}

/**
 * Sends a staff alert at most once in its key's window (null: no throttle, for a reveal and for a decision that lifted
 * the protection of reported images). After the throttle, in this order: it writes the alert's row of alert_outbox, which
 * the watcher pushes; then it mails every staff account. For 3c's and 3e's kinds (`mail: "own"`) the mail is the caller's
 * full message, and the row is marked mailed whether or not an address took it: the tick never renders such a mail from
 * a row. For a kind of 3f whose mail is its sentence, the row is marked only when an address took the mail, and the tick
 * mails a row left without it.
 *
 * An alert fails open: a row that cannot be written is logged and the mail goes all the same, and when the store cannot
 * be reached both go without a throttle. It answers sent when either leg took the alert. The hit is given back, so the
 * next occasion that meets the alert's condition sends it again, when the mail of one of 3c's and 3e's kinds went to
 * nobody (no row can mail it later), and for a kind of 3f only when neither leg took it. A failed give-back is logged.
 * It never throws for a failed send, which mailStaff logs.
 */
export async function staffAlert(deps: Pick<ModerationDeps, "apiDb" | "auth" | "limits" | "log">, key: string | null, windowMs: number, message: StaffMessage): Promise<"sent" | "throttled" | "unsent"> {
  let counted = false;
  if (key !== null) {
    try {
      const hit = await deps.limits.hit(key, windowMs);
      counted = true;
      if (hit.count > 1) return "throttled";
    } catch (err) {
      deps.log.warn({ err, alert: key }, "moderation alert: the limit store could not be reached; the alert goes without its throttle");
    }
  }
  const kind = message.template;
  const entry = ALERT_KINDS[kind];
  let rowId: number | null = null;
  try {
    // A statement of its own, in a savepoint where the caller holds a transaction: a refused row never aborts it.
    rowId = await deps.apiDb.transaction((tx) => insertAlert(tx, kind, alertFacts(message)));
  } catch (err) {
    deps.log.warn({ err, alert: key ?? kind }, "moderation alert: its row for the phones could not be written; the mail goes all the same");
  }
  let accepted: number;
  if (entry.mail === "sentence" && rowId !== null) {
    const mailed = await mailClaimed(deps, rowId, message).catch((err: unknown) => {
      deps.log.warn({ err, alert: rowId }, "moderation alert: its mail could not be sent now; the alert tick sends it");
      return 0;
    });
    accepted = mailed === "elsewhere" ? 1 : mailed;
  } else {
    accepted = await deps.auth.mailStaff(message);
    if (rowId !== null && entry.mail === "own") {
      await deps.apiDb
        .execute(sql`update public.alert_outbox set mailed_at = now() where id = ${rowId}`)
        .catch((err: unknown) => deps.log.warn({ err, alert: rowId }, "moderation alert: its row could not be marked mailed; nothing mails it again"));
    }
  }
  const pushed = rowId !== null && entry.legs.includes("push");
  const giveBack = accepted === 0 && (entry.mail === "own" || !pushed);
  if (giveBack && counted && key !== null) {
    await deps.limits.release(key).catch((err: unknown) => deps.log.warn({ err, alert: key }, "moderation alert: the hit of an alert nobody received could not be given back"));
  }
  return accepted > 0 || pushed ? "sent" : "unsent";
}

/**
 * The urgent lane's alert: when an intake has put an item into lane 0, every staff account is told how many cases wait
 * there and since when the oldest does, and the phone on call is woken. A notice about a post that quotes another puts
 * two cases into the lane and sends one alert that counts both. Best effort, after the commit and the answer; the
 * dispatch job repeats it while a lane-0 item still calls for someone.
 */
export async function alertUrgentLane(deps: Pick<ModerationDeps, "apiDb" | "auth" | "limits" | "log" | "config">): Promise<"sent" | "throttled" | "unsent" | "nothing_waiting"> {
  const waiting = await urgentWaiting(deps.apiDb);
  // Decided in the moment between the intake's commit and this read: nothing is left to alert about.
  if (waiting.count === 0 || waiting.oldest === null) return "nothing_waiting";
  // 3f's review (people4): the mail says whether the phone on call got the push, or that it is the only alert.
  return staffAlert(deps, URGENT_ALERT_KEY, URGENT_ALERT_WINDOW_MS, { template: "moderation_urgent", count: waiting.count, oldest: waiting.oldest, phones: deps.config.NOTIFY !== "off" });
}

// ---------------------------------------------------------------- the channel's health

/** The alert channel's state as the console's home and the tick read it, with the time since when. */
export interface ChannelHealth {
  channel: AlertChannelState;
  since: Date | null;
}

/**
 * The channel's state, read fresh (3f design, sections 5 and 7.2 step 3), by the database's clock: `off` with NOTIFY=off;
 * `down` while the watcher's beat is older than channel_down_minutes (or there never was one), or a row still owed its
 * push (a kind with a push leg, not pushed, younger than push_owed_minutes) is older than that while no publish has
 * worked for as long (push_ok_at; 3f's review, operations3: rows waiting behind ntfy's request limit, which answers and
 * takes some every round, never read as down, and Home never says that alerts arrive by mail only then); `mailbox`
 * while the beat is fresh and the mailbox was last read longer ago than that; `ok` otherwise. A row past its push's
 * bound counts for nothing any more, so the state clears by itself once the push server is back. `since` is the earliest
 * late time, or the clock's when there is none (a watcher that never beat, a mailbox never read).
 */
export async function channelHealth(deps: Pick<ModerationDeps, "apiDb" | "config">): Promise<ChannelHealth> {
  if (deps.config.NOTIFY === "off") return { channel: "off", since: null };
  const [row] = await deps.apiDb.execute<{ now: string; beat_at: string | null; mailbox_ok_at: string | null; owed_since: string | null; beat_late: boolean; owed_late: boolean; mailbox_late: boolean }>(sql`
    select now() as now, s.beat_at, s.mailbox_ok_at, o.owed_since,
           (s.beat_at is null or s.beat_at < now() - make_interval(mins => r.channel_down_minutes)) as beat_late,
           coalesce(o.owed_since < now() - make_interval(mins => r.channel_down_minutes), false)
             and (s.push_ok_at is null or s.push_ok_at < now() - make_interval(mins => r.channel_down_minutes)) as owed_late,
           (s.mailbox_ok_at is null or s.mailbox_ok_at < now() - make_interval(mins => r.channel_down_minutes)) as mailbox_late
      from public.order_rules() r
      left join public.notify_state s on s.id = 1
      cross join lateral (select min(x.created_at) as owed_since from public.alert_outbox x
                           where x.pushed_at is null and x.kind = any(${words(PUSH_KINDS)})
                             and x.created_at > now() - make_interval(mins => r.push_owed_minutes)) o`);
  const at = (value: string | null) => (value === null ? null : new Date(value));
  const now = new Date(row!.now);
  if (row!.beat_late || row!.owed_late) {
    const late = [row!.beat_late ? at(row!.beat_at) : null, row!.owed_late ? at(row!.owed_since) : null].filter((d): d is Date => d !== null);
    return { channel: "down", since: late.length === 0 ? now : new Date(Math.min(...late.map((d) => d.getTime()))) };
  }
  if (row!.mailbox_late) return { channel: "mailbox", since: at(row!.mailbox_ok_at) ?? now };
  return { channel: "ok", since: null };
}

/**
 * The tick's own alarm: one row of `alert_channel_down` (mailed only) or `mailbox_unreachable` (pushed and mailed), at
 * most once in 24 hours by the outbox's own rows, with no key in the limit store. Answers whether it wrote one.
 */
async function raiseAlarm(deps: Pick<ModerationDeps, "apiDb">, kind: "alert_channel_down" | "mailbox_unreachable", since: Date): Promise<boolean> {
  const entry = ALERT_KINDS[kind];
  const facts = JSON.stringify({ since: since.toISOString() });
  const rows = await deps.apiDb.execute(sql`
    insert into public.alert_outbox (kind, priority, scope, facts)
    select ${kind}, ${entry.priority}, ${entry.scope}, ${facts}::jsonb
     where not exists (select 1 from public.alert_outbox o where o.kind = ${kind} and o.created_at > now() - make_interval(hours => 24))
    returning id`);
  return rows.length > 0;
}

// ---------------------------------------------------------------- the alert tick

export interface TickReport {
  /** How many rows alert_steps() wrote, or null when the step failed. */
  steps: number | null;
  /** The channel's state, or null when NOTIFY is off or the step failed. */
  channel: AlertChannelState | null;
  /** The alarms the round raised. */
  raised: ("alert_channel_down" | "mailbox_unreachable")[];
}

/**
 * One round of the alert tick (3f design, section 7.2), each step in a try of its own:
 *   1. `select alert_steps()`: the database writes every time-driven row that is due;
 *   2. the channel's health, skipped with NOTIFY=off: its alarm rows, which the mail leg mails.
 * The mail leg (section 7.2's step 2) is alertMailLeg, a job of its own since 3f's review (ALERT_MAIL_JOB).
 */
export async function alertTick(deps: Pick<ModerationDeps, "apiDb" | "config" | "log">): Promise<TickReport> {
  const report: TickReport = { steps: null, channel: null, raised: [] };
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      deps.log.error({ err, job: ALERT_TICK_JOB, step: name }, "alert-tick: a step failed; the round goes on");
    }
  };

  await step("steps", async () => {
    const [row] = await deps.apiDb.execute<{ written: number }>(sql`select public.alert_steps() as written`);
    report.steps = Number(row!.written);
  });

  if (deps.config.NOTIFY === "on") {
    await step("channel", async () => {
      const health = await channelHealth(deps);
      report.channel = health.channel;
      if (health.channel === "down" && (await raiseAlarm(deps, "alert_channel_down", health.since!))) report.raised.push("alert_channel_down");
      if (health.channel === "mailbox" && (await raiseAlarm(deps, "mailbox_unreachable", health.since!))) report.raised.push("mailbox_unreachable");
    });
  }
  return report;
}

/**
 * One round of the mail leg (3f design, section 7.2 step 2): every row of a kind whose mail is its sentence, not yet
 * mailed and younger than ALERT_RULES.mailRetryHours, whoever wrote it, mailed to every staff account and marked when an
 * address took it; a row nobody took is tried again next round, and then left. Each row in a try of its own. It never
 * mails a row of 3c's or 3e's kinds: their mails say more than the row's facts, and staffAlert sends them. Answers how
 * many rows it mailed.
 */
export async function alertMailLeg(deps: Pick<ModerationDeps, "apiDb" | "auth" | "log">): Promise<number> {
  let mailedRows = 0;
  try {
    const rows = await deps.apiDb.execute<{ id: string; kind: StaffAlertKind; facts: AlertFacts }>(sql`
      select id, kind, facts from public.alert_outbox
       where mailed_at is null and kind = any(${words(TICK_MAILED_KINDS)})
         and created_at > now() - make_interval(hours => ${ALERT_RULES.mailRetryHours})
       order by id`);
    for (const row of rows) {
      try {
        const mailed = await mailClaimed(deps, Number(row.id), { template: row.kind, facts: row.facts });
        if (typeof mailed === "number" && mailed > 0) mailedRows++;
        else if (mailed === 0) deps.log.warn({ job: ALERT_MAIL_JOB, alert: row.id, kind: row.kind }, "alert-mail: no staff address took an alert's mail; it is tried again next round");
      } catch (err) {
        deps.log.error({ err, job: ALERT_MAIL_JOB, alert: row.id }, "alert-mail: an alert's mail failed; it is tried again next round");
      }
    }
  } catch (err) {
    deps.log.error({ err, job: ALERT_MAIL_JOB }, "alert-mail: the rows owed their mail could not be read; the next round reads them again");
  }
  return mailedRows;
}

/** The alert tick as a job of the shared lock: a round ALERT_TICK_INTERVAL_MS after the last one ended, on one instance at a time. */
export function createAlertTick(deps: ModerationDeps, lock: JobLock) {
  return createJob({ name: ALERT_TICK_JOB, intervalMs: ALERT_TICK_INTERVAL_MS, lockTtlMs: ALERT_TICK_INTERVAL_MS, lock, log: deps.log, run: () => alertTick(deps) });
}

/** The mail leg as a job of the shared lock under a key of its own, at the tick's interval, so a slow relay holds only it. */
export function createAlertMailJob(deps: ModerationDeps, lock: JobLock) {
  return createJob({ name: ALERT_MAIL_JOB, intervalMs: ALERT_TICK_INTERVAL_MS, lockTtlMs: ALERT_TICK_INTERVAL_MS, lock, log: deps.log, run: () => alertMailLeg(deps) });
}
