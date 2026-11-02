# Featherbone — demo video: phase 0 spike results

**31 Oct 2026. Verdict: GO for cloud recording.** The browser-pane fallback is not needed. Proof clip: `spike-login-dashboard.mp4` (14 s, 1920×1080, H.264 + AAC, ryan-high line, burned-in caption), sent in the conversation of 31 Oct.

## What was proven

| Step | Result |
| --- | --- |
| Replica | Postgres 16 in the cloud session; framework `jrogelstad/featherbone` @ `4254fef` (3.0.0-alpha.14); SupplyChain `jrogelstad/SupplyChain` @ `fa91353` (2.2.47); JobShop `jrogelstad/JobShop` @ `399a596` (2.3.8). Module versions identical to John's `demo`. |
| Install route | `node install.js --package <dir>` then `--deploy <Module>@<ver> --instance demo`. Money columns come out `mono` (checked `sales_order`, `invoice`), so the old `--dir` trap (plan 0.11) does not apply to Deploy. |
| Data | `load.js --clear --yes --script teardrop-campers.sql --db demo`: 271,109 rows, closing checks pass, about 25 s. Counts match John's `demo` exactly (SO 1141, WO 7519, PO 565, invoices 955 / $14,289,700, inventory qty 5652.55, 51 region states), except John's has +2 supply / +1 demand / +2 allocations from his own planning runs on 31 Oct 07:45. Allocations in John's `demo` are clean (0 mismatches), so the 28 Oct reload has been done. |
| Clock | libfaketime (apt `faketime`), **relative offset** `FAKETIME=+Ns` computed to land on 2027-06-01 08:00 America/Toronto, `FAKETIME_DONT_FAKE_MONOTONIC=1`, preloaded into the postmaster and into `node server.js`. Browser: Playwright `page.clock.install({time})` + `timezoneId: America/Toronto`. Dashboard reads "As of June 1, 2027 · Figures rebuilt 8:02 AM"; time flows normally from 08:00. |
| Recording | Playwright `recordVideo` at 1920×1080 (VP8 webm, 25 fps), re-encoded to H.264 `-preset veryfast -crf 20`. Readable at full size. 1600 px wide clips values in Operations metrics; record at 1920. |
| Pointer | Headless video has no cursor: an injected SVG pointer plus an orange click ring, appended to `document.documentElement` (Mithril mounts on `body` and wipes anything there). Moves use `mouse.move(..., {steps: 25})`. |
| Voice | Piper `en-us-ryan-high` from the GitHub release `rhasspy/piper v0.0.2` (`voice-en-us-ryan-high.tar.gz`, 105 MB), `pip install piper-tts`. Normalized with `loudnorm I=-16 TP=-1.5`. |
| Timing | Narration placed with `adelay`; `silencedetect` confirms speech 1.0–7.1 s, ending as the dashboard appears (7.1 s). This is the timing check for every later step. |

## Setup gotchas found

- `fileUpload: true` is needed in `config.json`, or JobShop's `job-shop-icon.svg` and the dashboard backdrop `job-shop-dashboard.png` 404 (they live in `files/upload/`; copied from the JobShop repo's `icon.svg` / `dashboard.png`).
- Set the instance marker to prod (`update "$db" set mode='prod'`) or the orange DEVELOPMENT SYSTEM banner is in every frame. `--mode dev` was used at install.
- The dashboard rollup is empty after a load. A setup pass (not filmed) signs in and presses **Refresh** on the Home ribbon before the filmed pass.
- Don't `pkill -f "node server.js"` from the session shell: it matches the shell's own command line and kills it. `kill $(pgrep -x node)`.
- The install creates organization "Default"; John's is Road Runner Campers. Not visible on the dashboard; check in phase 1 whether it shows anywhere.

## Data notes for phase 2 / phase 3 (seed)

1. **Future-dated sales orders** — 87 open orders have order dates after 2027-06-01 (June 36, July 22, Aug 16, Sept 13, latest 2027-09-07). **John, 31 Oct: fix in the seed.**
2. **Overdue purchase backlog** — 213 of 237 open PO lines are due before 1 June (due range 2027-04-30 to 06-04), so the dashboard shows Overdue Purchase Backlog $818,104 of $823,084. Confirmed in the data. Likely wants re-dating in the seed so purchasing has a believable open book.
3. **Revenue YTD by region** shows South, West, Midwest only (= the full $4,581,500); Northeast has no 2027 revenue, though the plan expected "Northeast smallest". To check.
4. **Top 5: Inventory value by product category** lists a category shown as `1b9739c13491` (an id, not a name). Not found in `item_category` by id or code; to trace in phase 1.
5. (Resolved 31 Oct.) A backup restore briefly left the data files in a nested `scripts/dev/dev/`; John fixed it, and `scripts/dev/demo-data/` is back where the README expects it.

## Rebuild recipe (the container is ephemeral)

```bash
# Postgres 16
mkdir -p /var/lib/pgtest && chown postgres /var/lib/pgtest; echo postgres > /var/lib/pgtest/pw; chown postgres /var/lib/pgtest/pw
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/pgtest/data -U postgres --pwfile=/var/lib/pgtest/pw -A md5"
# start (see clock.sh below for the faked start), then:
psql -h 127.0.0.1 -U postgres -c "create role admin login createdb superuser password 'password'"
# Framework
git clone --depth 1 https://github.com/jrogelstad/featherbone ~/jrogelstad/featherbone && cd ~/jrogelstad/featherbone && npm install
# server/config.json: clientPort 3003, debug true, pgUser admin/password, pgCryptoKey, secret, fileUpload true
node install.js --manager && node install.js --instance demo --mode dev
node install.js --package ~/supplychain && node install.js --deploy SupplyChain@2.2.47 --instance demo
node install.js --package ~/jobshop && node install.js --deploy JobShop@2.3.8 --instance demo
cp ~/jobshop/icon.svg files/upload/job-shop-icon.svg; cp ~/jobshop/dashboard.png files/upload/job-shop-dashboard.png
# stage teardrop-campers.sql, demo-settings.sql and load.js from John's disk (scripts/dev/, local only; the GitHub load.js lacks the settings step), then
node scripts/dev/load.js --clear --yes --script scripts/dev/demo-data/teardrop-campers.sql --db demo
psql -d demo -c "update \"\$db\" set mode='prod'"
# company logo: uploads live in the instance's "$file" table (Core alpha.20+), not files/upload. Stage 'Roadrunner Campers Desert Badge.png' from John's Featherbone-apps folder, then (server stopped; the server caches $settings)
psql -d demo -c 'CREATE TABLE IF NOT EXISTS "$file" (name text PRIMARY KEY, size integer NOT NULL, sha256 text NOT NULL, created timestamptz NOT NULL DEFAULT now(), created_by text, data bytea NOT NULL)'   # only if the replica was built before alpha.20
psql -d demo <<'SQL'
\set c `base64 -w0 "Roadrunner Campers Desert Badge.png"`
INSERT INTO "$file"(name,size,sha256,created_by,data) SELECT 'wwmvkd7a-Roadrunner Campers Desert Badge.png', length(d), encode(sha256(d),'hex'), 'admin', d FROM (SELECT decode(:'c','base64') d) x ON CONFLICT (name) DO UPDATE SET size=EXCLUDED.size, sha256=EXCLUDED.sha256, data=EXCLUDED.data;
SQL
psql -d demo -c "update \"\$settings\" set data=(data::jsonb || jsonb_build_object('logo','wwmvkd7a-Roadrunner Campers Desert Badge.png'))::json where name='globalSettings'"
# restart Postgres and node under clock.sh
```

`clock.sh` (source it; recompute before every start):

```bash
export TZ=America/Toronto
DEMO_NOW="${DEMO_NOW:-2027-06-01 08:00:00}"
off=$(( $(date -d "$DEMO_NOW" +%s) - $(date +%s) ))
export FAKETIME="+${off}s" FAKETIME_DONT_FAKE_MONOTONIC=1 FAKETIME_NO_CACHE=1
export FAKETIME_LIB=/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1
# postgres: su postgres -c "TZ=$TZ FAKETIME=$FAKETIME FAKETIME_DONT_FAKE_MONOTONIC=1 LD_PRELOAD=$FAKETIME_LIB pg_ctl ... start"
# node:     LD_PRELOAD=$FAKETIME_LIB node server.js
```

Assembly (one clip): `ffmpeg -ss <trim> -i take.webm -i line.wav -filter_complex "[0:v]subtitles=line.srt:force_style='FontName=Inter,FontSize=11,BorderStyle=4,BackColour=&H99000000,MarginV=18',fade=...[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,adelay=<ms>|<ms>,apad[a]" -map "[v]" -map "[a]" -t <len> -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart out.mp4`

The Playwright recorder (setup pass + filmed pass, pointer overlay) is kept in `claude/featherbone-demo-spike-record.js`.

## Open for later phases

- Narration and screen should be built per step (generate the line, measure it, hold the screen at least that long) — the spike placed one line by hand.
- The 1920 login page is mostly empty. Consider starting sections already signed in, or zooming the login.
- Captions burned in at FontSize 11 (≈41 px at 1080). Also ship a soft `.srt` per section.
