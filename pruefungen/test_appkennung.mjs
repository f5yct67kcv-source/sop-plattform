// Die Kennung der Mitarbeiter-App (ENT-141, umgestellt mit ENT-568).
//
// WARUM DIESE SUITE: Die Kennung steht an ACHT Stellen in SECHS Dateien --
// Capacitor, zweimal Gradle, die Java-Paketzeile, zweimal strings.xml und
// zweimal das Xcode-Projekt. Dazu muss das Java-VERZEICHNIS zur Paketzeile
// passen, sonst findet Android die Klasse nicht. Laufen zwei davon
// auseinander, bricht der Bau der App an einer Stelle, die nichts mit der
// Ursache zu tun hat -- und lokal faellt es gar nicht auf, weil hier
// niemand die App baut.
//
// Bis ENT-568 lautete sie ch.cupi24.mitarbeiter und benannte das Produkt
// nach der MANDANTIN. Nach der Store-Einreichung ist eine Kennung praktisch
// nicht mehr aenderbar (OP-16) -- darum wurde sie vorher umgestellt, und
// darum wird sie ab jetzt bewacht.
//
// Geprueft wird die UEBEREINSTIMMUNG, nicht ein fester Wert: Der Sollwert
// kommt aus capacitor.config.json, nicht aus dieser Datei. Eine Suite, die
// den Namen abschreibt, muesste bei jeder Umbenennung mitgeaendert werden --
// und waere damit keine Pruefung, sondern eine zweite Quelle.
//
// Seit ENT-603 bewacht diese Suite zusaetzlich den ANZEIGENAMEN (nicht nur
// die Kennung): Er stand bis dahin auf "CUPI 24" -- dem Namen der
// Mandantin -- obwohl die Kennung schon mit ENT-568 auf GuardOpS umgestellt
// war. Dieselbe Lehre wie oben: eine von drei Stellen zu vergessen faellt
// lokal nicht auf, weil hier niemand die App baut.
import { WURZEL } from './pfade.mjs';
import { readFileSync, existsSync, readdirSync } from 'fs';

const ok = [], bad = [];
const check = (n, c) => (c ? ok : bad).push(n);
const lies = d => readFileSync(`${WURZEL}/${d}`, 'utf8');
const M = 'mobile';

// Der Sollwert: die eine Quelle, aus der Capacitor die nativen Projekte baut.
const konfig = JSON.parse(lies(`${M}/capacitor.config.json`));
const kennung = konfig.appId || '';
check('KRITISCH: capacitor.config.json nennt eine App-Kennung', /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(kennung));

// Jede weitere Stelle muss dieselbe tragen.
const stellen = [
  [`${M}/android/app/build.gradle`, 'namespace', new RegExp(`namespace\\s*=\\s*"([^"]+)"`)],
  [`${M}/android/app/build.gradle`, 'applicationId', new RegExp(`applicationId\\s+"([^"]+)"`)],
  [`${M}/android/app/src/main/res/values/strings.xml`, 'package_name', /<string name="package_name">([^<]+)<\/string>/],
  [`${M}/android/app/src/main/res/values/strings.xml`, 'custom_url_scheme', /<string name="custom_url_scheme">([^<]+)<\/string>/],
];
for (const [datei, feld, muster] of stellen) {
  const treffer = (lies(datei).match(muster) || [])[1] || '';
  check(`KRITISCH: ${feld} in ${datei.replace(M + '/', '')} traegt dieselbe Kennung`, treffer === kennung);
  if (treffer !== kennung) { bad.push(`  ${feld}: "${treffer}" statt "${kennung}"`); }
}

// Xcode: BEIDE Konfigurationen (Debug und Release). Nur eine umzustellen
// faellt erst auf, wenn die falsche gebaut wird.
{
  const ids = [...lies(`${M}/ios/App/App.xcodeproj/project.pbxproj`)
    .matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)].map(m => m[1].trim().replace(/^"|"$/g, ''));
  check('KRITISCH: jede Xcode-Konfiguration traegt dieselbe Kennung (Debug UND Release)',
    ids.length >= 2 && ids.every(i => i === kennung));
  if (ids.some(i => i !== kennung)) { bad.push('  Xcode: ' + ids.join(', ')); }
}

// Java: die Paketzeile UND das Verzeichnis darunter.
{
  const paket = kennung;                       // Capacitor legt das Paket = appId an
  const pfad = `${M}/android/app/src/main/java/${paket.replace(/\./g, '/')}`;
  check('KRITISCH: das Java-Verzeichnis entspricht der Kennung', existsSync(`${WURZEL}/${pfad}`));
  if (existsSync(`${WURZEL}/${pfad}`)) {
    const dateien = readdirSync(`${WURZEL}/${pfad}`).filter(f => f.endsWith('.java'));
    check('KRITISCH: dort liegt mindestens eine Java-Datei', dateien.length > 0);
    for (const d of dateien) {
      const zeile = (lies(`${pfad}/${d}`).match(/^\s*package\s+([a-zA-Z0-9_.]+)\s*;/m) || [])[1] || '';
      check(`KRITISCH: die Paketzeile in ${d} entspricht dem Verzeichnis`, zeile === paket);
      if (zeile !== paket) { bad.push(`  ${d}: package ${zeile}`); }
    }
  }
  // Und kein verwaistes Verzeichnis daneben: Beim Umbenennen bleibt sonst
  // die alte Paketstruktur stehen, und Android baut zwei Klassen gleichen
  // Namens -- genau das ist beim Umstellen auf ENT-568 fast passiert.
  const wurzel = `${M}/android/app/src/main/java/${paket.split('.')[0]}`;
  if (existsSync(`${WURZEL}/${wurzel}`)) {
    const zweige = readdirSync(`${WURZEL}/${wurzel}`);
    check('KRITISCH: kein verwaistes Paketverzeichnis aus einer frueheren Kennung',
      zweige.length === 1 && zweige[0] === paket.split('.')[1]);
    if (zweige.length !== 1) { bad.push('  daneben liegt noch: ' + zweige.join(', ')); }
  }
}

// Der Anzeigename (ENT-603): dieselbe Kette wie bei der Kennung -- ein
// Sollwert aus capacitor.config.json, jede weitere Stelle muss ihn tragen.
{
  const name = konfig.appName || '';
  check('KRITISCH: capacitor.config.json nennt einen Anzeigenamen', name.length > 0);

  const anzeigeStellen = [
    [`${M}/ios/App/App/Info.plist`, 'CFBundleDisplayName',
      /<key>CFBundleDisplayName<\/key>\s*\n\s*<string>([^<]*)<\/string>/],
    [`${M}/android/app/src/main/res/values/strings.xml`, 'app_name',
      /<string name="app_name">([^<]*)<\/string>/],
    [`${M}/android/app/src/main/res/values/strings.xml`, 'title_activity_main',
      /<string name="title_activity_main">([^<]*)<\/string>/],
  ];
  for (const [datei, feld, muster] of anzeigeStellen) {
    const treffer = (lies(datei).match(muster) || [])[1] || '';
    check(`KRITISCH: ${feld} in ${datei.replace(M + '/', '')} traegt denselben Anzeigenamen`, treffer === name);
    if (treffer !== name) { bad.push(`  ${feld}: "${treffer}" statt "${name}"`); }
  }
}

// Push-Berechtigung fuer iOS (ENT-604). Ohne die Datei UND ohne den
// Verweis in BEIDEN Konfigurationen lehnt Apple die App beim Registrieren
// fuer Push kommentarlos ab -- ein Fehler, der sich nur am echten Geraet
// zeigt, nie lokal.
{
  const pfad = `${M}/ios/App/App/App.entitlements`;
  check('KRITISCH: die Push-Berechtigungsdatei existiert', existsSync(`${WURZEL}/${pfad}`));
  if (existsSync(`${WURZEL}/${pfad}`)) {
    const inhalt = lies(pfad);
    check('KRITISCH: sie nennt aps-environment',
      /<key>aps-environment<\/key>\s*<string>\w+<\/string>/.test(inhalt));
  }
  const pbxproj = lies(`${M}/ios/App/App.xcodeproj/project.pbxproj`);
  const treffer = [...pbxproj.matchAll(/CODE_SIGN_ENTITLEMENTS\s*=\s*([^;]+);/g)].map(m => m[1].trim());
  check('KRITISCH: beide Xcode-Konfigurationen verweisen auf dieselbe Berechtigungsdatei (Debug UND Release)',
    treffer.length === 2 && treffer.every(t => t === 'App/App.entitlements'));
  if (treffer.some(t => t !== 'App/App.entitlements')) { bad.push('  CODE_SIGN_ENTITLEMENTS: ' + treffer.join(', ')); }
}

// Der AppDelegate muss den Geraetetoken an Capacitor weiterreichen (ENT-604).
//
// iOS liefert den Token ausschliesslich an diese eine Methode. Gibt sie ihn
// nicht weiter, holt das System ihn zwar, das Plugin erfaehrt ihn aber nie:
// kein "registration"-Ereignis, kein Token beim Server, kein Push. Capacitor
// legt die Methoden beim Anlegen des Geruests nicht an, sie sind ein
// Handgriff aus seiner Anleitung -- und fehlten hier genau deshalb.
//
// Geprueft wird die Weitergabe, nicht die Formulierung: Kommt die Methode
// vor UND schickt sie die Nachricht los, auf die das Plugin hoert.
{
  const d = lies(`${M}/ios/App/App/AppDelegate.swift`);
  const weiterleitung = (methode, nachricht) => {
    const i = d.indexOf(methode);
    if (i < 0) { return false; }
    // Nur den Rumpf bis zur naechsten Methode ansehen -- sonst wuerde eine
    // Nachricht irgendwo sonst in der Datei als Weitergabe durchgehen.
    const rumpf = d.slice(i, d.indexOf('\n    func ', i + 1) + 1 || undefined);
    return rumpf.includes(nachricht);
  };
  check('KRITISCH: der AppDelegate reicht den Geraetetoken an Capacitor weiter',
    weiterleitung('didRegisterForRemoteNotificationsWithDeviceToken',
      'capacitorDidRegisterForRemoteNotifications'));
  check('KRITISCH: und meldet auch den Fehlschlag weiter, statt ihn zu verschlucken',
    weiterleitung('didFailToRegisterForRemoteNotificationsWithError',
      'capacitorDidFailToRegisterForRemoteNotifications'));
}

// Jedes Plugin aus package.json muss auch im nativen Bau stehen (ENT-604).
//
// WARUM: "npx cap sync" schreibt ios/App/CapApp-SPM/Package.swift bei jedem
// Lauf neu -- und zwar anhand dessen, was in node_modules liegt, NICHT
// anhand von package.json. Wer ein Plugin eintraegt und "npm install"
// vergisst, bekommt eine Package.swift ohne dieses Plugin. Der Bau gelingt
// danach anstandslos, die Funktion fehlt aber auf dem Geraet.
//
// Genau so fehlte das Push-Plugin beim ersten Geraetetest: keine Frage nach
// der Erlaubnis, und die App tauchte nicht einmal in den Mitteilungs-
// einstellungen des iPhones auf. Am Rechner faellt das nicht auf, weil hier
// niemand die App baut -- dieselbe Lehre wie oben bei der Kennung.
//
// Committet jemand eine so entstandene Package.swift, verschwindet das
// Plugin fuer alle. Diese Pruefung faengt das.
{
  const pkg = JSON.parse(lies(`${M}/package.json`));
  const swift = lies(`${M}/ios/App/CapApp-SPM/Package.swift`);
  // core, cli, ios und android sind das Geruest von Capacitor selbst, keine
  // Plugins -- sie stehen nie als eigene Abhaengigkeit in Package.swift.
  const GERUEST = ['core', 'cli', 'ios', 'android'];
  const plugins = Object.keys(pkg.dependencies || {})
    .filter(n => n.startsWith('@capacitor/'))
    .map(n => n.slice('@capacitor/'.length))
    .filter(n => !GERUEST.includes(n));

  check('KRITISCH: package.json nennt ueberhaupt ein natives Plugin', plugins.length > 0);
  for (const p of plugins) {
    check(`KRITISCH: das Plugin ${p} steht auch im nativen Bau (Package.swift)`,
      swift.includes(`@capacitor/${p}`));
    if (!swift.includes(`@capacitor/${p}`)) {
      bad.push(`  ${p} fehlt -- in mobile/ "npm install" und dann "npx cap sync ios" laufen lassen`);
    }
  }
}

// ══════════ GERÄTERECHTE: WER FRAGT, MUSS ES BEGRÜNDEN ════════════════
// Vom Projektinhaber am Gerät gemeldet: "Standort wird gesucht ..." lief
// endlos, die Frage nach der Erlaubnis kam nie. Ursache war nicht die App,
// sondern Info.plist: Fehlt die Nutzungsbeschreibung, fragt iOS gar nicht
// erst, es lehnt still ab. Dieselbe Falle wie beim Push (ENT-604) -- im
// Browser bringt Safari die Beschreibungen mit, in der eigenen Hülle muss
// die App sie selbst stellen.
//
// Der Sollwert wird aus dem ABGELEITET, was die App wirklich benutzt, nicht
// aus einer Liste hier: Wer morgen eine weitere Gerätefunktion einbaut und
// die Beschreibung vergisst, wird hier rot. Eine abgeschriebene Liste
// bliebe dagegen grün.
{
  const app = readFileSync(`${WURZEL}/app.html`, 'utf8');
  const plist = readFileSync(`${WURZEL}/mobile/ios/App/App/Info.plist`, 'utf8');
  const beschreibung = (schluessel) => {
    const m = plist.match(new RegExp(`<key>${schluessel}</key>\\s*<string>([^<]*)</string>`));
    return m ? m[1].trim() : null;
  };

  const braucht = [
    { was: 'Standort', benutzt: /navigator\.geolocation/.test(app),
      schluessel: 'NSLocationWhenInUseUsageDescription' },
    { was: 'Kamera', benutzt: /capture="(environment|user)"|getUserMedia/.test(app),
      schluessel: 'NSCameraUsageDescription' },
  ];

  for (const { was, benutzt, schluessel } of braucht) {
    check(`KRITISCH: die App benutzt ${was} -- die Prüfung sieht das auch`, benutzt);
    const text = beschreibung(schluessel);
    check(`KRITISCH: für ${was} steht eine Nutzungsbeschreibung in Info.plist`,
      !benutzt || (text !== null && text.length > 0));
    // Ein leerer oder nichtssagender Text ist so schlecht wie keiner: Wer
    // nicht weiss, warum gefragt wird, lehnt ab -- und Apple weist
    // Platzhaltertexte bei der Einreichung zurück.
    check(`Die Beschreibung für ${was} sagt etwas, statt nur den Zugriff zu nennen`,
      !benutzt || (text !== null && text.length >= 30));
  }

  // Um "immer" wird NICHT gebeten: Die Runde läuft im Vordergrund, der
  // Bildschirm wird dafür wachgehalten. Eine Hintergrundortung zu
  // verlangen, die niemand braucht, ist ein Grund für eine Zurückweisung
  // im Store -- und gegenüber den Mitarbeitenden nicht zu rechtfertigen.
  check('KRITISCH: es wird NICHT um dauerhafte Hintergrundortung gebeten',
    !/NSLocationAlwaysAndWhenInUseUsageDescription|NSLocationAlwaysUsageDescription/.test(plist));

  // Die Exportfrage zur Verschlüsselung (ENT-732). Ohne Eintrag fragt App
  // Store Connect bei JEDEM Build nach, und bis die Frage beantwortet ist,
  // steht der Build weder in TestFlight noch zur Prüfung bereit. Die App
  // verschlüsselt nur über das, was iOS mitbringt (HTTPS) -- das ist von
  // der Meldepflicht ausgenommen, also <false/>. Wer später eigene
  // Kryptografie einbaut, muss diese Antwort ändern, nicht löschen.
  check('KRITISCH: Info.plist beantwortet die Exportfrage (ITSAppUsesNonExemptEncryption = false)',
    /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\s*\/>/.test(plist));
}

// ══════════ ANDROID: DIESELBEN GERÄTERECHTE, ANDERS ERKLÄRT ═══════════
// Gegenstueck zum Block darueber. Android fragt nur nach dem, was im
// Manifest steht -- fehlt die Zeile, lehnt es still ab, genau wie iOS ohne
// Nutzungsbeschreibung. Der Sollwert kommt wieder aus app.html.
{
  const app = readFileSync(`${WURZEL}/app.html`, 'utf8');
  const manifest = lies(`${M}/android/app/src/main/AndroidManifest.xml`);
  const recht = (name) => new RegExp(`<uses-permission\\s+android:name="android\\.permission\\.${name}"`).test(manifest);

  if (/navigator\.geolocation/.test(app)) {
    check('KRITISCH: Android darf nach dem genauen Standort fragen (ACCESS_FINE_LOCATION)',
      recht('ACCESS_FINE_LOCATION'));
  }
  if (/capture="(environment|user)"|getUserMedia/.test(app)) {
    check('KRITISCH: Android darf die Kamera oeffnen (CAMERA)', recht('CAMERA'));
  }
  check('KRITISCH: Android bittet NICHT um Hintergrundortung (ENT-588)',
    !recht('ACCESS_BACKGROUND_LOCATION'));
  // Der Kartenschluessel steht als Platzhalter im Manifest, nie im Klartext.
  check('KRITISCH: im Android-Manifest steht kein echter Maps-Schluessel',
    !/AIza[0-9A-Za-z_-]{20,}/.test(manifest));
  check('Das Android-Manifest bekommt den Maps-Schluessel beim Bauen eingesetzt',
    /com\.google\.android\.geo\.API_KEY"[\s\S]*?android:value="\$\{MAPS_API_KEY\}"/.test(manifest)
    && /MAPS_API_KEY\s*:/.test(lies(`${M}/android/app/build.gradle`)));
}

// ══════════ ANDROID: DER SERVER LÄSST DIE HÜLLE DURCH ══════════════════
// Die Android-Huelle laeuft unter <androidScheme>://localhost, Vorgabe
// seit Capacitor 6 ist https. Stand im Backend die andere Schreibweise,
// blockte der WebView jede Antwort -- Anmelden scheiterte, ohne dass die
// App einen Grund nennen konnte. Sollwert aus capacitor.config.json.
{
  const cfg = JSON.parse(lies(`${M}/capacitor.config.json`));
  const schema = (cfg.server && cfg.server.androidScheme) || 'https';
  const db = lies(`backend/db.php`);
  const liste = (db.match(/const APP_NATIVE_HERKUENFTE\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
  check(`KRITISCH: das Backend laesst die Android-Huelle durch (${schema}://localhost)`,
    liste.includes(`'${schema}://localhost'`));
}

// ══════════ ANDROID: KEIN ABSTURZ BEIM PUSH OHNE FIREBASE ═══════════════
// Das Push-Plugin ruft auf Android FirebaseMessaging auf. Ohne
// google-services.json ist Firebase nicht eingerichtet, der Aufruf wirft,
// und Capacitor macht daraus einen Absturz der ganzen App -- beim Start,
// weil app.html die Registrierung dann selbst anstoesst
// (pushNativEinrichten). Bis der FCM-Weg gebaut ist (ENT-604, zweiter
// Bauabschnitt), bleibt das Plugin darum aus dem Android-Bau
// draussen (android.includePlugins in capacitor.config.json). Wer es
// wieder aufnimmt, braucht vorher die Firebase-Datei.
{
  const cfg = JSON.parse(lies(`${M}/capacitor.config.json`));
  const liste = (cfg.android && cfg.android.includePlugins) || cfg.includePlugins || null;
  const pushImBau = liste === null || liste.includes('@capacitor/push-notifications');
  check('KRITISCH: Push steht nur mit Firebase-Datei im Android-Bau',
    !pushImBau || existsSync(`${M}/android/app/google-services.json`));
  // Die Ausschlussliste ist eine POSITIVliste: Jedes Plugin, das nicht
  // drinsteht, fehlt auf Android. Die Karte darf dabei nicht verloren gehen.
  if (liste !== null) {
    const pkg = JSON.parse(lies(`${M}/package.json`));
    const GERUEST = ['@capacitor/core', '@capacitor/cli', '@capacitor/ios', '@capacitor/android'];
    for (const p of Object.keys(pkg.dependencies || {}).filter(n => n.startsWith('@capacitor/') && !GERUEST.includes(n))) {
      if (p === '@capacitor/push-notifications') { continue; }
      check(`KRITISCH: das Plugin ${p} ist auch im Android-Bau`, liste.includes(p));
    }
  }
}

// ══════════ ANDROID: DIE XML-DATEIEN SIND WOHLGEFORMT ═════════════════
// "--" ist in einem XML-Kommentar verboten. In den Kommentaren dieses
// Projekts ist es die uebliche Schreibweise fuer einen Gedankenstrich --
// im Manifest bricht es den Bau ab, und hier merkt es niemand, weil hier
// niemand die App baut. Beim Einrichten der Android-Huelle fast so
// passiert.
{
  const dateien = [
    `${M}/android/app/src/main/AndroidManifest.xml`,
    ...readdirSync(`${WURZEL}/${M}/android/app/src/main/res/values`)
      .filter(n => n.endsWith('.xml')).map(n => `${M}/android/app/src/main/res/values/${n}`),
  ];
  for (const d of dateien) {
    const text = lies(d);
    const kommentare = [...text.matchAll(/<!--([\s\S]*?)-->/g)].map(m => m[1]);
    check(`KRITISCH: kein "--" in einem XML-Kommentar (${d.split('/').pop()})`,
      kommentare.every(k => !k.includes('--')));
  }
}

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
