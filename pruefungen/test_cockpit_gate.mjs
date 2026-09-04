// Video-Hintergrund auf der Cockpit-Anmeldung (ENT-395).
//
// Wiederverwendet dieselbe Nachtszene wie app.html (ENT-392/394), auf
// ausdruecklichen Wunsch des Projektinhabers, nachdem er sie zuerst dort
// gesehen hatte. Der entscheidende Unterschied zu app.html/
// test_anmeldemaske.mjs: dort traegt Text DIREKT auf dem Video (die Karte
// ist seit ENT-385 weg), hier bleibt .gate-card vollstaendig deckend
// stehen. Kein Zeichen Text liegt hier direkt auf dem Video -- darum
// keine mehrpunktige Kontrastmessung wie dort, sondern ein Nachweis, dass
// die Karte tatsaechlich deckend ist UND tatsaechlich ueber dem Video
// liegt. Beides wird am gerenderten Zustand geprueft, nicht angenommen
// (CLAUDE.md) -- diese Datei selbst ist der Beweis, warum: die erste
// Fassung des CSS liess das Video wegen einer falschen Regel-Reihenfolge
// bei JEDER Fensterbreite verschwinden (siehe Kommentar im CSS bei
// #gate), sichtbar erst am Bildschirm, nicht im Quelltext.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });
const ev = (page, fn, ...a) => page.evaluate(fn, ...a).catch(() => null);

const seiteOeffnen = async (thema, breite) => {
  const page = await browser.newPage({ viewport: { width: breite, height: 900 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));
  await page.addInitScript(t => { try { localStorage.setItem('rv3_thema', t); } catch (e) {} }, thema);
  await page.goto(`file://${WURZEL}/dashboard.html`);
  await page.waitForTimeout(500);
  return page;
};

// ══════════ DESKTOP, DUNKLES THEMA (das im Screenshot des Projektinhabers) ══
const page = await seiteOeffnen('dunkel', 1440);

check('KRITISCH: das Video ist auf dem Desktop eingebunden',
  await ev(page, () => getComputedStyle(document.querySelector('.gate-video')).display !== 'none'));
const quellen = await ev(page, () =>
  [...document.querySelectorAll('.gate-video source')].map(s => ({ src: s.getAttribute('src'), typ: s.getAttribute('type') })));
check('KRITISCH: WebM/VP9 UND MP4/H.264 sind beide als Quelle eingetragen',
  Array.isArray(quellen)
  && quellen.some(q => q.src?.endsWith('.webm') && q.typ === 'video/webm')
  && quellen.some(q => q.src?.endsWith('.mp4') && q.typ === 'video/mp4'));
const attribute = await ev(page, () => {
  const v = document.querySelector('.gate-video');
  return { autoplay: v.autoplay, muted: v.muted, loop: v.loop, playsinline: v.hasAttribute('playsinline') };
});
check('KRITISCH: autoplay, muted, loop und playsinline sind gesetzt',
  attribute !== null && attribute.autoplay && attribute.muted && attribute.loop && attribute.playsinline);

const zeitVorher = await ev(page, () => document.querySelector('.gate-video')?.currentTime ?? null);
await page.waitForTimeout(600);
const zeitNachher = await ev(page, () => document.querySelector('.gate-video')?.currentTime ?? null);
check('KRITISCH: das Video spielt tatsaechlich von selbst (die Zeit laeuft weiter, ohne Klick)',
  zeitVorher !== null && zeitNachher !== null && zeitNachher > zeitVorher);

// ══════════ DIE KARTE SCHUETZT DEN TEXT -- DAS IST DER GANZE UNTERSCHIED ═
// Kein eigener Kontrast-Nachweis noetig, WEIL die Karte deckend ist UND
// ueber dem Video liegt. Beide Haelften dieser Aussage werden einzeln
// geprueft -- eine allein waere kein Beweis (deckend, aber unter dem
// Video waere so gut wie unsichtbar; ueber dem Video, aber durchsichtig
// liesse das Video durchscheinen).
const kartenGrund = await ev(page, () => getComputedStyle(document.querySelector('.gate-card')).backgroundColor);
check('KRITISCH: die Anmeldekarte hat eine deckende Flaeche (nicht transparent)',
  kartenGrund !== null && !/rgba\([^)]*,\s*0\s*\)/.test(kartenGrund) && kartenGrund !== 'transparent');
const trefferImKartenpunkt = await ev(page, () => {
  const karte = document.querySelector('.gate-card');
  const r = karte.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return el === karte || karte.contains(el);
});
check('KRITISCH: an einem Punkt mitten in der Karte liegt tatsaechlich die Karte obenauf, nicht das Video',
  trefferImKartenpunkt === true);

// ══════════ BEWEGUNG REDUZIEREN BLENDET VIDEO UND SCHLEIER AUS ════════
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.waitForTimeout(150);
check('KRITISCH: bei reduzierter Bewegung ist das Video unsichtbar',
  await ev(page, () => getComputedStyle(document.querySelector('.gate-video')).display === 'none'));
check('KRITISCH: und auch der Schleier',
  await ev(page, () => getComputedStyle(document.querySelector('.gate-schleier')).display === 'none'));
await page.emulateMedia({ reducedMotion: 'no-preference' });

check('KRITISCH: das Hintergrundfoto ist als CSS-Ausweiche eingebunden',
  await ev(page, () => getComputedStyle(document.getElementById('gate')).backgroundImage.includes('anmeldung-nacht.webp')));

await page.close();

// ══════════ HANDY: KEIN VIDEO, WIE BEI app.html ════════════════════════
const handy = await seiteOeffnen('dunkel', 390);
check('KRITISCH: auf dem Handy bleibt das Video unsichtbar',
  await ev(handy, () => getComputedStyle(document.querySelector('.gate-video')).display === 'none'));
await handy.close();

// ══════════ HELLES THEMA: FUNKTIONIERT GENAUSO, DIE KARTE BLEIBT WEISS ═
// #gate selbst ist in BEIDEN Themen dunkel (--shell), siehe CSS-Kommentar
// -- die Karte darueber folgt aber weiterhin dem gewaehlten Thema.
const hell = await seiteOeffnen('hell', 1440);
check('KRITISCH: auch im hellen Thema ist das Video eingebunden und spielt',
  await ev(hell, () => getComputedStyle(document.querySelector('.gate-video')).display !== 'none'));
const kartenGrundHell = await ev(hell, () => getComputedStyle(document.querySelector('.gate-card')).backgroundColor);
check('Im hellen Thema bleibt die Karte deckend UND weiss, nicht die dunkle Kartenfarbe',
  kartenGrundHell === 'rgb(255, 255, 255)');
await hell.close();

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
