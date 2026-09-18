// Offerten im Betreiber-Bereich (ENT-605).
//
// Zwei Sorten Aussage stehen hier:
//
//   1. Was gerechnet und wohin geschrieben wird -- das laeuft wirklich, in
//      pruef_offerten_betreiber.php. Eine Textsuche kann nicht sagen, ob ein
//      Tabellenpraefix an jeder einzelnen Abfrage ankommt.
//   2. Dass die beiden Ebenen einander nicht anfassen. Der Offertenteil ist
//      aus dem Cockpit UEBERNOMMEN -- und genau daran haengt die Gefahr:
//      Ein stehengebliebener Aufruf auf beleg_list.php statt
//      betreiber_beleg_list.php faellt niemandem auf, solange
//      betreiber_db() ohnehin auf dieselbe Datenbank zeigt (OP-518). Die
//      Offerten der Betreiberin stuenden dann in der Liste ihrer Mandantin.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { WURZEL } from './pfade.mjs';

const HIER = new URL('.', import.meta.url).pathname;
const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const lies = p => readFileSync(join(WURZEL, p), 'utf8');
// Kommentare weg: Ein Wort in einer Begruendung ist kein Aufruf.
const nurCode = q => q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|#).*$/gm, '');

// ── 1. Der Rechenkern und die Trennung, wirklich ausgefuehrt ──────────
let phpAus = '', phpCode = 0;
try {
  phpAus = execFileSync('php', [`${HIER}/pruef_offerten_betreiber.php`], { encoding: 'utf8' });
} catch (e) {
  phpAus = String(e.stdout || '') + String(e.stderr || '');
  phpCode = e.status || 1;
}
const phpAnzahl = Number((phpAus.match(/^(\d+) bestanden/m) || [0, 0])[1]);
check('die PHP-Pruefungen der Belegtrennung laufen durch', phpAnzahl > 0);
// phpAnzahl gehoert MIT in die kritische Bedingung: Stirbt die Datei vor
// ihrer Zusammenfassung, ist der Ende-Code 0 und kein "x " im Auswurf --
// die Pruefung waere gruen, obwohl nichts gelaufen ist (so geschehen bei
// ENT-539).
check('KRITISCH: alle PHP-Faelle bestehen (Trennung, Nummern, Tabellensatz-Wache)',
  phpCode === 0 && phpAnzahl > 0 && !phpAus.includes('\nx '));
phpAus.split('\n').filter(z => z.startsWith('x ')).forEach(z => bad.push('PHP: ' + z.slice(2)));

// ── 2. Kein Betreiber-Endpunkt fasst die Tabellen der Mandantin an ────
const API = join(WURZEL, 'backend/api');
const betreiberEndpunkte = readdirSync(API).filter(f => /^betreiber_.*\.php$/.test(f));
check('es gibt ueberhaupt Betreiber-Endpunkte fuer Offerten',
  betreiberEndpunkte.filter(f => /^betreiber_(beleg|kunden|produkt)_/.test(f)).length >= 10);

// Die Mandantentabellen beim Namen. Die be_-Fassungen sind ausdruecklich
// erlaubt, darum die Wortgrenze davor: "be_belege" darf, "belege" nicht.
const MANDANTENTABELLEN =
  /(?:FROM|INTO|UPDATE|JOIN)\s+(?<!be_)(belege|beleg_positionen|kunden|kunden_person|kunden_kontaktweg|produkte|betrieb)\b/;
const greiftDaneben = betreiberEndpunkte.filter(f => {
  const q = nurCode(lies(`backend/api/${f}`));
  return [...q.matchAll(/(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/g)]
    .some(m => ['belege', 'beleg_positionen', 'kunden', 'kunden_person',
                'kunden_kontaktweg', 'produkte', 'betrieb'].includes(m[1]));
});
check('KRITISCH: kein Betreiber-Endpunkt liest oder schreibt eine Tabelle der Mandantin',
  greiftDaneben.length === 0);
if (greiftDaneben.length) { bad.push('greift in Mandantentabellen: ' + greiftDaneben.join(', ')); }

// Und die Kehrseite: Sie muessen die be_-Tabellen tatsaechlich benutzen --
// sonst bestuende die Pruefung oben auch fuer eine leere Datei.
const nutztBeTabellen = betreiberEndpunkte.filter(f =>
  /^betreiber_(beleg|kunden|produkt)_/.test(f)
  && /\bbe_(belege|beleg_positionen|kunden|produkte)\b/.test(nurCode(lies(`backend/api/${f}`))));
check('die Offerten-Endpunkte sprechen die be_-Tabellen wirklich an',
  nutztBeTabellen.length >= 8);

// Jeder von ihnen holt seine Verbindung ueber betreiber_db(), nicht ueber
// db(). Das ist die Stelle, an der die Trennung spaeter tatsaechlich
// greift: Zieht die Betreiber-Ebene auf eine eigene Datenbank, ist es ein
// Deploy-Wert -- aber nur fuer den, der betreiber_db() ruft.
const falscheVerbindung = betreiberEndpunkte
  .filter(f => /^betreiber_(beleg|kunden|produkt|briefkopf)/.test(f))
  .filter(f => {
    const q = nurCode(lies(`backend/api/${f}`));
    return !q.includes('betreiber_db()') || /=\s*db\(\)/.test(q);
  });
check('KRITISCH: jeder Offerten-Endpunkt arbeitet auf betreiber_db()',
  falscheVerbindung.length === 0);
if (falscheVerbindung.length) { bad.push('falsche Verbindung: ' + falscheVerbindung.join(', ')); }

// Der Absender einer Offerte der Betreiberin kommt aus ihrem eigenen
// Briefkopf. `betrieb` gehoert einer Mandantin -- ihr Name haette auf einer
// Offerte der Betreiberin nichts verloren.
const versand = nurCode(lies('backend/api/betreiber_beleg_versenden.php'));
check('KRITISCH: der Versand nimmt den Absender aus be_briefkopf, nicht aus betrieb',
  versand.includes('be_briefkopf') && !/FROM\s+betrieb\b/.test(versand));
// Ohne Firma wird nicht verschickt: Eine Offerte ohne Absender ist keine.
check('ohne Firma im Briefkopf wird nicht verschickt',
  /\$firma\s*===\s*''/.test(versand) && /json_response/.test(versand));
// Der Link kommt aus dem Deploy, nie aus der Anfrage (ENT-501).
check('KRITISCH: der Versandlink kommt aus basis_url(), nicht aus dem Host-Kopf',
  versand.includes('basis_url()') && !versand.includes('HTTP_HOST'));

// ── 3. Die Oberflaeche ruft nur ihre eigenen Endpunkte ────────────────
//
// DER Kopierfehler, auf den diese Suite vor allem achtet.
const seite = lies('betreiber.html');
const aufrufe = [...new Set([...nurCode(seite).matchAll(/ruf\(\s*'([a-z_0-9]+\.php)/g)]
  .map(m => m[1]))];
check('es wurden ueberhaupt Endpunktaufrufe gefunden', aufrufe.length >= 15);
const fremdeAufrufe = aufrufe.filter(a => !a.startsWith('betreiber_') && !a.startsWith('demo_'));
check('KRITISCH: der Betreiber-Bereich ruft ausschliesslich betreiber_*-Endpunkte',
  fremdeAufrufe.length === 0);
if (fremdeAufrufe.length) { bad.push('fremder Aufruf: ' + fremdeAufrufe.join(', ')); }

// Die Gegenprobe dazu, als eigene Aussage: Die uebernommenen Namen aus dem
// Cockpit duerfen nirgends stehengeblieben sein.
const COCKPIT_NAMEN = ['beleg_list.php', 'beleg_lesen.php', 'beleg_speichern.php',
  'beleg_versenden.php', 'beleg_status.php', 'beleg_archivieren.php',
  'beleg_duplizieren.php', 'beleg_bezahlt.php', 'kunden_list.php', 'kunden_create.php',
  'kunden_update.php', 'kunden_import.php', 'produkt_list.php', 'produkt_speichern.php'];
const stehengeblieben = COCKPIT_NAMEN.filter(n =>
  new RegExp(`(?<!betreiber_)${n.replace('.', '\\.')}`).test(nurCode(seite)));
check('KRITISCH: kein Endpunktname aus dem Cockpit ist stehengeblieben',
  stehengeblieben.length === 0);
if (stehengeblieben.length) { bad.push('stehengeblieben: ' + stehengeblieben.join(', ')); }

// ── 4. Was die Seite nachlaedt, liegt auch im Buendel ─────────────────
//
// Aus der Seite abgeleitet, nicht hier aufgezaehlt: Ein spaeter
// hinzukommendes Skript faellt sonst durch. Fehlt es im Buendel, bleibt der
// Knopf ohne Wirkung -- und lokal faellt das NICHT auf.
const werk = lies('.github/workflows/deploy-hostpoint.yml');
const buendel = (werk.match(/Betreiber-Buendel[\s\S]*?(?=\n      - name:)/) || [''])[0];
check('der Buendel-Abschnitt wurde gefunden', buendel.length > 400);
const nachgeladen = [...new Set([...nurCode(seite).matchAll(/\.src\s*=\s*'([a-z0-9_.-]+\.js)'/g)]
  .map(m => m[1]))];
check('die Seite laedt ueberhaupt etwas nach', nachgeladen.length >= 1);
const fehlend = nachgeladen.filter(d => !buendel.includes(d));
check('KRITISCH: jede Datei, die betreiber.html nachlaedt, liegt im betreiber-Buendel',
  fehlend.length === 0);
if (fehlend.length) { bad.push('fehlt im Buendel: ' + fehlend.join(', ')); }

// ── 5. Kein Klassenname zweimal ──────────────────────────────────────
//
// Beim Zusammenfuehren mit main traf der uebernommene Dialog des
// Offertenteils (.dlg) auf den Einrichtungsdialog, der denselben Namen
// schon trug. Git verschmilzt zwei solche Bloecke GERAEUSCHLOS, und die
// spaetere Regel gewinnt: Der fremde Dialog war danach 560 statt 460 Pixel
// breit und anders gerundet -- ohne dass irgendetwas kaputtgegangen waere.
//
// Genau derselbe Fall wie ENT-536, wo ".leer" den Leerzustand UND eine
// Kennzahl auf null traf. Zweimal ist eine Wache faellig.
//
// Geprueft wird nur die OBERSTE Ebene: Eine Regel in einer @media-Abfrage
// soll die Grundregel ueberschreiben, das ist ihr Zweck.
{
  const stil = [...seite.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const ohneKommentar = stil.replace(/\/\*[\s\S]*?\*\//g, '');
  // Gezaehlt wird nicht, WIE OFT ein Selektor vorkommt, sondern WIE WEIT
  // die Vorkommen auseinanderliegen. Der Unterschied ist der ganze Punkt:
  // Zwei Regeln fuer denselben Selektor ein paar Zeilen untereinander sind
  // gewoehnliches CSS -- erst die Flaeche, dann der Radius. Gefaehrlich ist
  // der Fall, den es hier tatsaechlich gab: zwei Bloecke in verschiedenen
  // Teilen der Datei, die nichts voneinander wissen, weil sie aus zwei
  // Sitzungen stammen. Die Grenze von 60 Zeilen ist gemessen an genau dem
  // Fall: .dlg lag damals rund 400 Zeilen auseinander.
  const NAHE = 60;
  const zeilen = new Map();
  let tiefe = 0, i = 0;
  while (i < ohneKommentar.length) {
    const auf = ohneKommentar.indexOf('{', i);
    const zu  = ohneKommentar.indexOf('}', i);
    if (auf === -1 && zu === -1) { break; }
    if (zu !== -1 && (auf === -1 || zu < auf)) { tiefe = Math.max(0, tiefe - 1); i = zu + 1; continue; }
    const kopf = ohneKommentar.slice(i, auf).trim();
    if (tiefe === 0 && kopf && !kopf.startsWith('@')) {
      const zeile = ohneKommentar.slice(0, auf).split('\n').length;
      kopf.split(',').map(t => t.trim()).filter(Boolean)
        .forEach(t => { if (!zeilen.has(t)) { zeilen.set(t, []); } zeilen.get(t).push(zeile); });
    }
    tiefe += 1;
    i = auf + 1;
  }
  const zaehler = zeilen;
  const doppelt = [...zeilen.entries()]
    .filter(([, z]) => z.some((n, k) => k > 0 && n - z[k - 1] > NAHE))
    .map(([t, z]) => `${t} (Zeilen ${z.join(', ')})`);
  check('es wurden ueberhaupt Selektoren gefunden', zaehler.size > 60);
  check('KRITISCH: kein Selektor ist in betreiber.html zweimal auf oberster Ebene definiert',
    doppelt.length === 0);
  if (doppelt.length) { bad.push('doppelt definiert: ' + doppelt.join(', ')); }
}

// ── 6. Rechnungen (ENT-608) ──────────────────────────────────────────
//
// Bis ENT-608 stand hier das Gegenteil: Der Rechnungsbereich MUSSTE sagen,
// dass er nicht gebaut ist. Er ist es jetzt -- und die Wache wird darum
// umgehaengt, nicht gestrichen. Geprueft wird ab hier, dass die Rechnung
// wirklich eine Rechnung ist und nicht eine Offerte mit anderer
// Beschriftung.
const seiteCode = nurCode(seite);

check('KRITISCH: die Rechnungsliste holt ausdruecklich art=rechnung',
  /betreiber_beleg_list\.php\?art=rechnung/.test(seiteCode));
check('KRITISCH: das Formular schickt die Belegart mit, statt sie festzuschreiben',
  /art:\s*ofArt/.test(seiteCode) && !/art:\s*'offerte'/.test(seiteCode));
// Das zweite Datumsfeld ist der eigentliche Unterschied der beiden Arten.
// Traegt eine Rechnung "gueltig_bis", steht ihre Frist in der falschen
// Spalte -- und die Liste zeigt danach ueberall einen Strich.
check('KRITISCH: das zweite Datum geht in die Spalte der jeweiligen Art',
  /\[t\.zweitFeld\]:/.test(seiteCode)
  && /zweitFeld:\s*'faellig_bis'/.test(seiteCode)
  && /zweitFeld:\s*'gueltig_bis'/.test(seiteCode));
// Vier Spalten, die es nur bei Rechnungen gibt.
check('die Rechnungsliste rechnet Faelligkeit und offenen Betrag',
  /function reFaelligTage/.test(seiteCode) && /function reOffenRappen/.test(seiteCode));
// "Unbekannt darf nie wie laengst vorbei aussehen": '0000-00-00' ist
// truthy UND kleiner als jeder echte Tag.
check('KRITISCH: eine Rechnung ohne Frist gilt nicht als ueberfaellig',
  /leeresDatum\(b\.faellig_bis\)/.test(seiteCode));
check('KRITISCH: bestaetigt und abgelehnt gibt es bei einer Rechnung nicht',
  /function belegStatusOptionen/.test(seiteCode)
  && /art !== 'rechnung'/.test(seiteCode));

// Der neue Endpunkt: Er steht auf derselben Ebene wie die uebrigen und
// markiert ausschliesslich Rechnungen.
{
  const bez = nurCode(lies('backend/api/betreiber_beleg_bezahlt.php'));
  check('KRITISCH: der Bezahlt-Endpunkt verlangt die Betreiber-Anmeldung',
    /require_betreiber_voll\(\)/.test(bez));
  check('KRITISCH: er arbeitet auf be_belege und betreiber_db()',
    bez.includes('be_belege') && bez.includes('betreiber_db()') && !/FROM\s+belege\b/.test(bez));
  check('KRITISCH: nur eine Rechnung kann bezahlt sein -- eine Offerte nicht',
    /\$art\s*!==\s*'rechnung'/.test(bez));
  check('das Bezahldatum setzt der Server, nicht die Eingabe',
    /date\('Y-m-d'\)/.test(bez) && !/\$in\['bezahlt_am'\]/.test(bez));
  check('nur POST', /REQUEST_METHOD.*!==.*POST/.test(bez));
}

// Der Import (ENT-610). Er ist der zweite Schreibweg in be_kunden und damit
// genau die Stelle, an der ein zweites Regelwerk entstehen koennte.
{
  const imp = nurCode(lies('backend/api/betreiber_kunden_import.php'));
  check('KRITISCH: der Import verlangt die Betreiber-Anmeldung',
    /require_betreiber_voll\(\)/.test(imp));
  check('KRITISCH: er arbeitet auf be_kunden und betreiber_db()',
    imp.includes('be_kunden') && imp.includes('betreiber_db()')
    && !/\bFROM\s+kunden\b/.test(imp) && !/INSERT INTO kunden\b/.test(imp));
  check('KRITISCH: jede Zeile laeuft durch dieselbe Lesefunktion wie das Anlegen von Hand',
    /kunden_eingabe_lesen\(/.test(imp));
  check('KRITISCH: die Kundennummer vergibt der Server, mit dem be_-Praefix',
    /naechste_kundennummer\(\$pdo, 'be_'\)/.test(imp));
  check('KRITISCH: der Trockenlauf schreibt nichts',
    /\$modus === 'pruefen'[\s\S]{0,120}json_response/.test(imp)
    && imp.indexOf("'pruefen'") < imp.indexOf('beginTransaction'));
  check('KRITISCH: geschrieben wird alles oder nichts',
    /beginTransaction\(\)/.test(imp) && /rollBack\(\)/.test(imp));
  check('eine Obergrenze je Durchgang, damit eine grosse Datei nicht den Server bindet',
    /BE_IMPORT_MAX_ZEILEN/.test(imp));
  check('nur POST', /REQUEST_METHOD.*!==.*POST/.test(imp));
  check('ohne eingerichtete Tabelle sagt er das, statt zu schreiben',
    /hat_tabelle\(\$pdo, 'be_kunden'\)/.test(imp));

  // Und die Oberflaeche: Die Datei wird im Browser gelesen, nicht
  // hochgeladen -- sonst laegen Adressdaten unbeaufsichtigt auf dem Server.
  check('KRITISCH: die CSV-Datei wird im Browser gelesen, nicht hochgeladen',
    /FileReader\(\)/.test(seiteCode) && !/FormData\(/.test(seiteCode));
  check('erst pruefen, dann anlegen -- der Knopf erscheint erst nach dem Trockenlauf',
    /impSenden\('pruefen'\)/.test(seiteCode) && /impSenden\('anwenden'\)/.test(seiteCode));
  check('nach dem Anlegen wird die Liste neu geladen',
    /impAnwenden[\s\S]{0,140}ladeAdressen\(\)/.test(seiteCode));
}

// ── Die Adressenliste selbst ──────────────────────────────────────────
//
// Das WIE prueft test_offerten_gleich.mjs am gerenderten Bild. Hier steht
// nur, dass die Liste die Wege hat, die eine sortierbare Liste braucht --
// und dass die eine bewusste Abweichung benannt ist.
check('die Adressenliste ist sortierbar und hat Handy-Karten',
  /function adTh\(/.test(seiteCode) && /function adSort\(/.test(seiteCode)
  && /function adKarte\(/.test(seiteCode) && /function adSortNameUm\(/.test(seiteCode));
check('KRITISCH: die Zaehlspalte zaehlt Belege -- Rapporte gibt es beim Betreiber nicht',
  /belege_anzahl/.test(seiteCode) && !/rapporte/i.test(seiteCode));
{
  const list = nurCode(lies('backend/api/betreiber_kunden_list.php'));
  check('KRITISCH: die Belegzahl kommt aus EINER Abfrage, nicht einer je Adresse',
    /GROUP BY kunde_id/.test(list) && (list.match(/be_belege/g) || []).length <= 2);
  check('fehlt die Belegtabelle, bleibt die Zahl 0 statt eines Fehlers',
    /hat_tabelle\(\$pdo, 'be_belege'\)/.test(list));
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden`);
if (bad.length) {
  console.log('\n' + bad.map(b => '  ✗ ' + b).join('\n'));
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
