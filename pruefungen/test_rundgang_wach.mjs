// Rundgang-Bildschirm: Fokus im Kopf, Bildschirm wach halten, Ortungsmarke
// (ENT-355).
//
// Drei Dinge, die der Projektinhaber am Echtbetrieb beanstandet hat, und
// eine, die dabei aufgefallen ist:
//
//  1. Im Kopf stand der Firmenname gross und die beiden Zahlen klein. Wer
//     auf der Runde aufs Handy schaut, will wissen, wie weit er ist und wie
//     lange er dran ist -- welchen Kunden er abgeht, weiss er.
//  2. Sperrt sich der Bildschirm, haelt das Geraet die Ortung an. Die Runde
//     bekommt eine Luecke, ohne dass ein Fehler auftaucht. Dagegen gibt es
//     jetzt einen Schalter -- AUS als Vorgabe, weil eine Runde im
//     Echtbetrieb ueber neun Stunden lief und ein leeres Geraet gar nicht
//     mehr ortet.
//  3. Die Zeile "Standort wird waehrend der Runde verfolgt" unter der Karte
//     nahm Hoehe weg. Sie ist keine Kosmetik (ENT-317), also verschwindet
//     sie nicht -- sie zieht als Marke auf die Karte.
//  4. Dabei aufgefallen: Steht die Ortung still, sah das bis hierher aus wie
//     eine laufende Ortung mit alter Position. "Unbekannt" darf nie wie
//     "bekannt" aussehen (CLAUDE.md) -- die Marke sagt es jetzt.
//
// Die Anbieterleiste von Google (Kartendaten-Hinweis und Nutzungsbedingungen)
// wird hier ausdruecklich MITGEPRUEFT: Sie darf nach den Nutzungsbedingungen
// von Google Maps Platform weder entfernt noch verdeckt werden. Die beiden
// Kartenknoepfe muessen darum Abstand zur Unterkante halten.
import { WURZEL, browserPfad } from './pfade.mjs';
import { GOOGLE_MAPS_MOCK } from './google_maps_mock.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const APP = readFileSync(`${WURZEL}/app.html`, 'utf8');
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));

// ══════════ QUELLTEXT: was nicht wegoptimiert werden darf ═════════════
check('KRITISCH: die Anbieterleiste wird nirgends ausgeblendet',
  !/\.gm-style-cc[^}]*display\s*:\s*none/.test(APP)
  && !/gmnoprint[^}]*display\s*:\s*none/.test(APP)
  && !/a\[href\*=["']maps\.google[^}]*display\s*:\s*none/.test(APP));
check('KRITISCH: die Wachsperre wird nur waehrend einer laufenden Runde angefordert',
  /function rgWachAnfordern[\s\S]{0,600}?rgsModus !== 'lauf'[\s\S]{0,80}?return;/.test(APP));
check('KRITISCH: die Wachsperre wird beim Beenden der Ortung wieder freigegeben',
  /rgsOrtWache = null;[\s\S]{0,400}?rgWachFreigeben\(\);/.test(APP));
check('Die Vorgabe ist AUS -- gespeichert wird nur ein ausdrueckliches "an"',
  /function rgWachAn\(\)[\s\S]{0,200}?getItem\(RG_WACH_SCHLUESSEL\) === 'an'/.test(APP)
  && /catch \(e\) \{ return false; \}/.test(APP));
check('Beim Zurueckkommen aus dem Hintergrund wird die Sperre neu angefordert',
  /visibilitychange[\s\S]{0,200}?visibilityState === 'visible'[\s\S]{0,80}?rgWachAnfordern\(\)/.test(APP));

const RUNDE = { status: 'laeuft', einsatz_id: 71, rundgang_id: 5, name: 'Musterrunde',
  vorbereitet_am: tag(0) + ' 20:00:00', kontrollpunkte: [
  { id: 1, name: 'Tor Nord', reihenfolge: 1, erledigt: false, lat: 47.35, lng: 7.9, radius_m: 30, aufgaben: [] },
  { id: 2, name: 'Halle Ost', reihenfolge: 2, erledigt: false, lat: 47.351, lng: 7.901, radius_m: 30, aufgaben: [] },
  { id: 3, name: 'Rampe', reihenfolge: 3, erledigt: false, lat: 47.352, lng: 7.902, radius_m: 30, aufgaben: [] },
  { id: 4, name: 'Keller', reihenfolge: 4, erledigt: false, lat: 47.353, lng: 7.903, radius_m: 30, aufgaben: [] }] };
const SCHICHTEN = { status: 'ok', von: tag(-30), bis: tag(90), schichten: [
  { id: 71, kunde_name: 'Musterliegenschaften AG', titel: 'Nachtwache', strasse: 'Musterweg 4',
    ort: '9999 Musterdorf', einsatzart: 'Revierdienst', sparte: 'sicherheit', datum: tag(0),
    von: '20:00:00', bis: '06:00:00', status: 'bestaetigt', bemerkung: null, zusage: 'zugesagt',
    objekt_name: 'Musterobjekt', objekt_id: 7, hat_kontrollpunkte: true, im_team: 1 }] };
const PROFIL = { status: 'ok', monat: { anzahl: 0, stunden: 0 },
  profil: { name: 'm.muster', ist_admin: false, personalnummer: 'P-001',
    vorname: 'Max', nachname: 'Muster', erstellt_am: tag(-30) + ' 10:00:00' } };

const browser = await chromium.launch({ executablePath: browserPfad() });

async function seite(hoehe) {
  const page = await browser.newPage({ viewport: { width: 390, height: hoehe }, deviceScaleFactor: 2,
    permissions: ['geolocation'], geolocation: { latitude: 47.35, longitude: 7.9, accuracy: 8 } });
  // Eigene Wachsperre statt der echten: So laesst sich zaehlen, ob
  // angefordert und freigegeben wird -- unabhaengig davon, ob der
  // Pruefbrowser die Schnittstelle ueberhaupt mitbringt.
  await page.addInitScript(() => {
    window.__wach = { anfragen: 0, freigaben: 0, offen: 0 };
    // defineProperty und nicht einfach zuweisen: Chromium bringt
    // navigator.wakeLock selbst mit, als Nur-Lese-Eigenschaft am Prototyp.
    // Eine schlichte Zuweisung geht dort lautlos ins Leere -- die Pruefung
    // haette dann die ECHTE Sperre benutzt und nichts gezaehlt.
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      window.__wach.anfragen++; window.__wach.offen++;
      return { release: async () => { window.__wach.freigaben++; window.__wach.offen--; },
               addEventListener: () => {} };
    } } });
  });
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.route('**/api/**', route => {
    const p = new URL(route.request().url()).pathname.split('/api/')[1];
    const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
    if (p.includes('meine_schichten')) return send(SCHICHTEN);
    if (p.includes('mein_profil')) return send(PROFIL);
    if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
    if (p.includes('mein_rundgang_offen')) return send({ status: 'ok', rundgang: JSON.parse(JSON.stringify(RUNDE)) });
    return send({ status: 'ok' });
  });
  await page.route('**maps.googleapis.com/**', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: GOOGLE_MAPS_MOCK }));
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForSelector('.app.on'); await page.waitForTimeout(400);
  return page;
}

const masse = page => page.evaluate(() => {
  const g = s => { const e = document.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
    return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height,
             fs: parseFloat(c.fontSize), fw: parseInt(c.fontWeight, 10) }; };
  return { titel: g('#rgsTitel'), zaehler: g('#rgsZaehler'), timer: g('#rgsTimer'),
           zLb: g('#rgsZaehlerLb'), tLb: g('#rgsTimerLb'), zBlk: g('#rgsKopfZahlen > :nth-child(1)'),
           tBlk: g('#rgsKopfZahlen > :nth-child(2)'), chip: g('#rgsOrtChip'),
           huelle: g('.rgs-karte-huelle'), zen: g('#rgsZentrieren'), nacht: g('#rgsNachtsicht'),
           zeile: !!document.getElementById('rgsOrtungHinweis') };
});

// ══════════ KOPF: der Fokus liegt auf den Zahlen ══════════════════════
let page = await seite(844);
await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await page.waitForTimeout(1500);
await page.click('#rgsRt-karte'); await page.waitForTimeout(900);
let m = await masse(page);

// Zuerst: sind die Bauteile ueberhaupt da? Ohne diese Pruefung wuerde eine
// fehlende Marke die naechste Pruefung in einen Fehler laufen lassen -- und
// eine abgestuerzte Suite meldet gar keine rote Pruefung, sie meldet nichts.
// Genau so ist eine Gegenprobe in dieser Sitzung durchgerutscht.
for (const [nm, el] of [['Titel', m.titel], ['Zaehler', m.zaehler], ['Laufzeit', m.timer],
    ['Zaehler-Beschriftung', m.zLb], ['Laufzeit-Beschriftung', m.tLb],
    ['Zaehlerblock', m.zBlk], ['Laufzeitblock', m.tBlk], ['Ortungsmarke', m.chip],
    ['Kartenhuelle', m.huelle], ['Zentrieren', m.zen], ['Nachtsicht', m.nacht]]) {
  check(`KRITISCH: das Bauteil "${nm}" ist auf dem Bildschirm vorhanden`, !!el);
}

check('KRITISCH: waehrend der Runde treten Zaehler und Laufzeit vor den Firmennamen',
  !!m.zaehler && !!m.timer && !!m.titel
  && m.zaehler?.fs >= 22 && m.timer?.fs >= 22 && m.titel?.fs <= 14);
check('Beide Zahlen sind gleich gross -- ein Block darf nicht wichtiger aussehen als der andere',
  Math.abs(m.zaehler?.fs - m.timer?.fs) < 0.5 && Math.abs(m.zLb?.fs - m.tLb?.fs) < 0.5);
check('KRITISCH: die Beschriftung steht UEBER dem Wert, nicht darunter (CLAUDE.md)',
  m.zLb?.b <= m.zaehler?.t + 1 && m.tLb?.b <= m.timer?.t + 1);
check('Beide Bloecke stehen auf derselben Hoehe -- gleiches Muster auf beiden Seiten',
  Math.abs(m.zLb?.t - m.tLb?.t) < 1 && Math.abs(m.zaehler?.t - m.timer?.t) < 1);
const mitte = b => b ? (b.l + b.r) / 2 : NaN;
check('KRITISCH: jeder Wert steht in der Mitte SEINES Blocks, nicht im Zwischenraum',
  Math.abs(mitte(m.zaehler) - mitte(m.zBlk)) < 2 && Math.abs(mitte(m.timer) - mitte(m.tBlk)) < 2);
check('Der Firmenname bleibt lesbar -- zurueckgenommen ist nicht dasselbe wie weg',
  m.titel?.fs >= 12 && m.titel?.h > 10 && m.titel?.w > 100);
check('Die beiden Bloecke sind gleich breit',
  Math.abs(m.zBlk?.w - m.tBlk?.w) < 2);

// ══════════ KARTE: Knoepfe tiefer, Anbieterleiste frei ════════════════
check('KRITISCH: die Zeile unter der Karte ist weg -- die Karte hat die Hoehe',
  m.zeile === false);
check('KRITISCH: die Ortungsmarke steht stattdessen auf der Karte',
  !!m.chip && m.chip.h > 16 && m.chip.t >= m.huelle?.t && m.chip.b <= m.huelle?.b);
check('KRITISCH: beide Kartenknoepfe halten Abstand zur Anbieterleiste am unteren Rand',
  m.huelle?.b - m.zen?.b >= 24 && m.huelle?.b - m.nacht?.b >= 24);
check('Die Knoepfe sitzen trotzdem tief -- weiter unten als die halbe Karte',
  m.zen?.t > m.huelle?.t + m.huelle?.h / 2 && m.nacht?.t > m.huelle?.t + m.huelle?.h / 2);
check('Beide Kartenknoepfe behalten 44 px Trefferflaeche (CLAUDE.md)',
  m.zen?.h >= 44 && m.nacht?.h >= 44);
check('Marke und Knoepfe ueberlappen sich nicht',
  m.chip?.b < m.zen?.t && m.chip?.b < m.nacht?.t);

// ══════════ WACH HALTEN ═══════════════════════════════════════════════
await page.click('#rgsRt-funktionen'); await page.waitForTimeout(500);
check('KRITISCH: der Schalter "Bildschirm wach halten" steht unter Funktionen',
  await page.isVisible('#rgsLaufWach'));
check('Er steht auf AUS, ohne dass jemand etwas eingestellt hat',
  (await page.textContent('#rgsLaufWachZust')).trim() === 'Aus'
  && await page.getAttribute('#rgsLaufWach', 'aria-pressed') === 'false');
check('KRITISCH: solange er aus ist, wird keine Sperre angefordert',
  await page.evaluate(() => window.__wach.anfragen) === 0);
check('Daneben steht, was die Einstellung bringt und was sie kostet',
  (await page.textContent('#rgsLaufWachTxt')).includes('Akku'));
const wachBtn = await page.evaluate(() => {
  const r = document.getElementById('rgsLaufWach').getBoundingClientRect(); return r.height; });
check('Der Schalter hat 44 px Trefferflaeche', wachBtn >= 44);

await page.click('#rgsLaufWach'); await page.waitForTimeout(500);
check('KRITISCH: Einschalten fordert die Sperre tatsaechlich an',
  await page.evaluate(() => window.__wach.anfragen) >= 1
  && await page.evaluate(() => window.__wach.offen) === 1);
check('Der Schalter zeigt danach EIN -- mit Wort, nicht nur mit Farbe',
  (await page.textContent('#rgsLaufWachZust')).trim() === 'Ein'
  && await page.getAttribute('#rgsLaufWach', 'aria-pressed') === 'true');
check('Die Wahl bleibt auf dem Geraet',
  await page.evaluate(() => localStorage.getItem('sop_rundgang_wachhalten')) === 'an');

await page.click('#rgsLaufWach'); await page.waitForTimeout(500);
check('KRITISCH: Ausschalten gibt die Sperre wieder frei',
  await page.evaluate(() => window.__wach.freigaben) >= 1
  && await page.evaluate(() => window.__wach.offen) === 0);

// Wieder ein, dann Runde verlassen: die Sperre darf die Runde nicht ueberdauern.
await page.click('#rgsLaufWach'); await page.waitForTimeout(400);
check('Vor dem Verlassen ist die Sperre offen',
  await page.evaluate(() => window.__wach.offen) === 1);
await page.evaluate(() => rgSeiteZu()); await page.waitForTimeout(600);
check('KRITISCH: die Wachsperre ueberdauert die Runde nicht',
  await page.evaluate(() => window.__wach.offen) === 0);
await page.close();

// ══════════ ORTUNGSMARKE: der Zustand "steht" ═════════════════════════
page = await seite(844);
await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
await page.waitForTimeout(1500);
await page.click('#rgsRt-karte'); await page.waitForTimeout(900);
check('Solange Positionen kommen, meldet die Marke eine laufende Ortung',
  ((await page.textContent('#rgsOrtChip').catch(() => '')) || '').includes('Ortung läuft'));
// Position kuenstlich altern lassen -- genau der Fall "Bildschirm war gesperrt".
await page.evaluate(() => { rgsMeinOrt.zeit = Date.now() - 4 * 60000; rgLaufKopfZeichnen(); });
await page.waitForTimeout(300);
const steht = await page.evaluate(() => {
  const c = document.getElementById('rgsOrtChip');
  if (!c) { return { text: '', warn: false, titel: '' }; }
  return { text: (c.textContent || '').trim(), warn: c.classList.contains('steht'),
           titel: c.getAttribute('title') || '' };
});
check('KRITISCH: steht die Ortung still, sagt die Marke es -- statt eine alte Position als aktuell auszugeben',
  steht.text.includes('Ortung steht seit') && /\b4\b/.test(steht.text));
check('Sie wechselt dabei in die Warnfarbe -- das ist eine Aussage ueber die Datenqualitaet',
  steht.warn === true);
check('Und sie sagt, was dagegen hilft, statt nur zu diagnostizieren',
  steht.titel.includes('wach halten'));
// Der Punkte-Reiter hat keine Karte -- dort muss dieselbe Aussage als Zeile stehen.
await page.click('#rgsRt-punkte'); await page.waitForTimeout(500);
check('KRITISCH: auch auf dem Punkte-Reiter faellt die stehende Ortung auf',
  (await page.textContent('#rgsOrtungHinweis')).includes('Ortung steht seit'));
await page.close();

// ══════════ VORSCHAU: dort ist der Name die Hauptsache ════════════════
page = await seite(844);
await page.evaluate(() => ladeSchichten());
await page.waitForTimeout(600);
const vorschau = await page.evaluate(() => {
  const t = document.getElementById('rgsTitel');
  const z = document.getElementById('rgsKopfZahlen');
  return { fs: parseFloat(getComputedStyle(t).fontSize), zahlenWeg: z.hidden };
});
check('KRITISCH: ohne laufende Runde bleibt der Titel gross -- dort gibt es keine Zahlen, die vorgehen',
  vorschau.zahlenWeg === true && vorschau.fs >= 16);
await page.close();

// ══════════ KLEINE BILDSCHIRME ════════════════════════════════════════
for (const h of [720, 660, 600]) {
  page = await seite(h);
  await page.evaluate(() => ladeSchichten().then(() => rundgangFortsetzen(71)));
  await page.waitForTimeout(1500);
  await page.click('#rgsRt-karte'); await page.waitForTimeout(900);
  const k = await masse(page);
  check(`${h} px: der Kopf wird nicht zusammengedrueckt`,
    k.zaehler?.fs >= 22 && k.timer?.fs >= 22 && k.zBlk?.h > 40);
  check(`${h} px: die Knoepfe halten weiterhin Abstand zur Anbieterleiste`,
    k.huelle?.b - k.zen?.b >= 24 && k.huelle?.b - k.nacht?.b >= 24);
  check(`${h} px: die Ortungsmarke liegt im Bild`,
    !!k.chip && k.chip.t >= k.huelle?.t && k.chip.b <= k.huelle?.b);
  await page.close();
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
