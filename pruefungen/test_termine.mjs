// Terminbuchung "Betrieb besprechen" auf guardops.ch (ENT-731).
//
// Drei Ebenen, alle echt ausgefuehrt:
//   1. pruef_termine.php -- die Rechnung ohne Netz (Fenster, Puffer,
//      Wiederholung, Nachkontrolle, Eingaben, Kalenderdatei).
//   2. Der ECHTE Endpunkt api/termine.php unter "php -S", gegen einen
//      nachgestellten CalDAV-Kalender. Nur der Mailversand ist ersetzt --
//      er schreibt in eine Datei statt an einen SMTP-Server.
//   3. gespraech.html im Browser: die vier Zustaende mit vier Texten, der
//      Ablauf Wie/Wann/Wer, Handy-Masse, keine fremden Abrufe ohne Zustimmung.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// ══════════ 1. RECHNUNG ══════════════════════════════════════════════
{
  const r = JSON.parse(execFileSync('php', [`${WURZEL}/pruefungen/pruef_termine.php`], { encoding: 'utf8' }));
  for (let i = 0; i < r.ok; i++) { ok.push('pruef_termine.php #' + (i + 1)); }
  r.bad.forEach(b => bad.push('pruef_termine.php: ' + b));
}

// ══════════ 2. ENDPUNKT GEGEN EINEN NACHGESTELLTEN KALENDER ══════════
const tag = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const ymd = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const T = tag(3);
const ev = (uid, titel, von, bis, d = T) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${titel}\r\nDTSTART;TZID=Europe/Zurich:${ymd(d)}T${von}00\r\nDTEND;TZID=Europe/Zurich:${ymd(d)}T${bis}00\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

// Der Kalender: Map uid -> ics. Schalter fuer "stumm" und fuer die
// gleichzeitige Buchung der anderen Seite.
const kal = new Map([['frei-1', ev('frei-1', 'frei', '1400', '1700')]]);
const schalter = { stumm: false, fremdNachPut: false };
const dav = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const name = decodeURIComponent(req.url.split('/').pop() || '').replace(/\.ics$/, '');
    if (req.method === 'REPORT') {
      if (schalter.stumm) { res.writeHead(500); res.end(); return; }
      const teile = [...kal.values()].map(i => `<D:response><D:href>/cal/x.ics</D:href><D:propstat><D:prop><C:calendar-data>${i.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</C:calendar-data></D:prop></D:propstat></D:response>`);
      res.writeHead(207, { 'Content-Type': 'application/xml' });
      res.end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${teile.join('')}</D:multistatus>`);
      return;
    }
    if (req.method === 'PUT') {
      kal.set(name, body);
      if (schalter.fremdNachPut) {
        const zeit = (body.match(/DTSTART:\d{8}T(\d{4})/) || [])[1];
        // dieselbe Minute in Zuercher Zeit nachbauen: einfach die UTC-Zeit des Eintrags uebernehmen
        const dt = (body.match(/DTSTART:(\d{8}T\d{6}Z)/) || [])[1];
        kal.set('handeintrag-zzzzzzzzzzzzzzzzzzz', `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:handeintrag-zzzzzzzzzzzzzzzzzzz\r\nSUMMARY:Besprechung von Hand\r\nDTSTART:${dt}\r\nDURATION:PT30M\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
        schalter.fremdNachPut = false;
        void zeit;
      }
      res.writeHead(201); res.end(); return;
    }
    if (req.method === 'GET') {
      if (!kal.has(name)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/calendar' }); res.end(kal.get(name)); return;
    }
    if (req.method === 'DELETE') { const da = kal.delete(name); res.writeHead(da ? 204 : 404); res.end(); return; }
    res.writeHead(405); res.end();
  });
});
await new Promise(r => dav.listen(0, '127.0.0.1', r));
const davPort = dav.address().port;

// Das Buendel nachbauen wie der Deploy: flach, api/ darunter.
const ort = mkdtempSync(join(tmpdir(), 'termine-'));
const temp = join(ort, 'tmp'); mkdirSync(temp);
mkdirSync(join(ort, 'api'));
copyFileSync(`${WURZEL}/backend/api/termine.php`, join(ort, 'api/termine.php'));
for (const f of ['db.php', 'demo_bremse.php', 'termine_kalender.php']) { copyFileSync(`${WURZEL}/backend/${f}`, join(ort, f)); }
writeFileSync(join(ort, 'demo_anfrage.php'),
  readFileSync(`${WURZEL}/backend/demo_anfrage.php`, 'utf8').replace(/__DEMO_EMPFAENGER__/g, 'eingang@example.ch'));
// Mailversand ersetzt: schreibt jede Mail als Zeile in post.jsonl.
writeFileSync(join(ort, 'mailer.php'), `<?php
function smtp_konfiguriert(): bool { return true; }
function smtp_senden(string $an, string $name, string $betreff, string $html, string $text, array $anhaenge = [], array $bilder = [], string $antwortAn = ''): void {
  file_put_contents(__DIR__ . '/post.jsonl', json_encode(['an' => $an, 'betreff' => $betreff, 'text' => $text, 'anhaenge' => array_map(fn($a) => ['name' => $a['name'], 'mime' => $a['mime'], 'inhalt' => $a['inhalt']], $anhaenge), 'antwortAn' => $antwortAn]) . "\\n", FILE_APPEND);
}
`);
const post = () => existsSync(join(ort, 'post.jsonl'))
  ? readFileSync(join(ort, 'post.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(z => JSON.parse(z)) : [];

const php = spawn('php', ['-S', '127.0.0.1:0', '-t', ort], { env: { ...process.env, TMPDIR: temp }, stdio: ['ignore', 'pipe', 'pipe'] });
const phpPort = await new Promise((auf, ab) => {
  const t = setTimeout(() => ab(new Error('php -S startet nicht')), 8000);
  const lies = d => { const m = String(d).match(/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(t); auf(+m[1]); } };
  php.stdout.on('data', lies); php.stderr.on('data', lies);
});
const API = `http://127.0.0.1:${phpPort}/api/termine.php`;
const holen = async () => { rmSync(join(temp, 'guardops-termine-frei.json'), { force: true }); const r = await fetch(API); return { status: r.status, json: await r.json() }; };
const senden = async (daten, kopf = {}) => {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', ...kopf }, body: JSON.stringify(daten) });
  return { status: r.status, json: await r.json() };
};
const person = { firma: 'Muster Sicherheitsdienst AG', name: 'A. Beispielperson', telefon: '079 123 45 67', email: 'a.beispiel@gmail.com' };

try {
  // Ohne Zugangsdatei: nicht eingerichtet -- nicht "nichts frei".
  let a = await holen();
  check('KRITISCH: ohne Kalenderzugang meldet der Endpunkt "nicht eingerichtet" (503), nicht "nichts frei"',
    a.status === 503 && a.json.grund === 'nicht_eingerichtet');

  writeFileSync(join(ort, 'kalender_zugang.php'),
    `<?php return ['url' => 'http://127.0.0.1:${davPort}/cal/', 'benutzer' => 'pruefung', 'passwort' => 'pruefung'];`);

  a = await holen();
  check('Freie Zeiten kommen aus dem Fenster "frei" 14-17 Uhr: 14:00, 14:45, 15:30, 16:15',
    a.status === 200 && JSON.stringify(a.json.tage[iso(T)]) === JSON.stringify(['14:00', '14:45', '15:30', '16:15']));

  schalter.stumm = true;
  a = await holen();
  check('KRITISCH: ein stummer Kalender ist "Kalender antwortet nicht" (503), nicht "nichts frei"',
    a.status === 503 && a.json.grund === 'kalender_stumm');
  schalter.stumm = false;

  // Zeitfalle: zu schnell ausgefuellt -> dieselbe Antwort, aber kein Eintrag.
  const vorher = kal.size;
  a = await senden({ aktion: 'buchen', art: 'video', datum: iso(T), zeit: '14:00', ...person, website: '', dauer: 800 });
  check('Ein Skript (zu schnell) bekommt "ok", aber es entsteht kein Eintrag und keine Mail',
    a.status === 200 && kal.size === vorher && post().length === 0);

  // Die echte Buchung.
  a = await senden({ aktion: 'buchen', art: 'video', datum: iso(T), zeit: '14:00', ...person, website: '', dauer: 9000 });
  const eintrag = [...kal.entries()].find(([k]) => k.startsWith('guardops-'));
  const mails = post();
  const kunde = mails.find(m => m.an === person.email);
  const intern = mails.find(m => m.an === 'eingang@example.ch');
  check('KRITISCH: eine gueltige Buchung steht im Kalender, mit der Marke vorn im Titel',
    a.status === 200 && !!eintrag && /SUMMARY:GuardOpS: A\. Beispielperson/.test(eintrag[1]));
  check('KRITISCH: Video bekommt einen eigenen kMeet-Raum, im Kalender und in der Antwort',
    /^https:\/\/kmeet\.infomaniak\.com\/guardops-[0-9a-f]{16}$/.test(a.json.raum || '') && eintrag && eintrag[1].includes(a.json.raum));
  check('Beide Seiten bekommen eine Mail; die Bestaetigung traegt den Kalendereintrag als Anhang',
    !!kunde && !!intern && kunde.anhaenge.length === 1 && /^text\/calendar/.test(kunde.anhaenge[0].mime)
    && /BEGIN:VEVENT/.test(kunde.anhaenge[0].inhalt));
  check('Die interne Meldung antwortet an den Kunden (Antwort-An), nicht an uns selbst', intern && intern.antwortAn === person.email);
  const link = ((kunde && kunde.text) || '').match(/https:\/\/guardops\.ch\/gespraech\.html\?absagen=(guardops-[0-9a-f]{20})&t=([0-9a-f]{64})/);
  check('KRITISCH: der Absage-Link zeigt auf die feste Adresse guardops.ch und traegt UID und Signatur', !!link);

  a = await senden({ aktion: 'buchen', art: 'telefon', datum: iso(T), zeit: '14:00', ...person, website: '', dauer: 9000 });
  check('KRITISCH: dieselbe Zeit ein zweites Mal -> 409 "vergeben", kein zweiter Eintrag',
    a.status === 409 && [...kal.keys()].filter(k => k.startsWith('guardops-')).length === 1);

  // Im selben Augenblick traegt jemand von Hand denselben Platz ein.
  schalter.fremdNachPut = true;
  a = await senden({ aktion: 'buchen', art: 'telefon', datum: iso(T), zeit: '15:30', ...person, website: '', dauer: 9000 });
  check('KRITISCH: steht im selben Augenblick ein anderer Termin im Platz, nimmt die Seite ihre Buchung zurueck (409)',
    a.status === 409 && [...kal.keys()].filter(k => k.startsWith('guardops-')).length === 1
    && kal.has('handeintrag-zzzzzzzzzzzzzzzzzzz'));

  // Absagen.
  a = await senden({ aktion: 'absagen', uid: link ? link[1] : '', t: '0'.repeat(64) });
  check('KRITISCH: Absagen mit falscher Signatur -> 403, der Termin bleibt', a.status === 403 && link && kal.has(link[1]));
  a = await senden({ aktion: 'absagen', uid: link ? link[1] : '', t: link ? link[2] : '' });
  check('Absagen mit dem Link aus der Bestaetigung loescht den Termin', a.status === 200 && link && !kal.has(link[1]));
  a = await senden({ aktion: 'absagen', uid: link ? link[1] : '', t: link ? link[2] : '' });
  check('Ein zweites Absagen sagt "bereits abgesagt", nicht "Fehler"', a.status === 200 && a.json.schon === true);

  a = await senden({ aktion: 'buchen', art: 'video', datum: iso(T), zeit: '16:15', ...person, dauer: 9000 }, { Origin: 'https://fremd.example' });
  check('KRITISCH: eine Buchung von einer fremden Seite wird abgewiesen (403)', a.status === 403);

  // Die Bremse: Buchungen von derselben Adresse zaehlen, auch abgewiesene.
  let letzte;
  for (let i = 0; i < 4; i++) { letzte = await senden({ aktion: 'buchen', art: 'video', ...person, dauer: 9000 }); }
  check('KRITISCH: nach fuenf Buchungsversuchen in kurzer Zeit bremst der Endpunkt (429)', letzte.status === 429);
} finally {
  php.kill();
  dav.close();
}

// ══════════ 3. DIE SEITE IM BROWSER ══════════════════════════════════
const SEITE = `file://${WURZEL}/gespraech.html`;
const browser = await chromium.launch({ executablePath: browserPfad() });
const tageAntwort = { [iso(tag(3))]: ['14:00', '14:45', '15:30'], [iso(tag(5))]: ['14:00'] };

async function seiteMit(antwort, mass = { width: 1440, height: 900 }, mobil = false) {
  const p = await browser.newPage({ viewport: mass, isMobile: mobil, hasTouch: mobil });
  const fremd = [];
  const gesendet = [];
  p.on('request', r => { if (/^https?:/.test(r.url()) && !/\/api\/termine\.php/.test(r.url())) { fremd.push(r.url()); } });
  await p.route('**/api/termine.php', async route => {
    const r = route.request();
    if (r.method() === 'POST') {
      gesendet.push(r.postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', wann: 'Donnerstag, 1. Januar, 14:45 Uhr', art: 'video', raum: '', bestaetigt: true }) });
      return;
    }
    await route.fulfill({ status: antwort.status, contentType: 'application/json', body: JSON.stringify(antwort.body) });
  });
  await p.goto(SEITE, { waitUntil: 'load' });
  await p.waitForFunction(() => !document.getElementById('laden'), null, { timeout: 4000 }).catch(() => {});
  return { p, fremd, gesendet };
}

// Vier Zustaende, vier Texte.
const zustaende = [
  ['nicht eingerichtet', { status: 503, body: { status: 'error', grund: 'nicht_eingerichtet' } }],
  ['Kalender stumm', { status: 503, body: { status: 'error', grund: 'kalender_stumm' } }],
  ['nichts frei', { status: 200, body: { status: 'ok', dauer: 30, tage: {} } }],
];
const texte = [];
for (const [, antwort] of zustaende) {
  const { p } = await seiteMit(antwort);
  texte.push(await p.evaluate(() => document.getElementById('wann').innerText.trim()));
  await p.close();
}
check('KRITISCH: "nicht eingerichtet", "Kalender stumm" und "nichts frei" zeigen drei verschiedene Texte',
  new Set(texte).size === 3 && texte.every(t => t.length > 20 && /info@guardops\.ch/.test(t)));
check('"nichts frei" sagt belegt, "nicht eingerichtet" sagt eingerichtet -- nicht umgekehrt',
  /belegt/.test(texte[2]) && /eingerichtet/.test(texte[0]) && !/belegt/.test(texte[0]));

// Der Ablauf.
{
  const { p, fremd, gesendet } = await seiteMit({ status: 200, body: { status: 'ok', dauer: 30, tage: tageAntwort } });
  const tageZahl = await p.locator('.tag').count();
  check('Die freien Tage erscheinen als Knoepfe, mit der Zahl freier Plaetze', tageZahl === 2
    && /3 frei/.test(await p.locator('.tag').first().innerText()));
  check('Video ist vorgewaehlt', await p.locator('.art[data-art="video"]').getAttribute('aria-pressed') === 'true');
  await p.click('.art[data-art="telefon"]');
  check('Die Zusammenfassung folgt der Wahl der Art', /Telefon/.test(await p.locator('#wieZeile').innerText()));
  await p.click('.tag >> nth=0');
  await p.click('.zeit >> text=14:45');
  check('Die Zusammenfassung zeigt Tag und Zeit in Worten', /14:45 Uhr/.test(await p.locator('#wannZeile').innerText()));
  await p.click('#buchenKnopf');
  check('Ohne Angaben geht nichts zum Server, die Felder sind markiert',
    gesendet.length === 0 && await p.locator('#firma').getAttribute('aria-invalid') === 'true');
  await p.fill('#firma', person.firma); await p.fill('#name', person.name);
  await p.fill('#telefon', person.telefon); await p.fill('#email', person.email);
  await p.click('#buchenKnopf');
  await p.waitForSelector('#danke:not([hidden])', { timeout: 3000 }).catch(() => {});
  const g = gesendet[0] || {};
  check('KRITISCH: die Buchung schickt Art, Tag, Zeit und alle vier Angaben',
    g.aktion === 'buchen' && g.art === 'telefon' && g.datum === iso(tag(3)) && g.zeit === '14:45'
    && g.firma === person.firma && g.name === person.name && g.telefon === person.telefon && g.email === person.email);
  check('Nach der Buchung steht die Bestaetigung da, das Formular ist weg',
    await p.isVisible('#danke') && !(await p.isVisible('#formular')));
  check('KRITISCH: ohne Zustimmung laedt die Seite nichts von fremden Servern', fremd.length === 0);
  await p.close();
}

// Handy: Masse und kein Ueberlauf.
{
  const { p } = await seiteMit({ status: 200, body: { status: 'ok', dauer: 30, tage: tageAntwort } }, { width: 390, height: 844 }, true);
  await p.click('.tag >> nth=0');
  const m = await p.evaluate(() => {
    const sichtbar = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const bedien = [...document.querySelectorAll('.art, .tag, .zeit, #buchenKnopf, .kopf a, .fuss nav a')].filter(sichtbar);
    return {
      ueberlauf: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      kleinstes: Math.min(...bedien.map(e => e.getBoundingClientRect().height)),
      schrift: Math.min(...[...document.querySelectorAll('.feld input')].map(e => parseFloat(getComputedStyle(e).fontSize))),
    };
  });
  check('KRITISCH: kein horizontaler Ueberlauf auf dem Handy', m.ueberlauf === 0);
  check('KRITISCH: jedes Bedienelement ist auf dem Handy mindestens 44 px hoch', m.kleinstes >= 44);
  check('Eingabefelder haben auf dem Handy mindestens 16 px Schrift', m.schrift >= 16);
  await p.screenshot({ path: `${OUT}/gespraech-handy.png`, fullPage: true });
  await p.close();
}
{
  const { p } = await seiteMit({ status: 200, body: { status: 'ok', dauer: 30, tage: tageAntwort } });
  await p.click('.tag >> nth=0');
  check('Kein horizontaler Ueberlauf am Desktop',
    await p.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth));
  await p.screenshot({ path: `${OUT}/gespraech-desktop.png`, fullPage: true });
  await p.close();
}

// Die Startseite fuehrt hierher: der Hauptknopf oben, der Testzugang daneben.
{
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`file://${WURZEL}/homepage.html`, { waitUntil: 'load' });
  const k = await p.evaluate(() => {
    const held = document.querySelector('.held');
    const btns = [...held.querySelectorAll('.btn')];
    return { primaer: btns.filter(b => b.classList.contains('primaer')).map(b => b.getAttribute('href')),
      sekundaer: btns.filter(b => b.classList.contains('sekundaer')).map(b => b.getAttribute('href')),
      kopf: [...document.querySelectorAll('.kopf .btn')].filter(b => b.getBoundingClientRect().width > 0).map(b => b.getAttribute('href')),
      demo: !!document.getElementById('demoFormular') };
  });
  check('KRITISCH: oben fuehrt der Hauptknopf zum Gespraech, der Nebenknopf zum Testzugang -- und das Demo-Formular bleibt',
    k.primaer.length === 1 && k.primaer[0] === 'gespraech.html' && k.sekundaer.includes('#demo')
    && k.kopf.length === 1 && k.kopf[0] === 'gespraech.html' && k.demo);
  await p.close();
}
await browser.close();
rmSync(ort, { recursive: true, force: true });

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
