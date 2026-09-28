// Die Android-Huelle der Mitarbeiter-App (ENT-715; ENT-588 Punkt 3, ENT-604).
//
// WARUM DIESE SUITE: Hier baut niemand die Android-App -- weder in dieser
// Umgebung noch im Deploy. Was im Android-Projekt fehlt, faellt also erst
// auf dem Telefon auf, und dort meist STILL: Der WebView fragt nur nach
// Berechtigungen, die im Manifest stehen, und meldet sonst schlicht
// "abgelehnt". Kein Fehler, kein Dialog -- die Funktion ist einfach nicht da.
//
// Geprueft wird darum, was die App auf dem Geraet koennen muss, und je
// Aussage die Stelle, an der es sonst still scheitert. Die Aussagen sind
// Sachverhalte (FINE-Ortung ist erlaubt), kein abgeschriebener Wortlaut --
// Kommentare im Manifest zaehlen nicht mit.
import { WURZEL } from './pfade.mjs';
import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);

const MOBIL = `${WURZEL}/mobile`;
const manifestRoh = readFileSync(`${MOBIL}/android/app/src/main/AndroidManifest.xml`, 'utf8');
// Kommentare weg: Eine auskommentierte Zeile ist keine Berechtigung.
const manifest = manifestRoh.replace(/<!--[\s\S]*?-->/g, '');
const erlaubt = new Set([...manifest.matchAll(/<uses-permission[^>]*android:name="android\.permission\.([A-Z_]+)"/g)]
  .map(m => m[1]));

// ── Berechtigungen ────────────────────────────────────────────────────
check('KRITISCH: genaue Ortung (FINE) -- ohne sie laesst sich kein Kontrollpunkt bestaetigen',
  erlaubt.has('ACCESS_FINE_LOCATION'));
check('KRITISCH: COARSE daneben -- ab Android 12 bekommt sonst gar nichts, wer "ungefaehr" waehlt',
  erlaubt.has('ACCESS_COARSE_LOCATION'));
check('KRITISCH: Benachrichtigungen (Android 13+) -- sonst kommt ein Token an, aber nie eine Meldung',
  erlaubt.has('POST_NOTIFICATIONS'));
check('Vibration beim Kontrollpunkt', erlaubt.has('VIBRATE'));
check('Netz', erlaubt.has('INTERNET'));
/* Die Kamera-Berechtigung FEHLT mit Absicht. Steht sie im Manifest, fragt
   Capacitor vor dem Fotobeleg danach -- und wer ablehnt, bekommt weder
   Kamera noch Bildauswahl (BridgeWebChromeClient.onShowFileChooser: bei
   deklarierter, aber verweigerter Berechtigung geht null zurueck). Ohne
   den Eintrag oeffnet Android die System-Kamera ohne jede Rueckfrage. */
check('KRITISCH: KEINE Kamera-Berechtigung -- sie fuegte dem Fotobeleg nur einen Weg zum Scheitern hinzu',
  !erlaubt.has('CAMERA'));
/* Eine als Pflicht erklaerte Hardware blendet die App in Google Play auf
   jedem Geraet ohne diese Hardware aus. */
const pflicht = [...manifest.matchAll(/<uses-feature([^>]*)>/g)]
  .filter(m => !/android:required="false"/.test(m[1])).map(m => m[1]);
check('Keine Hardware als Pflicht erklaert, die Google Play Geraete ausschliessen liesse',
  pflicht.length === 0);

// ── Plugins im nativen Projekt ────────────────────────────────────────
/* Jedes Capacitor-Plugin aus package.json muss im Gradle-Projekt stehen,
   und zwar im VERSIONIERTEN Stand. Fehlt es dort, traegt "cap sync" es
   beim Bauen nach -- dann liegt nach jedem Lauf eine lokale Aenderung im
   Arbeitsbaum, die der naechste Lauf von aufs-android.sh in den Stash
   schiebt. Genau das ist bei iOS mit Package.swift passiert. So war es
   hier auch: google-maps fehlte seit ENT-609 im Android-Projekt. */
const paket = JSON.parse(readFileSync(`${MOBIL}/package.json`, 'utf8'));
const plugins = Object.keys(paket.dependencies || {})
  .filter(n => n.startsWith('@capacitor/'))
  .filter(n => !['@capacitor/core', '@capacitor/cli', '@capacitor/android', '@capacitor/ios'].includes(n))
  .map(n => n.slice('@capacitor/'.length));
const einstellungen = readFileSync(`${MOBIL}/android/capacitor.settings.gradle`, 'utf8');
const bau = readFileSync(`${MOBIL}/android/app/capacitor.build.gradle`, 'utf8');
check('Es gibt ueberhaupt Plugins zu pruefen', plugins.length > 0);
for (const p of plugins) {
  check(`Plugin ${p} ist im Android-Projekt eingebunden (settings)`,
    einstellungen.includes(`include ':capacitor-${p}'`));
  check(`Plugin ${p} ist im Android-Projekt eingebunden (Abhaengigkeit)`,
    bau.includes(`project(':capacitor-${p}')`));
}

// ── Firebase ──────────────────────────────────────────────────────────
/* google-services.json gehoert zum Firebase-Projekt der Betreiberin und
   liegt nie im Repository. Ohne sie stuerzt die App beim Anmelden fuer
   Benachrichtigungen ab -- aufs-android.sh verweigert darum den Bau. */
let versioniert = '';
try {
  versioniert = execFileSync('git', ['ls-files', 'mobile/android/app/google-services.json'],
    { cwd: WURZEL, encoding: 'utf8' }).trim();
} catch (e) { versioniert = '?'; }
check('KRITISCH: google-services.json ist nicht versioniert', versioniert === '');
let ignoriert = false;
try {
  execFileSync('git', ['check-ignore', '-q', 'mobile/android/app/google-services.json'], { cwd: WURZEL });
  ignoriert = true;
} catch (e) { ignoriert = false; }
check('KRITISCH: und Git nimmt sie auch versehentlich nicht mit (.gitignore)', ignoriert);
const appGradle = readFileSync(`${MOBIL}/android/app/build.gradle`, 'utf8');
check('Das Google-Services-Plugin wird angewendet, sobald die Datei da ist',
  /google-services\.json/.test(appGradle) && /com\.google\.gms\.google-services/.test(appGradle));

// ── Das Bauskript ─────────────────────────────────────────────────────
const skript = `${WURZEL}/aufs-android.sh`;
check('aufs-android.sh ist vorhanden', existsSync(skript));
let syntax = false;
try { execFileSync('bash', ['-n', skript]); syntax = true; } catch (e) { syntax = false; }
check('aufs-android.sh ist gueltiges bash', syntax);
/* Ohne google-services.json muss das Skript ABBRECHEN, bevor es etwas
   baut. Geprueft am Verhalten, nicht am Text: Die Pruefung auf die Datei
   wird herausgeloest und mit einem leeren Arbeitsverzeichnis ausgefuehrt. */
{
  const quelle = readFileSync(skript, 'utf8');
  const von = quelle.indexOf('GS="mobile/android/app/google-services.json"');
  const bis = quelle.indexOf('echo "        google-services.json passt zur App"');
  check('Die Pruefung auf google-services.json steht vor dem Bau',
    von > 0 && bis > von && bis < quelle.indexOf('npx cap sync android'));
  const teil = quelle.slice(von, bis);
  const lauf = (vorbereiten) => {
    const tmp = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim();
    execFileSync('mkdir', ['-p', `${tmp}/mobile/android/app`]);
    execFileSync('cp', [`${MOBIL}/capacitor.config.json`, `${tmp}/mobile/`]);
    vorbereiten(tmp);
    try { execFileSync('bash', ['-c', `set -euo pipefail\n${teil}\necho DURCH`], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' }); return 'durch'; }
    catch (e) {
      if (String(e.stdout || '').includes('DURCH')) { return 'durch'; }
      // Ein Abbruch mit einer Python-Fehlermeldung ist kein Handgriff,
      // den jemand befolgen kann. Verlangt wird darum auch eine eigene
      // Meldung auf der Standardausgabe -- ohne Traceback.
      const aus = String(e.stdout || ''), fehler = String(e.stderr || '');
      return aus.trim() !== '' && !/Traceback/.test(fehler + aus) ? 'abbruch' : 'absturz';
    }
    finally { execFileSync('rm', ['-rf', tmp]); }
  };
  const gs = (tmp, name) => execFileSync('bash', ['-c',
    `printf '{"client":[{"client_info":{"android_client_info":{"package_name":"%s"}}}]}' '${name}' > mobile/android/app/google-services.json`],
    { cwd: tmp });
  check('KRITISCH: ohne google-services.json bricht das Skript ab, statt eine abstuerzende App zu bauen',
    lauf(() => {}) === 'abbruch');
  check('KRITISCH: mit der Datei einer fremden App ebenso -- das Geraet bekaeme sonst still nie ein Token',
    lauf(t => gs(t, 'com.fremd.app')) === 'abbruch');
  check('Mit der passenden Datei geht es weiter',
    lauf(t => gs(t, JSON.parse(readFileSync(`${MOBIL}/capacitor.config.json`, 'utf8')).appId)) === 'durch');
}

// ── Die native Karte (ENT-717) ────────────────────────────────────────
/* Auf Android liest das Karten-SDK den Schluessel NUR aus dem Manifest.
   Dort darf er aber nicht stehen -- das Manifest ist versioniert. Also
   steht dort ein Gradle-Platzhalter, und Gradle fuellt ihn aus einer
   ignorierten Datei. Geprueft wird die Kette, nicht ein Wortlaut: Der
   Platzhaltername wird aus dem Manifest gelesen und muss in build.gradle
   als manifestPlaceholder definiert sein. */
{
  const meta = manifest.match(/<meta-data[^>]*android:name="com\.google\.android\.geo\.API_KEY"[^>]*android:value="([^"]*)"/);
  check('KRITISCH: das Manifest traegt einen Eintrag fuer den Karten-Schluessel -- ohne ihn bleibt die native Karte grau',
    !!meta);
  const wert = meta ? meta[1] : '';
  const platz = (wert.match(/^\$\{([A-Za-z_]+)\}$/) || [])[1];
  check('KRITISCH: dort steht ein Platzhalter und kein Schluessel', !!platz);
  check(`KRITISCH: Gradle definiert genau diesen Platzhalter (${platz || '?'})`,
    !!platz && new RegExp(`manifestPlaceholders[^\\n]*\\b${platz}\\s*:`).test(appGradle));
  const quelle = (appGradle.match(/rootProject\.file\('([^']+)'\)/) || [])[1];
  const datei = quelle ? `mobile/${quelle.replace(/^\.\.\//, '')}` : '';
  check(`Gradle liest ihn aus einer Datei (${datei || '?'})`, !!datei);
  let ign = false, vers = '?';
  try { execFileSync('git', ['check-ignore', '-q', datei], { cwd: WURZEL }); ign = true; } catch (e) {}
  try { vers = execFileSync('git', ['ls-files', datei], { cwd: WURZEL, encoding: 'utf8' }).trim(); } catch (e) {}
  check('KRITISCH: diese Datei nimmt Git nie mit', !!datei && ign && vers === '');
  check('KRITISCH: es ist dieselbe Datei, die aufs-android.sh ins Buendel einsetzt -- sonst sagte die App "eingerichtet" und die Karte bliebe grau',
    !!datei && readFileSync(skript, 'utf8').includes(`schluessel_einsetzen ${datei} `));
}

/* Kein echter Schluessel irgendwo im versionierten Android-Projekt. */
{
  const dateien = execFileSync('git', ['ls-files', 'mobile/android'], { cwd: WURZEL, encoding: 'utf8' })
    .split('\n').filter(f => /\.(xml|gradle|java|kt|properties|json)$/.test(f));
  const mitSchluessel = dateien.filter(f => /AIza[0-9A-Za-z_-]{30,}/.test(readFileSync(`${WURZEL}/${f}`, 'utf8')));
  check(`KRITISCH: kein Google-Schluessel im versionierten Android-Projekt (${mitSchluessel.join(', ') || 'keiner'})`,
    dateien.length > 0 && mitSchluessel.length === 0);
}

/* Beide Bauskripte fuellen DENSELBEN Platzhalter, den app.html fuer die
   native Karte fragt. Der Platzhalter wird aus app.html gelesen, nicht
   hier abgeschrieben. */
{
  const app = readFileSync(`${WURZEL}/app.html`, 'utf8');
  const ph = (app.match(/const RGS_MAPS_NATIV_SCHLUESSEL = '(__[A-Z_]+__)'/) || [])[1];
  check('app.html fragt fuer die native Karte einen Platzhalter ab', !!ph);
  check(`aufs-android.sh setzt ${ph} ein`, !!ph && new RegExp(`schluessel_einsetzen \\S+ ${ph} `).test(readFileSync(skript, 'utf8')));
  check(`aufs-handy.sh setzt ${ph} ein`, !!ph
    && new RegExp(`maps_schluessel_einsetzen \\S+ \\S+ ${ph}\\s*$`, 'm').test(readFileSync(`${WURZEL}/aufs-handy.sh`, 'utf8')));

  /* Und das Einsetzen selbst, am Verhalten: Die Funktion wird aus dem
     Skript herausgeloest und gegen eine Probedatei laufen gelassen. */
  const q = readFileSync(skript, 'utf8');
  const fn = q.slice(q.indexOf('schluessel_einsetzen() {'), q.indexOf('\n}\n', q.indexOf('schluessel_einsetzen() {')) + 3);
  const probe = (inhalt) => {
    const tmp = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim();
    try {
      execFileSync('bash', ['-c', `printf '%s' "$1" > k; printf 'a=${ph};' > b`, '_', inhalt], { cwd: tmp });
      const aus = execFileSync('bash', ['-c',
        `set -euo pipefail\nwarnen() { echo "WARN $1"; }\nBUENDEL_DATEI=b\n${fn}\nschluessel_einsetzen k ${ph} Probe || echo NEIN\ncat b`],
        { cwd: tmp, encoding: 'utf8' });
      return aus;
    } finally { execFileSync('rm', ['-rf', tmp]); }
  };
  const echt = 'AIza' + 'Sy' + 'P'.repeat(33);
  const r1 = probe(echt);
  check('Ein Schluessel in der Form von Google wird eingesetzt', r1.includes(`a=${echt};`) && !r1.includes('NEIN'));
  const r2 = probe('DER_NEUE_SCHLUESSEL_AUS_DER_ANLEITUNG_HIER_EINTRAGEN');
  check('KRITISCH: Beispieltext aus einer Anleitung wird NICHT eingesetzt -- die App sagte sonst "eingerichtet"',
    r2.includes(`a=${ph};`) && r2.includes('NEIN') && r2.includes('WARN'));
  const r3 = probe('');
  check('Eine leere Datei ebenso, mit Warnung', r3.includes(`a=${ph};`) && r3.includes('WARN'));
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { console.log(bad.map(n => '  ✗ ' + n).join('\n')); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
