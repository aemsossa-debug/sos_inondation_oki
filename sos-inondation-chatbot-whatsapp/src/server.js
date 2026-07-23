const express = require("express");
const crypto = require("crypto");
const path = require("path");
const config = require("./config");
const { handleIncomingMessage, notifierChangementStatutIntervention } = require("./flows");
const { getInterventionById } = require("./db");
const { RECEIPTS_DIR } = require("./receipts");
const scheduler = require("./scheduler");

const app = express();

// On a besoin du corps brut pour vérifier la signature Meta (X-Hub-Signature-256)
// avant de le parser en JSON.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ----------------------------------------------------------------------------
// Vérification de signature (recommandé en production — voir README §Sécurité)
// ----------------------------------------------------------------------------
function signatureValide(req) {
  if (!config.appSecret) return true; // pas configuré : on laisse passer (dev / Phase 1)
  const signature = req.get("x-hub-signature-256");
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", config.appSecret).update(req.rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Webhook WhatsApp — vérification (Meta appelle ceci une fois, à la configuration)
// ----------------------------------------------------------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.waVerifyToken) {
    console.log("[webhook] vérification Meta réussie.");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ----------------------------------------------------------------------------
// Webhook WhatsApp — réception des messages
// ----------------------------------------------------------------------------
app.post("/webhook", async (req, res) => {
  // On répond 200 immédiatement (exigence Meta : sous 20s) puis on traite.
  res.sendStatus(200);

  if (!signatureValide(req)) {
    console.warn("[webhook] signature invalide — message ignoré.");
    return;
  }

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const messages = change?.messages || [];
    for (const message of messages) {
      handleIncomingMessage(message.from, message).catch((err) =>
        console.error("[flows] erreur de traitement pour", message.from, err)
      );
    }
    // change.statuses contient les accusés de livraison/lecture des messages
    // sortants — utile pour un futur tableau de bord de délivrabilité, ignoré
    // pour l'instant.
  } catch (err) {
    console.error("[webhook] erreur inattendue:", err);
  }
});

// ----------------------------------------------------------------------------
// API interne — à appeler depuis le dashboard opérateur / l'app technicien
// (voir section 7 du dossier de conception : "couche applicative")
// ----------------------------------------------------------------------------
app.post("/api/interventions/:id/statut", express.json(), async (req, res) => {
  const { statut, etaMinutes, montant } = req.body || {};
  if (!["en_route", "arrivee", "terminee"].includes(statut)) {
    return res.status(400).json({ error: "statut invalide (attendu: en_route | arrivee | terminee)" });
  }
  const intervention = getInterventionById(req.params.id);
  if (!intervention) return res.status(404).json({ error: "intervention introuvable" });

  try {
    await notifierChangementStatutIntervention(intervention, statut, { etaMinutes, montant });
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] erreur notification statut:", err);
    res.status(500).json({ error: "échec de la notification WhatsApp" });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok", service: "sos-inondation-whatsapp-bot" }));

// Reçus PDF envoyés par WhatsApp comme documents (lien public temporaire)
app.use("/receipts", express.static(RECEIPTS_DIR));

app.listen(config.port, () => {
  console.log(`SOS INONDATION — chatbot WhatsApp à l'écoute sur le port ${config.port}`);
  console.log(`Webhook à configurer dans Meta for Developers : ${config.publicBaseUrl}/webhook`);
  scheduler.start();
});
