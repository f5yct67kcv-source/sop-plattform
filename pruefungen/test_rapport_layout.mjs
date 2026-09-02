// Gestaltung des Erfassungsformulars (index.html), am gerenderten Zustand
// gemessen -- nicht im Quelltext nachgelesen (ENT-301).
//
// Anlass: Der Projektinhaber kreiste auf einem Bildschirmfoto zwei Stellen
// ein, an denen die Beschriftung am Feld darueber klebte. Gemessen ergab das
// Formular am Handy DREI verschiedene Abstaende, wo einer sein muesste:
// 13 px zwischen den meisten Feldern, 25 px vor dem zweiten Feld einer
// Zweierreihe (13 px Rand plus 12 px Rasterabstand addiert) und 0 px danach.
// Ursache: `.field:last-child { margin-bottom: 0 }` war fuer das letzte Feld
// einer KARTE gedacht, traf aber auch das zweite Feld in `.row2` -- und unter
// 500 px stapelt `.row2`, dann steht dieses Feld mitten im Formular.
//
// Beim Nachmessen fielen zwei weitere Verstoesse gegen CLAUDE.md auf, die
// keine Suite bewachte: Alle 13 Eingabefelder standen auf 15 px Schrift
// (darunter zoomt iOS beim Antippen hinein und bleibt dort), und neun Felder,
// beide Reiter und der Speichern-Knopf blieben unter 44 px Hoehe.
//
// Geprueft wird die Aussage, nicht der Wortlaut: WIE VIELE verschiedene
// Abstaende ankommen, nicht welche CSS-Regel sie erzeugt.
import { WURZEL, OUT, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: EXE });

const gerufen = [];

async function formular(breite, hoehe) {
  const p = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  p.on('pageerror', e => bad.push(`JS-Fehler @${breite}: ${e.message}`));
  await p.route('**/api/**', route => (gerufen.push(route.request().url().split('/api/')[1]), route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', token: 't', name: 'm.muster', ist_admin: true,
      rapporte: [], mitarbeiter: [], kunden: [], objekte: [], stats: [] }) })));
  await p.goto(`file://${WURZEL}/index.html`);
  await p.fill('#loginName', 'm.muster');
  await p.fill('#loginPassword', 'egal');
  await p.click('#btn-login');
  await p.waitForTimeout(400);
  return p;
}

// Sammelt die senkrechte Luft vor jeder Feldbeschriftung, Karte fuer Karte.
// Nur innerhalb einer Spalte -- nebeneinanderliegende Felder einer Zweierreihe
// haben keinen sinnvollen senkrechten Abstand zueinander.
const abstaende = p => p.evaluate(() => {
  const werte = [];
  document.querySelectorAll('#formArea .card').forEach(karte => {
    let vor = null, vorLinks = null;
    [...karte.querySelectorAll('label, input, select, textarea')]
      .filter(e => e.offsetParent && e.type !== 'checkbox')
      .forEach(e => {
        const r = e.getBoundingClientRect();
        if (vor !== null && e.tagName === 'LABEL' && Math.abs(r.left - vorLinks) < 2) {
          werte.push(Math.round(r.top - vor));
        }
        vor = r.bottom; vorLinks = r.left;
      });
  });
  return werte;
});

// ── KEIN VERWALTUNGSBEREICH IM ERFASSUNGSWERKZEUG (ENT-303) ─────────────
// Der Rapport trug bis 2026-09-02 einen vollstaendigen Verwaltungsbereich:
// Mitarbeitende anlegen samt Passwort, deaktivieren, Passwort zuruecksetzen,
// per Diktat anlegen und bearbeiten, dazu Kunden und Objekte -- 11
// Verwaltungs-Endpunkte in einem Formular, das draussen ausgefuellt wird.
// Altbestand aus der Zeit, als der Rapport noch alleine stand; das Cockpit
// macht dasselbe seither gruendlicher. Serverseitig war es dicht (die Rechte
// greifen), aber es war ein zweiter, groberer Weg zu denselben Daten, den
// keine Pruefung bewachte.
//
// Gemessen wird die Aussage: WELCHE Endpunkte das Werkzeug im Betrieb
// anfasst -- nicht, ob ein bestimmtes Wort im Quelltext steht.
let p = await formular(390, 844);

const SCHREIBWEGE = ['mitarbeiter_create', 'mitarbeiter_update', 'mitarbeiter_deactivate',
  'mitarbeiter_reset_password', 'kunden_create', 'kunden_update', 'kunden_delete',
  'ki_mitarbeiter_parse', 'ki_mitarbeiter_edit_parse'];

const reiter = await p.evaluate(() => [...document.querySelectorAll('.tabs .tab')]
  .filter(e => e.offsetParent !== null).map(e => e.textContent.trim()));
check(`KRITISCH: der Rapport hat nur Erfassen und Übersicht (${reiter.join(', ')})`,
  reiter.length === 2 && reiter[0] === 'Erfassen' && reiter[1] === 'Übersicht');
check('KRITISCH: auch als Admin kommt kein Verwaltungsreiter dazu',
  await p.evaluate(() => currentUser && currentUser.ist_admin === true) && reiter.length === 2);
check('Kein Feld zum Anlegen von Personen oder Passwörtern',
  await p.evaluate(() => !document.querySelector('input[type=password]:not(#loginPassword)')));

// Gegenprobe zur Entfernung: Die Kundenauswahl im Formular haengt an
// kunden_list und muss weiterhin geladen werden -- sonst waere zu viel weg.
check('KRITISCH: die Kundenauswahl im Formular wird weiterhin geladen',
  gerufen.some(x => x.includes('kunden_list')));
check('KRITISCH: kein schreibender Verwaltungs-Endpunkt wird angefasst',
  !gerufen.some(x => SCHREIBWEGE.some(w => x.includes(w))));


const luftHandy = await abstaende(p);
const verschieden = [...new Set(luftHandy)].sort((a, b) => a - b);
check(`KRITISCH: am Handy hat das Formular EINEN Feldabstand, nicht mehrere (${verschieden.join(', ')} px)`,
  verschieden.length === 1);
check('Der Abstand ist nicht null -- eine Beschriftung klebt nie am Feld darüber',
  verschieden.length > 0 && verschieden[0] > 0);

// CLAUDE.md: Eingabefelder mindestens 16px Schrift, sonst zoomt iOS hinein
// und bleibt dort. Bedienelemente mindestens 44px hoch.
const felder = await p.evaluate(() => [...document.querySelectorAll('#formArea input, #formArea select, #formArea textarea')]
  .filter(e => e.offsetParent && e.type !== 'checkbox')
  .map(e => ({ id: e.id, schrift: parseFloat(getComputedStyle(e).fontSize),
               hoch: e.getBoundingClientRect().height })));
const zuKlein = felder.filter(f => f.schrift < 16);
const zuNiedrig = felder.filter(f => f.hoch < 44);
check(`KRITISCH: jedes Eingabefeld hat mindestens 16px Schrift -- darunter zoomt iOS hinein (${felder.length} geprüft)`,
  felder.length >= 10 && zuKlein.length === 0);
if (zuKlein.length) { bad.push('   zu klein: ' + zuKlein.map(f => `${f.id} ${f.schrift}px`).join(', ')); }
check('KRITISCH: jedes Eingabefeld ist mindestens 44px hoch',
  zuNiedrig.length === 0);
if (zuNiedrig.length) { bad.push('   zu niedrig: ' + zuNiedrig.map(f => `${f.id} ${Math.round(f.hoch)}px`).join(', ')); }

const bedien = await p.evaluate(() => [...document.querySelectorAll('.tab, #formArea .btn')]
  .filter(e => e.offsetParent)
  .map(e => ({ was: e.id || e.className, hoch: e.getBoundingClientRect().height })));
check(`Reiter und Knöpfe sind mindestens 44px hoch (${bedien.length} geprüft)`,
  bedien.length >= 3 && bedien.every(b => b.hoch >= 44));

// Eine einzige versale Ebene: der Kartentitel. Standen Titel und
// Feldbeschriftung beide in Versalien, trat nichts hervor.
const versal = await p.evaluate(() => {
  const t = getComputedStyle(document.querySelector('.card-title')).textTransform;
  const l = getComputedStyle(document.querySelector('#field-kunde label')).textTransform;
  return { titel: t, beschriftung: l };
});
check('Der Kartentitel ist die einzige versale Ebene -- die Feldbeschriftung nicht',
  versal.titel === 'uppercase' && versal.beschriftung !== 'uppercase');

check('KRITISCH: kein Seiten-Scroll bei 390px',
  await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await p.evaluate(() => document.getElementById('lbl-sec-auftrag').scrollIntoView({ block: 'start' }));
await p.waitForTimeout(150);
await p.screenshot({ path: `${OUT}/rl-01-formular-handy.png` });
await p.close();

// ── DESKTOP (CLAUDE.md: nie nur eine Seite prüfen) ──────────────────────
p = await formular(1440, 900);

const verschiedenDesk = [...new Set(await abstaende(p))].sort((a, b) => a - b);
check(`KRITISCH: am Desktop derselbe eine Feldabstand (${verschiedenDesk.join(', ')} px)`,
  verschiedenDesk.length === 1 && verschiedenDesk[0] === verschieden[0]);

check('Am Desktop stehen Datum und Einsatzart nebeneinander, nicht gestapelt',
  await p.evaluate(() => {
    const d = document.getElementById('datum').getBoundingClientRect();
    const e = document.getElementById('einsatzart').getBoundingClientRect();
    return Math.abs(d.top - e.top) < 2 && e.left > d.right;
  }));
check('KRITISCH: kein Seiten-Scroll am Desktop',
  await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
await p.evaluate(() => document.getElementById('lbl-sec-auftrag').scrollIntoView({ block: 'start' }));
await p.waitForTimeout(150);
await p.screenshot({ path: `${OUT}/rl-02-formular-desktop.png` });
await p.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
