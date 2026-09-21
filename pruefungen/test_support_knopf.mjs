// Der Weg ins Cockpit im Support-Dialog (ENT-631, Schritt 4).
//
// WAS HIER SCHIEFGEHEN KANN, und beides waere still: Der Knopf erscheint,
// wo er nicht hingehoert (bei einem Mandanten ohne Freigabe -- er fuehrte
// dann ins Leere und saehe aus, als haette der Betreiber ein Recht, das er
// nicht hat). Oder er fehlt, wo er hingehoert (bei einem Demo-Platz, denn
// dort weist die DIAGNOSE mangels Freigabe ab -- und genau fuer diesen
// Platz ist der Weg gebaut).
//
// Gemessen wird am gerenderten Zustand: Die Oberflaeche wird geladen, die
// Serverantwort durch eine Attrappe ersetzt und dann nachgesehen, was
// tatsaechlich sichtbar ist. Eine Pruefung auf Quelltext saehe beide
// Faelle gleich.
//
// WAS DIESE SUITE NICHT PRUEFT: ob der Zugang erlaubt IST. Darueber
// entscheidet der Server (api/betreiber_support_sprung.php, geprueft in
// test_support_sprung.mjs). Eine Sperre, die man am Browser vorbei
// umgehen kann, ist keine -- der Knopf hier ist Bequemlichkeit, nicht
// Sicherheit.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const browser = await chromium.launch({ executablePath: browserPfad() });

// Einen Fall durchspielen: Mandant hinein, Antwort der Diagnose
// vorgeben, und ansehen, was die Oberflaeche daraus macht.
async function fall(mandant, antwort) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  const fehler = [];
  page.on('pageerror', e => fehler.push(e.message));
  await page.goto(`file://${WURZEL}/betreiber.html`);
  await page.waitForTimeout(300);

  const r = await page.evaluate(async ([m, a]) => {
    // Die Attrappe steht an der Stelle, an der sonst der Server
    // antwortet. Alles davor und danach ist echte Oberflaeche.
    // Den Zustand herstellen, in dem dieser Dialog im Betrieb steht:
    // angemeldet (#haus offen) und im Reiter Mandanten (#b-mandanten
    // offen). OHNE das haben Karte und Knopf die Hoehe 0, obwohl die
    // Klassen richtig gesetzt sind -- jede Aussage ueber "sichtbar" waere
    // dann wertlos. Genau dieser Fall ist beim Schreiben dieser Suite
    // eingetreten.
    for (const id of ['haus', 'b-mandanten']) {
      const e = document.getElementById(id);
      if (e) { e.classList.remove('versteckt'); }
    }
    window.ruf = async () => a;
    if (typeof supportHolen !== 'function') { return { fehlt: 'supportHolen' }; }
    await supportHolen(m);
    const sicht = (id) => {
      const e = document.getElementById(id);
      if (!e) { return null; }
      const b = e.getBoundingClientRect();
      return getComputedStyle(e).display !== 'none' && b.height > 0;
    };
    const knopf = document.getElementById('knopf-sup-sprung');
    return {
      karte:   sicht('sup-karte'),
      sprung:  sicht('sup-sprung'),
      knopfDa: !!knopf,
      hinweis: (document.getElementById('sup-sprung-hinweis') || {}).textContent || '',
      inhalt:  (document.getElementById('sup-inhalt') || {}).textContent || '',
    };
  }, [mandant, antwort]);
  await page.close();
  return { ...r, fehler };
}

const MIT_FREIGABE = {
  status: 'ok', mandant: { name: 'Beispiel' },
  freigabe: { von: 'jemand', gilt_bis: '2030-01-01 00:00', zweck: '' },
  umfang: 'Zeilenzahlen', tabellen: [], fehlend: [], profile: [],
};
const OHNE_FREIGABE = { status: 'error', grund: 'keine_freigabe', lage: 'nie_freigegeben' };

// ══════════ MANDANT MIT FREIGABE: der Weg steht offen ═════════════════
{
  const a = await fall({ id: 1, name: 'Beispiel', ist_demo: false }, MIT_FREIGABE);
  // Zuerst: Misst die Suite ueberhaupt etwas? Eine Karte mit Hoehe 0
  // liesse jede Aussage ueber "sichtbar" ins Leere laufen.
  check('die Karte ist ueberhaupt gerendert (sonst misst die Suite Luft)', a.karte === true);
  check('bei gueltiger Freigabe ist der Weg ins Cockpit da', a.sprung === true);
  check('der Hinweis nennt die Freigabe als Grundlage', /Freigabe/.test(a.hinweis));
  check('der Hinweis nennt das Protokoll', /protokolliert/i.test(a.hinweis));
  if (a.fehler.length) { bad.push('JS-Fehler (mit Freigabe): ' + a.fehler.join('; ')); }
}

// ══════════ MANDANT OHNE FREIGABE: kein Weg, keine Karte ══════════════
{
  const a = await fall({ id: 1, name: 'Beispiel', ist_demo: false }, OHNE_FREIGABE);
  check('ohne Freigabe bleibt der Weg ins Cockpit verschlossen', a.sprung === false);
  check('ohne Freigabe bleibt die Karte zu', a.karte === false);
  if (a.fehler.length) { bad.push('JS-Fehler (ohne Freigabe): ' + a.fehler.join('; ')); }
}

// ══════════ DEMO-PLATZ OHNE FREIGABE: der Weg steht trotzdem ══════════
//
// DER EIGENTLICHE PUNKT DIESER SUITE. Die Diagnose weist ab, weil ein
// Demo-Platz keine Freigabe hat und haben kann. Waere die Karte damit
// erledigt, gaebe es fuer die zehn Plaetze gar keinen Weg -- und fuer sie
// ist er gebaut.
{
  const a = await fall({ id: 7, name: 'Demo-Platz 3', ist_demo: true }, OHNE_FREIGABE);
  check('beim Demo-Platz steht der Weg ins Cockpit trotz fehlender Freigabe offen',
    a.sprung === true);
  check('beim Demo-Platz bleibt die Karte stehen', a.karte === true);
  check('beim Demo-Platz wird erklaert, warum es ohne Freigabe geht',
    /Demo-Platz gehört dem Betreiber/.test(a.inhalt));
  check('auch beim Demo-Platz wird auf das Protokoll hingewiesen',
    /protokolliert/i.test(a.hinweis));
  if (a.fehler.length) { bad.push('JS-Fehler (Demo): ' + a.fehler.join('; ')); }
}

// ══════════ DER WEG BLEIBT NICHT VON EINEM FALL ZUM NAECHSTEN STEHEN ══
//
// Ein Knopf, der vom vorigen Mandanten uebrig ist, waere der gefaehrliche
// Fehler: Er saehe genauso aus und zeigte auf einen anderen Betrieb.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  await page.goto(`file://${WURZEL}/betreiber.html`);
  await page.waitForTimeout(300);
  const r = await page.evaluate(async ([ja, nein]) => {
    for (const id of ['haus', 'b-mandanten']) {
      const e = document.getElementById(id);
      if (e) { e.classList.remove('versteckt'); }
    }
    window.ruf = async () => ja;
    await supportHolen({ id: 1, name: 'Mit Freigabe', ist_demo: false });
    const zuerst = getComputedStyle(document.getElementById('sup-sprung')).display !== 'none';
    window.ruf = async () => nein;
    await supportHolen({ id: 2, name: 'Ohne Freigabe', ist_demo: false });
    const danach = getComputedStyle(document.getElementById('sup-sprung')).display !== 'none';
    return { zuerst, danach };
  }, [MIT_FREIGABE, OHNE_FREIGABE]);
  await page.close();
  check('der Weg steht beim ersten Mandanten offen (Vorbedingung)', r.zuerst === true);
  check('beim naechsten Mandanten ohne Freigabe ist er wieder zu', r.danach === false);
}

await browser.close();

// ══════════ DAS FENSTER OEFFNET SICH VOR DER ANFRAGE ══════════════════
//
// Nicht am gerenderten Zustand messbar, aber die Stelle, an der dieser
// Knopf am ehesten wortlos versagt: Ein window.open() NACH dem Warten auf
// die Antwort gilt dem Browser nicht mehr als Folge eines Klicks und
// landet im Blocker.
{
  const { readFileSync } = await import('fs');
  const q = readFileSync(`${WURZEL}/betreiber.html`, 'utf8');
  const von = q.indexOf('async function supSprungAusloesen');
  const rumpf = von === -1 ? '' : q.slice(von, q.indexOf('\nasync function', von + 10));
  const auf = rumpf.indexOf('window.open(');
  const frag = rumpf.indexOf('await ruf(');
  check('das Fenster wird geoeffnet, BEVOR der Server gefragt wird',
    auf !== -1 && frag !== -1 && auf < frag);
  check('bleibt die Antwort aus, wird das leere Fenster geschlossen',
    /fenster\.close\(\)/.test(rumpf));
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
