// Der Sprung des Betreibers ins Cockpit (ENT-631).
//
// WARUM ES DIESE SUITE GIBT: Der Sprung ist der einzige Weg im Haus, auf
// dem jemand ohne Passwort zu einer Sitzung kommt. Fast alles daran ist
// eine Sicherheitsaussage, und Sicherheitsaussagen bleiben still, wenn sie
// brechen -- ein Schluessel, der zweimal gilt, faellt niemandem auf, bis
// ihn jemand zweimal benutzt.
//
// Geprueft werden die AUSSAGEN, nicht der Wortlaut (CLAUDE.md, Regel 1):
// dass nur der Abdruck gespeichert wird, dass die Entwertung die Pruefung
// IST und nicht daneben steht, dass ein echter Mandant eine Freigabe
// braucht und ein Demo-Platz nicht, und dass der Schluessel im Fragment
// reist statt in der Abfrage. Am Schluss die GEGENPROBE (Regel 2): jede
// dieser Pruefungen wird gegen einen absichtlich kaputten Text laufen
// gelassen und muss dabei rot werden.
import { readFileSync } from 'fs';
import { WURZEL } from './pfade.mjs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const lies = (f) => readFileSync(`${WURZEL}/${f}`, 'utf8');

const modul     = lies('backend/support.php');
const ausstellen= lies('backend/api/betreiber_support_sprung.php');
const einloesen = lies('backend/api/support_sprung_einloesen.php');
const kern      = lies('backend/planung_einrichten_kern.php');
const instanz   = lies('backend/demo_instanz.php');
const phpTest   = lies('pruefungen/test_php.mjs');

// Der Rumpf einer PHP-Funktion. Suchen im ganzen Modul wuerde eine Zeile
// aus einer NACHBARFUNKTION als Beleg durchgehen lassen.
function rumpf(text, name) {
  const von = text.indexOf(`function ${name}(`);
  if (von === -1) { return ''; }
  const nach = text.indexOf('\nfunction ', von + 1);
  return text.slice(von, nach === -1 ? text.length : nach);
}

const PRUEFUNGEN = {
  // Der Rohwert geht an den Browser und sonst nirgendwohin. Was in die
  // Tabelle kommt, ist sein Abdruck -- wer die Tabelle lesen kann, kommt
  // damit nicht ins Cockpit (ENT-501).
  nur_der_abdruck: (m) => {
    const r = rumpf(m, 'support_sprung_ausstellen');
    if (!/INSERT INTO support_sprung/.test(r)) { return false; }
    // Der Wert, der als abdruck eingesetzt wird, muss durch
    // sitzung_abdruck() gegangen sein -- und der Rohwert darf nicht
    // daneben in derselben Parameterliste stehen.
    const params = r.match(/->execute\(\[([^\]]*)\]\)/);
    if (!params) { return false; }
    return /sitzung_abdruck\(\$roh\)/.test(params[1])
        && !/(^|[^_])\$roh\s*[,\]]/.test(params[1].replace(/sitzung_abdruck\(\$roh\)/g, 'X'));
  },

  // Die Entwertung IST die Pruefung: ein UPDATE, das nur eine noch
  // ungenutzte und noch gueltige Zeile trifft, und danach die Zahl der
  // getroffenen Zeilen. Wer erst liest und dann entwertet, hat dazwischen
  // eine Luecke, durch die zwei gleichzeitige Anfragen passen.
  entwertung_ist_die_pruefung: (m) => {
    const r = rumpf(m, 'support_sprung_einloesen');
    const u = r.match(/UPDATE support_sprung[\s\S]*?WHERE([\s\S]*?)'/);
    if (!u) { return false; }
    const wo = u[1];
    return /eingeloest_am IS NULL/.test(wo)
        && /gilt_bis > NOW\(\)/.test(wo)
        && /rowCount\(\)\s*!==\s*1/.test(r);
  },

  // Ein Schluessel, der nie ablaeuft, ist ein Dauerzugang. Die Frist wird
  // beim Ausstellen gesetzt, nicht beim Einloesen erhofft.
  frist_beim_ausstellen: (m) => {
    const r = rumpf(m, 'support_sprung_ausstellen');
    return /gilt_bis/.test(r)
        && /INTERVAL \? SECOND/.test(r)
        && /SUPPORT_SPRUNG_SEKUNDEN/.test(r);
  },

  // Genug Zufall, dass Raten aussichtslos ist. 32 Bytes sind dieselbe
  // Groesse wie beim Sitzungs-Token in login.php -- kein eigenes Mass.
  schluessel_ist_nicht_zu_erraten: (m) =>
    /random_bytes\(32\)/.test(rumpf(m, 'support_sprung_ausstellen')),

  // Ein echter Mandant braucht die Freigabe nach ENT-526, ein Demo-Platz
  // nicht. Beides muss im Ausstell-Endpunkt stehen, und die Freigabe muss
  // an der Demo-Unterscheidung haengen -- nicht daneben.
  freigabe_nur_beim_echten_mandanten: (a) => {
    if (!/in_array\(\(string\)\$m\['subdomain'\], DEMO_PLAETZE, true\)/.test(a)) { return false; }
    const m = a.match(/if \(!\$istDemo\) \{([\s\S]*?)\n\}/);
    if (!m) { return false; }
    return /support_freigabe_gueltig\(\$pdo\)/.test(m[1])
        && /keine_freigabe/.test(m[1]);
  },

  // Die Freigabe wird in der Datenbank des MANDANTEN geprueft, nicht im
  // Betreiberstamm. Laege sie beim Betreiber, koennte er sie sich selbst
  // ausstellen -- die Bauart von ENT-526 haengt daran.
  freigabe_kommt_aus_der_mandantendatenbank: (a) =>
    /\$pdo = mandant_db\(\$m\)/.test(a)
    && /support_freigabe_gueltig\(\$pdo\)/.test(a)
    && !/support_freigabe_gueltig\(\$stamm\)/.test(a),

  // Der Schluessel reist im Fragment (#), nicht in der Abfrage (?). Ein
  // Fragment sendet der Browser nie an einen Server; in der Abfrage
  // stuende er in jedem Zugriffsprotokoll (ENT-075).
  schluessel_reist_im_fragment: (a) => {
    const z = a.match(/'ziel'\s*=>\s*([^\n]*)/);
    return !!z && z[1].includes('#support=') && !z[1].includes('?support=');
  },

  // Beide Endpunkte veraendern etwas und duerfen darum nicht per GET
  // erreichbar sein -- ein GET wiederholt sich durch Verlauf, Vorschau
  // und Neuladen von selbst.
  nur_per_post: (a) => /REQUEST_METHOD[\s\S]*?!== 'POST'/.test(a),

  // Das Support-Konto hat KEIN Passwort, das zu irgendetwas passt. Ein
  // erratbarer oder gesetzter Hash waere ein zweiter Weg hinein, an dem
  // weder Frist noch Protokoll haengen.
  konto_ohne_gueltiges_passwort: (m0) => {
    const r = rumpf(m0, 'support_konto_sicherstellen');
    const m = r.match(/INSERT INTO mitarbeiter \(name, password_hash[\s\S]*?->execute\(\[([^\]]*)\]\)/);
    if (!m) { return false; }
    return /'\*'/.test(m[1]) && !/password_hash\(/.test(m[1]);
  },

  // Das Konto wird nur angelegt, wenn es noch keines gibt -- der
  // Einrichtungslauf ist wiederholbar und darf nicht bei jedem Durchgang
  // ein weiteres erzeugen.
  konto_nur_einmal: (m0) =>
    /SELECT COUNT\(\*\) FROM mitarbeiter WHERE support_konto = 1/.test(
      rumpf(m0, 'support_konto_sicherstellen')),

  // Das Leeren einer Demo macht TRUNCATE auf JEDE Tabelle -- auch auf
  // mitarbeiter. Ohne das Nachlegen waere das Support-Konto nach dem
  // ersten Ablauf fort, und der Sprung endete wortlos auf der
  // Anmeldemaske. Geprueft wird, dass es NACH dem Leeren geschieht: davor
  // waere es dasselbe wie gar nicht.
  konto_ueberlebt_das_leeren: (i) => {
    const leeren = i.indexOf('demo_reset_alle_tabellen_leeren($instanz)');
    const nachlegen = i.indexOf('support_konto_sicherstellen($instanz)');
    return leeren !== -1 && nachlegen !== -1 && nachlegen > leeren;
  },

  // Der Einloese-Endpunkt hat bewusst keine Anmeldung und muss darum
  // namentlich in der Ausnahmeliste stehen (ENT-501). Ohne den Eintrag
  // bliebe ein vergessenes require_session() gruen.
  ohne_anmeldung_benannt: (t) =>
    /'support_sprung_einloesen\.php'/.test(t.slice(t.indexOf('const OHNE_ANMELDUNG'))),
};

const ANWENDEN = {
  nur_der_abdruck: modul,
  entwertung_ist_die_pruefung: modul,
  frist_beim_ausstellen: modul,
  schluessel_ist_nicht_zu_erraten: modul,
  freigabe_nur_beim_echten_mandanten: ausstellen,
  freigabe_kommt_aus_der_mandantendatenbank: ausstellen,
  schluessel_reist_im_fragment: ausstellen,
  nur_per_post: ausstellen,
  konto_ohne_gueltiges_passwort: modul,
  konto_nur_einmal: modul,
  konto_ueberlebt_das_leeren: instanz,
  ohne_anmeldung_benannt: phpTest,
};

for (const [name, fn] of Object.entries(PRUEFUNGEN)) {
  check(name.replace(/_/g, ' '), fn(ANWENDEN[name]));
}

// Der Einloese-Endpunkt gilt genauso: er veraendert und darf kein GET sein.
check('einloesen nur per post', PRUEFUNGEN.nur_per_post(einloesen));

// ── Gegenprobe ────────────────────────────────────────────────────────
const GEGENPROBEN = [
  ['nur_der_abdruck', modul, t =>
    t.replace('sitzung_abdruck($roh), $freigabeId', '$roh, $freigabeId')],
  ['entwertung_ist_die_pruefung', modul, t =>
    t.replace('WHERE abdruck = ? AND eingeloest_am IS NULL AND gilt_bis > NOW()',
              'WHERE abdruck = ?')],
  ['frist_beim_ausstellen', modul, t =>
    t.replace('DATE_ADD(NOW(), INTERVAL ? SECOND)', 'DATE_ADD(NOW(), INTERVAL 30 DAY)')],
  ['schluessel_ist_nicht_zu_erraten', modul, t =>
    t.replace('bin2hex(random_bytes(32))', 'bin2hex(random_bytes(4))')],
  ['freigabe_nur_beim_echten_mandanten', ausstellen, t =>
    t.replace('$freigabe = support_freigabe_gueltig($pdo);', '$freigabe = ["id" => 0];')],
  ['freigabe_kommt_aus_der_mandantendatenbank', ausstellen, t =>
    t.replace('support_freigabe_gueltig($pdo)', 'support_freigabe_gueltig($stamm)')],
  ['schluessel_reist_im_fragment', ausstellen, t =>
    t.replace("'/dashboard.html#support=' . $schluessel", "'/dashboard.html?support=' . $schluessel")],
  ['nur_per_post', ausstellen, t =>
    t.replace(/if \(\(\$_SERVER\['REQUEST_METHOD'\][\s\S]*?\n\}\n/, '')],
  ['konto_ohne_gueltiges_passwort', modul, t =>
    t.replace("->execute(['GuardOpS Support', '*',", "->execute(['GuardOpS Support', password_hash('support', PASSWORD_DEFAULT),")],
  ['konto_nur_einmal', modul, t =>
    t.replace('SELECT COUNT(*) FROM mitarbeiter WHERE support_konto = 1', 'SELECT 0')],
  ['konto_ueberlebt_das_leeren', instanz, t =>
    t.replace('    support_konto_sicherstellen($instanz);\n', '')],
  ['ohne_anmeldung_benannt', phpTest, t =>
    t.replace("  'support_sprung_einloesen.php',", '')],
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
