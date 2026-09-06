// Benachrichtigungen in der App (ENT-424).
//
// Geprüft wird, was still falsch werden kann:
//
//   1. SECHS Zustände, sechs verschiedene Sätze. "Geht auf diesem Gerät
//      nicht", "auf dem Server nicht eingerichtet", "im Browser abgelehnt",
//      "ausgeschaltet", "eingeschaltet" und "Zustand unbekannt" verlangen
//      verschiedene Handlungen — sie dürfen nie gleich aussehen (CLAUDE.md,
//      meistverletzte Hausregel). Ein ausgegrauter Schalter ohne
//      Begründung ist die schlechteste Auskunft von allen.
//   2. Der Schalter zeigt NUR bei "an" den eingeschalteten Zustand. Zeigte
//      er ihn auch bei "abgelehnt", hielte man sich für benachrichtigt und
//      wäre es nicht.
//   3. In den vier nicht bedienbaren Zuständen tut ein Tipp NICHTS — und
//      verlangt keine Erlaubnis. Ein Erlaubnisfenster, das ungefragt
//      erscheint, wird weggeklickt, und "abgelehnt" lässt sich in der App
//      nicht mehr zurückholen.
//   4. Die iPhone-Anleitung erscheint NUR dort, wo sie hilft: auf einem
//      Apple-Gerät im Browser-Tab. Auf Android wäre sie falsch, auf einem
//      installierten iPhone eine Aufforderung zu etwas Erledigtem.
//   5. Der Zustand entsteht aus Server UND Gerät. Kennt nur der Browser
//      ein Abo, der Server aber nicht, ist es serverseitig abgemeldet
//      worden — "eingeschaltet" wäre dann eine Falschauskunft.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const ev = (fn, ...a) => page.evaluate(fn, ...a).catch(() => null);

let antwort = { status: 'ok', eingerichtet: true, tabelle_da: true,
                schluessel: 'BObc3Q_gefaelschterSchluessel', dieses_geraet: false, geraete: 0 };
let gesendet = [];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(5000);
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const p = new URL(route.request().url()).pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('mein_profil')) return send({ status: 'ok', profil: {
    name: 'm.muster', vorname: 'Max', nachname: 'Muster', ist_admin: false,
    revierdienst_berechtigt: false } });
  if (p.includes('push_einrichtung')) {
    if (route.request().method() === 'POST') {
      gesendet.push(JSON.parse(route.request().postData() || '{}'));
      return send({ status: 'ok', an: true });
    }
    return send(antwort);
  }
  if (p.includes('meine_mitteilungen')) return send({ status: 'ok', eingerichtet: true,
    mitteilungen: [], ungelesen: 0, revier_ungelesen: 0, unterbrechen: [] });
  if (p.includes('meine_schichten')) return send({ status: 'ok', schichten: [] });
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  return send({ status: 'ok' });
});

async function anmelden() {
  await page.goto(`file://${WURZEL}/app.html`);
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForTimeout(700);
}

// Einen Zustand herstellen und die Einstellungen zeichnen. Der Zustand
// wird gesetzt, nicht erzeugt: Ein echtes iPhone im Safari-Tab, eine echte
// Ablehnung und ein echter Push-Dienst lassen sich in einer Prüfung nicht
// herbeiführen -- die Oberfläche muss trotzdem für jeden davon stimmen.
async function zustand(stand, zusatz = {}) {
  await page.evaluate(([s, z]) => {
    pushStand = s;
    pushGeraete = z.geraete || 0;
    pushSchaltet = !!z.schaltet;
    zeige('menu');
    einstSeiteAuf();
  }, [stand, zusatz]);
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const b = document.getElementById('btnPush');
    const s = document.getElementById('pushSatz');
    const sch = b ? b.querySelector('.schalter') : null;
    return b ? {
      satz: (s ? s.textContent : '').trim(),
      an: b.getAttribute('aria-checked') === 'true',
      gesperrt: b.getAttribute('aria-disabled') === 'true',
      schalterAn: !!(sch && sch.classList.contains('an')),
      hoehe: b.getBoundingClientRect().height,
      anleitung: !!document.getElementById('pushAnleitung'),
    } : null;
  });
}

await anmelden();

// ══════════════ 1. DIE SECHS ZUSTAENDE ════════════════════════════════
const z = {};
for (const s of ['an', 'aus', 'server', 'abgelehnt', 'unmoeglich', 'unbekannt']) {
  z[s] = await zustand(s);
  check(`Der Zustand "${s}" wird gezeichnet`, !!z[s] && z[s].satz.length > 0);
}

const saetze = Object.values(z).map(x => (x || {}).satz || '');
check('KRITISCH: alle sechs Zustaende sagen etwas VERSCHIEDENES (CLAUDE.md)',
  new Set(saetze).size === 6);
check('KRITISCH: "nicht eingerichtet" sagt etwas anderes als "ausgeschaltet"',
  z.server.satz !== z.aus.satz);
check('KRITISCH: "abgelehnt" sagt etwas anderes als "ausgeschaltet"',
  z.abgelehnt.satz !== z.aus.satz);
check('KRITISCH: "Zustand unbekannt" sagt etwas anderes als "ausgeschaltet"',
  z.unbekannt.satz !== z.aus.satz);
check('KRITISCH: keiner der fuenf Nicht-An-Zustaende behauptet, es sei eingeschaltet',
  ['aus', 'server', 'abgelehnt', 'unmoeglich', 'unbekannt'].every(s => !z[s].an && !z[s].schalterAn));

// ══════════════ 2. DER SCHALTER ═══════════════════════════════════════
check('KRITISCH: nur bei "an" steht der Schalter auf ein', z.an.an && z.an.schalterAn);
check('KRITISCH: bei "an" und "aus" ist er bedienbar', !z.an.gesperrt && !z.aus.gesperrt);
check('KRITISCH: in den vier uebrigen Zustaenden ist er gesperrt',
  z.server.gesperrt && z.abgelehnt.gesperrt && z.unmoeglich.gesperrt && z.unbekannt.gesperrt);
check('44 px Trefferflaeche (CLAUDE.md)', z.an.hoehe >= 44);

// ══════════════ 3. EIN TIPP IM GESPERRTEN ZUSTAND TUT NICHTS ══════════
// Und verlangt vor allem KEINE Erlaubnis: Eine ungefragte Erlaubnisfrage
// wird weggeklickt, und danach steht der Zustand dauerhaft auf "abgelehnt".
await page.evaluate(() => {
  window.__gefragt = 0;
  if (typeof Notification !== 'undefined') {
    Notification.requestPermission = () => { window.__gefragt++; return Promise.resolve('denied'); };
  }
});

// pushUmschalten() wird DIREKT gerufen, nicht ueber einen Klick: Ein
// Playwright-Klick, der ins Leere geht, wuerde stillschweigend nichts tun
// -- und die Pruefung waere gruen, ohne je etwas ausgeloest zu haben.
// Genau das ist beim ersten Bau dieser Suite passiert und in der
// Gegenprobe aufgefallen.
for (const s of ['server', 'abgelehnt', 'unmoeglich', 'unbekannt']) {
  await zustand(s);
  await ev(() => pushUmschalten());
  await page.waitForTimeout(200);
}
const gefragtGesperrt = await ev(() => window.__gefragt);
check('KRITISCH: im gesperrten Zustand wird keine Erlaubnis angefragt', gefragtGesperrt === 0);
check('Und der Zustand bleibt, wie er war', (await ev(() => pushStand)) === 'unbekannt');

// GEGENPROBE IM LAUF: Im Zustand "aus" MUSS gefragt werden. Ohne diese
// Zeile bewiese der Zaehler oben nichts -- er waere auch dann null, wenn
// die Erlaubnisfrage gar nicht mehr existierte.
await zustand('aus');
await ev(() => pushUmschalten());
await page.waitForTimeout(300);
check('KRITISCH: im Zustand "aus" WIRD gefragt -- sonst bewiese der Zaehler oben nichts',
  (await ev(() => window.__gefragt)) === 1);

// ══════════════ 4. DIE IPHONE-ANLEITUNG ═══════════════════════════════
check('Auf einem Nicht-Apple-Geraet steht keine iPhone-Anleitung da',
  !z.unmoeglich.anleitung);

// Ein Apple-Geraet im Browser-Tab vortaeuschen: Nur dort hilft die
// Anleitung, und nur dort soll sie stehen.
await page.evaluate(() => { window.istApple = () => true; window.appInstalliert = () => false; });
const apple = await zustand('unmoeglich');
check('KRITISCH: auf einem iPhone im Safari-Tab steht die Anleitung da', apple.anleitung);
check('Und der Satz erklaert den Grund, statt nur "geht nicht" zu sagen',
  apple.satz.length > 30 && apple.satz !== z.unmoeglich.satz);
check('Die Anleitung nennt den Home-Bildschirm',
  /Home-Bildschirm/i.test((await ev(() => document.getElementById('pushAnleitung')?.textContent)) || ''));

// Bereits installiert: dann ist die Anleitung eine Aufforderung zu etwas
// Erledigtem und faellt weg.
await page.evaluate(() => { window.appInstalliert = () => true; });
const appleInstalliert = await zustand('unmoeglich');
check('KRITISCH: auf einem bereits installierten Geraet faellt die Anleitung weg',
  !appleInstalliert.anleitung);
await page.evaluate(() => { window.istApple = () => false; window.appInstalliert = () => false; });

// ══════════════ 5. DER ZUSTAND ENTSTEHT AUS BEIDEM ════════════════════
// Die reine Funktion, ohne Browser und ohne Netz -- so laesst sich jede
// Weiche einzeln pruefen.
const f = async (a) => ev((x) => pushZustandBestimmen(x), a);
const voll = { abrufOk: true, moeglich: true, serverEingerichtet: true, erlaubnis: 'granted', aboDa: true };
check('Alles da ergibt "an"', (await f(voll)) === 'an');
check('KRITISCH: ohne Abo ergibt es "aus"', (await f({ ...voll, aboDa: false })) === 'aus');
check('KRITISCH: ein gescheiterter Abruf ergibt "unbekannt", nicht "aus"',
  (await f({ ...voll, abrufOk: false })) === 'unbekannt');
check('KRITISCH: ein gescheiterter Abruf ergibt "unbekannt" auch OHNE Abo -- '
    + 'sonst saehe eine Stoerung wie "ausgeschaltet" aus',
  (await f({ ...voll, abrufOk: false, aboDa: false })) === 'unbekannt');
check('KRITISCH: kein Push moeglich ergibt "unmoeglich"',
  (await f({ ...voll, moeglich: false })) === 'unmoeglich');
check('KRITISCH: Server ohne Schluessel ergibt "server"',
  (await f({ ...voll, serverEingerichtet: false })) === 'server');
check('KRITISCH: eine Ablehnung schlaegt ein bestehendes Abo -- '
    + 'wer die Erlaubnis entzogen hat, bekommt nichts mehr',
  (await f({ ...voll, erlaubnis: 'denied', aboDa: true })) === 'abgelehnt');
check('Die Reihenfolge stimmt: "nicht moeglich" geht der Ablehnung vor',
  (await f({ ...voll, moeglich: false, erlaubnis: 'denied' })) === 'unmoeglich');

// ══════════════ 5b. BEIDE MUESSEN DAS ABO KENNEN ══════════════════════
// Kennt nur der Browser ein Abo, der Server aber nicht, ist es dort
// abgemeldet worden (der Push-Dienst hatte es abgewiesen) -- es kaeme nie
// etwas an. "Eingeschaltet" waere dann eine Falschauskunft.
//
// Ein echtes Abo gibt es in einer Pruefung nicht: Dazu braeuchte es einen
// Push-Dienst. Vorgetaeuscht wird darum nur die eine Auskunft "der Browser
// hat ein Abo" -- alles andere laeuft echt.
await page.evaluate(() => {
  window.pushAboHolen = () => Promise.resolve({ endpoint: 'https://push.example.invalid/geraet-1' });
});

antwort = { status: 'ok', eingerichtet: true, tabelle_da: true,
            schluessel: 'BObc3Q_gefaelschterSchluessel', dieses_geraet: true, geraete: 1 };
await ev(() => pushZustandLaden());
await page.waitForTimeout(200);
check('Kennen BEIDE das Abo, ist es eingeschaltet', (await ev(() => pushStand)) === 'an');

antwort = { status: 'ok', eingerichtet: true, tabelle_da: true,
            schluessel: 'BObc3Q_gefaelschterSchluessel', dieses_geraet: false, geraete: 0 };
await ev(() => pushZustandLaden());
await page.waitForTimeout(200);
check('KRITISCH: kennt nur der Browser das Abo, steht NICHT "eingeschaltet" da -- '
    + 'serverseitig abgemeldet heisst, es kommt nichts mehr an',
  (await ev(() => pushStand)) === 'aus');

// Und bei einer Stoerung wird gar nichts behauptet, obwohl der Browser
// ein Abo kennt.
antwort = { status: 'error', message: 'kaputt' };
await ev(() => pushZustandLaden());
await page.waitForTimeout(200);
check('KRITISCH: bei einer Stoerung bleibt der Zustand unbekannt, auch mit Abo im Browser',
  (await ev(() => pushStand)) === 'unbekannt');

await page.evaluate(() => { delete window.pushAboHolen; });
await anmelden();

// ══════════════ 6. "AN" NENNT DIE WEITEREN GERAETE MIT BEZUG ══════════
const einGeraet = await zustand('an', { geraete: 1 });
const dreiGeraete = await zustand('an', { geraete: 3 });
check('Bei einem einzigen Geraet steht keine Geraetezahl da',
  !/\d/.test(einGeraet.satz));
check('KRITISCH: bei mehreren steht die Zahl der WEITEREN, nicht die Gesamtzahl',
  /2/.test(dreiGeraete.satz) && !/3/.test(dreiGeraete.satz));

// ══════════════ 7. WAEHREND DES SCHALTENS ═════════════════════════════
const schaltet = await zustand('an', { schaltet: true });
check('Waehrend des Umschaltens sagt die Zeile das', schaltet.satz !== z.an.satz);
check('Und der Schalter ist solange gesperrt', schaltet.gesperrt);

// ══════════════ 8. DER ZUSTAND WIRD BEIM LADEN GEHOLT ═════════════════
// Nicht der Wortlaut im Quelltext, sondern die Wirkung: Nach dem Anmelden
// steht ein Zustand fest, und der Server ist gefragt worden.
gesendet = [];
antwort = { status: 'ok', eingerichtet: false, tabelle_da: false,
            schluessel: null, dieses_geraet: false, geraete: 0 };
await anmelden();
check('KRITISCH: nach dem Anmelden steht ein Zustand fest',
  ['an', 'aus', 'server', 'abgelehnt', 'unmoeglich'].includes(await ev(() => pushStand)));
check('KRITISCH: meldet der Server "nicht eingerichtet", steht das auch so da -- '
    + 'ein nicht eingerichteter Server sieht nie wie ein ausgeschalteter Schalter aus',
  ['server', 'unmoeglich'].includes(await ev(() => pushStand)));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
