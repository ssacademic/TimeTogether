// Simple assertion-based test runner (no dependencies, runs with plain `node tests/core.test.js`).
const path = require('path');
const {
  localTimeParts, formatClock, utcOffsetMinutes, sunTimes,
  searchPlaces, UTC_OFFSETS,
  isFixedTz, fixedTzMinutes, makeFixedTz,
  SCORING, personHourCost, scoreInstant, suggestMeetingTimes,
  snapUpToHalfHour, roundToBetterMark
} = require(path.join(__dirname, '..', 'core.js'));

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', msg); }
}
function approx(a, b, eps, msg) {
  assert(Math.abs(a - b) < eps, `${msg} (got ${a}, expected ~${b})`);
}

// --- Time ---
const now = new Date('2026-08-21T12:00:00Z'); // fixed instant for deterministic tests
approx(localTimeParts('UTC', now).hourFloat, 12, 0.01, 'UTC noon should be hour 12');
approx(utcOffsetMinutes('Asia/Kolkata', now), 330, 0.5, 'India is UTC+5:30');
approx(utcOffsetMinutes('Asia/Kathmandu', now), 345, 0.5, 'Nepal is UTC+5:45 (quarter-hour offset)');
assert(formatClock('UTC', now).includes('12:00'), 'formatClock renders noon correctly');

// --- Sunrise/sunset sanity (August, so northern hemisphere summer, southern winter) ---
const tokyoSun = sunTimes(35.6762, 139.6503, 'Asia/Tokyo', now);
assert(tokyoSun.sunrise > 3 && tokyoSun.sunrise < 7, 'Tokyo August sunrise is early morning');
assert(tokyoSun.sunset > 17 && tokyoSun.sunset < 20, 'Tokyo August sunset is early evening');

const sydneySun = sunTimes(-33.8688, 151.2093, 'Australia/Sydney', now);
assert(sydneySun.sunrise > 5.5 && sydneySun.sunrise < 7.5, 'Sydney August (winter) sunrise is later');

// --- Search: the exact gaps reported by the user ---
const { PLACES } = require(path.join(__dirname, '..', 'data.js'));

assert(searchPlaces(PLACES, 'pune').some(p => p.name === 'Pune'), 'searching "pune" finds Pune');
assert(searchPlaces(PLACES, 'california').length >= 3, 'searching "california" (a US state) returns multiple CA cities');
assert(searchPlaces(PLACES, 'india').length >= 5, 'searching "india" (a country) returns multiple Indian cities');
assert(searchPlaces(PLACES, 'bay area').some(p => p.name === 'San Francisco'), 'alias "bay area" resolves to San Francisco');
assert(searchPlaces(PLACES, 'zzzznotaplace').length === 0, 'nonsense query returns no matches (caller should fall back to UTC offset picker)');
assert(UTC_OFFSETS.some(o => o.label === 'UTC+5:30'), 'manual UTC offset fallback list includes +5:30 for India-like offsets');

// Ranking check: exact name match should outrank a country-field match
const tokyoResults = searchPlaces(PLACES, 'tokyo');
assert(tokyoResults[0].name === 'Tokyo', 'exact city name match ranks first');

// --- Scoring: the core algorithmic behavior the user asked to be validated ---

// 1. Cost curve should have no "cliff": 8:59 and 9:01 should be close in cost.
const justBefore = personHourCost(8 + 59/60);
const justAfter = personHourCost(9 + 1/60);
assert(Math.abs(justBefore - justAfter) < 0.1, 'cost curve is smooth across the work-start boundary, not a cliff');

// 2. Squarely working hours = zero cost.
assert(personHourCost(13) === 0, 'midday local time has zero cost');

// 3. The specific failure mode raised by the user: does team size let SUM
//    (or any aggregate) "outvote" one severely-inconvenienced person?
//    We simulate by scoring a synthetic list of "people" via personHourCost directly
//    and confirm the blended score (matching scoreInstant's formula) resists this
//    regardless of how many mildly-inconvenienced people are added.
function blendedScoreOfHours(hours) {
  const costs = hours.map(h => personHourCost(h));
  const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
  const worst = Math.max(...costs);
  return SCORING.worstWeight * worst + (1 - SCORING.worstWeight) * avg;
}
for (const n of [2, 9, 20, 40]) {
  const oneSuffers = [...Array(n - 1).fill(13), 3];      // n-1 perfect, 1 person at 3am
  const allMild = Array(n).fill(19);                      // everyone mildly late (7pm)
  const scoreA = blendedScoreOfHours(oneSuffers);
  const scoreB = blendedScoreOfHours(allMild);
  assert(scoreB < scoreA, `at team size ${n}, blended score still prefers "everyone mildly inconvenienced" over "one person woken at 3am" (got A=${scoreA.toFixed(2)} B=${scoreB.toFixed(2)})`);
}

// 4. Tie-break sanity: same worst-off cost, but the rest of the team differs —
//    score should prefer the slot where everyone else is doing better.
const slotRestGreat = blendedScoreOfHours([9, 9, 9, 3]);
const slotRestBad = blendedScoreOfHours([23, 23, 23, 3]);
assert(slotRestGreat < slotRestBad, 'when worst-off cost ties, the slot with a better outcome for everyone else scores lower (better)');

// --- suggestMeetingTimes integration test ---
const people = [
  { id: 'a', name: 'Amy', tz: 'America/Los_Angeles' },
  { id: 'b', name: 'Raj', tz: 'Asia/Kolkata' },
  { id: 'c', name: 'Lena', tz: 'Europe/Berlin' },
];
const suggestions = suggestMeetingTimes(people, now, 3);
assert(suggestions.length > 0 && suggestions.length <= 3, 'suggestMeetingTimes returns up to 3 slots');
assert(suggestions.every((s, i) => i === 0 || s.score >= suggestions[i-1].score), 'suggestions are sorted best-first');
assert(suggestions[0].worstPerson, 'each suggestion identifies the worst-affected person, for UI transparency');
// slots should be spread out, not clustered within 90 min of each other
for (let i = 1; i < suggestions.length; i++) {
  const gapMin = Math.abs(suggestions[i].instant - suggestions[0].instant) / 60000;
  assert(gapMin >= 90, 'suggested slots are de-duplicated (not all clustered around one peak)');
}

// --- Manual fixed-offset fallback (requirement: let people add someone even
// when city search fails). Must support fractional-hour offsets, which
// Intl's Etc/GMT zones do NOT support (that was an actual bug caught during
// review — Etc/GMT only accepts whole hours). ---
const halfHourTz = makeFixedTz(330);   // +5:30, e.g. India-like offset
const quarterHourTz = makeFixedTz(345); // +5:45, e.g. Nepal-like offset
assert(isFixedTz(halfHourTz), 'makeFixedTz produces a string isFixedTz recognizes');
assert(fixedTzMinutes(halfHourTz) === 330, 'fixedTzMinutes round-trips correctly');

const refUTC = new Date('2026-08-21T12:00:00Z');
approx(localTimeParts(halfHourTz, refUTC).hourFloat, 17.5, 0.01, 'fixed +5:30 offset at UTC noon = 17:30 local');
approx(localTimeParts(quarterHourTz, refUTC).hourFloat, 17.75, 0.01, 'fixed +5:45 offset at UTC noon = 17:45 local (quarter-hour, would break Etc/GMT)');
assert(formatClock(halfHourTz, refUTC) === '5:30 PM', 'formatClock renders fixed-offset time correctly');
assert(utcOffsetMinutes(halfHourTz, refUTC) === 330, 'utcOffsetMinutes returns the fixed offset directly');

const fixedSun = sunTimes(0, 0, halfHourTz, refUTC);
assert(fixedSun.sunrise === null && fixedSun.sunset === null, 'a fixed-offset person (no real coordinates) gets no fabricated sunrise/sunset');

// scoreInstant should work transparently with a fixed-offset person mixed into a real group
const mixedPeople = [
  { id: 'a', name: 'Amy', tz: 'America/Los_Angeles' },
  { id: 'b', name: 'Manual Offset Person', tz: makeFixedTz(60) },
];
const mixedScore = scoreInstant(mixedPeople, refUTC);
assert(mixedScore.perPerson.length === 2, 'scoreInstant handles a mix of real IANA zones and manual fixed offsets');

// --- Clean-time rounding for meeting suggestions (requirement: suggestions
// should land on :00 or :30, never an odd minute like "7:07 PM" — because
// suggestMeetingTimes is normally called with `new Date()`, whose seconds
// are essentially random). ---

approx(snapUpToHalfHour(new Date('2026-08-21T14:00:00Z')).getTime(), new Date('2026-08-21T14:00:00Z').getTime(), 1, 'snapUpToHalfHour leaves an already-clean instant unchanged');
approx(snapUpToHalfHour(new Date('2026-08-21T14:00:01Z')).getTime(), new Date('2026-08-21T14:30:00Z').getTime(), 1, 'snapUpToHalfHour rounds 14:00:01 up to 14:30:00');
approx(snapUpToHalfHour(new Date('2026-08-21T14:37:22Z')).getTime(), new Date('2026-08-21T15:00:00Z').getTime(), 1, 'snapUpToHalfHour rounds an arbitrary odd time up to the next clean mark');

const oddNow = new Date('2026-08-21T14:37:22Z'); // realistic `new Date()` call, odd seconds
const twoPeople = [
  { id: 'a', name: 'Amy', tz: 'America/Los_Angeles' },
  { id: 'b', name: 'Raj', tz: 'Asia/Kolkata' },
];
const suggestionsClean = suggestMeetingTimes(twoPeople, oddNow, 3);
suggestionsClean.forEach(s => {
  assert(s.instant.getTime() % (30 * 60000) === 0, `suggested instant ${s.instant.toISOString()} lands on a clean :00/:30 UTC mark`);
  const amyClock = formatClock('America/Los_Angeles', s.instant);
  const rajClock = formatClock('Asia/Kolkata', s.instant);
  assert(/:00 |:30 /.test(amyClock), `Amy's displayed time "${amyClock}" is on a clean half-hour mark (whole-hour-offset zone)`);
  assert(/:00 |:30 /.test(rajClock), `Raj's displayed time "${rajClock}" is on a clean half-hour mark (India's +5:30 offset is itself a multiple of 30 min)`);
});

// roundToBetterMark: picks whichever neighboring clean mark scores better,
// not just whichever is nearer in time.
const uneven = new Date('2026-08-21T15:47:00Z'); // between 15:30 and 16:00
const rounded = roundToBetterMark(twoPeople, uneven, SCORING);
assert(rounded.getTime() % (30 * 60000) === 0, 'roundToBetterMark always returns a clean :00/:30 mark');
assert([new Date('2026-08-21T15:30:00Z').getTime(), new Date('2026-08-21T16:00:00Z').getTime()].includes(rounded.getTime()), 'roundToBetterMark returns one of the two neighboring clean marks');
const alreadyClean = new Date('2026-08-21T16:00:00Z');
assert(roundToBetterMark(twoPeople, alreadyClean, SCORING).getTime() === alreadyClean.getTime(), 'roundToBetterMark leaves an already-clean instant unchanged');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
