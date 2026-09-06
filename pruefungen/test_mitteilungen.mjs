// Mitteilungen in der App (ENT-421).
//
// Geprüft wird nicht das Aussehen, sondern die Aussagen, die still falsch
// werden können:
//
//   1. Der Einstieg ist die Glocke im Kopf, NICHT ein sechster Reiter.
//      Die Reiterleiste hat weiterhin fünf Einträge -- vom Projektinhaber
//      ausdrücklich so entschieden ("sechs Reiter sind zu viel").
//   2. Der Zähler zeigt die UNGELESENEN, nicht alle. Und er verschwindet,
//      wenn nichts offen ist -- eine 0 im roten Punkt wäre eine Warnung
//      ohne Anlass.
//   3. Nur "wichtig" unterbricht beim Öffnen. Käme das Fenster bei jeder
//      Mitteilung, würde es gewohnheitsmässig weggeklickt -- und genau die
//      eine Meldung, auf die es ankommt, mit.
//   4. Der Wegklick ist eine BESTÄTIGUNG und wird als solche gemeldet
//      (bestaetigt: true), nicht nur als "gelesen".
//   5. Die vier Nicht-Fälle sagen vier verschiedene Sätze. "Nicht
//      abrufbar" darf nie wie "keine Mitteilungen" aussehen -- die im
//      Haus meistverletzte Regel (CLAUDE.md).
//   6. Die Wächter-Kachel zeigt DIESELBE Liste, gefiltert -- keine zweite
//      Kopie mit eigenem Lesestand.
//   7. Die Glocke bleibt im Menü erreichbar, obwohl dort die Kopfzeile
//      wegfällt (ENT-402). Und es bleibt EINE Glocke, keine zweite.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';

const EXE = browserPfad();
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const klick = async s => { try { await page.click(s, { timeout: 2000 }); return true; }
                           catch { return false; } };
const ev = (fn, ...a) => page.evaluate(fn, ...a).catch(() => null);

// Kein festes Datum nahe beim heutigen Tag (Projektregel): Die Zeitpunkte
// liegen bewusst weit in der Vergangenheit und werden nirgends mit "heute"
// verglichen -- der Server entscheidet über die Sichtbarkeit, die App
// stellt nur dar, was sie bekommt.
const MITTEILUNGEN = [
  { id: 3, titel: 'Mitarbeitersitzung', text: 'Am Dienstag um 17 Uhr im Büro.',
    zielgruppe: 'alle', stufe: 'wichtig', sichtbar_ab: null, sichtbar_bis: null,
    erstellt_am: '2029-03-01 09:00:00', verfasser_name: 'Die Geschäftsleitung',
    gelesen_am: null, bestaetigt_am: null, gelesen: false, bestaetigt: false },
  { id: 2, titel: 'Ferien eintragen', text: 'Bitte bis Ende Monat erfassen.',
    zielgruppe: 'alle', stufe: 'normal', sichtbar_ab: null, sichtbar_bis: '2029-04-30 23:59:59',
    erstellt_am: '2029-02-20 08:00:00', verfasser_name: 'Das Personalbüro',
    gelesen_am: null, bestaetigt_am: null, gelesen: false, bestaetigt: false },
  { id: 1, titel: 'Neuer Schlüsselkasten', text: 'Ab sofort im Revierfahrzeug.',
    zielgruppe: 'revier', stufe: 'normal', sichtbar_ab: null, sichtbar_bis: null,
    erstellt_am: '2029-02-10 08:00:00', verfasser_name: 'Die Einsatzleitung',
    gelesen_am: '2029-02-11 07:00:00', bestaetigt_am: null, gelesen: true, bestaetigt: false },
];

// Was die App an den Server gemeldet hat -- daran hängen die Prüfungen zu
// "gelesen" und "bestätigt".
let gemeldet = [];
let antwort = null;   // wird je Abschnitt gesetzt

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(5000);
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const url = new URL(route.request().url());
  const p = url.pathname.split('/api/')[1];
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'm.muster', ist_admin: false });
  if (p.includes('mein_profil')) return send({ status: 'ok', profil: {
    name: 'm.muster', vorname: 'Max', nachname: 'Muster', personalnummer: 'P-001',
    strasse: '', ort: '', telefon: '', mobil: '', email: '', ist_admin: false,
    revierdienst_berechtigt: true } });
  if (p.includes('meine_mitteilungen')) {
    if (route.request().method() === 'POST') {
      gemeldet.push(JSON.parse(route.request().postData() || '{}'));
      return send({ status: 'ok' });
    }
    return send(antwort);
  }
  if (p.includes('meine_schichten')) return send({ status: 'ok', schichten: [] });
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  if (p.includes('meine_abwesenheit')) return send({ status: 'ok', abwesenheiten: [] });
  if (p.includes('meine_verfuegbarkeit')) return send({ status: 'ok', sperren: [] });
  if (p.includes('meine_fahrzeuge')) return send({ status: 'ok', fahrzeuge: [], eingerichtet: false });
  return send({ status: 'ok' });
});

async function anmelden() {
  await page.goto(`file://${WURZEL}/app.html`);
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForTimeout(700);
}

// ══════════════ 1. DER EINSTIEG ═══════════════════════════════════════
antwort = { status: 'ok', eingerichtet: true, mitteilungen: MITTEILUNGEN,
            ungelesen: 2, revier_ungelesen: 0, unterbrechen: [3] };
await anmelden();

// Die Reiterleiste bleibt bei fuenf. Gezaehlt wird, was SICHTBAR ist --
// ein per style="display:none" verstecktes Element zaehlt nicht mit.
const reiter = await ev(() => [...document.querySelectorAll('.tabs button')]
  .filter(b => getComputedStyle(b).display !== 'none')
  .map(b => b.textContent.trim()));
check('KRITISCH: die Reiterleiste hat weiterhin fuenf Eintraege, keinen sechsten',
  Array.isArray(reiter) && reiter.length === 5);
check('Und es ist kein Reiter "Mitteilungen" darunter',
  Array.isArray(reiter) && !reiter.some(t => /Mitteil|Info/i.test(t)));
check('"Heute" und "Plan" sind weiterhin getrennte Reiter',
  Array.isArray(reiter) && reiter.includes('Heute') && reiter.includes('Plan'));

check('KRITISCH: die Glocke steht in der Kopfzeile', await page.isVisible('#mitGlocke'));
const glockeMass = await ev(() => {
  const r = document.getElementById('mitGlocke')?.getBoundingClientRect();
  return r ? { h: r.height, b: r.width } : null;
});
check('44 px Trefferflaeche (CLAUDE.md)',
  !!glockeMass && glockeMass.h >= 44 && glockeMass.b >= 44);

// ══════════════ 2. DER ZAEHLER ════════════════════════════════════════
check('KRITISCH: der Zaehler nennt die UNGELESENEN (2), nicht alle (3)',
  (await ev(() => document.getElementById('mitZahl')?.textContent)) === '2');
check('Der Zaehler ist sichtbar, solange etwas offen ist',
  await page.isVisible('#mitZahl'));

// ══════════════ 3. NUR "WICHTIG" UNTERBRICHT ══════════════════════════
check('KRITISCH: das Fenster erscheint beim Oeffnen', await page.isVisible('#mitDlg'));
check('KRITISCH: und zwar mit der WICHTIGEN Mitteilung, nicht der neuesten normalen',
  ((await page.textContent('#mitDlgTitel').catch(() => '')) || '').includes('Mitarbeitersitzung'));
check('Der Text steht vollstaendig darin, nicht nur der Titel',
  ((await page.textContent('#mitDlgText').catch(() => '')) || '').includes('Dienstag'));
check('Der Absender steht dabei -- das unterscheidet eine Mitteilung vom Gruppenchat',
  ((await page.textContent('#mitDlgMeta').catch(() => '')) || '').includes('Geschäftsleitung'));

// Ein Klick DANEBEN darf es nicht schliessen -- das waere das
// versehentliche Wegwischen, das der Bestaetigung ihren Wert naehme.
await page.mouse.click(10, 400);
await page.waitForTimeout(250);
check('KRITISCH: ein Klick neben das Fenster schliesst es nicht',
  await page.isVisible('#mitDlg'));

// ══════════════ 4. DER WEGKLICK IST EINE BESTAETIGUNG ═════════════════
gemeldet = [];
await klick('#mitDlgOk');
await page.waitForTimeout(400);
check('Nach dem Wegklicken ist das Fenster zu', !(await page.isVisible('#mitDlg')));
const best = gemeldet.find(g => Number(g.id) === 3);
check('KRITISCH: der Wegklick wird als BESTAETIGUNG gemeldet, nicht nur als gelesen',
  !!best && best.bestaetigt === true);
check('Der Zaehler zieht nach: eine ungelesene weniger',
  (await ev(() => document.getElementById('mitZahl')?.textContent)) === '1');

// ══════════════ 5. DIE LISTE ══════════════════════════════════════════
gemeldet = [];
await klick('#mitGlocke');
await page.waitForTimeout(500);
check('KRITISCH: die Glocke oeffnet die Mitteilungsseite',
  await ev(() => document.getElementById('mitSeite')?.classList.contains('on')));
const karten = await ev(() => [...document.querySelectorAll('#mitBody .mit-karte')]
  .map(k => ({ id: k.dataset.id, titel: k.querySelector('h3')?.textContent || '' })));
check('KRITISCH: alle drei Mitteilungen erscheinen -- auch die schon gelesene',
  Array.isArray(karten) && karten.length === 3);
check('Die wichtige steht oben',
  Array.isArray(karten) && karten.length === 3 && karten[0].titel.includes('Mitarbeitersitzung'));

// Was in der Liste steht, ist gelesen -- und wird auch so gemeldet. Aber
// NICHT als bestaetigt: Aufklappen und Bestaetigen sind zwei verschiedene
// Aussagen.
const ausListe = gemeldet.find(g => Number(g.id) === 2);
check('KRITISCH: eine in der Liste gezeigte Mitteilung wird als gelesen gemeldet', !!ausListe);
check('KRITISCH: aber NICHT als bestaetigt -- lesen ist nicht bestaetigen',
  !!ausListe && ausListe.bestaetigt === false);
check('Die bereits gelesene wird nicht erneut gemeldet',
  !gemeldet.some(g => Number(g.id) === 1));
check('Der Zaehler steht nach dem Lesen auf null und der Punkt verschwindet',
  !(await page.isVisible('#mitZahl')));

await klick('.mit-zurueck');
await page.waitForTimeout(300);
check('Der Zurueck-Knopf schliesst die Seite',
  !(await ev(() => document.getElementById('mitSeite')?.classList.contains('on'))));

// ══════════════ 6. DIE WAECHTER-KACHEL ════════════════════════════════
await klick('#t-waechter');
await page.waitForTimeout(400);
check('KRITISCH: im Waechter-Bereich steht die Kachel "Revier-Infos"',
  await page.isVisible('#mk-revierinfo'));
check('Sie steht NEBEN den bestehenden Kacheln, nicht anstelle einer davon',
  await page.isVisible('#mk-rundgang') && await page.isVisible('#mk-fahrzeug'));
await klick('#mk-revierinfo');
await page.waitForTimeout(500);
check('Ein Klick oeffnet die Mitteilungsseite',
  await ev(() => document.getElementById('mitSeite')?.classList.contains('on')));
const revierKarten = await ev(() => [...document.querySelectorAll('#mitBody .mit-karte')]
  .map(k => k.dataset.id));
check('KRITISCH: dort stehen NUR die Revier-Mitteilungen, nicht alle',
  Array.isArray(revierKarten) && revierKarten.length === 1 && revierKarten[0] === '1');
check('Der Titel oben sagt, dass es die gefilterte Sicht ist -- nicht einfach "Mitteilungen"',
  ((await page.textContent('#mitTitel').catch(() => '')) || '').trim() === 'Revier-Infos');
await klick('.mit-zurueck');
await page.waitForTimeout(300);

// Dieselbe Liste, kein zweiter Bestand: Was ueber die Kachel als gelesen
// gilt, gilt auch ueber die Glocke.
await klick('#mitGlocke');
await page.waitForTimeout(400);
const nachher = await ev(() => [...document.querySelectorAll('#mitBody .mit-karte')].map(k => k.dataset.id));
check('KRITISCH: die Glocke zeigt danach wieder ALLE -- die Kachel filtert nur, sie ersetzt nichts',
  Array.isArray(nachher) && nachher.length === 3);
await klick('.mit-zurueck');
await page.waitForTimeout(300);

// ══════════════ 7. DIE GLOCKE IM MENUE ════════════════════════════════
// Im Menue faellt die Kopfzeile weg (ENT-402). Die Glocke muss trotzdem
// erreichbar bleiben -- und es darf keine zweite entstehen.
await klick('#t-menu');
await page.waitForTimeout(500);
check('KRITISCH: die Glocke bleibt im Menue erreichbar, obwohl die Kopfzeile dort wegfaellt',
  await page.isVisible('#mitGlocke'));
check('KRITISCH: es bleibt EINE Glocke, keine zweite daneben',
  (await ev(() => document.querySelectorAll('.mit-glocke').length)) === 1);
check('Auch im Menue 44 px Trefferflaeche',
  (await ev(() => document.getElementById('mitGlocke')?.getBoundingClientRect().height)) >= 44);
await klick('#t-heute');
await page.waitForTimeout(400);
check('Zurueck auf Heute steht sie wieder in der Kopfzeile',
  await ev(() => !!document.getElementById('mitGlocke')?.closest('.kopf')));

// Und sie ueberlebt ein Neuzeichnen des Menues, waehrend sie DARIN steht.
// Genau daran ist die erste Fassung gescheitert: zeichneMenu() setzt
// innerHTML neu und loeschte die verschobene Glocke mit -- danach stuerzte
// beschriften() ab. Das Aktualisieren im laufenden Betrieb (allesLaden ->
// zeichne) macht genau das.
await klick('#t-menu');
await page.waitForTimeout(400);
const jsFehlerVorher = bad.length;
await ev(() => zeichne());
await page.waitForTimeout(300);
check('KRITISCH: die Glocke ueberlebt ein Neuzeichnen des Menues',
  (await ev(() => document.querySelectorAll('.mit-glocke').length)) === 1);
check('Und sie ist dabei sichtbar geblieben', await page.isVisible('#mitGlocke'));
check('KRITISCH: das Neuzeichnen loest keinen JS-Fehler aus', bad.length === jsFehlerVorher);
await klick('#t-heute');
await page.waitForTimeout(300);

// ══════════════ 7b. BEIDE FASSUNGEN, GEMESSEN ════════════════════════
// Die Kopfzeile traegt seit ENT-420 in "hell" andere Farben. Die Glocke
// sitzt darin -- gemessen wird darum in beiden Fassungen, ob sie sich
// ueberhaupt vom Grund abhebt. Nachgelesen im Regelwerk saehe man das
// nicht: --shell-txt-hi wird je Fassung anders gesetzt.
for (const thema of ['hell', 'dunkel']) {
  antwort = { status: 'ok', eingerichtet: true, mitteilungen: MITTEILUNGEN,
              ungelesen: 2, revier_ungelesen: 0, unterbrechen: [] };
  await page.goto(`file://${WURZEL}/app.html`);
  await page.evaluate(t => { localStorage.clear(); localStorage.setItem('rv3_app_thema', t); }, thema);
  await page.goto(`file://${WURZEL}/app.html`);
  await page.fill('#gName', 'm.muster'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
  await page.waitForTimeout(700);
  const f = await ev(() => {
    const g = document.getElementById('mitGlocke'), z = document.getElementById('mitZahl');
    const zahl = z.getBoundingClientRect();
    const farbe = t => (getComputedStyle(t).color.match(/\d+/g) || []).map(Number);
    const grund = t => (getComputedStyle(t).backgroundColor.match(/\d+/g) || []).map(Number);
    const hell = c => c.length >= 3 ? (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 : 0;
    return { unterschied: Math.abs(hell(farbe(g)) - hell(grund(document.querySelector('.kopf')))),
             zahlUnterschied: Math.abs(hell(farbe(z)) - hell(grund(z))),
             imBild: zahl.right <= 390 && zahl.top >= 0 && zahl.left >= 0 };
  });
  check(`KRITISCH: die Glocke hebt sich in der Fassung "${thema}" vom Grund ab`,
    !!f && f.unterschied > 60);
  check(`Der Zaehler ist in der Fassung "${thema}" lesbar`, !!f && f.zahlUnterschied > 60);
  check(`Und er steht in der Fassung "${thema}" vollstaendig im Bild`, !!f && f.imBild);
}

// ══════════════ 8. DIE VIER NICHT-FAELLE ══════════════════════════════
// Sie müssen VERSCHIEDENE Sätze sagen. Verglichen wird der tatsächliche
// Text, nicht ein Wort aus dem Quelltext -- eine Prüfung, die den Wortlaut
// abschreibt, bleibt grün, wenn die Aussage verschwindet.
async function leerText(a) {
  antwort = a;
  await anmelden();
  await klick('#mitGlocke');
  await page.waitForTimeout(500);
  const t = await ev(() => document.getElementById('mitBody')?.textContent || '');
  await klick('.mit-zurueck');
  return (t || '').replace(/\s+/g, ' ').trim();
}

const tLeer = await leerText({ status: 'ok', eingerichtet: true, mitteilungen: [],
  ungelesen: 0, revier_ungelesen: 0, unterbrechen: [] });
const tUneingerichtet = await leerText({ status: 'ok', eingerichtet: false, mitteilungen: [],
  ungelesen: 0, revier_ungelesen: 0 });
const tFehler = await leerText({ status: 'error', message: 'kaputt' });

check('Es gibt nichts: die Seite sagt es', tLeer.length > 0);
check('Nicht eingerichtet: die Seite sagt es', tUneingerichtet.length > 0);
check('Nicht abrufbar: die Seite sagt es', tFehler.length > 0);
check('KRITISCH: "nicht abrufbar" sagt etwas ANDERES als "keine Mitteilungen" (CLAUDE.md)',
  tFehler !== tLeer);
check('KRITISCH: "nicht eingerichtet" sagt etwas ANDERES als "keine Mitteilungen"',
  tUneingerichtet !== tLeer);
check('KRITISCH: "nicht eingerichtet" sagt etwas ANDERES als "nicht abrufbar"',
  tUneingerichtet !== tFehler);
check('KRITISCH: bei einem Fehler wird nicht behauptet, es gebe keine Mitteilungen',
  !/keine mitteilungen/i.test(tFehler));

// Der vierte Fall: die gefilterte Revier-Sicht ohne Treffer. "Kein Treffer"
// und "nichts vorhanden" sind verschiedene Aussagen.
antwort = { status: 'ok', eingerichtet: true,
  mitteilungen: [MITTEILUNGEN[1]], ungelesen: 0, revier_ungelesen: 0, unterbrechen: [] };
await anmelden();
await klick('#t-waechter'); await page.waitForTimeout(300);
await klick('#mk-revierinfo'); await page.waitForTimeout(500);
const tRevierLeer = ((await ev(() => document.getElementById('mitBody')?.textContent || '')) || '')
  .replace(/\s+/g, ' ').trim();
check('KRITISCH: die leere Revier-Sicht sagt etwas anderes als die leere Gesamtliste',
  tRevierLeer.length > 0 && tRevierLeer !== tLeer);

// ══════════════ 9. KEIN FENSTER OHNE ANLASS ═══════════════════════════
antwort = { status: 'ok', eingerichtet: true, mitteilungen: [MITTEILUNGEN[1]],
  ungelesen: 1, revier_ungelesen: 0, unterbrechen: [] };
await anmelden();
check('KRITISCH: ohne wichtige Mitteilung erscheint KEIN Fenster',
  !(await page.isVisible('#mitDlg')));
check('Der Zaehler steht trotzdem',
  (await ev(() => document.getElementById('mitZahl')?.textContent)) === '1');

// Und bei einem Fehler erst recht nicht: Ein Fenster, das nichts anzeigen
// kann, waere eine Unterbrechung ohne Inhalt.
antwort = { status: 'error', message: 'kaputt' };
await anmelden();
check('KRITISCH: bei einem Abruffehler erscheint kein Fenster',
  !(await page.isVisible('#mitDlg')));
check('Und kein Zaehler -- eine Zahl waere hier erfunden',
  !(await page.isVisible('#mitZahl')));

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) { console.log('\n✗ ' + bad.length + ' FEHLGESCHLAGEN:'); bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
