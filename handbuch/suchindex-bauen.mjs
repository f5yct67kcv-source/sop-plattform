#!/usr/bin/env node
// Baut handbuch/suchindex.js aus den Überschriften aller Kapitel und dem
// Glossar. Trägt dabei fehlende Anker-IDs an h2/h3 in den Kapiteln direkt
// nach — nach demselben Grundgedanken wie skizze-einbetten.py im
// Hauptrepository: eine lesbare Quelle (die Kapitel-Dateien selbst) und ein
// abgeleitetes Ergebnis (suchindex.js), von Hand neu erzeugt, kein
// Build-Schritt im Deploy.
//
// Aufruf nach jeder inhaltlichen Änderung an einem Kapitel:
//   node handbuch/suchindex-bauen.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HIER = path.dirname(fileURLToPath(import.meta.url));

const KAPITEL = [
  'erste-schritte.html', 'erfassung.html', 'planung.html', 'kunden.html',
  'personal.html', 'lohn.html', 'abgleich.html', 'betrieb.html', 'kundenportal.html',
];

function slug(text) {
  let s = text.toLowerCase();
  s = s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'abschnitt';
}

function textOhneTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&auml;/g, 'ä')
    .replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function ersterAbsatzNach(html, abIndex) {
  const rest = html.slice(abIndex);
  const treffer = rest.match(/<p[^>]*>([\s\S]*?)<\/p>/);
  if (!treffer) return '';
  return textOhneTags(treffer[1]).slice(0, 160);
}

const eintraege = [];

for (const datei of KAPITEL) {
  const pfad = path.join(HIER, datei);
  let html = readFileSync(pfad, 'utf8');
  const titelTreffer = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const titel = titelTreffer ? textOhneTags(titelTreffer[1]) : datei;
  eintraege.push({ datei, anker: '', ebene: 1, titel, kapitel: titel, text: '' });

  const vergeben = new Set();
  let geaendert = false;

  for (const ebene of [2, 3]) {
    const muster = new RegExp(`<h${ebene}(\\s[^>]*)?>([\\s\\S]*?)</h${ebene}>`, 'g');
    let m;
    while ((m = muster.exec(html)) !== null) {
      const attrs = m[1] || '';
      const inner = m[2];
      const klartext = textOhneTags(inner);
      if (!klartext) continue;

      let id = null;
      const idTreffer = attrs.match(/id="([^"]+)"/);
      if (idTreffer) {
        id = idTreffer[1];
      } else {
        let basis = slug(klartext);
        id = basis;
        let n = 2;
        while (vergeben.has(id)) { id = `${basis}-${n}`; n++; }
        const alteTag = m[0];
        const neueTag = alteTag.replace(`<h${ebene}${attrs}>`, `<h${ebene}${attrs} id="${id}">`);
        html = html.slice(0, m.index) + neueTag + html.slice(m.index + alteTag.length);
        muster.lastIndex = m.index + neueTag.length;
        geaendert = true;
      }
      vergeben.add(id);
      eintraege.push({
        datei, anker: id, ebene, titel: klartext, kapitel: titel,
        text: ersterAbsatzNach(html, muster.lastIndex),
      });
    }
  }

  if (geaendert) {
    writeFileSync(pfad, html, 'utf8');
    console.log(`IDs ergänzt: ${datei}`);
  }
}

// Glossar: jeder .hb-eintrag mit id ist bereits verankert.
const glossarPfad = path.join(HIER, 'glossar.html');
const glossarHtml = readFileSync(glossarPfad, 'utf8');
const eintragMuster = /<div class="hb-eintrag" id="([^"]+)">\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g;
let gm;
while ((gm = eintragMuster.exec(glossarHtml)) !== null) {
  eintraege.push({
    datei: 'glossar.html', anker: gm[1], ebene: 2,
    titel: textOhneTags(gm[2]), kapitel: 'Glossar',
    text: textOhneTags(gm[3]).slice(0, 160),
  });
}
eintraege.splice(1, 0, { datei: 'glossar.html', anker: '', ebene: 1, titel: 'Glossar', kapitel: 'Glossar', text: '' });

const ausgabe = `// Automatisch erzeugt von suchindex-bauen.mjs — nicht von Hand ändern.\n`
  + `// Quelle sind die Überschriften der Kapitel-Dateien und des Glossars.\n`
  + `window.HB_SUCHINDEX = ${JSON.stringify(eintraege)};\n`;
writeFileSync(path.join(HIER, 'suchindex.js'), ausgabe, 'utf8');
console.log(`suchindex.js geschrieben: ${eintraege.length} Einträge.`);
