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
// Die beiden Teile, aus denen die .htaccess eines Platzes zusammengesetzt
// wird (siehe startseiteAus() weiter unten).
const hostpoint = readFileSync(`${WURZEL}/htaccess-hostpoint`, 'utf8');
const demoZusatz = readFileSync(`${WURZEL}/htaccess-demo-zusatz`, 'utf8');

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

// Welche Datei ein Platz unter "/" ausliefert. Gelesen wird die WIRKUNG am
// fertigen Buendel und nicht der Wortlaut einer Zeile: Die beiden Quellen
// werden in derselben Reihenfolge aneinandergehaengt wie im Deploy
// (htaccess-hostpoint, danach htaccess-demo-zusatz), und davon gilt die
// LETZTE DirectoryIndex-Angabe -- so entscheidet es auch Apache, wenn
// mehrere im selben Geltungsbereich stehen.
// Die beiden Texte kommen als Parameter herein, damit die Gegenprobe ganz
// unten denselben Leser gegen eine veraenderte Fassung laufen lassen kann
// statt einen nachgebauten.
function startseiteAus(hostpointText, zusatzText) {
  const treffer = [...`${hostpointText}\n${zusatzText}`
    .matchAll(/^[^\S\n]*DirectoryIndex[^\S\n]+(\S+)/gm)];
  return treffer.length ? treffer[treffer.length - 1][1] : null;
}

// ── Die Pruefungen, als Funktionen ueber den Workflow-Text ───────────────
//
// Als Funktionen und nicht als gerade heruntergeschriebene Zeilen, damit
// die Gegenprobe ganz unten dieselben Pruefungen gegen einen veraenderten
// Text laufen lassen kann. Sonst muesste sie sie nachbauen -- und eine
// nachgebaute Pruefung beweist nichts ueber die echte.
// Ohne Nebenwirkung, weil die Gegenprobe dieselbe Funktion gegen einen
// veraenderten Text laufen laesst: Wuerde sie dabei ins Ergebnis
// schreiben, faerbte die Gegenprobe die Suite rot, obwohl sie gerade
// beweist, dass die Pruefung greift. (Genau so beim ersten Versuch
// passiert.)
function offenePlatzhalter(text) {
  const b = platzBlock(text);
  // Quelle UND Ziel aus derselben cp-Zeile: Der Deploy flacht backend/ in
  // dist/ ab, api/ bleibt ein Unterordner. Wer das nachbaut statt es
  // abzulesen, liegt beim naechsten Sonderfall daneben.
  const zeilen = [...text.matchAll(/^\s*cp\s+(\S+)\s+(dist\/\S*)\s*$/gm)]
    .map(m => ({ quelle: m[1], ziel: m[2] }));
  const offen = new Set();
  for (const { quelle, ziel } of zeilen) {
    // Glob-Zeilen (backend/api/*.php) und fehlende Dateien uebergehen --
    // die deckt die Wache im Deploy ab; hier geht es um die benannten.
    if (quelle.includes('*') || ziel.endsWith('/')) { continue; }
    let inhalt;
    try { inhalt = readFileSync(`${WURZEL}/${quelle}`, 'utf8'); } catch { continue; }
    // JE DATEI, nicht je Platzhalter: Derselbe Platzhalter kann in
    // mehreren Dateien stehen (seit ENT-622 etwa __DEMO_EMPFAENGER__ in
    // demo_anfrage.php UND demo_zugang.php). Eine Pruefung, die nur
    // fragt, ob er irgendwo ersetzt wird, laesst die zweite Datei durch
    // -- genau daran ist der Lauf vom 2026-09-19 gescheitert, obwohl
    // diese Suite gruen war.
    const zielImPlatz = ziel.replace(/^dist\//, 'dist-demo/$PLATZ/');
    for (const t of inhalt.match(/__[A-Z0-9_]{3,}__/g) || []) {
      // PHPs eigene Konstante und der Schluessel der NATIVEN Karte
      // (ENT-609, gehoert ins App-Buendel) -- dieselben zwei Ausnahmen
      // wie im Waechter des Deploys.
      if (t === '__DIR__' || t === '__MAPS_IOS_KEY__') { continue; }
      if (!b.includes(`ersetze ${t} "`) || !b.includes(`"${zielImPlatz}"`)
          || !new RegExp(`ersetze ${t} "[^\n]*" "${zielImPlatz.replace(/[$/.]/g, '\\$&')}"`).test(b)) {
        offen.add(`${t} in ${ziel}`);
      }
    }
  }
  return { offen: [...offen], quellen: zeilen.length };
}

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

  // Je Platz ein Upload, und jeder in sein eigenes Verzeichnis. Ein
  // Platz ohne Upload-Schritt ist eine Adresse, die im Betreiber-Bereich
  // als "frei" dasteht und trotzdem 403 liefert.
  upload_je_platz(text) {
    return plaetzeAusCode(zugang).every(p =>
      new RegExp(`local-dir:\\s*\\./dist-demo/${p}/\\s*$`, 'm').test(text)
      && new RegExp(`server-dir: \\$\\{\\{ env\\.EFF_${p.toUpperCase()}_ZIEL \\}\\}`).test(text)
      && new RegExp(`EFF_${p.toUpperCase()}_ZIEL != ''`).test(text));
  },

  // DIE GEFAEHRLICHSTE ZEILE DER UPLOADS, seit sich alle zehn EINEN
  // Zugang auf den gemeinsamen Elternordner teilen (Festlegung des
  // Projektinhabers, 2026-09-19): Das Zielverzeichnis MUSS der
  // Unterordner des Platzes sein. Stuende dort "/", lieferte der Upload
  // die Dateien EINES Platzes in den Elternordner -- und raeumte dabei
  // die Verzeichnisse der neun anderen weg, weil er sein Ziel aufraeumt.
  ziel_ist_der_unterordner(text) {
    const b = platzBlock(text);
    return /echo "EFF_\$\{GROSS\}_ZIEL=\/\$PLATZ\/"/.test(b)
      && !/server-dir: \/\s*$/m.test(text.slice(text.indexOf('- name: demo1.guardops.ch beliefern')));
  },

  // Ein Zugangssatz fuer alle zehn, nicht zehn einzelne: Wo frueher je
  // Platz Zugangsdaten standen, steht jetzt EIN gemeinsamer Zugang auf
  // den Elternordner. Bliebe daneben ein Platz mit eigenen Zugangsdaten
  // zurueck, gaebe es wieder zwei Wege in dieselbe Sache.
  ein_gemeinsamer_zugang(text) {
    const uploads = text.slice(text.indexOf('- name: demo1.guardops.ch beliefern'));
    return /server: \$\{\{ env\.EFF_DEMOPLAETZE_FTP_HOST \}\}/.test(uploads)
      && !/EFF_DEMO\d+_FTP_/.test(text);
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

  // Das Datenbank-Passwort steht an EINEM Ort: MANDANT_SECRETS, dort, wo
  // der Betreiber-Bereich es auch holt (OP-526). Stuende es zusaetzlich in
  // DEMO_PLAETZE, koennte eine Passwortaenderung an einem der beiden Orte
  // vergessen werden -- und zwar still: Der Betreiber-Bereich kaeme weiter
  // an die Instanz, der Platz selbst nicht mehr.
  passwort_aus_mandant_secrets(text) {
    const b = platzBlock(text);
    const ausTafel = /DB_PASS=\$\(printf '%s' "\$\{EFF_MANDANT_SECRETS:-\}"[\s\S]{0,200}\$SECRET_NAME/.test(b);
    const zweiterOrt = /feld db_passwort/.test(b);
    return ausTafel && !zweiterOrt;
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

  // Das Postfach steht an EINEM Ort: den GUARDOPS_SMTP_*-Secrets, aus
  // denen auch die Homepage verschickt (ENT-569/ENT-570). Stuende es
  // zusaetzlich im Vorrat, waeren es dieselben Werte an zwei Orten --
  // dieselbe stille Falle wie beim Datenbank-Passwort.
  postfach_aus_dem_deploy(text) {
    const b = platzBlock(text);
    // Die Schreibweise der Variablen bleibt offen ("$X" oder "${X:-}") --
    // geprueft wird, WOHER der Wert kommt, nicht wie er geschrieben steht.
    return /ersetze __SMTP_HOST__ "\$\{?EFF_GUARDOPS_SMTP_HOST/.test(b)
      && /ersetze __SMTP_PASSWORD__ "\$\{?EFF_GUARDOPS_SMTP_PASSWORD/.test(b)
      && !/hole smtp_/.test(b);
  },

  // Was ein Interessent unter "/" zu sehen bekommt. Ohne DirectoryIndex
  // nimmt Apache seinen Standard, und das ist index.html -- das
  // Rapport-Tool. Der Interessent landet dann in dessen nackter
  // Anmeldekarte statt in der Maske, die ihm den Demobereich erklaert:
  // ohne Video, ohne Logo mit Claim, ohne Gruss, ohne Impressum und
  // Datenschutz. Genau so stand es bis zum 2026-09-21 auf allen zehn
  // Plaetzen, ohne dass etwas rot wurde: Eine Startseite, die die falsche
  // Datei zeigt, ist kein Fehler, sondern eine andere Seite.
  //
  // Zwei Aussagen zusammen, weil eine allein nichts wert ist: Die
  // Zusatzdatei muss die Startseite wirklich auf dashboard.html stellen
  // (gelesen ueber startseiteAus(), nicht als Wortlaut), UND der
  // Bau-Schritt muss genau diese beiden Dateien in dieser Reihenfolge
  // zusammensetzen. Faellt das Anhaengen weg, gilt wieder der Standard.
  startseite_ist_das_cockpit(text) {
    const b = platzBlock(text);
    const zusammengesetzt =
      /cp htaccess-hostpoint "dist-demo\/\$PLATZ\/\.htaccess"/.test(b)
      && /cat htaccess-demo-zusatz >> "dist-demo\/\$PLATZ\/\.htaccess"/.test(b);
    return zusammengesetzt && startseiteAus(hostpoint, demoZusatz) === 'dashboard.html';
  },

  // Eine Demo-Instanz unter dem Firmennamen eines Interessenten bei
  // Google ist ein Datenschutzvorfall mit Ansage. Beide Dateien, wie bei
  // der Demo-Umgebung aus ENT-523.
  kein_suchmaschinen_eintrag(text) {
    const b = platzBlock(text);
    return /cat htaccess-demo-zusatz >> "dist-demo\/\$PLATZ\/\.htaccess"/.test(b)
      && /cp robots-demo\.txt "dist-demo\/\$PLATZ\/robots\.txt"/.test(b);
  },

  // JEDER Platzhalter, der im Buendel landet, wird auch eingesetzt.
  //
  // WARUM DIESE PRUEFUNG DIE WICHTIGSTE DER GANZEN SUITE IST: Das
  // Platz-Buendel ist eine Kopie von dist/. Legt irgendeine andere Sitzung
  // eine Datei mit einem NEUEN Platzhalter dort hinein, erbt der Platz ihn
  // -- und der Waechter im Deploy bricht ab, womit KEIN einziger Platz
  // beliefert wird. Genau das ist am 2026-09-19 mit
  // __GUARDOPS_BASIS_URL__ aus ENT-624 passiert, gefunden von Hand beim
  // Nachziehen von main. Hier faellt es beim naechsten Testlauf auf,
  // Tage vorher.
  //
  // Die Dateiliste kommt aus den cp-Zeilen des Workflows selbst, nicht aus
  // einer zweiten gepflegten Aufzaehlung: Was nach dist/ kopiert wird,
  // steht dort und nirgends sonst.
  jeder_platzhalter_eingesetzt(text) {
    const { offen, quellen } = offenePlatzhalter(text);
    return offen.length === 0 && quellen > 20;
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
  ['passwort_aus_mandant_secrets', t =>
    t.replace(/DB_PASS=\$\(printf '%s' "\$\{EFF_MANDANT_SECRETS:-\}"[\s\S]*?\|\| true\)/,
              'DB_PASS=$(feld db_passwort)')],
  ['eigene_adresse_je_platz', t =>
    t.replace('https://$PLATZ.guardops.ch', 'https://demo1.guardops.ch')],
  ['upload_je_platz', t =>
    t.replace('          local-dir: ./dist-demo/demo7/\n', '          local-dir: ./dist-demo/demo1/\n')],
  ['ziel_ist_der_unterordner', t =>
    t.replace('echo "EFF_${GROSS}_ZIEL=/$PLATZ/"', 'echo "EFF_${GROSS}_ZIEL=/"')],
  ['ein_gemeinsamer_zugang', t =>
    t.replace('server: ${{ env.EFF_DEMOPLAETZE_FTP_HOST }}', 'server: ${{ env.EFF_DEMO1_FTP_HOST }}')],
  ['listen_decken_sich', t =>
    t.replace(/^(\s*)PLAETZE="[^"]+"/m, '$1PLAETZE="demo1 demo2 demo3"')],
  ['mailumleitung_ist_pflicht', t =>
    t.replace('ersetze __DEMO_TESTMAIL__ "$G_TESTMAIL"', 'ersetze __DEMO_TESTMAIL__ ""')],
  ['jeder_platzhalter_eingesetzt', t =>
    t.replace('ersetze __ANTHROPIC_API_KEY__ "$G_KI" "dist-demo/$PLATZ/ai.php"', ': # weg')],
  ['postfach_aus_dem_deploy', t =>
    t.replace(/ersetze __SMTP_HOST__ "\$\{?EFF_GUARDOPS_SMTP_HOST[^"]*"/,
              'ersetze __SMTP_HOST__ "$(hole smtp_host)"')],
  ['kein_suchmaschinen_eintrag', t =>
    t.replace('cat htaccess-demo-zusatz >> "dist-demo/$PLATZ/.htaccess"', ': # kein Zusatz')],
  ['startseite_ist_das_cockpit', t =>
    t.replace('cp htaccess-hostpoint "dist-demo/$PLATZ/.htaccess"', ': # keine Grundlage')],
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

// Die zweite Haelfte der Startseiten-Pruefung haengt nicht am Workflow,
// sondern am Inhalt der Zusatzdatei -- die Gegenprobe oben kann sie darum
// nicht erreichen. Hier wird sie einzeln gefuehrt: Nimmt man die
// DirectoryIndex-Zeile heraus, muss derselbe Leser etwas anderes
// herausbekommen als dashboard.html. Faende er sie auch ohne die Zeile,
// laese er sie nicht.
check('Gegenprobe: "startseite ist das cockpit" schlaegt an, wenn die DirectoryIndex-Zeile fehlt',
  startseiteAus(hostpoint, demoZusatz.replace(/^[^\S\n]*DirectoryIndex[^\n]*$/m, '')) !== 'dashboard.html');

// Beim echten Workflow wird auch gesagt, WELCHER Platzhalter fehlt --
// sonst weiss niemand, wo er suchen soll.
{
  const { offen } = offenePlatzhalter(workflow);
  if (offen.length) { bad.push('im Platz-Buendel nicht eingesetzt: ' + offen.join(', ')); }
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
