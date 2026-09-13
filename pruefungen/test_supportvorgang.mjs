// Supportvorgaenge (ENT-538): der Weg vom Betrieb zum Plattform-Betreiber.
//
// WORAUF DIESE SUITE BESONDERS ACHTET:
//
// 1. DIE VORGAENGE LIEGEN BEIM BETREIBER, nicht beim Mandanten -- anders
//    als die Support-Freigabe (ENT-526). Genau daraus folgt der
//    gefaehrlichste Fehler dieses Moduls: eine Anfrage, die unter dem Namen
//    des falschen Betriebs im Vorrat landet, oder ein Betrieb, der die
//    Vorgaenge eines anderen sieht. Beides wird echt geprueft
//    (pruef_supportvorgang.php), nicht nur gelesen.
//
// 2. DIE BENANNTE AUSNAHME MUSS EINE BLEIBEN. backend/betreiber.php haelt
//    fest, dass keine Abfrage Mandant und Betreiber vermischt; genau eine
//    Funktion tut es. Diese Suite bewacht, dass keine zweite dazukommt --
//    ohne diese Wache waere es in einem halben Jahr die Stelle, an der
//    jemand "schnell noch" den Mandantenstamm mitliest.
//
// 3. VIER STATUS, VIER AUSSAGEN. "neu", "in Arbeit", "wartet auf Kunde" und
//    "erledigt" sind vier verschiedene Dinge. Die Hausregel dazu ist hier
//    schon am haeufigsten verletzt worden: unbekannt darf nie wie keine
//    aussehen -- und ein Filter, der alles ausblendet, nie wie ein leerer
//    Vorrat.
//
// 4. DIE OBERFLAECHE WIRD GEMESSEN, nicht im Quelltext nachgelesen. Eine
//    CSS-Regel kann wirkungslos bleiben, ohne dass etwas kaputtgeht.
import { WURZEL, HIER, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Testdaten mit festem Datum kippen beim Datumswechsel -- darum relativ zum
// Lauftag gerechnet (test_datumsfest.mjs achtet darauf). Die ABSTAENDE sind
// das, worauf es ankommt: ein Vorgang von vorletzter Woche, einer von
// vorletztem Monat.
const vorTagen = n => {
  const d = new Date(Date.now() - n * 864e5);
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4)
    .toISOString().slice(0, 19).replace('T', ' ');
};

// ══════════════════════════════════════════════════════════════════════
// TEIL 1 — Der Rechenkern wird wirklich ausgefuehrt
// ══════════════════════════════════════════════════════════════════════
let phpAusgabe = '', phpCode = 0;
try {
  phpAusgabe = execFileSync('php', [`${HIER}/pruef_supportvorgang.php`], { encoding: 'utf8' });
} catch (e) {
  phpAusgabe = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAusgabe.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check('KRITISCH: der Rechenkern der Supportvorgaenge laeuft ueberhaupt durch', phpAnzahl > 0);
check('KRITISCH: alle Rechenkern-Pruefungen bestehen', phpCode === 0);
phpAusgabe.split('\n').filter(z => z.trim().startsWith('✗')).forEach(f => bad.push('PHP:' + f));

// ══════════════════════════════════════════════════════════════════════
// TEIL 2 — Rechte, Eingrenzung und die benannte Ausnahme (Quelltext)
// ══════════════════════════════════════════════════════════════════════
const KERN    = readFileSync(`${WURZEL}/backend/supportvorgang.php`, 'utf8');
const KUNDE   = readFileSync(`${WURZEL}/backend/api/support_anfrage.php`, 'utf8');
const VORRAT  = readFileSync(`${WURZEL}/backend/api/betreiber_support_vorgang.php`, 'utf8');
const ZEITGEB = readFileSync(`${WURZEL}/backend/api/push_versand.php`, 'utf8');
const ohneKommentar = t => t.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

// Die Kundenseite haengt an require_verwaltung -- schwaecher als die
// Freigabe (Recht 'rechte'), aber nicht offen fuer jede angemeldete Person.
check('KRITISCH: die Kundenseite verlangt eine Verwaltungsberechtigung',
  /require_session\s*\(/.test(ohneKommentar(KUNDE))
  && /require_verwaltung\s*\(\s*\$user\s*\)/.test(ohneKommentar(KUNDE)));
check('KRITISCH: der Vorrat verlangt eine vollwertige Betreiber-Sitzung',
  /require_betreiber_voll\s*\(/.test(ohneKommentar(VORRAT)));
check('KRITISCH: der Vorrat laeuft NICHT ueber eine Mitarbeitersitzung',
  !/require_session\s*\(/.test(ohneKommentar(VORRAT)));

// Der Melder kommt aus der Sitzung, nie aus der Anfrage -- sonst koennte
// jemand eine Anfrage unter fremdem Namen stellen.
check('KRITISCH: wer meldet, kommt aus der Sitzung und nicht aus der Anfrage',
  /\$wer\s*=\s*trim\(\(string\)\$user\['name'\]\)/.test(ohneKommentar(KUNDE))
  && !/\$daten\['melder/.test(ohneKommentar(KUNDE)));
check('KRITISCH: wer antwortet, kommt auch beim Betreiber aus der Sitzung',
  /\$wer\s*=\s*trim\(\(string\)\(\$betreiber\['name'\]/.test(ohneKommentar(VORRAT)));

// Jeder lesende und schreibende Weg der Kundenseite grenzt auf den eigenen
// Mandanten ein. Geprueft wird die AUSSAGE: Jeder Aufruf von sv_detail/
// sv_antwort aus dem Kundenendpunkt fuehrt $mandantId mit.
const kundeOhne = ohneKommentar(KUNDE);
const aufrufe = [...kundeOhne.matchAll(/sv_(detail|antwort|liste|zaehler_offen)\s*\(([^;]*?)\)\s*[;,)]/g)];
check('KRITISCH: jeder Datenzugriff der Kundenseite fuehrt den eigenen Mandanten mit',
  aufrufe.length >= 4 && aufrufe.every(m => /\$mandantId/.test(m[2])));

// Ohne Zuordnung wird abgebrochen -- nicht auf Mandant 1 geraten.
check('KRITISCH: ohne Mandantenzuordnung wird die Anfrage abgewiesen, nicht zugeordnet',
  /\$mandant\['id'\]\s*===\s*null/.test(kundeOhne) && /409/.test(kundeOhne));

// ── Die benannte Ausnahme ───────────────────────────────────────────
//
// DIE LUECKE, DIE DIESE PRUEFUNG SCHLIESST: betreiber_db() ist der Zugang
// zur Betreiber-Ebene. Solange nur der Supportweg ihn aus Mandanten-Code
// benutzt, ist die Ausnahme benannt. Baut jemand einen zweiten Weg, faellt
// das sonst nirgends auf -- es funktioniert ja.
//
// Die Liste ist absichtlich vollstaendig und namentlich, nicht als Muster:
// Ein Muster wie /^betreiber_/ wuerde jeden kuenftigen Endpunkt mit
// passendem Namen stillschweigend mit durchlassen. Kommt ein Nutzer dazu,
// wird diese Pruefung rot -- und dann gehoert er hier hinein ODER er
// gehoert nicht dorthin, wo er steht.
const BETREIBER_EBENE_ERLAUBT = [
  // Die Betreiber-Endpunkte selbst. Sie SIND die Betreiber-Ebene.
  ...readdirSync(`${WURZEL}/backend/api`).filter(f => f.startsWith('betreiber_')),
  // Die benannte Ausnahme (ENT-538): der Weg, auf dem eine Anfrage von der
  // Mandanten- auf die Betreiber-Seite kommt. Nur ueber
  // sv_mandant_bestimmen() und die sv_*-Funktionen, nie mit eigener Abfrage
  // -- die Pruefung direkt darunter bewacht das.
  'support_anfrage.php',
  // Der Zeitgeber (ENT-538). Er traegt seit der Erinnerung eine zweite
  // Aufgabe, die in der Betreiber-Datenbank steht.
  'push_versand.php',
  // Die Ersteinrichtung (ENT-529). Sie legt die Betreiber-Tabellen an,
  // solange der Bootstrap offen ist -- aelter als die Supportvorgaenge und
  // hier nur der Vollstaendigkeit halber genannt.
  'planung_einrichten.php',
];
const apiDateien = readdirSync(`${WURZEL}/backend/api`).filter(f => f.endsWith('.php'));
const fremdeNutzer = apiDateien.filter(f => {
  if (BETREIBER_EBENE_ERLAUBT.includes(f)) { return false; }
  return /betreiber_db\s*\(/.test(ohneKommentar(readFileSync(`${WURZEL}/backend/api/${f}`, 'utf8')));
});
check('KRITISCH: nur namentlich genannte Endpunkte greifen auf die Betreiber-Ebene zu',
  fremdeNutzer.length === 0);
if (fremdeNutzer.length) {
  bad.push('greift ungenannt auf die Betreiber-Ebene zu: ' + fremdeNutzer.join(', '));
}
// Die Liste selbst darf nicht veralten: Ein genannter Endpunkt, der die
// Ebene gar nicht mehr beruehrt, verdeckt sonst still einen neuen gleichen
// Namens.
const totInListe = BETREIBER_EBENE_ERLAUBT.filter(f =>
  !apiDateien.includes(f)
  || (!f.startsWith('betreiber_')
      && !/betreiber_db\s*\(/.test(ohneKommentar(readFileSync(`${WURZEL}/backend/api/${f}`, 'utf8')))));
check('Die Ausnahmeliste nennt nur Endpunkte, die es gibt und die die Ebene wirklich beruehren',
  totInListe.length === 0);
if (totInListe.length) { bad.push('Ausnahme ohne Zugriff: ' + totInListe.join(', ')); }

// Der Kundenendpunkt liest aus der Betreiber-Ebene NUR Supportvorgaenge --
// kein Mandantenstamm, keine Konten, keine Sitzungen.
check('KRITISCH: der Kundenendpunkt fragt die Betreiber-Ebene nur ueber die Supportfunktionen ab',
  !/betreiber_db\(\)\s*->\s*(query|prepare)/.test(kundeOhne)
  && !/FROM\s+(mandant|betreiber|betreiber_sessions)/i.test(kundeOhne));

// Die Zuordnung selbst liest den Stamm -- aber nur Name und db_name, nicht
// die Zugangsdaten der fremden Datenbanken.
check('KRITISCH: die Mandantenzuordnung liest keine Zugangsdaten fremder Betriebe',
  /SELECT id, name, db_name FROM mandant/.test(ohneKommentar(KERN))
  && !/db_user|secret_name/.test(ohneKommentar(KERN)));

// ── Der Zeitgeber ───────────────────────────────────────────────────
//
// Der Support-Nachlauf muss VOR den Push-Aussteigern stehen: Darunter
// beendet sich der Endpunkt, wenn Push nicht eingerichtet ist -- und dann
// liefe die Erinnerung auf jeder Anlage ohne Push nie. Das faellt nicht
// auf, weil nichts rot wird; es passiert einfach nichts.
const zg = ohneKommentar(ZEITGEB);
const posNachlauf = zg.indexOf('sv_erinnerungen_versenden');
const posAussteiger = zg.search(/push_konfiguriert\(\)/);
check('KRITISCH: der Support-Nachlauf laeuft auch auf einer Anlage ohne Push',
  posNachlauf !== -1 && posAussteiger !== -1 && posNachlauf < posAussteiger);
check('KRITISCH: ein Fehler im Support-Nachlauf haelt den Push-Versand nicht auf',
  /try\s*\{[\s\S]{0,200}sv_erinnerungen_versenden[\s\S]{0,200}catch/.test(zg));

// ── Die Mail traegt keinen Anfragetext ──────────────────────────────
check('KRITISCH: der Versand baut die Mail ausschliesslich aus Betreff und Kopfangaben',
  !/\$vorgang\['text'\]|\$werte\['text'\]/.test(
    (ohneKommentar(KERN).match(/function sv_mail_text[\s\S]*?\n}/) || [''])[0]));

// ══════════════════════════════════════════════════════════════════════
// TEIL 3 — Die Oberflaeche wird GEMESSEN
// ══════════════════════════════════════════════════════════════════════
const browser = await chromium.launch({ executablePath: browserPfad() });
const VORRAT_HTML  = pathToFileURL(join(WURZEL, 'betreiber.html')).href;
const COCKPIT_HTML = pathToFileURL(join(WURZEL, 'dashboard.html')).href;

// Testdaten: bewusst mit allen vier Status und einem Vorgang, dessen
// Betrieb es nicht mehr gibt -- fuer die Frage, ob "unbekannt" als solches
// erscheint.
const ANTWORT = {
  status: 'ok', lage: 'ok', offen: 2,
  vorgaenge: [
    { id: 1, mandant_id: 1, mandant: 'Betrieb A', betreff: 'Rundgang bricht ab',
      art: 'stoerung', art_wort: 'Störung', status: 'neu', status_wort: 'Neu',
      melder_name: 'Testperson', melder_rolle: 'Verwaltung', bildschirm: 'Revierdienst',
      umgebung: 'Chrome · 1500×900', eroeffnet_am: vorTagen(10),
      geaendert_am: null, erinnert_am: null, nachrichten: 1, letzte_seite: 'kunde' },
    { id: 2, mandant_id: 2, mandant: 'Betrieb B', betreff: 'Frage zur Auswertung',
      art: 'frage', art_wort: 'Frage', status: 'in_arbeit', status_wort: 'In Arbeit',
      melder_name: 'Testperson', melder_rolle: 'Verwaltung', bildschirm: 'Auswertung',
      umgebung: 'Firefox · 390×844', eroeffnet_am: vorTagen(9),
      geaendert_am: vorTagen(9), erinnert_am: null, nachrichten: 3,
      letzte_seite: 'betreiber' },
    { id: 3, mandant_id: 9, mandant: 'Unbekannter Mandant', betreff: 'Wunsch: Filter merken',
      art: 'wunsch', art_wort: 'Wunsch', status: 'wartet_auf_kunde',
      status_wort: 'Wartet auf Kunde', melder_name: '', melder_rolle: '', bildschirm: '',
      umgebung: '', eroeffnet_am: vorTagen(22), geaendert_am: vorTagen(21),
      erinnert_am: null, nachrichten: 2, letzte_seite: 'betreiber' },
    { id: 4, mandant_id: 1, mandant: 'Betrieb A', betreff: 'Erledigte Sache',
      art: 'frage', art_wort: 'Frage', status: 'erledigt', status_wort: 'Erledigt',
      melder_name: 'Testperson', melder_rolle: 'Verwaltung', bildschirm: 'Lohn',
      umgebung: 'Safari · 1200×800', eroeffnet_am: vorTagen(41),
      geaendert_am: vorTagen(40), erinnert_am: null, nachrichten: 4,
      letzte_seite: 'betreiber' },
  ],
  status_liste: ['neu', 'in_arbeit', 'wartet_auf_kunde', 'erledigt'],
  __alt: vorTagen(10),
};

async function vorratSeite(antwort, breite = 1500) {
  const seite = await browser.newPage({ viewport: { width: breite, height: 900 } });
  await seite.addInitScript(a => {
    window.__ANTWORT = a;
    window.fetch = async (pfad) => new Response(
      JSON.stringify(String(pfad).includes('?id=')
        ? { status: 'ok',
            vorgang: a.vorgaenge.find(v => v.id === Number(String(pfad).split('?id=')[1]))
                     || a.vorgaenge[0],
            nachrichten: [
            { id: 1, seite: 'kunde', autor: 'Testperson', text: 'Der Rundgang bricht ab.',
              erstellt_am: a.__alt },
            { id: 2, seite: 'betreiber', autor: 'Support', text: 'Wir sehen nach.',
              erstellt_am: a.__alt }] }
        : a),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }, antwort);
  await seite.goto(VORRAT_HTML);
  await seite.evaluate(() => {
    document.getElementById('tor').classList.add('versteckt');
    document.getElementById('haus').classList.remove('versteckt');
  });
  return seite;
}

{
  const seite = await vorratSeite(ANTWORT);
  await seite.evaluate(() => { bereichZeigen('support'); return ladeSupport(); });
  await seite.waitForTimeout(120);

  // Das Abzeichen: "ganz deutlich sehen" war die Anforderung.
  const abz = await seite.evaluate(() => {
    const el = document.getElementById('nav-sv-abz');
    const r = el.getBoundingClientRect();
    return { versteckt: el.hidden, text: el.textContent,
             breite: r.width, hoehe: r.height,
             sichtbar: getComputedStyle(el).display !== 'none',
             angesagt: el.closest('.nav-item').getAttribute('aria-label') };
  });
  check('KRITISCH: das Abzeichen am Reiter ist sichtbar, wenn etwas offen ist',
    !abz.versteckt && abz.sichtbar && abz.breite > 0 && abz.hoehe > 0);
  check('KRITISCH: das Abzeichen zeigt nur, was auf UNS wartet (nicht "wartet auf Kunde")',
    abz.text === '2');
  check('Das Abzeichen wird auch angesagt, nicht nur eingefaerbt',
    /2 Anfragen warten/.test(abz.angesagt || ''));

  // Vier Status, vier verschiedene Woerter -- gemessen am gerenderten Text.
  const worte = await seite.evaluate(() =>
    [...document.querySelectorAll('#sv-inhalt .merker')].map(e => e.textContent.trim()));
  const zellen = await seite.evaluate(() =>
    [...document.querySelectorAll('#sv-inhalt tbody tr')].length);
  check('Der Vorrat zeigt zunaechst nur die offenen Vorgaenge', zellen === 2);
  check('KRITISCH: verschiedene Status tragen verschiedene Woerter',
    new Set(worte).size === worte.length);

  // "Alle" zeigt alles, und die vier Status bleiben unterscheidbar.
  await seite.evaluate(() => { document.getElementById('knopf-sv-alle').click(); });
  await seite.waitForTimeout(120);
  const alleWorte = await seite.evaluate(() =>
    [...document.querySelectorAll('#sv-inhalt .merker')].map(e => e.textContent.trim()));
  check('Mit "Alle" stehen alle vier Vorgaenge da', alleWorte.length === 4);
  check('KRITISCH: alle vier Status sind im Text unterscheidbar',
    new Set(alleWorte).size === 4);
  check('KRITISCH: "wartet auf Kunde" heisst weder offen noch erledigt',
    alleWorte.some(w => /wartet/i.test(w))
    && !alleWorte.filter(w => /wartet/i.test(w)).some(w => /^erledigt$/i.test(w)));

  // Ein Betrieb, den es nicht mehr gibt, wird als unbekannt benannt --
  // nicht als leere Zelle.
  const unbekannt = await seite.evaluate(() =>
    document.getElementById('sv-inhalt').textContent.includes('Unbekannter Mandant'));
  check('KRITISCH: ein geloeschter Betrieb erscheint als "unbekannt", nicht als Leerstelle',
    unbekannt);

  // Der Filter, der alles ausblendet, darf nie wie ein leerer Vorrat
  // aussehen. Genau diese Hausregel ist hier am haeufigsten verletzt worden.
  const seite2 = await vorratSeite({ ...ANTWORT, offen: 0,
    vorgaenge: ANTWORT.vorgaenge.filter(v => v.status === 'erledigt') });
  await seite2.evaluate(() => { bereichZeigen('support'); return ladeSupport(); });
  await seite2.waitForTimeout(120);
  const kFilter = await seite2.evaluate(() => document.getElementById('sv-inhalt').textContent);
  const seite3 = await vorratSeite({ ...ANTWORT, offen: 0, vorgaenge: [] });
  await seite3.evaluate(() => { bereichZeigen('support'); return ladeSupport(); });
  await seite3.waitForTimeout(120);
  const kLeer = await seite3.evaluate(() => document.getElementById('sv-inhalt').textContent);
  check('KRITISCH: "kein Treffer" und "nichts vorhanden" sind verschiedene Texte',
    kFilter.trim() !== kLeer.trim() && kFilter.length > 10 && kLeer.length > 10);

  // Und "nicht eingerichtet" ist die dritte Aussage.
  const seite4 = await vorratSeite({ lage: 'nicht_eingerichtet', status: 'error' });
  await seite4.evaluate(() => { bereichZeigen('support'); return ladeSupport(); });
  await seite4.waitForTimeout(120);
  const kNicht = await seite4.evaluate(() => document.getElementById('sv-inhalt').textContent);
  check('KRITISCH: "nicht eingerichtet" ist eine dritte, eigene Aussage',
    kNicht.trim() !== kLeer.trim() && kNicht.trim() !== kFilter.trim()
    && /eingerichtet/i.test(kNicht));
  const abzAus = await seite4.evaluate(() => document.getElementById('nav-sv-abz').hidden);
  check('Ohne offene Vorgaenge traegt der Reiter kein Abzeichen', abzAus === true);

  // DIE LUECKE, DIE DIESE PRUEFUNG BEWACHT: Die Tabellen der Betreiber-Ebene
  // legt sonst nur der Einrichtungsknopf des Cockpits an -- und der zeigt
  // sich ausschliesslich, SOLANGE der Bootstrap offen ist (ENT-529). Auf
  // einer Anlage mit bestehendem Betreiber-Konto gaebe es ohne diesen Knopf
  // keinen Weg mehr, eine neu dazugekommene Tabelle anzulegen; der
  // Supportkanal bliebe dort dauerhaft "nicht eingerichtet".
  const einr = await seite4.evaluate(() => {
    const k = document.getElementById('knopf-sv-einrichten');
    if (!k) { return null; }
    return { hoehe: k.getBoundingClientRect().height, hatKlick: typeof k.onclick === 'function' };
  });
  check('KRITISCH: "nicht eingerichtet" bietet den Handgriff an, statt ihn nur zu benennen',
    !!einr && einr.hatKlick);
  check('Der Einrichtungsknopf erreicht die 44-px-Trefferflaeche', einr && einr.hoehe >= 44);
  await seite2.close(); await seite3.close(); await seite4.close();

  // Der Verlauf: wer geschrieben hat, muss ohne Lesen erkennbar sein.
  await seite.evaluate(() => svOeffnen(1));
  await seite.waitForTimeout(150);
  const seiten = await seite.evaluate(() => {
    const c = document.getElementById('sv-verlauf').getBoundingClientRect();
    const hol = k => {
      const e = document.querySelector('#sv-verlauf .' + k);
      if (!e) { return null; }
      const r = e.getBoundingClientRect();
      return { linksAbstand: r.left - c.left, rechtsAbstand: c.right - r.right };
    };
    return { anzahl: document.querySelectorAll('#sv-verlauf .sv-n').length,
             kunde: hol('sv-kunde'), betreiber: hol('sv-betreiber') };
  });
  // EIN VERGLEICH DER LINKEN KANTEN GENUEGT NICHT: Stehen beide Blasen
  // rechtsbuendig, unterscheiden sich ihre linken Kanten trotzdem, sobald
  // die Texte verschieden lang sind -- die Gegenprobe blieb darum gruen.
  // Geprueft wird jetzt die Aussage: die eine beginnt am linken Rand, die
  // andere endet am rechten.
  check('KRITISCH: der Beitrag des Betriebs steht am linken Rand',
    seiten.anzahl === 2 && seiten.kunde && seiten.kunde.linksAbstand < 2);
  check('KRITISCH: der Beitrag des Supports steht am rechten Rand',
    seiten.betreiber && seiten.betreiber.rechtsAbstand < 2);
  check('KRITISCH: die beiden Seiten sind nicht gleich ausgerichtet',
    seiten.kunde && seiten.betreiber
    && Math.abs(seiten.kunde.linksAbstand - seiten.betreiber.linksAbstand) > 4);

  // Die Kopfangaben, die die Rueckfrage ersparen -- und die Hausregel,
  // dass eine fehlende Angabe als fehlend benannt wird.
  const kontext = await seite.evaluate(() => document.getElementById('sv-kontext').textContent);
  check('Der mitgeschickte Kontext steht im Vorgang', /Revierdienst/.test(kontext));
  await seite.evaluate(() => svOeffnen(3));
  await seite.waitForTimeout(150);
  const kontext3 = await seite.evaluate(() => document.getElementById('sv-kontext').textContent);
  check('KRITISCH: eine fehlende Kontextangabe wird benannt, nicht weggelassen',
    /nicht mitgeschickt/.test(kontext3));
  await seite.close();
}

// ── Am Telefon ──────────────────────────────────────────────────────
{
  const seite = await vorratSeite(ANTWORT, 390);
  await seite.setViewportSize({ width: 390, height: 844 });
  await seite.evaluate(() => { bereichZeigen('support'); return ladeSupport(); });
  await seite.waitForTimeout(150);
  await seite.evaluate(() => svOeffnen(1));
  await seite.waitForTimeout(150);
  const mass = await seite.evaluate(() => ({
    ueberlauf: document.documentElement.scrollWidth > window.innerWidth + 1,
    antwortSchrift: parseFloat(getComputedStyle(document.getElementById('sv-antwort')).fontSize),
    knopf: document.getElementById('knopf-sv-senden').getBoundingClientRect().height,
    blase: Math.max(...[...document.querySelectorAll('#sv-verlauf .sv-n')]
      .map(e => e.getBoundingClientRect().width)),
  }));
  check('KRITISCH: am Telefon laeuft der Supportbereich nicht seitlich ueber', !mass.ueberlauf);
  check('KRITISCH: das Antwortfeld traegt mindestens 16 px (sonst zoomt iOS hinein)',
    mass.antwortSchrift >= 16);
  check('Der Sendeknopf erreicht die 44-px-Trefferflaeche', mass.knopf >= 44);
  check('Die Verlaufsblasen passen in die Telefonbreite', mass.blase <= 390);
  await seite.close();
}

// ── Die Kundenseite im Cockpit ──────────────────────────────────────
{
  const seite = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await seite.route('**/api/**', route => {
    const u = route.request().url();
    const send = b => route.fulfill({ status: 200, contentType: 'application/json',
                                      body: JSON.stringify(b) });
    if (u.includes('login')) { return send({ status: 'ok', token: 't', name: 'a', ist_admin: true }); }
    return send({ status: 'ok', einsaetze: [], kunden: [], rapporte: [], objekte: [],
                  mitarbeiter: [], feiertage: [], gepflegt: {}, sperren: [] });
  });
  await seite.goto(COCKPIT_HTML);
  await seite.fill('#gName', 'a'); await seite.fill('#gPass', 'x'); await seite.click('#gBtn');
  await seite.waitForSelector('#shell.on');
  await seite.waitForTimeout(400);

  // Die Kachel fuehrt in den Abschnitt -- und zwar OHNE die Rechtehuerde
  // der Freigabe: Wer fragt, oeffnet niemandem die Tuer.
  const kachel = await seite.evaluate(() => {
    const k = [...document.querySelectorAll('.bk-kachel')]
      .find(b => /Supportanfrage/.test(b.textContent));
    if (!k) { return null; }
    const r = k.getBoundingClientRect();
    return { da: true, hoehe: r.height, ruft: k.getAttribute('onclick') || '',
             versteckt: k.style.display === 'none' };
  });
  check('KRITISCH: die Kachel "Supportanfrage" steht in den Einstellungen', !!kachel);
  check('KRITISCH: sie ist nicht an die Rechtehuerde der Freigabe gebunden',
    kachel && !kachel.versteckt);
  check('Die Kachel fuehrt in den Supportabschnitt', kachel && /bkAb|sa/.test(kachel.ruft));

  // Die Statuswoerter des Betriebs: "wartet auf Kunde" heisst aus seiner
  // Sicht "Antwort erhalten" -- derselbe Zustand, die andere Blickrichtung.
  await seite.evaluate(() => go('betrieb'));
  await seite.waitForTimeout(120);
  const worte = await seite.evaluate(() =>
    Object.entries(SA_STATUS).map(([k, v]) => [k, v[1]]));
  const nurWorte = worte.map(w => w[1]);
  check('KRITISCH: der Betrieb sieht fuer jeden Status ein eigenes Wort',
    new Set(nurWorte).size >= 3);
  check('KRITISCH: aus Sicht des Betriebs heisst "wartet auf Kunde" nicht "wartet"',
    !/wartet/i.test((worte.find(w => w[0] === 'wartet_auf_kunde') || ['', ''])[1]));

  // Der mitgeschickte Kontext darf nichts Personenbezogenes tragen.
  const umgebung = await seite.evaluate(() => saUmgebung());
  check('KRITISCH: die mitgeschickte Umgebung ist kurz und traegt keinen vollen User-Agent',
    umgebung.length < 60 && !/Mozilla|AppleWebKit|Gecko/.test(umgebung));

  // Gemessen: die Zeile und der Verlauf.
  await seite.evaluate(([alt1, alt2]) => {
    go('betrieb');
    bkAbschnittZeigen('sa');
    saListeZeichnen([
      { id: 1, betreff: 'Rundgang bricht ab', status: 'neu',
        eroeffnet_am: alt1, nachrichten: 1 },
      { id: 2, betreff: 'Frage zur Auswertung', status: 'wartet_auf_kunde',
        eroeffnet_am: alt2, nachrichten: 3 },
    ]);
  }, [vorTagen(10), vorTagen(9)]);
  await seite.waitForTimeout(80);
  const zeilen = await seite.evaluate(() =>
    [...document.querySelectorAll('#saListe .sa-zeile')].map(e => ({
      hoehe: e.getBoundingClientRect().height,
      chip: !!e.querySelector('.chip'),
      chipFarbe: e.querySelector('.chip') ? getComputedStyle(e.querySelector('.chip')).backgroundColor : '',
    })));
  check('Die Anfragezeilen stehen da', zeilen.length === 2);
  check('KRITISCH: jede Anfragezeile erreicht die 44-px-Trefferflaeche',
    zeilen.every(z => z.hoehe >= 44));
  check('KRITISCH: der Status ist eingefaerbt und nicht nur Text',
    zeilen.every(z => z.chip && z.chipFarbe && z.chipFarbe !== 'rgba(0, 0, 0, 0)'));

  // Leer ist etwas anderes als nicht abrufbar.
  await seite.evaluate(() => saListeZeichnen([]));
  const leerText = await seite.evaluate(() => document.getElementById('saListe').textContent);
  check('KRITISCH: "noch keine Anfrage" ist ein eigener Satz und keine leere Flaeche',
    leerText.trim().length > 10);
  await seite.close();
}

await browser.close();
console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
