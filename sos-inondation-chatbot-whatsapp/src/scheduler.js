// Automatisations CRM programmées (section 4.6 / 5.8 du dossier de conception).
// node-cron suffit largement au volume de la Phase 1 — pas besoin d'une file
// de messages distincte tant que la base de clients reste de cette taille.
//
// ⚠️ IMPORTANT (règle WhatsApp) : un message texte libre ("sendText") ne peut
// être envoyé que dans les 24h suivant le dernier message DU CLIENT. Passé ce
// délai — ce qui est presque toujours le cas pour les 3 messages ci-dessous,
// envoyés à l'initiative de l'entreprise — WhatsApp exige un "message modèle"
// pré-approuvé par Meta. Voir README.md section "Modèles de message requis"
// avant de passer ce fichier en production : il faudra remplacer les 3 appels
// wa.sendText() ci-dessous par des appels à un modèle approuvé (même contenu,
// juste un format d'envoi différent une fois le modèle validé par Meta).
const cron = require("node-cron");
const { db } = require("./db");
const wa = require("./whatsapp");

function estOptOut(client) {
  return client.opt_out_marketing === true;
}

// 1er mars et 1er août à 9h — rappel Pack Sécurité avant chaque saison des pluies
function planifierRappelSaison() {
  cron.schedule("0 9 1 3,8 *", async () => {
    const clients = db.get("clients").value();
    for (const client of clients) {
      if (estOptOut(client)) continue;
      const prenom = client.nom?.split(" ")[0] || "";
      await wa
        .sendText(
          client.telephone,
          `Bonjour ${prenom} ! La saison des pluies approche.\nRéservez votre PACK SÉCURITÉ à partir de 15 000 FCFA et soyez prioritaire.\n👉 Répondez OUI pour souscrire`
        )
        .catch((e) => console.error("[scheduler] rappel saison échoué pour", client.telephone, e.message));
    }
  });
}

// Toutes les heures : relance de parrainage 24h après une intervention terminée
// (implémenté par un scan léger plutôt qu'un cron par intervention — suffisant
// pour le volume attendu et beaucoup plus simple à maintenir).
function planifierRelanceParrainage() {
  cron.schedule("0 * * * *", async () => {
    const interventions = db.get("interventions").filter({ statut: "payée" }).value();
    const now = Date.now();
    for (const inter of interventions) {
      if (inter.parrainage_envoye) continue;
      const cloture = new Date(inter.date_cloture || inter.date_creation).getTime();
      if (now - cloture < 24 * 3600 * 1000) continue;
      const client = db.get("clients").find({ id: inter.client_id }).value();
      if (!client || estOptOut(client)) continue;
      const prenom = client.nom?.split(" ")[0] || "";
      await wa
        .sendText(
          client.telephone,
          `Merci pour votre confiance, ${prenom} !\nRecommandez-nous à un voisin et obtenez 5 000 FCFA de réduction sur votre prochaine intervention 🎁\nRépondez PARRAINAGE pour votre code.`
        )
        .catch((e) => console.error("[scheduler] relance parrainage échouée", e.message));
      db.get("interventions").find({ id: inter.id }).assign({ parrainage_envoye: true }).write();
    }
  });
}

// Une fois par jour à 10h : réactivation des clients inactifs depuis 8 mois
function planifierReactivation() {
  cron.schedule("0 10 * * *", async () => {
    const clients = db.get("clients").value();
    const now = Date.now();
    const HUIT_MOIS = 8 * 30 * 24 * 3600 * 1000;
    for (const client of clients) {
      if (estOptOut(client) || client.reactivation_envoyee) continue;
      const dernierContact = new Date(client.date_creation).getTime();
      if (now - dernierContact < HUIT_MOIS) continue;
      const prenom = client.nom?.split(" ")[0] || "";
      await wa
        .sendText(
          client.telephone,
          `Bonjour ${prenom}, ça fait un moment ! 👋\nOn reste disponibles si une inondation touche votre quartier. Besoin d'un devis ou d'infos sur le Pack Sécurité ?`
        )
        .catch((e) => console.error("[scheduler] réactivation échouée", e.message));
      db.get("clients").find({ id: client.id }).assign({ reactivation_envoyee: true }).write();
    }
  });
}

function start() {
  planifierRappelSaison();
  planifierRelanceParrainage();
  planifierReactivation();
  console.log("[scheduler] automatisations CRM programmées (rappel saison, parrainage, réactivation).");
}

module.exports = { start };
