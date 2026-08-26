# TimeTogether

A single-page, no-backend app that shows where your teammates are in their day — right now — as bubbles moving along 24-hour timelines, grouped into panels you define (e.g. "Design Team", "Calls with Acme").

## What changed in this version
- **Add person is always available**, not just when a group is empty (was a real bug — the button only existed in the empty-state screen).
- **Search is richer**: type a city, a state/province ("California", "Maharashtra"), or a country ("India") and matching cities show up. 179 places covering every populated timezone, including explicit coverage for previously-missing spots like Pune.
- **Manual time zone fallback**: if someone's town truly isn't in the list, "Can't find their city? Set time zone manually" lets you pick a UTC offset directly (including quarter-hour offsets like +5:45) instead of getting stuck.
- **"✨ Suggest meeting times"**: appears once a group has 2+ people (counting you, if you've set up your info). Suggests slots ranked to avoid badly hurting any one person, always rounded to a clean half-hour mark — see "How meeting times are scored" below.
- **You're a permanent person**: a one-time "What's your name and city?" step (skippable, editable later from the settings gear) pins you at the top of every group, so you don't have to re-add yourself each time.
- **Light/dark theme toggle**, higher-contrast rows in dark mode, a sort-by-time toggle to reorder rows earliest-to-latest, tab overflow fade indicators, full AM/PM hour labels, and a clearer trash-icon remove action.
- **Restructured into modules** (`core.js` / `data.js` / `app.js` / `style.css`) instead of one large HTML file, with a real unit test suite.

## Project structure
```
index.html   — page shell, loads the other files
style.css    — all styling, light + dark theme via CSS variables
data.js      — the place/city dataset (name, country, state, timezone, lat/lon, aliases)
core.js      — pure logic: time math, search, scoring. No DOM access — testable standalone.
app.js       — state management + rendering, built on core.js
tests/
  core.test.js — unit tests for core.js (run with plain `node`, no dependencies)
```

## Run it locally
Open `index.html` in any browser — no build step, no install. (It loads `data.js`, `core.js`, `app.js` as separate `<script>` tags, so if you're opening the file directly via `file://` in a strict browser setup, a quick local server avoids any script-loading quirks: `python3 -m http.server` from this folder, then visit `http://localhost:8000`.)

## Run the tests
```
node tests/core.test.js
```
No install needed. Currently 49 checks covering: DST-correct time math, sunrise/sunset sanity, search matching (including the exact "Pune"/"California"/"India" cases), the meeting-time scoring formula, the manual fixed-offset fallback, and clean half-hour rounding for suggestions (see below).

## How "current time" is calculated
Every person's row is driven from one true instant (`new Date()`, i.e. right now in UTC). For each person, that instant is rendered into their timezone using the browser's built-in `Intl.DateTimeFormat` — the same mechanism your OS uses — which automatically accounts for daylight saving time. Nothing is hardcoded as a fixed offset for real cities, so rows stay correct across DST changes without any manual updating. People added via the manual offset fallback are the one exception: they use a fixed offset by design (there's no city to look up DST rules for), and the UI labels this clearly.

## How meeting times are scored
This took some real back-and-forth to get right, worth explaining.

A simple approach would give every hour of the day a "cost" per person (0 = comfortably in working hours, higher = more inconvenient/asleep) and just sum the costs across the team, picking the slot with the lowest total. The problem: at large enough team sizes, that sum can rate "wake one teammate at 3am" as *better* than "everyone is mildly annoyed" — because one person's real pain gets diluted across everyone else's tiny convenience. We checked this by hand with worked examples (in the test suite) before shipping anything, and confirmed a plain sum flips to the wrong answer once a team crosses roughly 15-20 people.

The fix: each candidate time slot is scored as **0.65 × (worst-affected person's cost) + 0.35 × (average cost)**. Weighting the worst-off person heavily means no amount of team size can "outvote" someone being badly inconvenienced, while the average still breaks ties between two slots that are equally bad for whoever's worst off. The per-person cost curve is also deliberately smooth (no hard 9:00am cutoff) so 8:59 and 9:01 aren't treated as night-and-day different.

We also checked an even 0.5/0.5 split, since it's a reasonable alternative: both weights avoid the team-size problem above at every size tested. The real difference is subtler — 0.65 makes the worst-off person dominate the ranking more (more predictable, less swayed by the rest of the team), while 0.5 lets the rest of the team's comfort matter more when the worst-off person is roughly tied between two options. We kept 0.65 for predictability, but 0.5 is a defensible choice too if you'd rather the group's overall comfort carry more weight.

Each suggested slot in the UI names who it's hardest on, so the ranking isn't a black box.

**Suggestions always land on a clean time** — "5:00 PM", "6:30 AM" — never an odd minute like "7:07 PM". This wasn't automatic: candidate times are generated starting from `new Date()`, whose seconds are essentially random, so a naive 30-minute step from "now" drifts onto odd minutes immediately. The fix rounds the starting point up to the next clean half-hour mark before searching, and a separate `roundToBetterMark()` helper is available for rounding any instant to whichever neighboring clean mark scores better for the group (rather than whichever is merely closer in time), per your ask to round on the side of the better score. One honest limitation: this guarantees clean minutes for people whose timezone offset is a multiple of 30 minutes from UTC (the vast majority — all of the US, Europe, India, etc.), but a person on a quarter-hour offset (Nepal's UTC+5:45 is the main real-world case) will still see their own clock land on `:15`/`:45` — that's the best achievable outcome without breaking cleanliness for everyone else on the call.

## Data & privacy
Everyone's people/groups (and your own "me" info) are stored in **your own browser's localStorage** — nothing is sent to a server (there is no server). This means:
- Data is per-browser, per-device. If you open the app on your phone, it starts empty, including your own profile.
- Use the **export (⇩, in the settings gear)** button to save a `.json` backup, and **import (⇧)** to load it on another device or share your groups with a teammate who wants the same setup.
- Clearing browser data / private browsing will wipe it.

## Host it free on GitHub Pages
1. Create a new GitHub repo (public or private).
2. Add `index.html`, `style.css`, `data.js`, `core.js`, `app.js` to the repo root.
3. Commit and push.
4. In the repo: **Settings → Pages → Source → Deploy from branch → main → / (root)**.
5. Wait ~1 minute — GitHub gives you a URL like `https://yourname.github.io/repo-name/`.

## What's next (not in this version, on purpose)
- Shared/synced data across people, not just per-browser
- Calendar export (.ics) for a chosen suggested time
- Proper photo upload instead of pasting a URL
- A wider/community-editable city list
- Per-person custom working-hours (currently a fixed 9am–6pm assumption for everyone)
