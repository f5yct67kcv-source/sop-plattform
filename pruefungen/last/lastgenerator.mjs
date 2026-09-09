// Lastgenerator: bildet den Tagesbetrieb nach, nicht einen einzelnen Endpunkt.
//
// Drei Sorten Nutzer, wie sie im Betrieb tatsaechlich vorkommen:
//   waechter  -- App auf dem Handy: Schichten laden, Mitteilungen, Rundgang
//                mit GPS-Spur alle 15 s und Scans
//   cockpit   -- Verwaltung am Desktop: Planung, Abgleich, Stammdaten
//   portal    -- Kunde sieht seine Einsaetze und Rundgaenge nach
//
// Aufruf: node lastgenerator.mjs <waechter> <cockpit> <portal> <sekunden> [tempo]
// tempo=1 heisst Echtzeit; tempo=n verdichtet die Denkpausen um Faktor n.
import http from 'node:http';
import fs from 'node:fs';

// Welche laufende Runde gehoert zu welchem Mitarbeitenden (vom Aufbau erzeugt)
const RUNDEN = JSON.parse(fs.readFileSync(new URL('./runden.json', import.meta.url), 'utf8'));
const MA_IDS = Object.keys(RUNDEN).map(Number).sort((a, b) => a - b);

const [, , wArg, cArg, pArg, sArg, tArg] = process.argv;
const N_WAECHTER = Number(wArg ?? 20);
const N_COCKPIT  = Number(cArg ?? 3);
const N_PORTAL   = Number(pArg ?? 5);
const DAUER_S    = Number(sArg ?? 60);
const TEMPO      = Number(tArg ?? 1);

const HOST = '127.0.0.1';
const PORT = Number(process.env.LAST_PORT ?? 8080);
const agent = new http.Agent({ keepAlive: true, maxSockets: 512 });

const messungen = [];   // {endpunkt, ms, status, bytes}
let laeuft = true;

function anfrage(pfad, { methode = 'GET', token = null, portalToken = null, rumpf = null } = {}) {
  return new Promise((fertig) => {
    const daten = rumpf ? Buffer.from(JSON.stringify(rumpf)) : null;
    const kopf = { 'Content-Type': 'application/json' };
    if (token) kopf['X-Auth-Token'] = token;
    if (portalToken) kopf['X-Auth-Token'] = portalToken;
    if (daten) kopf['Content-Length'] = daten.length;
    const start = process.hrtime.bigint();
    const req = http.request({ host: HOST, port: PORT, path: pfad, method: methode, headers: kopf, agent }, (res) => {
      let bytes = 0;
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        messungen.push({ endpunkt: pfad.split('?')[0].split('/').pop(), ms, status: res.statusCode, bytes });
        fertig({ status: res.statusCode, bytes });
      });
    });
    req.on('error', (e) => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      messungen.push({ endpunkt: pfad.split('?')[0].split('/').pop(), ms, status: 0, bytes: 0, fehler: e.code });
      fertig({ status: 0, bytes: 0 });
    });
    if (daten) req.write(daten);
    req.end();
  });
}

const API = '/backend/api/';
const schlaf = (ms) => new Promise((r) => setTimeout(r, Math.max(1, ms / TEMPO)));
const zufall = (a, b) => a + Math.random() * (b - a);
const heute = new Date().toISOString().slice(0, 10);

// ── Waechter: App im Einsatz ──────────────────────────────────────────
async function waechter(maId, rundgangId) {
  const token = 'tok-ma-' + maId;
  // App-Start: das laedt die Oberflaeche einmal komplett
  await anfrage(API + 'me.php', { token });
  await anfrage(API + 'meine_schichten.php', { token });
  await anfrage(API + 'meine_mitteilungen.php', { token });
  await schlaf(zufall(500, 2000));

  while (laeuft) {
    // GPS-Spur: alle 15 s ein Punkt, so wie die App es tut
    await anfrage(API + 'mein_rundgang_position.php', {
      methode: 'POST', token,
      rumpf: { rundgang_id: rundgangId, positionen: [{
        lat: 47.2 + Math.random() / 1000, lng: 7.5 + Math.random() / 1000,
        genauigkeit_m: 12, erfasst_am: new Date().toISOString().slice(0, 19).replace('T', ' ') }] },
    });
    if (!laeuft) break;
    // gelegentlich der Rest des Alltags
    const w = Math.random();
    if (w < 0.15) { await anfrage(API + 'meine_schichten.php', { token }); }
    else if (w < 0.26) { await anfrage(API + 'meine_mitteilungen.php', { token }); }
    await schlaf(15000);
  }
}

// ── Cockpit: Verwaltung am Desktop ────────────────────────────────────
async function cockpit(token) {
  const seiten = [
    [API + 'dashboard_stats.php', API + 'me.php'],
    [`${API}einsatz_list.php?von=${heute}&bis=${heute}`, API + 'objekt_list.php'],
    [API + 'mitarbeiter_list.php', API + 'kunden_list.php'],
    [`${API}rundgang_liste.php?von=${heute}&bis=${heute}`],
    [`${API}rapport_list.php`],
  ];
  while (laeuft) {
    const seite = seiten[Math.floor(Math.random() * seiten.length)];
    await Promise.all(seite.map((p) => anfrage(p, { token })));
    await schlaf(zufall(4000, 15000));   // Denkpause vor dem naechsten Klick
  }
}

// ── Kundenportal ──────────────────────────────────────────────────────
async function portal(zugangId) {
  const pt = 'tok-portal-' + zugangId;
  while (laeuft) {
    await anfrage(API + 'portal_einsaetze.php', { portalToken: pt });
    await schlaf(zufall(2000, 6000));
    await anfrage(API + 'portal_rundgaenge.php', { portalToken: pt });
    await schlaf(zufall(20000, 60000));
  }
}

// ── Auswertung ────────────────────────────────────────────────────────
function quantil(werte, q) {
  if (!werte.length) return 0;
  const s = [...werte].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

async function main() {
  const aufgaben = [];
  for (let i = 0; i < N_WAECHTER; i++) {
    const ma = MA_IDS[i % MA_IDS.length];
    aufgaben.push(waechter(ma, RUNDEN[ma]));
  }
  for (let i = 0; i < N_COCKPIT; i++) aufgaben.push(cockpit('tok-admin-lasttest-0001'));
  for (let i = 0; i < N_PORTAL; i++) aufgaben.push(portal(1 + (i % 50)));

  const t0 = Date.now();
  setTimeout(() => { laeuft = false; }, DAUER_S * 1000);
  await Promise.race([Promise.all(aufgaben), new Promise((r) => setTimeout(r, (DAUER_S + 25) * 1000))]);
  laeuft = false;
  const dauer = (Date.now() - t0) / 1000;

  const proEndpunkt = {};
  for (const m of messungen) {
    const e = (proEndpunkt[m.endpunkt] ||= { n: 0, fehler: 0, ms: [], bytes: 0 });
    e.n++; e.bytes += m.bytes;
    if (m.status !== 200) e.fehler++;
    e.ms.push(m.ms);
  }
  const alle = messungen.map((m) => m.ms);
  const fehler = messungen.filter((m) => m.status !== 200);
  const ergebnis = {
    last: { waechter: N_WAECHTER, cockpit: N_COCKPIT, portal: N_PORTAL, dauer_s: Math.round(dauer), tempo: TEMPO },
    gesamt: {
      anfragen: messungen.length,
      pro_sekunde: +(messungen.length / dauer).toFixed(2),
      fehler: fehler.length,
      fehlerquote_prozent: +((fehler.length / Math.max(1, messungen.length)) * 100).toFixed(2),
      p50_ms: Math.round(quantil(alle, 0.5)),
      p95_ms: Math.round(quantil(alle, 0.95)),
      p99_ms: Math.round(quantil(alle, 0.99)),
      max_ms: Math.round(Math.max(0, ...alle)),
      uebertragen_mb: +(messungen.reduce((s, m) => s + m.bytes, 0) / 1048576).toFixed(1),
    },
    endpunkte: Object.entries(proEndpunkt)
      .map(([k, v]) => ({ endpunkt: k, n: v.n, fehler: v.fehler,
        p50_ms: Math.round(quantil(v.ms, 0.5)), p95_ms: Math.round(quantil(v.ms, 0.95)),
        max_ms: Math.round(Math.max(...v.ms)), kb_mittel: +(v.bytes / v.n / 1024).toFixed(1) }))
      .sort((a, b) => b.p95_ms - a.p95_ms),
    fehlerarten: Object.entries(fehler.reduce((a, f) => { const k = f.fehler || ('HTTP ' + f.status); a[k] = (a[k] || 0) + 1; return a; }, {})),
  };
  console.log(JSON.stringify(ergebnis, null, 2));
}
main();
