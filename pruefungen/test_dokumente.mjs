// Dokumente zum Einsatz (ENT-117).
//
// Der Planer hängt ein PDF an, die eingeteilte Person öffnet es in der App --
// Objektplan, Verkehrsanordnung, Sicherheitskonzept.
//
// Warum diese Suite scharf sein muss: Hier verlässt zum ersten Mal eine
// Kundenunterlage das System als Datei. Wer eine Nummer raten kann und dabei
// fremde Unterlagen bekommt, hat kein Anzeigeproblem, sondern ein Leck. Die
// Rechteprüfung liegt darum im Endpunkt und wird hier am Quelltext geprüft --
// eine Prüfung in der Oberfläche wäre keine.
//
// Der zweite empfindliche Punkt ist die Reihenfolge: Auf der Seite "Neue
// Schicht" gibt es beim Anhängen noch keine Einsatznummer. Wird zu früh
// hochgeladen, landet die Datei nirgends; wird nach einem Abbruch hochgeladen,
// landet sie am falschen Einsatz.
import { WURZEL, browserPfad } from './pfade.mjs';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const EXE = browserPfad();
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const tag = n => iso(new Date(Date.now() + n * 864e5));
const MORGEN = tag(1);
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

// Ein gültiges Mini-PDF. Der Endpunkt prüft am Inhalt, nicht an der Endung --
// die ersten fünf Zeichen sind also nicht Beiwerk, sondern der Prüfgegenstand.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const datei = (name, buffer) => ({ name, mimeType: 'application/pdf', buffer: buffer || PDF });

// ══════════════════════════════════════════════════════════════════════════
// TEIL 1 — Der Endpunkt (Quelltext)
// ══════════════════════════════════════════════════════════════════════════
const EP = readFileSync(`${WURZEL}/backend/api/einsatz_dokument.php`, 'utf8');
const EINR = readFileSync(`${WURZEL}/backend/api/planung_einrichten.php`, 'utf8');

check('KRITISCH: das Anhängen verlangt das Planungsrecht',
  /require_recht\(\$user,\s*'plan'\)/.test(EP));
check('KRITISCH: wer nicht plant, sieht nur die Einsätze, auf denen er eingeteilt ist',
  /FROM einsatz_zuteilung WHERE einsatz_id = \? AND mitarbeiter_id = \?/.test(EP));
check('KRITISCH: die mitarbeiter_id kommt aus der Sitzung, nicht aus der Anfrage',
  /\(int\)\$user\['id'\]\]\)/.test(EP) && !/mitarbeiter_id.*\$_GET|\$in\['mitarbeiter_id'\]/.test(EP));
check('KRITISCH: die Ausgabe eines Dokuments prüft die Zugriffsrechte',
  /dok_zugriff\(\$pdo, \$user, \(int\)\$d\['einsatz_id'\]\)/.test(EP));
check('KRITISCH: "gibt es nicht" und "darfst du nicht" antworten gleich (404)',
  /!\$d \|\| !dok_zugriff[\s\S]{0,400}?'Nicht gefunden\.'\], 404\)/.test(EP));
check('KRITISCH: der Typ wird am Inhalt geprüft, nicht an der Endung',
  /substr\(\$roh, 0, 5\) !== '%PDF-'/.test(EP));
check('KRITISCH: der vom Browser gemeldete MIME-Typ wird nicht übernommen',
  !/\$in\['mime'\]/.test(EP) && /'application\/pdf'/.test(EP));
// Kein Regex: Der Ausdruck selbst besteht aus Rückschrägstrichen, und eine
// Prüfung, die man beim Lesen nicht mehr versteht, prüft irgendwann das
// Falsche. Ein Textvergleich sagt dasselbe und bleibt lesbar.
check('KRITISCH: der Dateiname verliert Pfadanteile',
  EP.includes("basename(str_replace('\\\\', '/', $name))"));
check('KRITISCH: Steuerzeichen fliegen aus dem Dateinamen (Header-Einschleusung)',
  EP.includes("preg_replace('/[\\x00-\\x1F\\x7F]/u', '', $name)"));
check('KRITISCH: eine Grössengrenze besteht', /DOK_MAX/.test(EP) && /strlen\(\$roh\) > DOK_MAX/.test(EP));
check('Die Grenze liegt bei 4 MB', /const DOK_MAX = 4 \* 1024 \* 1024;/.test(EP));
check('KRITISCH: eine festgeschriebene Schicht nimmt nichts mehr an (ENT-045)',
  (EP.match(/einsatz_sperre_pruefen\(/g) || []).length >= 2);
check('KRITISCH: der Browser führt das Dokument nicht als HTML aus',
  /X-Content-Type-Options: nosniff/.test(EP) && /Content-Security-Policy: sandbox/.test(EP));
check('Der Dateiname im Header wird entschärft',
  /Content-Disposition[\s\S]{0,80}preg_replace/.test(EP));
check('Die Liste schleppt den Inhalt nicht mit',
  /SELECT id, dateiname, mime, groesse, hochgeladen_am/.test(EP));
check('Alle Abfragen sind vorbereitet, nichts wird zusammengesetzt',
  !/\$pdo->query\(/.test(EP) && !/"\s*\.\s*\$/.test(EP.replace(/\/\/.*/g, '')));
check('KRITISCH: die Tabelle wird bei der Einrichtung angelegt',
  /CREATE TABLE IF NOT EXISTS einsatz_dokument/.test(EINR));
check('KRITISCH: das Dokument verschwindet mit seinem Einsatz',
  /REFERENCES einsaetze\(id\) ON DELETE CASCADE/.test(
    (EINR.match(/CREATE TABLE IF NOT EXISTS einsatz_dokument[\s\S]*?ENGINE=InnoDB/) || [''])[0]));

// Der Deploy kopiert backend/api/*.php als Ganzes -- aber genau das muss so
// bleiben, sonst fehlt der neue Endpunkt produktiv.
const WF = readFileSync(`${WURZEL}/.github/workflows/deploy-hostpoint.yml`, 'utf8');
check('KRITISCH: der Endpunkt wird deployt',
  /cp\s+backend\/api\/\*\.php\s+dist\/api\//.test(WF) || /cp\s+backend\/api\/einsatz_dokument\.php/.test(WF));

// ══════════════════════════════════════════════════════════════════════════
// TEIL 2 — Die Planungsoberfläche
// ══════════════════════════════════════════════════════════════════════════
const MA = [{ id: 1, name: 'adrian', vorname: 'Adrian', nachname: 'von Arb', aktiv: 1, ist_admin: 1 }];
const KU = [{ id: 1, name: 'Stranag', strasse: 'Kantonsstrasse 3', ort: '6000 Luzern' }];
const EINSAETZE = [
  { id: 81, kunde_id: 1, kunde_name: 'Stranag', titel: null, strasse: 'Kantonsstrasse 3',
    ort: '6000 Luzern', kanton: 'LU', einsatzart: 'Verkehrsdienst', sparte: 'sicherheit',
    datum: MORGEN, von: '07:30:00', bis: '16:30:00', bedarf: 1, status: 'geplant',
    bemerkung: null, objekt_id: null, mitarbeiter: [] },
  // Abgeglichen und festgeschrieben: hier darf nichts mehr angehängt werden.
  { id: 82, kunde_id: 1, kunde_name: 'Fest', titel: null, strasse: 'Kantonsstrasse 3',
    ort: '6000 Luzern', kanton: 'LU', einsatzart: 'Verkehrsdienst', sparte: 'sicherheit',
    datum: tag(-1), von: '07:30:00', bis: '16:30:00', bedarf: 1, status: 'geplant',
    ist_status: 'anwesend', bemerkung: null, objekt_id: null, mitarbeiter: [] },
];

// Nachbau des Endpunkts, so weit die Oberfläche ihn sieht.
// 82 bekommt bewusst AUCH ein Dokument. Ohne eines wäre die Prüfung "an einer
// festgeschriebenen Schicht wird nichts entfernt" wirkungslos: Wo nichts
// steht, gibt es auch ohne Regel keinen Knopf zum Entfernen.
const DOK = { 81: [{ id: 900, dateiname: 'Objektplan.pdf', mime: 'application/pdf',
                     groesse: 234567, hochgeladen_am: tag(-2) + ' 10:00:00' }],
              82: [{ id: 800, dateiname: 'Altes Konzept.pdf', mime: 'application/pdf',
                     groesse: 100000, hochgeladen_am: tag(-9) + ' 10:00:00' }] };
let dokSeq = 900;
let dokFehler = false;          // erzwingt eine Fehlerantwort beim Hochladen
const rufe = [];

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => bad.push('JS-Fehler: ' + e.message));

await page.route('**/api/**', route => {
  const req = route.request(), url = req.url(), p = url.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  rufe.push({ p, body, url });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'adrian', ist_admin: true });
  if (p.includes('mitarbeiter_list')) return send({ status: 'ok', mitarbeiter: MA });
  if (p.includes('kunden_list')) return send({ status: 'ok', kunden: KU });
  if (p.includes('einsatz_list')) return send({ status: 'ok', einsaetze: EINSAETZE });
  if (p.includes('einsatz_dokument')) {
    if (!body) {
      // Ein einzelnes Dokument kommt als PDF zurück, nicht als JSON.
      if (/[?&]id=/.test(url)) {
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF });
      }
      const eid = Number(url.split('einsatz_id=')[1]);
      return send({ status: 'ok', dokumente: DOK[eid] || [] });
    }
    if (body.aktion === 'hochladen') {
      if (dokFehler) return send({ status: 'error', message: 'Hochladen fehlgeschlagen.' });
      const eid = Number(body.einsatz_id);
      DOK[eid] = DOK[eid] || [];
      DOK[eid].push({ id: ++dokSeq, dateiname: body.dateiname, mime: 'application/pdf',
        groesse: Buffer.from(body.inhalt || '', 'base64').length, hochgeladen_am: tag(0) + ' 08:00:00' });
      return send({ status: 'ok', id: dokSeq, dateiname: body.dateiname });
    }
    if (body.aktion === 'entfernen') {
      Object.keys(DOK).forEach(k => { DOK[k] = DOK[k].filter(d => d.id !== Number(body.id)); });
      return send({ status: 'ok' });
    }
    return send({ status: 'ok' });
  }
  if (p.includes('einsatz_position')) {
    const id = Number((body && body.einsatz_id) || url.split('einsatz_id=')[1] || 0);
    return send({ status: 'ok', positionen: [{ id: 700, nr: 1, funktion: 'Verkehrsdienst',
      position: null, von: '07:30:00', bis: '16:30:00', std_verrechnung: null, pauschal: null,
      qualifikation: null, gesperrt: 0, bemerkung: null, mitarbeiter_id: null, mitarbeiter: null,
      vorname: null, nachname: null, zusage: null, einsatz_id: id }] });
  }
  if (p.includes('einsatz_save')) return send({ status: 'ok', id: 91 });
  if (p.includes('dashboard_stats')) return send({ status: 'ok', kpi: { rapporte_monat: 0,
    rapporte_vormonat: 0, stunden_monat: 0, stunden_vormonat: 0, mitarbeiter: 1, kunden: 1,
    rapporte_total: 0 }, verlauf: [], angemeldet: [], pro_mitarbeiter: [], letzte_rapporte: [],
    sperr_ereignisse: [] });
  return send({ status: 'ok', einsaetze: [], rapporte: [], objekte: [], feiertage: [],
    gepflegt: {}, sperren: [], adressen: [], wege: [], fahrzeuge: [] });
});

await page.goto(`file://${WURZEL}/dashboard.html`);
await page.fill('#gName', 'adrian'); await page.fill('#gPass', 'x'); await page.click('#gBtn');
await page.waitForSelector('#shell.on'); await page.waitForTimeout(500);

const zeilen = () => page.evaluate(() =>
  [...document.querySelectorAll('#enNDokListe .dok-zeile')].map(z => z.textContent.replace(/\s+/g, ' ').trim()));
const hochladeRufe = () => rufe.filter(r => r.body && r.body.aktion === 'hochladen');

// ── Die Seite "Neue Schicht" öffnen
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(400);
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(400);
check('Die Seite "Neue Schicht" steht offen', await page.isVisible('#view-einsatzneu'));
// Nicht auf Sichtbarkeit prüfen: Die leere Liste blendet sich absichtlich aus
// (.dok-liste:empty), sonst stünde eine leere Fläche unter der Beschriftung.
check('Es gibt einen Bereich für Dokumente',
  await page.evaluate(() => !!document.getElementById('enNDokListe')));
check('Und einen Knopf zum Anhängen',
  await page.evaluate(() => [...document.querySelectorAll('#view-einsatzneu button')]
    .some(b => b.textContent.includes('PDF anhängen'))));
check('Ohne Anhang steht keine leere Fläche da',
  await page.evaluate(() => getComputedStyle(document.getElementById('enNDokListe')).display === 'none'));

// ── Anhängen
await page.setInputFiles('#enNDokDatei', datei('Verkehrsanordnung.pdf'));
await page.waitForTimeout(300);
const nach1 = await zeilen();
check('Das angehängte PDF steht in der Liste',
  nach1.length === 1 && nach1[0].includes('Verkehrsanordnung.pdf'));
check('Die Grösse steht dabei', /\d+\s?KB/.test(nach1[0]));
check('KRITISCH: vor dem Speichern wird nichts hochgeladen', hochladeRufe().length === 0);

// ── Was nicht angenommen wird
await page.setInputFiles('#enNDokDatei', datei('Verkehrsanordnung.pdf'));
await page.waitForTimeout(250);
check('Dieselbe Datei zweimal wird abgewiesen', (await zeilen()).length === 1);
check('Und begründet', (await page.textContent('#enNDokErr')).includes('schon angehängt'));

await page.setInputFiles('#enNDokDatei',
  { name: 'liste.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('PK') });
await page.waitForTimeout(250);
check('KRITISCH: was kein PDF ist, wird abgewiesen', (await zeilen()).length === 1);
check('Und begründet', (await page.textContent('#enNDokErr')).includes('Nur PDF'));

await page.setInputFiles('#enNDokDatei', datei('riesig.pdf', Buffer.concat([PDF, Buffer.alloc(4.2 * 1024 * 1024)])));
await page.waitForTimeout(500);
check('KRITISCH: zu grosse Dateien werden abgewiesen', (await zeilen()).length === 1);
const grossErr = await page.textContent('#enNDokErr');
check('Die Meldung nennt die Grenze und die tatsächliche Grösse',
  grossErr.includes('4 MB') && /MB gross/.test(grossErr));

// ── Entfernen vor dem Speichern
await page.setInputFiles('#enNDokDatei', datei('Sicherheitskonzept.pdf'));
await page.waitForTimeout(300);
check('Ein zweites Dokument lässt sich anhängen', (await zeilen()).length === 2);
await page.evaluate(() => { const b = document.querySelectorAll('#enNDokListe .dok-zeile button')[0]; if (b) b.click(); });
await page.waitForTimeout(200);
const nachWeg = await zeilen();
check('Ein angehängtes Dokument lässt sich wieder entfernen',
  nachWeg.length === 1 && nachWeg[0].includes('Sicherheitskonzept.pdf'));

// ── Abbrechen: nichts wird hochgeladen, nichts bleibt kleben
await page.evaluate(() => enNeuAbbrechen());
await page.waitForTimeout(300);
check('KRITISCH: nach dem Abbrechen wurde nichts hochgeladen', hochladeRufe().length === 0);
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(400);
check('KRITISCH: der Anhang klebt nicht am nächsten Einsatz', (await zeilen()).length === 0);
check('Die Fehlermeldung ist beim Neuöffnen weg', !(await page.isVisible('#enNDokErr')));

// ── Speichern: jetzt erst wird hochgeladen, und zwar an die neue Nummer
await page.setInputFiles('#enNDokDatei', datei('Objektplan.pdf'));
await page.waitForTimeout(300);
await page.evaluate(() => {
  $('enNKunde_name').value = 'Stranag';
  $('enNStrasse').value = 'Kantonsstrasse 3';
  $('enNOrt').value = '6000 Luzern';
  $('enNKanton').value = 'LU';
  $('enNDatum').value = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  $('enNVon').value = '07:30'; $('enNBis').value = '16:30';
});
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(800);
const hoch = hochladeRufe();
check('KRITISCH: nach dem Speichern wird hochgeladen', hoch.length === 1);
check('KRITISCH: und zwar an die Nummer aus der Speicherantwort',
  hoch.length === 1 && Number(hoch[0].body.einsatz_id) === 91);
check('Der Dateiname wird mitgeschickt',
  hoch.length === 1 && hoch[0].body.dateiname === 'Objektplan.pdf');
check('KRITISCH: der Inhalt kommt als base64, nicht als Text',
  hoch.length === 1 && Buffer.from(hoch[0].body.inhalt, 'base64').slice(0, 5).toString() === '%PDF-');
check('KRITISCH: das Hochladen läuft NACH dem Speichern, nicht davor',
  rufe.findIndex(r => r.p.includes('einsatz_save')) <
  rufe.findIndex(r => r.body && r.body.aktion === 'hochladen'));

// ── Ein fehlgeschlagener Anhang darf nicht unter "Einsatz angelegt" verschwinden
dokFehler = true;
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(400);
await page.setInputFiles('#enNDokDatei', datei('Konzept.pdf'));
await page.waitForTimeout(300);
await page.evaluate(() => {
  $('enNKunde_name').value = 'Stranag';
  $('enNStrasse').value = 'Kantonsstrasse 3';
  $('enNOrt').value = '6000 Luzern';
  $('enNKanton').value = 'LU';
  $('enNDatum').value = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  $('enNVon').value = '07:30'; $('enNBis').value = '16:30';
});
await page.evaluate(() => createEinsatz());
await page.waitForTimeout(900);
const meldung = await page.evaluate(() => document.getElementById('toast').textContent);
check('KRITISCH: ein fehlgeschlagener Anhang wird gemeldet, nicht verschwiegen',
  meldung.includes('nicht angehängt') && meldung.includes('Konzept.pdf'));
dokFehler = false;

// ══════════════ IM EINSATZPLAN
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(400);
await page.evaluate(() => epAuf(81));
await page.waitForTimeout(800);
const kopf = await page.textContent('#epKopf');
check('Der Einsatzplan zeigt die angehängten Dokumente', kopf.includes('Objektplan.pdf'));
check('Mit ihrer Grösse', /229|230|0,2 MB|235 KB|KB/.test(kopf));
check('Es lässt sich weiteres anhängen',
  await page.evaluate(() => !!document.getElementById('epDokDatei')));

await page.setInputFiles('#epDokDatei', datei('Nachtrag.pdf'));
await page.waitForTimeout(700);
check('KRITISCH: im Einsatzplan wird sofort hochgeladen — die Nummer gibt es hier',
  rufe.some(r => r.body && r.body.aktion === 'hochladen' && Number(r.body.einsatz_id) === 81));
check('Die Liste zieht danach nach', (await page.textContent('#epKopf')).includes('Nachtrag.pdf'));

// Öffnen: der Anmeldekopf muss mit, ein blosses <a href> trüge ihn nicht.
// Ein Fenster, das nirgends hinführt: So lässt sich die Adresse ablesen, ohne
// dass der Prüflauf tatsächlich ein PDF-Fenster öffnet.
await page.evaluate(() => { window.__auf = []; window.open = () => ({ set location(u) { window.__auf.push(u); }, close() {} }); });
check('Der Dateiname im Einsatzplan ist anklickbar',
  await page.evaluate(() => { const a = document.querySelector('#epKopf .dok-zeile a.nm');
    if (!a) return false; a.click(); return true; }));
await page.waitForTimeout(500);
const holen = rufe.filter(r => r.p.includes('einsatz_dokument') && /[?&]id=/.test(r.url));
check('KRITISCH: das Dokument wird geholt, nicht verlinkt', holen.length >= 1);
check('KRITISCH: es wird über den geprüften Endpunkt geholt',
  holen.length >= 1 && holen[0].url.includes('einsatz_dokument.php?id='));

// Entfernen fragt nach.
await page.evaluate(() => { window.__gefragt = null; window.confirm = t => { window.__gefragt = t; return true; }; });
// Blockiert der Browser das Fenster, darf die Arbeitsoberfläche NICHT
// weggerissen werden -- ein halb ausgefülltes Formular wäre sonst verloren.
await page.evaluate(() => { window.__toast = null; window.open = () => null;
  const alt = window.toast; window.toast = t => { window.__toast = t; alt(t); }; });
await page.evaluate(() => { const a = document.querySelector('#epKopf .dok-zeile a.nm'); if (a) a.click(); });
await page.waitForTimeout(500);
check('KRITISCH: ein blockiertes Fenster leitet die Arbeitsoberfläche nicht um',
  await page.evaluate(() => document.querySelector('.view.on')
    && document.querySelector('.view.on').id === 'view-einsatzplan'));
check('Stattdessen wird gesagt, woran es liegt',
  await page.evaluate(() => (window.__toast || '').includes('Pop-ups')));

check('Es gibt einen Entfernen-Knopf',
  await page.evaluate(() => { const b = document.querySelector('#epKopf .dok-zeile button');
    if (!b) return false; b.click(); return true; }));
await page.waitForTimeout(700);
const gefragt = await page.evaluate(() => window.__gefragt);
check('KRITISCH: das Entfernen fragt zuerst nach', !!gefragt && gefragt.includes('entfernen'));
check('Und nennt dabei den Dateinamen', !!gefragt && gefragt.includes('Objektplan.pdf'));
check('Danach ist es weg', !(await page.textContent('#epKopf')).includes('Objektplan.pdf'));

// ── Eine festgeschriebene Schicht (ENT-045)
await page.evaluate(() => { go('planung'); goTab('einsaetze'); });
await page.waitForTimeout(400);
await page.evaluate(() => epAuf(82));
await page.waitForTimeout(800);
check('KRITISCH: an einer festgeschriebenen Schicht wird nichts angehängt',
  await page.evaluate(() => !document.getElementById('epDokDatei')));
check('KRITISCH: und nichts entfernt',
  await page.evaluate(() => !document.querySelector('#epKopf .dok-zeile button')));
check('Die bestehenden Unterlagen bleiben aber sichtbar',
  (await page.textContent('#epKopf')).includes('Altes Konzept.pdf'));

// ══════════════ SERIEN GEHÖREN AN DIE OBJEKTE, NICHT HIERHER
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(400);
const hinweis = await page.textContent('#enNSerieHinweis');
check('Der Hinweis nennt den richtigen Ort für wiederkehrende Einsätze',
  hinweis.includes('Masterschicht'));
check('KRITISCH: es gibt kein zweites Serienwerkzeug auf dieser Seite',
  await page.evaluate(() => !document.getElementById('enNRhythmus')
    && !document.getElementById('enNBedarfMo') && !document.getElementById('enNEnddatum')));
await page.evaluate(() => enZuObjekten());
await page.waitForTimeout(500);
check('KRITISCH: der Weg dorthin führt tatsächlich zur Objektplanung',
  await page.evaluate(() => document.querySelector('.view.on').id === 'view-kunden'
    && document.getElementById('kv-objekte').classList.contains('on')));

// ══════════════ GESTALTUNG — GEMESSEN, NICHT NACHGELESEN
await page.evaluate(() => openEinsatzNeu());
await page.waitForTimeout(500);
const zeilenMass = await page.evaluate(() => {
  const f = document.querySelector('#view-einsatzneu .form-zeilen .f:not(.wide)');
  if (!f) return null;
  const l = f.querySelector('label'), i = f.querySelector('.inp, .zp');
  if (!l || !i) return null;
  const a = l.getBoundingClientRect(), b = i.getBoundingClientRect();
  return { labelRechts: a.right, feldLinks: b.left,
           labelMitte: a.top + a.height / 2, feldMitte: b.top + b.height / 2 };
});
check('KRITISCH: Beschriftung links, Feld rechts — gemessen',
  !!zeilenMass && zeilenMass.labelRechts <= zeilenMass.feldLinks + 1);
// Über die Mitten, nicht über die Oberkanten: Steht die Beschriftung über dem
// Feld, liegen die Oberkanten nur eine Zeilenhöhe auseinander -- das fiele
// unter jeder grosszügigen Toleranz durch, ohne dass die Prüfung etwas merkt.
check('KRITISCH: beide stehen mittig auf derselben Zeile',
  !!zeilenMass && Math.abs(zeilenMass.labelMitte - zeilenMass.feldMitte) < 4);

// Der Platz soll genutzt werden: die Felder dürfen nicht in einer schmalen
// Säule kleben, wenn 1500 px zur Verfügung stehen.
const breite = await page.evaluate(() => {
  const g = document.querySelector('#view-einsatzneu .form-zeilen');
  return g ? g.getBoundingClientRect().width : 0;
});
check('KRITISCH: die Seite nutzt die volle Breite', breite > 900);

// Und dieselbe Ansicht auf dem Handy: dort stapelt die Zeile.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const mobil = await page.evaluate(() => {
  const f = document.querySelector('#view-einsatzneu .form-zeilen .f:not(.wide)');
  if (!f) return null;
  const l = f.querySelector('label'), i = f.querySelector('.inp, .zp');
  const a = l.getBoundingClientRect(), b = i.getBoundingClientRect();
  return { labelUnten: a.bottom, feldOben: b.top, feldBreite: b.width, seite: document.body.scrollWidth };
});
check('KRITISCH: auf dem Handy steht die Beschriftung über dem Feld',
  !!mobil && mobil.labelUnten <= mobil.feldOben + 1);
check('KRITISCH: die Seite läuft auf dem Handy nicht seitlich über',
  !!mobil && mobil.seite <= 391);
await page.setViewportSize({ width: 1500, height: 1000 });
await page.waitForTimeout(300);

await browser.close();

// ══════════════════════════════════════════════════════════════════════════
// TEIL 3 — Die App der Mitarbeitenden
// ══════════════════════════════════════════════════════════════════════════
const APP_DOK = [
  { id: 901, dateiname: 'Objektplan Bahnhof.pdf', mime: 'application/pdf',
    groesse: 512000, hochgeladen_am: tag(-1) + ' 10:00:00' },
];
const appRufe = [];
const b2 = await chromium.launch({ executablePath: EXE });
const p2 = await b2.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
p2.on('pageerror', e => bad.push('JS-Fehler (App): ' + e.message));

await p2.route('**/api/**', route => {
  const req = route.request(), url = req.url(), p = url.split('/api/')[1].split('?')[0];
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) {}
  appRufe.push({ p, body, url });
  const send = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (p.includes('login')) return send({ status: 'ok', token: 't', name: 'daniele', ist_admin: false });
  if (p.includes('einsatz_dokument')) {
    if (/[?&]id=/.test(url)) return route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF });
    const eid = Number(url.split('einsatz_id=')[1]);
    return send({ status: 'ok', dokumente: eid === 51 ? APP_DOK : [] });
  }
  if (p.includes('meine_schichten')) return send({ status: 'ok', schichten: [
    { id: 51, kunde_name: 'Stranag', titel: 'Mit Unterlagen', strasse: 'Kantonsstrasse 3',
      ort: '6000 Luzern', kanton: 'LU', einsatzart: 'Verkehrsdienst', datum: MORGEN,
      von: '07:30:00', bis: '16:30:00', status: 'bestaetigt', bemerkung: null,
      zusage: 'zugesagt', objekt_name: null, im_team: 1 },
    { id: 52, kunde_name: 'Stranag', titel: 'Ohne Unterlagen', strasse: 'Kantonsstrasse 3',
      ort: '6000 Luzern', kanton: 'LU', einsatzart: 'Verkehrsdienst', datum: tag(2),
      von: '07:30:00', bis: '16:30:00', status: 'bestaetigt', bemerkung: null,
      zusage: 'zugesagt', objekt_name: null, im_team: 1 }] });
  if (p.includes('mein_profil')) return send({ status: 'ok', monat: { anzahl: 0, stunden: 0 },
    profil: { name: 'daniele', ist_admin: false, vorname: 'Daniele', nachname: 'Ciardo' } });
  if (p.includes('rapport_list')) return send({ status: 'ok', rapporte: [] });
  return send({ status: 'ok' });
});

await p2.goto(`file://${WURZEL}/app.html`);
await p2.fill('#gName', 'daniele'); await p2.fill('#gPass', 'x'); await p2.click('#gBtn');
await p2.waitForSelector('#app.on'); await p2.waitForTimeout(500);

await p2.evaluate(() => blattAuf(51));
await p2.waitForTimeout(700);
const blatt = await p2.textContent('#blDok');
check('KRITISCH: die eingeteilte Person sieht die Unterlagen ihrer Schicht',
  blatt.includes('Objektplan Bahnhof.pdf'));
check('Mit Grösse', /MB|KB/.test(blatt));
check('KRITISCH: die App fragt beim geprüften Endpunkt nach, nicht an einem Pfad',
  appRufe.some(r => r.url.includes('einsatz_dokument.php?einsatz_id=51')));

// Trefferfläche: am Bauzaun wird das mit Handschuhen getippt.
const flaeche = await p2.evaluate(() => {
  const z = document.querySelector('#blDok .dok-zeile');
  return z ? z.getBoundingClientRect() : null;
});
check('KRITISCH: die Zeile ist mindestens 44 px hoch', !!flaeche && flaeche.height >= 44);
check('Die Zeile nutzt die volle Breite als Trefferfläche', !!flaeche && flaeche.width > 300);

// Öffnen holt die Datei mit dem Anmeldekopf.
await p2.evaluate(() => { window.__auf = []; window.open = () => ({ set location(u) { window.__auf.push(u); }, close() {} }); });
await p2.evaluate(() => { const z = document.querySelector('#blDok .dok-zeile'); if (z) z.click(); });
await p2.waitForTimeout(600);
check('KRITISCH: das Öffnen holt die Datei über den Endpunkt',
  appRufe.some(r => r.url.includes('einsatz_dokument.php?id=901')));

// Ohne Unterlagen steht nichts da -- kein leerer Kopf, keine leere Liste.
await p2.evaluate(() => blattZu());
await p2.waitForTimeout(300);
await p2.evaluate(() => blattAuf(52));
await p2.waitForTimeout(700);
check('KRITISCH: ohne Unterlagen steht kein leerer Abschnitt da',
  (await p2.textContent('#blDok')).trim() === '');

await b2.close();

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
