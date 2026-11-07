/**
 * Smart assignment: every tunable number in ONE file. A score is 0-100 = the sum of the four weighted factors.
 * Nothing here is learned silently: the nightly job refreshes the RATES (lead_assignment_stats); these are the rules.
 */
export const WEIGHTS = {
  /** This person's rate of moving leads like this one to Qualified or beyond (destination-aware when the lead has one). */
  fit: 35,
  /** Room: 1 - held open leads / (role median x ROOM_FACTOR), clamped 0..1. */
  room: 30,
  /** Speed: median minutes from "reached them" to first CONTACT (lib/contact.ts: activity or human note). */
  speed: 20,
  /** Present: clocked in today, or any contact in the last 2 hours. */
  present: 15,
} as const;

/** Fit smoothing: a person's destination rate is pulled toward their overall rate as if they had this many extra leads (and their overall rate toward the team's). */
export const FIT_PRIOR = 10;
/** Room: how many times the role's median load a person may carry before Room reaches 0. */
export const ROOM_FACTOR = 1.5;
/** Speed: at or under FAST minutes = full marks, at or over SLOW minutes = zero, linear between. */
export const SPEED_FAST_MIN = 30;
export const SPEED_SLOW_MIN = 24 * 60;
/** A person's own speed needs at least this many first-contact samples; below it the team's median is used. */
export const MIN_SPEED_SAMPLES = 5;
/** The why-line cites a person's Fit only when it rests on at least this many of their leads. */
export const MIN_FIT_SAMPLES = 5;
/** ...and their Speed only when it rests on at least this many first-contact samples. */
export const MIN_SPEED_EVIDENCE = 3;
/** Hard filter "dormant": no lead activity and no human note by this person in this many days. */
export const DORMANT_DAYS = 14;
/** The first-touch positions are learned from who received new leads in this many days, covering at least this share. */
export const LEARN_DAYS = 60;
export const LEARN_COVERAGE = 0.8;
/** Neutral Speed score (0..1) when neither the person nor the team has data. */
export const SPEED_UNKNOWN = 0.5;
/** Today's cap: a person's fair share of today's leads, plus this much. */
export const CAP_SLACK = 0.5;
/** "Present" without attendance data: any contact within this many hours. */
export const PRESENT_ACTIVITY_HOURS = 2;
/**
 * A tenant "uses attendance" only if, in the last 30 days, there are at least this many attendance records from at least
 * this many different people. Below it (Admizz: 1 record in 30 days) Present falls back to recent activity.
 */
export const ATTENDANCE_MIN_RECORDS = 30;
export const ATTENDANCE_MIN_PEOPLE = 3;
/** Stats windows (kept in step with education_assignment_stats_refresh). */
export const STATS_DAYS = 120;
export const SPEED_DAYS = 30;
