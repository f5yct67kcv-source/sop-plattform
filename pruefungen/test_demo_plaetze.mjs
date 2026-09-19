// Die zehn Demo-Plaetze bekommen ihre Dateien (ENT-600/ENT-601/ENT-613).
//
// WARUM ES DIESE SUITE GIBT: Bis zum 2026-09-19 war der Demo-Bereich bis
// auf einen Schritt fertig -- Mandantenstamm, Datenbanken, Tabellen,
// Selbstbedienung, Zugangsmail. Nur die DATEIEN kamen nie auf die
// Subdomains. Wer die Mail bekam und auf den Link klickte, las "403
// Forbidden". Kein Test war rot, kein Deploy gescheitert: Ein Ziel, das
// niemand beliefert, faellt nirgends auf.
//
// Geprueft wird darum nicht, ob der Workflow bestimmte Woerter enthaelt,
// sondern ob die AUSSAGEN stehen, an denen ein Platz haengt: eigene
// Datenbank, eigene Adresse, Umgebungskennung "demo", kein
// Suchmaschinen-Eintrag, und ein Upload je Platz. Am Ende steht eine
// GEGENPROBE (CLAUDE.md, Regel 2): Jede kritische Pruefung wird gegen
// einen absichtlich kaputt gemachten Workflow laufen gelassen und muss
// dabei rot werden. Eine Pruefung, die nie angeschlagen hat, ist eine
// Behauptung.
import { readFileSync } from 'fs';
import { WURZEL } from './pfade.mjs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const workflowDatei = `${WURZEL}/.github/workflows/deploy-hostpoint.yml`;
const zugangDatei   = `${WURZEL}/backend/demo_zugang.php`;
const workflow = readFileSync(workflowDatei, 'utf8');
const zugang   = readFileSync(zugangDatei, 'utf8');

// Der Abschnitt des Workflows, der die Buendel der Plaetze baut. Alles,
// was diese Suite ueber die Plaetze aussagt, bezieht sich darauf -- damit
// eine gleichlautende Zeile aus einem der anderen fuenf Buendel hier nicht
// versehentlich als Beleg durchgeht.
function platzBlock(text) {
  const von = text.indexOf('- name: Demo-Plaetze bauen');
  const bis = text.indexOf('- name: demo1.guardops.ch beliefern');
  return von === -1 || bis === -1 || bis < von ? '' : text.slice(von, bis);
}

// Die Plaetze, die der Code kennt (DEMO_PLAETZE in backend/demo_zugang.php).
function plaetzeAusCode(text) {
  const m = text.match(/const DEMO_PLAETZE = \[([\s\S]*?)\];/);
  return m ? [...m[1].matchAll(/'([a-z0-9]+)'/g)].map(t => t[1]) : [];
}

// Die Plaetze, die der Workflow kennt (die Liste im Bau-Schritt).
function plaetzeAusWorkflow(text) {
  const m = platzBlock(text).match(/^\s*PLAETZE="([^"]+)"/m);
  return m ? m[1].trim().split(/\s+/) : [];
}

// ── Die Pruefungen, als Funktionen ueber den Workflow-Text ───────────────
//
// Als Funktionen und nicht als gerade heruntergeschriebene Zeilen, damit
// die Gegenprobe ganz unten dieselben Pruefungen gegen einen veraenderten
// Text laufen lassen kann. Sonst muesste sie sie nachbauen -- und eine
// nachgebaute Pruefung beweist nichts ueber die echte.
const PRUEFUNGEN = {

  // Beide Listen muessen dasselbe sagen. Laufen sie auseinander, entsteht
  // genau der Zustand, der am 2026-09-19 vorlag: Der Code teilt einen
  // Platz zu, den der Deploy nicht beliefert.
  listen_decken_sich(text) {
    const code = plaetzeAusCode(zugang);
    const wf = plaetzeAusWorkflow(text);
    return code.length > 0 && wf.length === code.length
      && code.every(p => wf.includes(p));
  },

  // Je Platz ein Upload, und jeder auf sein eigenes Verzeichnis. Ein
  // Platz ohne Upload-Schritt ist eine Adresse, die im Betreiber-Bereich
  // als "frei" dasteht und trotzdem 403 liefert.
  upload_je_platz(text) {
    return plaetzeAusCode(zugang).every(p =>
      new RegExp(`local-dir:\\s*\\./dist-demo/${p}/\\s*$`, 'm').test(text)
      && new RegExp(`EFF_${p.toUpperCase()}_FTP_HOST != ''`).test(text));
  },

  // DIE GEFAEHRLICHSTE ZEILE DES GANZEN SCHRITTS. Die Vorlage ist eine
  // Kopie von dist/ -- aber nur, solange sie VOR der Ersetzung gezogen
  // wird. Rutscht sie dahinter, tragen alle zehn Plaetze die Zugangsdaten
  // der PRODUKTIVEN Datenbank der Mandantin, und ein Demo-Besucher sieht
  // echte Einsaetze, echtes Personal und echte Loehne. Nichts daran
  // kraecht: Die Anlage laeuft, sie zeigt nur die falschen Daten.
  vorlage_vor_der_ersetzung(text) {
    const kopie = text.indexOf('cp -a dist dist-demoplatz-vorlage');
    const ersteErsetzung = text.indexOf('__DB_HOST__|$EFF_DB_HOST');
    return kopie !== -1 && ersteErsetzung !== -1 && kopie < ersteErsetzung;
  },

  // ENT-587: An der Umgebungskennung haengt ist_demo(), und daran haengt
  // die Sperre, die einen Demo-Besucher daran hindert, sich im
  // Betreiber-Bereich das maechtigste Konto der Anlage auszustellen.
  // Stuende hier $UMGEBUNG (= "production"), waere jeder Platz ein
  // offener Weg dorthin.
  umgebungskennung_ist_demo(text) {
    const b = platzBlock(text);
    const gesetzt = /ersetze __APP_ENV__ "demo" "dist-demo\/\$PLATZ\/db\.php"/.test(b)
      && /ersetze __APP_ENV__ "demo" "dist-demo\/\$PLATZ\/testumgebung\.js"/.test(b);
    const verwaessert = /__APP_ENV__[^\n]*\$UMGEBUNG/.test(b);
    return gesetzt && !verwaessert;
  },

  // ENT-600, Punkt 2: Die Trennung laeuft ueber die Datenbank. Kaemen die
  // DB-Werte aus $EFF_DB_* statt aus dem Vorrat, zeigten alle zehn Plaetze
  // auf dieselbe -- und zwar auf die produktive.
  eigene_datenbank_je_platz(text) {
    const b = platzBlock(text);
    const ausVorrat = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS']
      .every(f => new RegExp(`ersetze __${f}__ "\\$${f === 'DB_PASS' ? 'DB_PASS' : f}"`).test(b));
    const ausProduktion = /ersetze __DB_(HOST|NAME|USER|PASS)__ "\$EFF_/.test(b);
    return ausVorrat && !ausProduktion;
  },

  // ENT-501: Die eigene Adresse kommt aus dem Deploy -- und je Platz eine
  // andere, sonst verschickt demo3 Links, die auf demo1 fuehren.
  eigene_adresse_je_platz(text) {
    return /ersetze __APP_BASIS_URL__ "https:\/\/\$PLATZ\.guardops\.ch"/.test(platzBlock(text));
  },

  // Die Sperre, die verhindert, dass ein Interessent beim Ausprobieren
  // eine Offerte an eine echte Adresse schickt: In der Demo leitet
  // smtp_ziel() JEDE Mail auf die Testadresse um. Fehlt sie, geht nichts
  // raus -- fehlt sie unbemerkt, faellt es niemandem auf. Darum ist sie
  // Pflichtwert mit Abbruch, nicht mit Warnung.
  mailumleitung_ist_pflicht(text) {
    const b = platzBlock(text);
    return /ersetze __DEMO_TESTMAIL__ "\$G_TESTMAIL"/.test(b)
      && /PFLICHT_FEHLT[^\n]*gemeinsam\.testmail/.test(b)
      && /\[ -n "\$PFLICHT_FEHLT" \][\s\S]{0,400}exit 1/.test(b);
  },

  // Eine Demo-Instanz unter dem Firmennamen eines Interessenten bei
  // Google ist ein Datenschutzvorfall mit Ansage. Beide Dateien, wie bei
  // der Demo-Umgebung aus ENT-523.
  kein_suchmaschinen_eintrag(text) {
    const b = platzBlock(text);
    return /cat htaccess-demo-zusatz >> "dist-demo\/\$PLATZ\/\.htaccess"/.test(b)
      && /cp robots-demo\.txt "dist-demo\/\$PLATZ\/robots\.txt"/.test(b);
  },

  // Kein uebersehener Platzhalter geht hoch -- dieselbe Wache wie bei den
  // anderen Buendeln. Ohne sie landete zum Beispiel der woertliche Text
  // "__DB_PASS__" als Passwort in der Anlage.
  keine_uebersehenen_platzhalter(text) {
    const b = platzBlock(text);
    return /UEBRIG=\$\(grep -rhos '__\[A-Z_\]\\\{3,\\\}__' "dist-demo\/\$PLATZ\/"/.test(b)
      && /Nicht ersetzte Platzhalter im Buendel[\s\S]{0,200}exit 1/.test(b);
  },

  // Jeder Wert aus dem Vorrat geht durch ersetze(), nie durch ein rohes
  // sed: Ein Passwort mit "|" oder "&" bringt sed sonst zu Fall (im
  // Probelauf vom 2026-09-19 tatsaechlich passiert). Die einzige
  // erlaubte rohe sed-Zeile ist die INNERHALB von ersetze().
  werte_immer_maskiert(text) {
    const b = platzBlock(text);
    const rohe = [...b.matchAll(/^\s*sed -i /gm)].length;
    return /ersetze\(\) \{/.test(b) && rohe === 1;
  },
};

for (const [name, fn] of Object.entries(PRUEFUNGEN)) {
  check(name.replace(/_/g, ' '), fn(workflow));
}

// Ein Platz-Schritt ohne Plaetze waere eine gruene Suite ohne Gegenstand.
check('der Bau-Schritt der Demo-Plaetze existiert ueberhaupt', platzBlock(workflow).length > 500);
check('der Code kennt zehn Plaetze (ENT-613)', plaetzeAusCode(zugang).length === 10);

// ── GEGENPROBE (CLAUDE.md, Regel 2) ──────────────────────────────────────
//
// Jede kritische Pruefung bekommt einen absichtlich kaputten Workflow
// vorgelegt und MUSS daran rot werden. Wird sie es nicht, prueft sie
// nichts -- und das ist selbst ein Befund, nicht bloss eine Luecke.
const GEGENPROBEN = [
  ['vorlage_vor_der_ersetzung', t =>
    t.replace('          if [ "$UMGEBUNG" = "production" ]; then\n            cp -a dist dist-demoplatz-vorlage\n          fi\n', '')
     + '\n# cp -a dist dist-demoplatz-vorlage'],
  ['umgebungskennung_ist_demo', t =>
    t.replace('ersetze __APP_ENV__ "demo" "dist-demo/$PLATZ/db.php"',
              'ersetze __APP_ENV__ "$UMGEBUNG" "dist-demo/$PLATZ/db.php"')],
  ['eigene_datenbank_je_platz', t =>
    t.replace('ersetze __DB_HOST__ "$DB_HOST" "dist-demo/$PLATZ/db.php"',
              'ersetze __DB_HOST__ "$EFF_DB_HOST" "dist-demo/$PLATZ/db.php"')],
  ['eigene_adresse_je_platz', t =>
    t.replace('https://$PLATZ.guardops.ch', 'https://demo1.guardops.ch')],
  ['upload_je_platz', t =>
    t.replace('          local-dir: ./dist-demo/demo7/\n', '          local-dir: ./dist-demo/demo1/\n')],
  ['listen_decken_sich', t =>
    t.replace(/^(\s*)PLAETZE="[^"]+"/m, '$1PLAETZE="demo1 demo2 demo3"')],
  ['mailumleitung_ist_pflicht', t =>
    t.replace('ersetze __DEMO_TESTMAIL__ "$G_TESTMAIL"', 'ersetze __DEMO_TESTMAIL__ ""')],
  ['kein_suchmaschinen_eintrag', t =>
    t.replace('cat htaccess-demo-zusatz >> "dist-demo/$PLATZ/.htaccess"', ': # kein Zusatz')],
  ['werte_immer_maskiert', t =>
    t.replace('ersetze __DB_PASS__ "$DB_PASS" "dist-demo/$PLATZ/db.php"',
              'sed -i "s|__DB_PASS__|$DB_PASS|g" "dist-demo/$PLATZ/db.php"')],
];

for (const [name, kaputt] of GEGENPROBEN) {
  const veraendert = kaputt(workflow);
  const hatSichGeaendert = veraendert !== workflow;
  const wirdRot = !PRUEFUNGEN[name](veraendert);
  check(`Gegenprobe: "${name.replace(/_/g, ' ')}" schlaegt an, wenn man es kaputt macht`,
    hatSichGeaendert && wirdRot);
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
