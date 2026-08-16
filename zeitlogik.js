// Reine Rechenlogik des Ablaufplans — Zeiten, Sortierung, Textübernahme,
// Verschieben, Betroffenheit.
//
// ⚠️ Bewusst OHNE jeden DOM-Zugriff. Dadurch lässt sich die Datei in Node laden
// und einzeln prüfen (gleiches Muster wie E:\schulsport\termine.js). Wer hier
// document oder window anfasst, macht genau das kaputt.

// ---------- Zeit ----------

// "09:00" -> 540. Liefert null, wenn nichts Brauchbares dasteht.
function minutenAusZeit(zeit) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(zeit || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// 540 -> "09:00". Werte außerhalb eines Tages werden NICHT abgeschnitten,
// sondern vom Aufrufer über den Tagesversatz abgefangen (siehe verschiebeAb).
function zeitAusMinuten(minuten) {
  const m = ((minuten % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return String(h).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
}

// ---------- Datum ----------
//
// ⚠️ Gerechnet wird mit getFullYear/getMonth/getDate, NIE mit
// toISOString().slice(0,10): in deutscher Sommerzeit liefert toISOString() vor
// 02:00 Uhr den Vortag. Gleiche Falle wie in E:\schulsport\termine.js.

function isoAusDatum(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function datumAusIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Fängt den 31.02. ab: der Konstruktor rollt still weiter.
  if (d.getMonth() !== Number(m[2]) - 1) return null;
  return d;
}

// Verschiebt ein ISO-Datum um ganze Tage.
function isoPlusTage(iso, tage) {
  const d = datumAusIso(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + tage);
  return isoAusDatum(d);
}

// Ganze Tage zwischen zwei ISO-Daten (b - a).
function tageZwischen(a, b) {
  const da = datumAusIso(a);
  const db = datumAusIso(b);
  if (!da || !db) return 0;
  return Math.round((db - da) / 86400000);
}

const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

function datumText(iso) {
  const d = datumAusIso(iso);
  if (!d) return String(iso || "");
  return WOCHENTAGE[d.getDay()] + ", " +
    String(d.getDate()).padStart(2, "0") + "." +
    String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear();
}

function datumKurz(iso) {
  const d = datumAusIso(iso);
  if (!d) return String(iso || "");
  return WOCHENTAGE[d.getDay()].slice(0, 2) + " " +
    String(d.getDate()).padStart(2, "0") + "." +
    String(d.getMonth() + 1).padStart(2, "0") + ".";
}

// ---------- Mannschaften ----------

// Vergleichsform für Mannschaftsnamen. "D1", "D1-Jugend" und "d 1 Jugend" sind
// dieselbe Mannschaft — die Namen kommen aus den frei getippten Trainerprofilen
// und aus einer eingefügten Textliste, die stimmen nie zeichengenau überein.
function normMannschaft(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[\s._-]+/g, "")
    .replace(/(jugend|junioren|juniorinnen|mannschaft)$/, "");
}

// Betrifft dieser Punkt eine der eigenen Mannschaften?
// Ein Punkt ohne Mannschaft (nur Freitext-Wer) betrifft niemanden persönlich —
// er wird angezeigt, aber nie als "meiner" markiert.
function punktBetrifft(punkt, meineMannschaften) {
  const meine = (meineMannschaften || []).map(normMannschaft).filter(Boolean);
  if (!meine.length) return false;
  const seine = ((punkt && punkt.mannschaften) || []).map(normMannschaft).filter(Boolean);
  return seine.some((m) => meine.indexOf(m) >= 0);
}

// ---------- Sortierung ----------

// Sortierschlüssel eines Punktes: Datum, dann Startzeit. Punkte ohne Zeit
// stehen am Anfang des Tages, nicht irgendwo dazwischen.
function punktSortKey(punkt) {
  const min = minutenAusZeit(punkt && punkt.startZeit);
  return String((punkt && punkt.datum) || "") + "T" +
    String(min === null ? -1 : min).padStart(5, "0");
}

function sortierePunkte(punkte) {
  return (punkte || []).slice().sort((a, b) => {
    const ka = punktSortKey(a);
    const kb = punktSortKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

// ---------- Verschieben ----------
//
// Der Knopf am Tag selbst: ein Punkt und alles danach rutscht um X Minuten.
// Gerechnet wird auf der SORTIERTEN Reihenfolge, nicht auf der Speicher-
// reihenfolge — sonst hinge es davon ab, in welcher Folge die Punkte angelegt
// wurden. Läuft eine Zeit über Mitternacht, wandert der Punkt auf den nächsten
// Tag statt bei 23:59 stehenzubleiben.
function verschiebeAb(punkte, abId, minuten) {
  const sortiert = sortierePunkte(punkte);
  const start = sortiert.findIndex((p) => p.id === abId);
  if (start < 0 || !minuten) return punkte.slice();

  const betroffen = new Set(sortiert.slice(start).map((p) => p.id));

  return punkte.map((p) => {
    if (!betroffen.has(p.id)) return p;
    const startMin = minutenAusZeit(p.startZeit);
    if (startMin === null) return p; // ohne Startzeit gibt es nichts zu schieben

    const neuStart = startMin + minuten;
    const tagesVersatz = Math.floor(neuStart / 1440);
    const neu = Object.assign({}, p, {
      datum: tagesVersatz ? isoPlusTage(p.datum, tagesVersatz) : p.datum,
      startZeit: zeitAusMinuten(neuStart)
    });

    const endMin = minutenAusZeit(p.endZeit);
    if (endMin !== null) {
      // Die Endzeit wandert um denselben Betrag, damit die Dauer erhalten
      // bleibt. Ein Punkt, dessen Ende vor dem Start lag (über Mitternacht
      // getippt), bleibt genauso schief wie vorher — hier wird nichts geheilt.
      neu.endZeit = zeitAusMinuten(endMin + minuten);
    }
    return neu;
  });
}

// ---------- Zeitraum eines Ablaufs ----------

// Der Zeitraum im Kopf ist die Vorgabe; Punkte dürfen aber darüber
// hinauswandern (Verschieben über Mitternacht, eingefügter Text mit Datums-
// zeilen). Diese Funktion zieht den Kopf nach — sie schneidet nie etwas ab.
function synchronisiereZeitraum(ablauf) {
  const daten = (ablauf.punkte || []).map((p) => p.datum).filter(Boolean).sort();
  if (!daten.length) return ablauf;
  const frueh = daten[0];
  const spaet = daten[daten.length - 1];
  if (!ablauf.startDatum || frueh < ablauf.startDatum) ablauf.startDatum = frueh;
  if (!ablauf.endDatum || spaet > ablauf.endDatum) ablauf.endDatum = spaet;
  return ablauf;
}

// Ein Ablauf gehört ins Archiv, sobald sein LETZTER Tag vorbei ist.
// Der Tag selbst zählt bis zum Schluss dazu — am Medientag um 14 Uhr soll der
// Medientag nicht plötzlich unter "Früher" liegen.
function istVergangen(ablauf, heuteIso) {
  const ende = ablauf.endDatum || ablauf.startDatum || "";
  if (!ende) return false;
  return ende < heuteIso;
}

// ---------- Was läuft gerade / was kommt als Nächstes ----------

// Index des ersten Punktes, der noch nicht begonnen hat (bezogen auf die
// sortierte Liste). Alles davor ist gelaufen. Liefert die Länge der Liste,
// wenn alles vorbei ist.
function naechsterPunktIndex(sortiertePunkte, jetztIso, jetztMinuten) {
  for (let i = 0; i < sortiertePunkte.length; i++) {
    const p = sortiertePunkte[i];
    const datum = p.datum || "";
    if (datum > jetztIso) return i;
    if (datum < jetztIso) continue;
    const min = minutenAusZeit(p.startZeit);
    if (min === null || min >= jetztMinuten) return i;
  }
  return sortiertePunkte.length;
}

// Läuft dieser Punkt gerade? Ohne Endzeit gilt er als laufend, solange kein
// späterer Punkt begonnen hat — das entscheidet der Aufrufer, hier wird nur
// das Fenster geprüft.
function punktLaeuft(punkt, jetztIso, jetztMinuten) {
  if ((punkt.datum || "") !== jetztIso) return false;
  const start = minutenAusZeit(punkt.startZeit);
  if (start === null) return false;
  const ende = minutenAusZeit(punkt.endZeit);
  if (ende === null) return false;
  return jetztMinuten >= start && jetztMinuten < ende;
}

// ---------- Text übernehmen ----------

// Unsichtbare Zeichen, die beim Kopieren aus WhatsApp, Word und Mail mitkommen.
// ⚠️ Michels Medientag-Liste enthält genau solche (Word-Joiner U+2060 vor
// einzelnen Uhrzeiten) — ohne dieses Putzen findet die Zeitsuche die Zeile nicht.
const UNSICHTBAR_RE = /[\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g;

function putzeZeile(zeile) {
  return String(zeile || "")
    .replace(UNSICHTBAR_RE, "")
    .replace(/\u00A0/g, " ")
    .replace(/^[\s]*[-–—*•·]+\s*/, "") // Aufzählungsstrich
    .trim();
}

// Erkennt Mannschafts-Kürzel wie B1, D2, C, G — auch als Kette B1/B2/B3.
// Bewusst ein MUSTER und nicht nur die Liste aus den Trainerprofilen: dort
// steht vielleicht "B-Junioren", in der eingefügten Liste steht "B1". Was das
// Muster erkennt, wird übernommen; was in der Profilliste steht, ebenfalls.
const TEAM_TOKEN_RE = /^[A-G]\d{0,2}$/i;

function tokenIstMannschaft(token, bekannte) {
  if (TEAM_TOKEN_RE.test(token)) return true;
  const norm = normMannschaft(token);
  if (!norm) return false;
  return (bekannte || []).some((b) => normMannschaft(b) === norm);
}

// "B1/B2" -> ["B1","B2"] wenn ALLE Teile als Mannschaft durchgehen, sonst null.
function teileMannschaften(token, bekannte) {
  const teile = token.split("/").map((t) => t.trim()).filter(Boolean);
  if (!teile.length) return null;
  if (!teile.every((t) => tokenIstMannschaft(t, bekannte))) return null;
  return teile;
}

// Eine reine Datumszeile ("Samstag 16.08.", "16.08.2026", "2026-08-16") schaltet
// die folgenden Punkte auf einen anderen Tag um — dafür ist ein Trainingslager
// da. Liefert ISO oder null.
function parseDatumZeile(zeile, jahrFallback) {
  const t = zeile.replace(/^[A-Za-zÄÖÜäöüß]+,?\s*/, "").trim(); // führender Wochentag
  let m = /^(\d{4})-(\d{2})-(\d{2})\.?$/.exec(t);
  if (m) return datumAusIso(m[1] + "-" + m[2] + "-" + m[3]) ? m[1] + "-" + m[2] + "-" + m[3] : null;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?$/.exec(t);
  if (!m) return null;
  let jahr = m[3] ? Number(m[3]) : Number(jahrFallback);
  if (m[3] && m[3].length === 2) jahr = 2000 + Number(m[3]);
  if (!jahr) return null;
  const iso = jahr + "-" + String(Number(m[2])).padStart(2, "0") + "-" + String(Number(m[1])).padStart(2, "0");
  return datumAusIso(iso) ? iso : null;
}

// Sucht die Uhrzeit am Zeilenanfang. Erlaubt 9:00, 09:00, 9.00 und einen
// Bereich 09:00-09:30 (auch mit Gedankenstrich oder "bis").
// Liefert { startZeit, endZeit, rest } oder null.
function parseZeitAnfang(zeile) {
  const re = /^(\d{1,2})[:.](\d{2})(?:\s*(?:-|–|—|bis)\s*(\d{1,2})[:.](\d{2}))?\s*(?:uhr\b)?\s*/i;
  const m = re.exec(zeile);
  if (!m) return null;
  const start = minutenAusZeit(m[1] + ":" + m[2]);
  if (start === null) return null;
  let ende = null;
  if (m[3]) {
    ende = minutenAusZeit(m[3] + ":" + m[4]);
    if (ende === null) return null;
  }
  return {
    startZeit: zeitAusMinuten(start),
    endZeit: ende === null ? "" : zeitAusMinuten(ende),
    rest: zeile.slice(m[0].length).trim()
  };
}

// Wandelt eingefügten Text in Punkte um.
//
// Vertrag: Was nicht sicher erkannt wird, landet unverändert im Feld "was" —
// es wird NIE geraten und NIE still verworfen. Zeilen ohne Uhrzeit, die auch
// kein Datum sind, kommen als Warnung zurück, damit der Aufrufer sie anzeigen
// kann statt sie zu schlucken.
//
// text            — die eingefügte Liste
// standardDatum   — ISO-Datum, dem die Punkte zugeordnet werden
// bekannteTeams   — Mannschaftsnamen aus den Trainerprofilen (nur Zusatz zum Muster)
// neueId          — Funktion, die eine frische Id liefert
function parseAblaufText(text, standardDatum, bekannteTeams, neueId) {
  const punkte = [];
  const warnungen = [];
  let datum = standardDatum;
  const jahrFallback = (standardDatum || "").slice(0, 4);

  String(text || "").split(/\r?\n/).forEach((roh, nr) => {
    const zeile = putzeZeile(roh);
    if (!zeile) return;

    const zeit = parseZeitAnfang(zeile);
    if (!zeit) {
      const neuesDatum = parseDatumZeile(zeile, jahrFallback);
      if (neuesDatum) { datum = neuesDatum; return; }
      warnungen.push({ zeile: nr + 1, text: zeile, grund: "keine Uhrzeit erkannt" });
      return;
    }

    let mannschaften = [];
    let was = zeit.rest;

    // Erstes Wort nach der Uhrzeit als Mannschaft prüfen. Trennende Satzzeichen
    // dahinter (Doppelpunkt, Komma, Gedankenstrich) gehören nicht zum Namen.
    const ersterRaum = was.search(/\s/);
    const kopf = (ersterRaum < 0 ? was : was.slice(0, ersterRaum)).replace(/[:,;–—-]+$/, "");
    const geteilt = kopf ? teileMannschaften(kopf, bekannteTeams) : null;
    if (geteilt) {
      mannschaften = geteilt;
      was = (ersterRaum < 0 ? "" : was.slice(ersterRaum)).trim().replace(/^[:,;–—-]+\s*/, "");
    }

    punkte.push({
      id: neueId(),
      datum,
      startZeit: zeit.startZeit,
      endZeit: zeit.endZeit,
      was,
      mannschaften,
      werFrei: "",
      ort: "",
      notiz: ""
    });
  });

  return { punkte, warnungen };
}

// ---------- Kalenderraster ----------
//
// Das Raster zeichnet je Tag eine Spalte auf einer gemeinsamen Zeitachse
// (Muster: Streamkalender in E:\agelan). Alles hier ist reine Rechnerei — die
// Oberfläche baut daraus nur noch HTML.

// Höhe einer Stunde in Pixeln. EINZIGE Quelle für Blockposition, Blockhöhe und
// den Abstand der Stundenlinien; das CSS bekommt den Wert über background-size
// zugereicht, damit er nicht an zwei Stellen steht.
//
// ⚠️ 68 und nicht weniger: der häufigste Fall ist ein Halbstundentakt, und ein
// 34px hoher Block ist die Untergrenze, in der eine Textzeile samt Innenabstand
// noch vollständig steht. Bei 56 war der Titel in allen Halbstundenblöcken
// abgeschnitten (Michel am 2026-08-16 am echten Medientag gesehen).
const RASTER_STUNDE_PX = 68;

// Ein Punkt ohne Endzeit braucht trotzdem eine Fläche. Die Dauer gilt NUR fürs
// Zeichnen — in den Daten bleibt die Endzeit leer, hier wird nichts ergänzt.
const RASTER_STANDARD_DAUER = 30;

// Kleinste Blockhöhe, damit ein Fünf-Minuten-Punkt am Handy noch zu treffen ist
// und eine Zeile Text hineinpasst.
const RASTER_MIN_HOEHE = 30;

// Luft zwischen zwei aufeinanderfolgenden Blöcken. Ohne sie verschmelzen die
// Punkte eines lückenlosen Taktes optisch zu einem einzigen langen Balken.
const RASTER_LUECKE = 3;

// Ab dieser Höhe steht der Inhalt untereinander (Zeit, was, wer). Darunter
// nebeneinander in einer Zeile — in einen Halbstundenblock passen keine drei
// Zeilen, und die Spalte ist bei einem eintägigen Ablauf ohnehin breit genug.
const RASTER_HOCH_AB = 58;

// Kleinste Spanne der Achse. Ohne sie stünde ein einzelner Punkt als schmaler
// Streifen ohne jede Umgebung da.
const RASTER_MIN_SPANNE = 180;

function rasterPx(minuten) {
  return Math.round((minuten / 60) * RASTER_STUNDE_PX);
}

// Start und Ende eines Punktes in Minuten, oder null ohne Startzeit.
//
// ⚠️ Eine Endzeit, die nicht nach der Startzeit liegt (über Mitternacht
// getippt, oder schlicht vertippt), wird auf die Standarddauer zurückgesetzt
// statt geheilt: eine negative Höhe ließe den Block spurlos verschwinden.
// verschiebeAb heilt so einen Punkt ebenfalls nicht — die Daten bleiben, wie
// sie sind, nur das Bild wird brauchbar.
function punktSpanne(punkt) {
  const start = minutenAusZeit(punkt && punkt.startZeit);
  if (start === null) return null;
  const ende = minutenAusZeit(punkt && punkt.endZeit);
  return { von: start, bis: ende !== null && ende > start ? ende : start + RASTER_STANDARD_DAUER };
}

// Punkte ohne Uhrzeit haben keine Stelle auf der Achse. Sie werden NICHT
// verworfen, sondern getrennt zurückgegeben — die Oberfläche stellt sie über
// das Raster. (Das Formular verlangt eine Startzeit, eine eingefügte Liste
// oder ein Altbestand kann trotzdem welche ohne enthalten.)
function teilePunkteNachZeit(punkte) {
  const mitZeit = [];
  const ohneZeit = [];
  sortierePunkte(punkte).forEach((p) => {
    (minutenAusZeit(p && p.startZeit) === null ? ohneZeit : mitZeit).push(p);
  });
  return { mitZeit, ohneZeit };
}

// Zeitachse des Rasters: früheste Start- bis späteste Endzeit, auf volle
// Stunden gerundet.
//
// Gerechnet wird über die SICHTBAREN Punkte, nicht über alle: wer auf „nur
// meine" schaltet, will nicht durch die leeren Stunden der anderen scrollen.
function rasterAchse(punkte) {
  let von = null;
  let bis = null;
  (punkte || []).forEach((p) => {
    const s = punktSpanne(p);
    if (!s) return;
    if (von === null || s.von < von) von = s.von;
    if (bis === null || s.bis > bis) bis = s.bis;
  });
  if (von === null) return { von: 8 * 60, bis: 8 * 60 + RASTER_MIN_SPANNE };

  von = Math.max(0, Math.floor(von / 60) * 60);
  // Über die Tagesgrenze wird nicht gezeichnet. Ein Punkt, dessen Standarddauer
  // darüber hinausreicht, wird von der Fläche beschnitten — seine echte Zeit
  // steht unverändert in der Liste darunter.
  bis = Math.min(1440, Math.ceil(bis / 60) * 60);
  if (bis - von < RASTER_MIN_SPANNE) {
    bis = Math.min(1440, von + RASTER_MIN_SPANNE);
    von = Math.max(0, bis - RASTER_MIN_SPANNE);
  }
  return { von, bis };
}

// Die Tage, an denen wirklich etwas steht — in Kalenderreihenfolge. Leere Tage
// mitten in einem Trainingslager werden bewusst nicht erfunden: eine leere
// Spalte kostet Platz und sagt nichts.
function rasterTage(punkte) {
  const gesehen = new Set();
  const tage = [];
  sortierePunkte(punkte).forEach((p) => {
    const d = (p && p.datum) || "";
    if (d && !gesehen.has(d)) { gesehen.add(d); tage.push(d); }
  });
  return tage;
}

// Überschneidende Punkte nebeneinander legen statt übereinander. Am Medientag
// laufen Einzel- und Mannschaftsfotos parallel — Überschneidungen sind erlaubt
// (die Endzeit wird bewusst nicht gegen den nächsten Punkt geprüft), also darf
// kein Block hinter einem anderen verschwinden.
//
// ⚠️ Liefert HÜLLEN und schreibt nichts in die Punkte. In app.js sind das die
// echten Datensätze aus appData — eine hier gesetzte Eigenschaft „spur" wäre
// beim nächsten Speichern in ablaufplan.json gelandet.
//
// Die Breite teilen sich nur Blöcke, die über eine Kette von Überschneidungen
// zusammenhängen. Sonst machte EINE Überschneidung am Vormittag alle Blöcke des
// ganzen Tages halb so breit.
function verteileSpuren(punkte) {
  const bloecke = [];
  sortierePunkte(punkte).forEach((p) => {
    const s = punktSpanne(p);
    if (s) bloecke.push({ punkt: p, von: s.von, bis: s.bis, spur: 0, spurAnzahl: 1 });
  });

  let gruppe = [];
  let gruppenEnde = -1;

  function gruppeAbschliessen() {
    if (!gruppe.length) return;
    const spurEnde = [];
    gruppe.forEach((b) => {
      let spur = spurEnde.findIndex((ende) => ende <= b.von);
      if (spur === -1) { spurEnde.push(b.bis); spur = spurEnde.length - 1; }
      else { spurEnde[spur] = b.bis; }
      b.spur = spur;
    });
    const anzahl = Math.max(1, spurEnde.length);
    gruppe.forEach((b) => { b.spurAnzahl = anzahl; });
    gruppe = [];
  }

  bloecke.forEach((b) => {
    // Berührung (Ende == nächster Start) ist keine Überschneidung.
    if (gruppe.length && b.von >= gruppenEnde) { gruppeAbschliessen(); gruppenEnde = -1; }
    gruppe.push(b);
    if (b.bis > gruppenEnde) gruppenEnde = b.bis;
  });
  gruppeAbschliessen();

  return bloecke;
}

// Welche Punkte sind schon gelaufen? Liefert ein Set der Punkt-OBJEKTE, damit
// es ohne ids auskommt (über den offenen Link sind die Punkte Fremddaten).
//
// ⚠️ Bewusst NICHT über naechsterPunktIndex abgeleitet. Ein Punkt ohne Uhrzeit
// steht in der Sortierung ganz vorn, und naechsterPunktIndex bleibt bei ihm
// stehen — mit einem einzigen zeitlosen Punkt im Ablauf wäre abends noch alles
// „kommt noch". Beim Bauen des Rasters genau so aufgeschlagen.
//
// Ende eines Punktes ist seine Endzeit; fehlt die, der Beginn des nächsten
// Punktes am selben Tag; fehlt auch der, die Standarddauer. Damit wird eine
// Mittagspause ohne Endzeit nicht nach einer halben Stunde grau, während ein
// letzter Punkt ohne Endzeit trotzdem irgendwann abläuft.
function vergangenePunkte(punkte, jetztIso, jetztMin) {
  const sortiert = sortierePunkte(punkte);
  const vorbei = new Set();

  sortiert.forEach((p, i) => {
    const datum = String((p && p.datum) || "");
    if (!datum) return;
    if (datum < jetztIso) { vorbei.add(p); return; }
    if (datum > jetztIso) return;

    const start = minutenAusZeit(p.startZeit);
    if (start === null) return;   // ohne Uhrzeit gilt ein Punkt nie als gelaufen

    const ende = minutenAusZeit(p.endZeit);
    let schluss = ende !== null && ende > start ? ende : null;
    if (schluss === null) {
      for (let j = i + 1; j < sortiert.length; j++) {
        if (String(sortiert[j].datum || "") !== datum) break;
        const s = minutenAusZeit(sortiert[j].startZeit);
        if (s !== null && s > start) { schluss = s; break; }
      }
    }
    if (schluss === null) schluss = start + RASTER_STANDARD_DAUER;
    if (schluss <= jetztMin) vorbei.add(p);
  });

  return vorbei;
}

// Lage eines Blocks: oben/Höhe in Pixeln, links/Breite in Prozent der Spalte.
// `flach` sagt der Oberfläche, dass der Inhalt in EINE Zeile muss.
function blockGeometrie(block, achse) {
  const breite = 100 / block.spurAnzahl;
  // Die Lücke wird von der Dauer abgezogen, die Mindesthöhe gilt danach —
  // sonst wäre ein Fünf-Minuten-Block am Ende schmaler als das Minimum.
  const hoehe = Math.max(RASTER_MIN_HOEHE, rasterPx(block.bis - block.von) - RASTER_LUECKE);
  return {
    top: rasterPx(block.von - achse.von),
    hoehe: hoehe,
    links: block.spur * breite,
    breite: breite,
    flach: hoehe < RASTER_HOCH_AB
  };
}

// Höhe der gesamten Rasterfläche.
function rasterHoehe(achse) {
  return rasterPx(achse.bis - achse.von);
}

// Die vollen Stunden der Achse, für die Beschriftung links.
function rasterStunden(achse) {
  const marken = [];
  for (let m = achse.von; m < achse.bis; m += 60) marken.push(m);
  return marken;
}

// Position der Jetzt-Linie in der Spalte eines Tages — null, wenn dieser Tag
// nicht heute ist oder die Uhrzeit außerhalb der gezeichneten Achse liegt.
function jetztLinieTop(datum, achse, jetztIso, jetztMin) {
  if (String(datum || "") !== jetztIso) return null;
  if (jetztMin < achse.von || jetztMin > achse.bis) return null;
  return rasterPx(jetztMin - achse.von);
}

// Für Node-Prüfungen. Im Browser gibt es kein module — dann bleibt alles global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    minutenAusZeit, zeitAusMinuten,
    isoAusDatum, datumAusIso, isoPlusTage, tageZwischen, datumText, datumKurz,
    normMannschaft, punktBetrifft,
    punktSortKey, sortierePunkte,
    verschiebeAb, synchronisiereZeitraum, istVergangen,
    naechsterPunktIndex, punktLaeuft,
    putzeZeile, parseDatumZeile, parseZeitAnfang, parseAblaufText,
    RASTER_STUNDE_PX, RASTER_STANDARD_DAUER, RASTER_MIN_HOEHE, RASTER_MIN_SPANNE,
    RASTER_LUECKE, RASTER_HOCH_AB,
    rasterPx, punktSpanne, teilePunkteNachZeit, rasterAchse, rasterTage,
    verteileSpuren, vergangenePunkte, blockGeometrie, rasterHoehe, rasterStunden, jetztLinieTop
  };
}
