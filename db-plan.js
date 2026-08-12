// Zugriff für die Seite OHNE Anmeldung (plan.html).
//
// ⚠️ Bewusst NICHT db.js: es gibt hier keinen Sitzungstoken und keinen
// Authorization-Header. Der Ausweis ist allein das lange Zufallstoken aus der
// Adresszeile, das der Worker gegen den Ablauf prüft.
// ⚠️ Bewusst auch NICHT config.js: dort steht der ganze Changelog — auf dieser
// Seite hat davon nichts etwas verloren.
// Vorbild: E:\schulsport\db-bestaetigung.js

const WORKER_URL = "https://landingpage.michel-brunner.workers.dev";

// Muss zur Prüfung im Worker passen. Die Form wird SCHON HIER geprüft, damit ein
// offensichtlich kaputter Link gar keinen Serveraufruf auslöst.
const TOKEN_FORM = /^[0-9a-f]{64}$/;

class LinkUngueltigError extends Error {
  constructor() { super("Dieser Link ist nicht gültig."); this.name = "LinkUngueltigError"; }
}
class LinkZurueckgezogenError extends Error {
  constructor(m) { super(m || "Dieser Link wurde zurückgezogen."); this.name = "LinkZurueckgezogenError"; }
}
class ZuVieleVersucheError extends Error {
  constructor() { super("Zu viele Versuche. Bitte später erneut probieren."); this.name = "ZuVieleVersucheError"; }
}

async function ablaufOeffentlichLaden(token) {
  if (!TOKEN_FORM.test(String(token || ""))) throw new LinkUngueltigError();

  let resp;
  try {
    resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ablaufplan-oeffentlich", token })
    });
  } catch (_) {
    throw new Error("Der Server ist nicht erreichbar. Bitte die Internetverbindung prüfen.");
  }

  if (resp.status === 400 || resp.status === 404) throw new LinkUngueltigError();
  if (resp.status === 410) {
    let grund = "";
    try { const b = await resp.json(); grund = b && b.error ? b.error : ""; } catch (_) {}
    throw new LinkZurueckgezogenError(grund);
  }
  if (resp.status === 429) throw new ZuVieleVersucheError();
  if (!resp.ok) throw new Error("Es ist ein Fehler aufgetreten (HTTP " + resp.status + ").");

  const body = await resp.json();
  return body.ablauf;
}
