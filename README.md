# EFL Fund Tracker

A small HTML + JavaScript app for our FPL mini-league money.

## Run it

**Recommended: keeps `data.json` up to date**
1. Install [Node.js](https://nodejs.org) (version 18 or newer). No packages are needed.
2. In this folder, run `npm start` (or `node server.js`).
3. Open http://localhost:3000.

Every change is written to `data.json` straight away. A backup copy is also kept in the browser.

**Quick: no server**
Double-click `index.html`. Data is then saved only inside that browser, and `data.json` is **not** changed, because web pages aren't allowed to write files on your disk. Use **Settings → Export JSON / Import JSON** to move data.

Switching from the double-click version to the server? Your data won't carry over by itself. Click **Export JSON** in the double-click version, then **Import JSON** at http://localhost:3000.

## Put it online
The server runs on any host that runs Node.js 18+ (Render, Railway, Fly.io, a VPS, …) or Docker. Configure it with environment variables:

| Variable | What it does |
|---|---|
| `EFL_PASSWORD` | **Needed online.** The browser asks for it once (any user name works). Without it, the server only answers the computer it runs on. |
| `DATA_FILE` | Where the data is saved, e.g. `/var/data/data.json`. Put it on the host's **persistent disk / volume**, because most hosts wipe other files on every restart or deploy. The first time, it starts as a copy of this folder's `data.json`. |
| `PORT` | Port to listen on. Hosting services set this themselves; the default is 3000. |
| `HOST` | Address to listen on. Default `0.0.0.0` when `EFL_PASSWORD` is set, otherwise `127.0.0.1`. |

**On a Node.js host:** create a web service from this repo with build command `npm install` and start command `npm start`. Add a persistent disk (for example mounted at `/var/data`), and set `EFL_PASSWORD` and `DATA_FILE=/var/data/data.json`. If the host asks for a health check path, use `/healthz`.

**With Docker:**
```sh
docker build -t efl .
docker run -d --name efl -p 3000:3000 -e EFL_PASSWORD=choose-a-password -v efl-data:/data efl
```
The data is kept in the `efl-data` volume, so it survives rebuilding the image.

Good to know:
- Open it over **https** (hosting services provide this) so the password isn't sent in plain text.
- Everyone with the password can change the data. If two people save at the same moment, the last save wins.
- Without a persistent disk the data is lost when the host restarts the app. The next browser that opens it writes its own backup copy back, but that copy may be out of date.

## Fetching points from FPL
On the Gameweek tab, **⬇ Fetch from FPL** fills in the current FPL gameweek's points from the league standings (league ID is in Settings). It only works through the server (`npm start`), because browsers block pages from calling the FPL site directly, so the server fetches it for the app.

- Players are matched to the league by their **FPL manager name** (`player_name`), so names in Settings must be spelled the same way.
- FPL's `event_total` does **not** take off transfer hits (−4, −8, …). So each fetch saves every player's league total for that gameweek (`fplSnapshots`), and a gameweek's points are **total now − total saved for the previous gameweek**. If no previous total was saved (first use, or a new player), it is taken once from the player's FPL history.
- If every total is still the same as after the previous gameweek, FPL hasn't updated yet, and nothing is filled in.
- A player's points are left for you to type in when their total hasn't moved, or when the numbers don't fit together (FPL's GW points minus our points must be 0, 4, 8, …). That usually means the previous gameweek was fetched before it finished.
- Points can change until FPL marks the gameweek as finished. Fetch again after the last match (and bonus), then press **Save gameweek**.

## Money rules
- Each of the 6 friends pays ₹100 per gameweek, so the weekly pot is ₹600.
- One quarter is 9 gameweeks, so the quarterly pool is ₹5,400. With 38 GWs, Q4 runs from GW 28 to 38.
- Weekly prizes: 1st ₹300, 2nd ₹200, 3rd ₹100.
- **Ties:** tied players add up the prizes for the places they share and split them equally.
  - Tie for 2nd: (200 + 100) / 2 = ₹150 each
  - Tie for 1st: (300 + 200) / 2 = ₹250 each, and the next player gets 3rd (₹100)
  - Tie for 3rd: 100 / 2 = ₹50 each

## Data format (`data.json`)
```json
{
  "version": 1,
  "settings": { "weeklyFee": 100, "prizes": [300, 200, 100], "gameweeksPerQuarter": 9, "totalGameweeks": 38, "fplLeagueId": 292599 },
  "players": [ { "id": "p1", "name": "Friend 1" } ],
  "gameweeks": [
    {
      "gw": 1,
      "scores": { "p1": 72, "p2": 65 },
      "paid":   { "p1": true, "p2": false },
      "fee": 100,
      "prizes": [300, 200, 100]
    }
  ],
  "fplSnapshots": {
    "3": { "totals": { "p1": 222 }, "from": "FPL history", "fetchedAt": "2026-09-15T10:00:00.000Z" },
    "4": { "totals": { "p1": 311 }, "eventTotals": { "p1": 93 }, "fetchedAt": "2026-09-15T10:05:00.000Z" }
  },
  "updatedAt": "2026-09-15T10:00:00.000Z"
}
```
`fplSnapshots` holds each player's FPL league total as last fetched for each gameweek (the example gives p1 93 − 4 hit = 89 points for GW 4).
Prizes are not stored. They are calculated from `scores` each time. Each gameweek keeps the `fee` and `prizes` it was saved with, so changing the settings later does not change past results. `updatedAt` records the last save. If `data.json` and the browser's copy differ (for example, because the server was stopped), the app uses whichever copy is newer.
