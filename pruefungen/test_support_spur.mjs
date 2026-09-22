// Was der Betreiber im Cockpit tut, steht im Protokoll des Betriebs
// (ENT-631, Schritt 2).
//
// WARUM ES DIESE SUITE GIBT: Ein Supportzugang, der funktioniert, aber
// nichts protokolliert, ist genau der Zustand, den ENT-631 ausschliesst.
// Und er faellt niemandem auf: Alles laeuft, nur die Spur fehlt. Ein
// Protokoll, das still ausfaellt, ist schlimmer als keines -- weil man
// sich darauf verlaesst.
//
// Geprueft werden die AUSSAGEN (CLAUDE.md, Regel 1): dass die Spur an der
// EINEN Stelle entsteht, durch die jeder Endpunkt laeuft; dass sie an der
// Sitzung haengt und nicht am Kontonamen; dass ein Fehler beim Schreiben
// die Arbeit nicht abbricht; und dass der Betrieb sie lesen kann, ohne
// den Betreiber zu fragen. Am Schluss die Gegenprobe (Regel 2).
import { readFileSync } from 'fs';
import { WURZEL } from './pfade.mjs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const lies = (f) => readFileSync(`${WURZEL}/${f}`, 'utf8');

const db        = lies('backend/db.php');
const modul     = lies('backend/support.php');
const einloesen = lies('backend/api/support_sprung_einloesen.php');
const protokoll = lies('backend/api/support_protokoll.php');
const kern      = lies('backend/planung_einrichten_kern.php');

function rumpf(text, name) {
  const von = text.indexOf(`function ${name}(`);
  if (von === -1) { return ''; }
  const nach = text.indexOf('\nfunction ', von + 1);
  return text.slice(von, nach === -1 ? text.length : nach);
}

const PRUEFUNGEN = {
  // Die Spur entsteht in require_session() -- der einen Stelle, durch die
  // jeder angemeldete Endpunkt laeuft. Stuende sie in den einzelnen
  // Schreibwegen, fehlte sie beim naechsten neuen Endpunkt.
  spur_entsteht_an_einer_stelle: (d) => {
    const r = rumpf(d, 'require_session');
    return r.includes('support_spur_merken(');
  },

  // Nur veraendernde Anfragen. Ein Cockpit laedt beim Oeffnen ein Dutzend
  // Endpunkte -- jeden Abruf mitzuschreiben liesse die Aenderungen darin
  // untergehen.
  nur_veraendernde_anfragen: (d) => {
    const r = rumpf(d, 'require_session');
    const m = r.match(/!in_array\(\$_SERVER\['REQUEST_METHOD'\][^)]*\[([^\]]*)\]/);
    if (!m) { return false; }
    return /'GET'/.test(m[1]) && /'HEAD'/.test(m[1]);
  },

  // Erkannt wird die Support-Sitzung an der SITZUNG, nicht am Namen des
  // Kontos. Ein Name ist Text, den jemand aendern kann; daran darf keine
  // Protokollpflicht haengen.
  erkannt_an_der_sitzung: (d) => {
    const r = rumpf(d, 'require_session');
    return /support_sprung_id/.test(r)
        && !/name'\]\s*===\s*'GuardOpS/.test(r);
  },

  // Die Spur traegt die Sprung-Id -- ueber sie fuehrt sie zurueck bis zur
  // Freigabe. Ohne sie waere nicht mehr feststellbar, unter welcher
  // Freigabe eine Aenderung geschah.
  spur_fuehrt_zur_freigabe: (e) =>
    /\$spalten\[\] = 'support_sprung_id'/.test(e)
    && /\$werte\[\]\s*=\s*\(int\)\$sprung\['id'\]/.test(e),

  // Ein Fehler beim Protokollieren darf die Arbeit nicht abbrechen. Sonst
  // waere die Folge eines vollen Datentraegers, dass niemand mehr etwas
  // speichern kann.
  protokollfehler_bricht_nichts_ab: (m) => {
    const r = rumpf(m, 'support_spur_merken');
    return /try\s*\{/.test(r) && /catch\s*\(Throwable/.test(r);
  },

  // Fehlt die Tabelle, wird nichts geschrieben statt zu scheitern -- eine
  // Datenbank vor dem Nachtrag laeuft weiter wie bisher.
  ohne_tabelle_kein_abbruch: (m) => {
    const r = rumpf(m, 'support_spur_merken');
    return /if \(!support_spur_da\(\$pdo\)\) \{ return; \}/.test(r);
  },

  // Der Betrieb liest die Spur in SEINER Datenbank, ohne den Betreiber zu
  // fragen -- dieselbe Ueberlegung wie bei support_freigabe (ENT-526).
  betrieb_kann_die_spur_lesen: (p) => {
    // NUR der Teil nach dem fruehen Ausstieg: Dort steht die Spur
    // ebenfalls, und ohne diese Eingrenzung ginge der eine Treffer als
    // Beleg fuer den anderen durch -- die Gegenprobe bliebe dann gruen,
    // obwohl die Hauptantwort die Spur nicht mehr traegt.
    const ab = p.lastIndexOf('json_response([');
    return ab !== -1 && /'spur'\s*=>\s*support_spur_lesen\(\$pdo\)/.test(p.slice(ab));
  },

  // Auch dann, wenn die Freigabe-Tabellen fehlen: Ein Demo-Platz hat
  // keine Freigabe und trotzdem Supportzugaenge. Der fruehe Ausstieg
  // darf die Spur nicht verschlucken.
  spur_auch_ohne_freigabetabellen: (p) => {
    const m = p.match(/if \(!support_tabellen_da\(\$pdo\)\) \{([\s\S]*?)\n\}/);
    return !!m && m[1].includes('support_spur_lesen($pdo)');
  },

  // Die Tabelle gehoert dem Betrieb, also entsteht sie in SEINER
  // Datenbank -- zusammen mit den uebrigen Kerntabellen.
  tabelle_wird_eingerichtet: (k) =>
    /'support_spur' => "CREATE TABLE IF NOT EXISTS support_spur/.test(k)
    && /\['sessions', 'support_sprung_id',/.test(k),

  // sprung_id darf leer bleiben: Ein Demo-Platz hat keine Freigabe, und
  // eine Pflichtangabe haette genau diesen Fall unmoeglich gemacht.
  sprung_id_darf_leer_sein: (k) => {
    const m = k.match(/CREATE TABLE IF NOT EXISTS support_spur \(([\s\S]*?)\) ENGINE/);
    return !!m && /sprung_id INT UNSIGNED NULL/.test(m[1]);
  },

  // Fehlt die Spalte an der Sitzung, laeuft der Zugang ZWAR, hinterlaesst
  // aber keine Spur. Das muss der Aufrufer erfahren -- eine Zusicherung,
  // die still ausfaellt, ist schlimmer als keine.
  fehlende_spur_wird_gemeldet: (e) => /'protokolliert' => \$hatSprungSpalte/.test(e),
};

const ANWENDEN = {
  spur_entsteht_an_einer_stelle: db,
  nur_veraendernde_anfragen: db,
  erkannt_an_der_sitzung: db,
  spur_fuehrt_zur_freigabe: einloesen,
  protokollfehler_bricht_nichts_ab: modul,
  ohne_tabelle_kein_abbruch: modul,
  betrieb_kann_die_spur_lesen: protokoll,
  spur_auch_ohne_freigabetabellen: protokoll,
  tabelle_wird_eingerichtet: kern,
  sprung_id_darf_leer_sein: kern,
  fehlende_spur_wird_gemeldet: einloesen,
};

for (const [name, fn] of Object.entries(PRUEFUNGEN)) {
  check(name.replace(/_/g, ' '), fn(ANWENDEN[name]));
}

// ── Gegenprobe ────────────────────────────────────────────────────────
const GEGENPROBEN = [
  ['spur_entsteht_an_einer_stelle', db, t =>
    t.replace(/\n\s*support_spur_merken\([\s\S]*?\);\n/, '\n')],
  ['nur_veraendernde_anfragen', db, t =>
    t.replace("['GET', 'HEAD', 'OPTIONS']", "['OPTIONS']")],
  ['erkannt_an_der_sitzung', db, t =>
    t.replace(/support_sprung_id/g, 'irgendwas')],
  ['spur_fuehrt_zur_freigabe', einloesen, t =>
    t.replace("$werte[]   = (int)$sprung['id'];", "$werte[]   = null;")],
  ['protokollfehler_bricht_nichts_ab', modul, t =>
    t.replace(/    try \{\n(\s*\$pdo->prepare\([\s\S]*?\]\);)\n    \} catch \(Throwable \$e\) \{[\s\S]*?\n    \}/,
              '$1')],
  ['ohne_tabelle_kein_abbruch', modul, t =>
    t.replace('    if (!support_spur_da($pdo)) { return; }\n    try {', '    try {')],
  ['betrieb_kann_die_spur_lesen', protokoll, t =>
    t.replace("'spur'      => support_spur_lesen($pdo),", '')],
  ['spur_auch_ohne_freigabetabellen', protokoll, t =>
    t.replace("'spur' => support_spur_lesen($pdo), 'freigaben' => []]);",
              "'freigaben' => []]);")],
  ['sprung_id_darf_leer_sein', kern, t =>
    t.replace('sprung_id INT UNSIGNED NULL', 'sprung_id INT UNSIGNED NOT NULL')],
  ['fehlende_spur_wird_gemeldet', einloesen, t =>
    t.replace("'protokolliert' => $hatSprungSpalte,", '')],
];

for (const [name, quelle, kaputt] of GEGENPROBEN) {
  const veraendert = kaputt(quelle);
  const hatSichGeaendert = veraendert !== quelle;
  const wirdRot = !PRUEFUNGEN[name](veraendert);
  check(`Gegenprobe: "${name.replace(/_/g, ' ')}" schlaegt an, wenn man es kaputt macht`,
    hatSichGeaendert && wirdRot);
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
