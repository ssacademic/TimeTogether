// ============================================================================
// core.js — pure logic, no DOM access. Kept separate so it can be unit-tested
// (see /tests) and reasoned about independently of rendering.
// ============================================================================

/* ---------------------------------------------------------------------------
 * TIME
 * -------------------------------------------------------------------------*/

/**
 * How "current time" is calculated for each person:
 * 1. We always start from the single true moment `new Date()` (i.e. UTC "now",
 *    the same instant everywhere).
 * 2. For each person, we ask the browser's Intl API to render that instant in
 *    their IANA timezone (e.g. "Asia/Kolkata"). Intl.DateTimeFormat handles
 *    daylight saving time correctly for us — we never hardcode a UTC offset.
 * 3. The result is their local wall-clock hour, used to position the bubble
 *    and to compute day/night + meeting-friendliness.
 * This means a person's row updates correctly across DST changes automatically,
 * as long as their IANA zone (e.g. "America/New_York") is correct — that's why
 * every place in the dataset stores a real IANA zone rather than a fixed offset.
 */

/**
 * "Fixed:<minutes>" is our own convention for a manually-chosen UTC offset
 * (used by the "can't find their city" fallback). Real IANA zones (e.g.
 * "Asia/Kolkata") support fractional-hour offsets like +5:30 or +5:45 via
 * Intl automatically, but Intl's Etc/GMT zones only support whole hours —
 * so manual offsets are handled with plain arithmetic instead, which works
 * for any offset including quarter-hours, and skips DST (documented in the UI).
 */
const FIXED_TZ_PREFIX = 'Fixed:';
function isFixedTz(tz) { return typeof tz === 'string' && tz.startsWith(FIXED_TZ_PREFIX); }
function fixedTzMinutes(tz) { return parseInt(tz.slice(FIXED_TZ_PREFIX.length), 10); }
function makeFixedTz(offsetMinutes) { return FIXED_TZ_PREFIX + offsetMinutes; }

/** Returns { hourFloat, hh, mm } — local wall-clock time in `tz` at instant `date`. */
function localTimeParts(tz, date) {
  if (isFixedTz(tz)) {
    const totalMin = (date.getTime() / 60000 + fixedTzMinutes(tz));
    const minsInDay = ((Math.floor(totalMin) % 1440) + 1440) % 1440;
    const hh = Math.floor(minsInDay / 60);
    const mm = minsInDay % 60;
    return { hourFloat: hh + mm / 60, hh, mm };
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = fmt.formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const hh = parseInt(parts.hour, 10) % 24;
  const mm = parseInt(parts.minute, 10);
  const ss = parseInt(parts.second, 10);
  return { hourFloat: hh + mm / 60 + ss / 3600, hh, mm };
}

/** Human-readable "3:45 PM" style clock string in `tz`. */
function formatClock(tz, date) {
  if (isFixedTz(tz)) {
    const { hh, mm } = localTimeParts(tz, date);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
  }).format(date);
}

/** Minutes offset of `tz` from UTC at instant `date` (handles DST for real IANA zones). */
function utcOffsetMinutes(tz, date) {
  if (isFixedTz(tz)) return fixedTzMinutes(tz);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = fmt.formatToParts(date).reduce((acc, x) => { acc[x.type] = x.value; return acc; }, {});
  const hour24 = p.hour === '24' ? 0 : p.hour;
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, hour24, p.minute, p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * Approximate local sunrise/sunset hour-of-day for shading only (not precision
 * astronomy). Returns null for either value during polar day/night.
 */
function sunTimes(lat, lon, tz, date) {
  // A manually-added person (fixed offset, no real coordinates) has no
  // meaningful sunrise/sunset — the row falls back to a flat neutral shade
  // rather than pretending lat=0,lon=0 (the Gulf of Guinea) is their sky.
  if (isFixedTz(tz)) return { sunrise: null, sunset: null };
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((date - start) / 86400000);
  const zenith = 90.833 * Math.PI / 180;
  const latRad = lat * Math.PI / 180;

  function calc(isSunrise) {
    const lngHour = lon / 15;
    const t = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
    const M = (0.9856 * t) - 3.289;
    const Mrad = M * Math.PI / 180;
    let L = M + (1.916 * Math.sin(Mrad)) + (0.020 * Math.sin(2 * Mrad)) + 282.634;
    L = ((L % 360) + 360) % 360;
    const Lrad = L * Math.PI / 180;
    let RA = Math.atan2(0.91764 * Math.tan(Lrad), 1) * 180 / Math.PI;
    RA = ((RA % 360) + 360) % 360;
    const Lquadrant = Math.floor(L / 90) * 90;
    const RAquadrant = Math.floor(RA / 90) * 90;
    RA = (RA + (Lquadrant - RAquadrant)) / 15;
    const sinDec = 0.39782 * Math.sin(Lrad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(zenith) - (sinDec * Math.sin(latRad))) / (cosDec * Math.cos(latRad));
    if (cosH > 1 || cosH < -1) return null; // sun never rises/sets that day at this latitude
    let H = isSunrise ? 360 - (Math.acos(cosH) * 180 / Math.PI) : (Math.acos(cosH) * 180 / Math.PI);
    H = H / 15;
    const T = H + RA - (0.06571 * t) - 6.622;
    let UT = T - lngHour;
    return ((UT % 24) + 24) % 24;
  }

  const sunriseUTC = calc(true);
  const sunsetUTC = calc(false);
  const offsetH = utcOffsetMinutes(tz, date) / 60;
  const toLocal = (utcH) => utcH === null ? null : (((utcH + offsetH) % 24) + 24) % 24;
  return { sunrise: toLocal(sunriseUTC), sunset: toLocal(sunsetUTC) };
}

/* ---------------------------------------------------------------------------
 * SEARCH
 * A place matches a query if the query is found in its name, country, admin
 * region (state/province), or any alias — so "california", "pune", "india",
 * and "bay area" all resolve. Results are ranked so exact/prefix name matches
 * beat matches found only in a country or alias field.
 * -------------------------------------------------------------------------*/

function searchPlaces(places, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored = [];
  for (const place of places) {
    const name = place.name.toLowerCase();
    const country = (place.country || '').toLowerCase();
    const admin = (place.admin || '').toLowerCase();
    const aliases = (place.aliases || []).map(a => a.toLowerCase());

    let score = -1;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 90;
    else if (name.includes(q)) score = 70;
    else if (aliases.some(a => a === q)) score = 65;
    else if (aliases.some(a => a.includes(q))) score = 55;
    else if (admin.startsWith(q)) score = 45;
    else if (admin.includes(q)) score = 35;
    else if (country.startsWith(q)) score = 30;
    else if (country.includes(q)) score = 20;

    if (score > 0) scored.push({ place, score });
  }

  scored.sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name));
  return scored.slice(0, limit).map(s => s.place);
}

/**
 * Common UTC-offset fallback list, used when someone can't find their city.
 * Lets anyone add a person by offset alone (see requirement: manual time entry
 * as a fallback to search). Not DST-aware — flagged in the UI as approximate.
 */
const UTC_OFFSETS = [];
for (let m = -720; m <= 840; m += 30) {
  const h = m / 60;
  const sign = h >= 0 ? '+' : '-';
  const abs = Math.abs(h);
  const hh = Math.floor(abs);
  const mm = Math.round((abs - hh) * 60);
  const label = `UTC${sign}${hh}${mm ? ':' + String(mm).padStart(2, '0') : ''}`;
  UTC_OFFSETS.push({ minutes: m, label });
}

/* ---------------------------------------------------------------------------
 * MEETING-TIME SCORING
 *
 * Goal: given a group of people (each with a timezone), suggest good times to
 * meet, without either of two failure modes:
 *   (a) a plain SUM of "how bad is this hour for each person" lets a large
 *       group's small conveniences outvote one person's severe inconvenience
 *       (e.g. it can rate waking one teammate at 3am as *better* than a slot
 *       where 20 people are each an hour later than ideal — worked through
 *       with worked examples before choosing this formula; see /tests).
 *   (b) a plain MAX (only look at the worst-off person) ignores the group
 *       entirely once the worst person is fixed, so it can't tell a slot
 *       where everyone else is great apart from that one person, from a slot
 *       where everyone else is *also* bad.
 *
 * Fix: score = a blend, weighted toward the worst-off person, so no team size
 * can dilute one person's bad slot into looking fine, while the average still
 * breaks ties between slots that are equally bad for the worst person.
 * -------------------------------------------------------------------------*/

const SCORING = {
  workStart: 9,   // 9am
  workEnd: 18,    // 6pm
  dayStart: 7,    // treated as "awake" from 7am
  dayEnd: 22,     // to 10pm
  worstWeight: 0.65 // how much the worst-affected person dominates the score
};

/**
 * Cost of a given local hour for one person. 0 = squarely in working hours.
 * The curve is smooth (no cliffs) so 8:59am and 9:01am aren't treated as
 * night-and-day different — a hard cutoff is exactly the kind of "synthetic,
 * rigid" scoring that produces silly rankings.
 */
function personHourCost(hourFloat, opts = SCORING) {
  const { workStart, workEnd, dayStart, dayEnd } = opts;
  if (hourFloat >= workStart && hourFloat < workEnd) return 0;

  const distToStart = Math.abs(hourFloat - workStart);
  const distToEnd = Math.abs(hourFloat - workEnd);
  let dist = Math.min(distToStart, distToEnd);
  dist = Math.min(dist, 24 - dist); // wrap around midnight

  const isAwake = hourFloat >= dayStart && hourFloat < dayEnd;
  if (isAwake) return dist * 0.35;               // outside work but awake: gentle ramp
  return 1.2 + dist * 0.9;                        // asleep: steep, plus a flat "waking someone" penalty
}

/**
 * Rounds an instant up to the next clean half-hour mark in UTC (`:00` or
 * `:30`). Used so every candidate meeting time we ever score or suggest
 * lands on a clean clock mark for people on whole- or half-hour UTC offsets
 * (the vast majority), rather than on whatever odd minute `new Date()`
 * happened to return (e.g. "7:07 PM").
 */
function snapUpToHalfHour(date) {
  const halfHourMs = 30 * 60000;
  const remainder = date.getTime() % halfHourMs;
  return remainder === 0 ? new Date(date.getTime()) : new Date(date.getTime() + (halfHourMs - remainder));
}

/**
 * Scores one candidate UTC instant for a list of people.
 * Returns { instant, score, avg, worst, worstPerson, perPerson: [{personId, cost, hour}] }
 */
function scoreInstant(people, instant, opts = SCORING) {
  const perPerson = people.map(p => {
    const { hourFloat } = localTimeParts(p.tz, instant);
    const cost = personHourCost(hourFloat, opts);
    return { personId: p.id, name: p.name, hour: hourFloat, cost };
  });
  const avg = perPerson.reduce((s, x) => s + x.cost, 0) / (perPerson.length || 1);
  const worstEntry = perPerson.reduce((a, b) => (b.cost > a.cost ? b : a), perPerson[0] || { cost: 0 });
  const worst = worstEntry ? worstEntry.cost : 0;
  const score = opts.worstWeight * worst + (1 - opts.worstWeight) * avg;
  return { instant, score, avg, worst, worstPerson: worstEntry ? worstEntry.name : null, perPerson };
}

/**
 * Given any instant (not necessarily on a clean mark), returns whichever of
 * the nearest clean half-hour marks (the one at/before it, or the one after)
 * scores better for the group — "round on the side of better score" rather
 * than always rounding to nearest-in-time. If the instant is already on a
 * clean mark, it's returned unchanged.
 */
function roundToBetterMark(people, instant, opts = SCORING) {
  const halfHourMs = 30 * 60000;
  const ms = instant.getTime();
  const remainder = ms % halfHourMs;
  if (remainder === 0) return instant;
  const down = new Date(ms - remainder);
  const up = new Date(down.getTime() + halfHourMs);
  const scoreDown = scoreInstant(people, down, opts).score;
  const scoreUp = scoreInstant(people, up, opts).score;
  return scoreDown <= scoreUp ? down : up;
}

/**
 * Suggests the best meeting slots for a group over the next 24h, sampled on
 * a clean 30-minute grid (:00 and :30 marks only — see snapUpToHalfHour), so
 * every suggestion is a time a human would actually propose (e.g. "5:00 PM",
 * "6:30 AM"), never an odd minute like "7:07 PM". Returns the top `topN`
 * distinct slots, sorted best first.
 */
function suggestMeetingTimes(people, fromDate = new Date(), topN = 3, opts = SCORING) {
  if (!people.length) return [];
  const gridStart = snapUpToHalfHour(fromDate);
  const candidates = [];
  for (let stepMin = 0; stepMin < 24 * 60; stepMin += 30) {
    const instant = new Date(gridStart.getTime() + stepMin * 60000);
    candidates.push(scoreInstant(people, instant, opts));
  }
  candidates.sort((a, b) => a.score - b.score);

  // De-duplicate slots that are within 90 minutes of an already-picked, better slot,
  // so we don't show three near-identical options clustered around one peak.
  const picked = [];
  for (const c of candidates) {
    if (picked.length >= topN) break;
    const tooClose = picked.some(p => Math.abs(p.instant - c.instant) < 90 * 60000);
    if (!tooClose) picked.push(c);
  }
  return picked;
}

// Export for both browser (global) and Node (tests) use.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    localTimeParts, formatClock, utcOffsetMinutes, sunTimes,
    searchPlaces, UTC_OFFSETS,
    isFixedTz, fixedTzMinutes, makeFixedTz,
    SCORING, personHourCost, scoreInstant, suggestMeetingTimes,
    snapUpToHalfHour, roundToBetterMark
  };
}
