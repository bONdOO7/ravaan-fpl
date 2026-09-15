# EFL Fund Tracker

A small HTML + JavaScript app for our FPL mini-league money.

## Run it

**Recommended: keeps `data.json` up to date**
1. Install [Node.js](https://nodejs.org) (any recent version). No packages are needed.
2. In this folder, run `node server.js`.
3. Open http://localhost:3000.

Every change is written to `data.json` straight away. A backup copy is also kept in the browser.

**Quick: no server**
Double-click `index.html`. Data is then saved only inside that browser, and `data.json` is **not** changed, because web pages aren't allowed to write files on your disk. Use **Settings → Export JSON / Import JSON** to move data.

Switching from the double-click version to the server? Your data won't carry over by itself. Click **Export JSON** in the double-click version, then **Import JSON** at http://localhost:3000.

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
  "settings": { "weeklyFee": 100, "prizes": [300, 200, 100], "gameweeksPerQuarter": 9, "totalGameweeks": 38 },
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
  "updatedAt": "2026-09-15T10:00:00.000Z"
}
```
Prizes are not stored. They are calculated from `scores` each time. Each gameweek keeps the `fee` and `prizes` it was saved with, so changing the settings later does not change past results. `updatedAt` records the last save. If `data.json` and the browser's copy differ (for example, because the server was stopped), the app uses whichever copy is newer.
