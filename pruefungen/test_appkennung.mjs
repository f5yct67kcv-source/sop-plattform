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

console.log(`\n${ok.length} bestanden, ${bad.length} nicht bestanden\n`);
if (bad.length) { bad.forEach(b => console.log('  ✗ ' + b)); process.exit(1); }
console.log('Alle Pruefungen bestanden.');
