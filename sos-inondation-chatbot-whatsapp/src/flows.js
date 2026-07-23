// Implémente exactement le script décrit en section 5 du dossier de conception :
// menu principal + 5 branches + commandes globales + messages CRM programmés
// (ceux-ci sont dans scheduler.js). Chaque fonction ci-dessous correspond à un
// bloc de conversation documenté (les numéros de section sont rappelés en commentaire).
const axios = require("axios");
const wa = require("./whatsapp");
const db = require("./db");
const { findNearestTechnicien } = require("./dispatch");
const { SERVICES, PACK_SECURITE, formatFcfa, formatRange, URGENCE_TYPE_TO_SERVICE } = require("./pricing");
const { generateReceiptPdf } = require("./receipts");
const config = require("./config");

const HANDOFF_DUREE_MS = 2 * 60 * 60 * 1000; // 2h — voir section 5.7

function normCmd(v) {
  return (v || "").toString().trim().toUpperCase();
}

async function reverseGeocode(lat, lng) {
  try {
    const { data } = await axios.get("https://nominatim.openstreetmap.org/reverse", {
      params: { lat, lon: lng, format: "json", "accept-language": "fr", zoom: 14 },
      headers: { "User-Agent": "SOS-INONDATION-Bot/1.0 (contact@sos-inondation.bj)" },
      timeout: 5000,
    });
    const a = data?.address || {};
    return a.suburb || a.neighbourhood || a.quarter || a.city_district || a.town || a.city || "votre position";
  } catch {
    return "votre position";
  }
}

// ============================================================================
// POINT D'ENTRÉE — appelé par server.js pour chaque message WhatsApp reçu
// ============================================================================
async function handleIncomingMessage(from, rawMessage) {
  wa.markAsRead(rawMessage.id).catch(() => {});
  const input = wa.normalizeIncoming(rawMessage);
  let session = await db.getSession(from);
  let client = await db.findClientByPhone(from);

  // Prise en charge humaine active (section 5.7) : le bot se tait, sauf MENU
  // qui reste une porte de sortie de sécurité si l'escalade n'était plus utile.
  const handoffActif = session.contexte?.handoff_jusqu_a && session.contexte.handoff_jusqu_a > Date.now();
  const estCommandeMenu = input.type === "text" && normCmd(input.value) === "MENU";
  if (handoffActif && !estCommandeMenu) {
    return; // un conseiller humain a la main sur cette conversation
  }

  // Nouveau contact jamais vu : on demande le prénom avant toute chose (section 5.2)
  if (!client && session.etape !== "onboarding_nom") {
    await db.setSession(from, { etape: "onboarding_nom", contexte: {} });
    return wa.sendText(
      from,
      "🌊 Bonjour et bienvenue chez *SOS INONDATION* 👋\nVotre allié en cas d'inondation à Cotonou & Abomey-Calavi.\n\nPour commencer, quel est votre prénom ?"
    );
  }
  if (session.etape === "onboarding_nom") {
    const nom = input.type === "text" ? input.value.trim() : "";
    if (!nom) return wa.sendText(from, "Merci de m'indiquer votre prénom en texte pour continuer 🙂");
    client = await db.upsertClient(from, { nom });
    await db.resetSession(from);
    return sendMainMenu(from, client);
  }

  // Commandes globales — actives à tout moment (section 5.1)
  if (input.type === "text") {
    const cmd = normCmd(input.value);
    if (cmd === "MENU") {
      await db.resetSession(from);
      return sendMainMenu(from, client);
    }
    if (cmd === "URGENCE") {
      await db.setSession(from, { etape: "urgence_position", contexte: {} });
      return startUrgence(from);
    }
    if (cmd === "STOP") {
      await db.upsertClient(from, { opt_out_marketing: true });
      return wa.sendText(from, "C'est noté : vous ne recevrez plus de messages promotionnels. Vous pouvez toujours nous écrire à tout moment en cas d'urgence.");
    }
    if (cmd === "PARRAINAGE") {
      const code = `PARRAIN-${from.slice(-4)}`;
      return wa.sendText(from, `🎁 Voici votre code de parrainage : ${code}\nPartagez-le à un voisin : il obtient -10% sur sa 1ère intervention, et vous recevez 5 000 FCFA de réduction dès qu'il en profite.`);
    }
  }

  switch (session.etape) {
    case "menu_principal":
      return routeMenuPrincipal(from, input, client);
    case "urgence_position":
      return urgenceCollecterPosition(from, input);
    case "urgence_photo":
      return urgenceCollecterPhoto(from, input);
    case "urgence_type_probleme":
      return urgenceCollecterType(from, input, client);
    case "urgence_paiement":
      return urgencePaiement(from, input, session);
    case "urgence_notation":
      return urgenceNotation(from, input, session);
    case "devis_choix_service":
      return devisChoixService(from, input);
    case "devis_confirmation":
      return devisConfirmation(from, input, session);
    case "abonnement_confirmation":
      return abonnementConfirmation(from, input, client);
    default:
      await db.resetSession(from);
      return sendMainMenu(from, client);
  }
}

// ============================================================================
// 5.2 — Message d'accueil / menu principal
// ============================================================================
async function sendMainMenu(from, client) {
  await db.setSession(from, { etape: "menu_principal", contexte: {} });
  const prenom = client?.nom ? client.nom.split(" ")[0] : "";
  const salutation = prenom
    ? `Bonjour ${prenom} 👋 Nous sommes là pour vous aider.`
    : "Bonjour 👋 Nous sommes là pour vous aider.";
  return wa.sendList(
    from,
    `🌊 *SOS INONDATION* — Cotonou & Abomey-Calavi\n\n${salutation}\n\nQue puis-je faire pour vous ?`,
    "Voir les options",
    [
      { id: "1", title: "🚨 Intervention d'urgence", description: "Un technicien chez vous en < 2h" },
      { id: "2", title: "💰 Devis rapide", description: "Prix immédiat par service" },
      { id: "3", title: "🛡️ Mon Pack Sécurité", description: "Abonnement saison des pluies" },
      { id: "4", title: "📍 Suivre mon intervention", description: "Statut en temps réel" },
      { id: "5", title: "👤 Parler à un conseiller", description: "Prise en charge humaine" },
    ]
  );
}

async function routeMenuPrincipal(from, input, client) {
  const choix = input.type === "choice" ? input.value : input.type === "text" ? input.value.trim() : "";
  switch (choix) {
    case "1":
      await db.setSession(from, { etape: "urgence_position", contexte: {} });
      return startUrgence(from);
    case "2":
      return sendDevisMenu(from);
    case "3":
      return sendAbonnementInfo(from, client);
    case "4":
      return sendSuivi(from, client);
    case "5":
      return handoffConseiller(from);
    default:
      return wa.sendText(from, "Je n'ai pas compris 🤔 Répondez avec un chiffre de 1 à 5, ou tapez MENU pour revoir les options.");
  }
}

// ============================================================================
// 5.3 — Branche 1 : Intervention d'urgence
// ============================================================================
async function startUrgence(from) {
  await wa.sendText(
    from,
    "🚨 Intervention d'urgence — on s'en occupe tout de suite.\n\nPour vous envoyer un technicien en moins de 2h, j'ai besoin de 3 choses."
  );
  return wa.requestLocation(from, "1️⃣ Votre position — appuyez sur 📎 puis « Localisation » et envoyez votre position actuelle.");
}

async function urgenceCollecterPosition(from, input) {
  if (input.type !== "location") {
    return wa.sendText(from, "Merci d'utiliser le bouton 📎 puis « Localisation » pour m'envoyer votre position exacte — c'est ce qui permet d'envoyer le bon technicien.");
  }
  const quartier = await reverseGeocode(input.value.lat, input.value.lng);
  const session = await db.getSession(from);
  await db.setSession(from, { etape: "urgence_photo", contexte: { ...session.contexte, position: input.value, quartier } });
  return wa.sendText(from, `✅ Position reçue — Quartier ${quartier}\n\n2️⃣ Envoyez une photo du dégât si possible (sinon tapez PASSER)`);
}

async function urgenceCollecterPhoto(from, input) {
  let photoMediaId = null;
  if (input.type === "image") {
    photoMediaId = input.value.mediaId;
  } else if (!(input.type === "text" && normCmd(input.value) === "PASSER")) {
    return wa.sendText(from, "Envoyez une photo (icône 📷) ou tapez PASSER pour continuer sans photo.");
  }
  const session = await db.getSession(from);
  await db.setSession(from, {
    etape: "urgence_type_probleme",
    contexte: { ...session.contexte, photoMediaId },
  });
  return wa.sendList(from, "✅ Bien reçu, merci.\n\n3️⃣ Quel est le problème ?", "Choisir", [
    { id: "1", title: "Maison inondée" },
    { id: "2", title: "Canalisation bouchée" },
    { id: "3", title: "Risque électrique" },
    { id: "4", title: "Autre" },
  ]);
}

async function urgenceCollecterType(from, input, client) {
  const choix = input.type === "choice" ? input.value : input.type === "text" ? input.value.trim() : "";
  if (!["1", "2", "3", "4"].includes(choix)) {
    return wa.sendText(from, "Répondez avec un chiffre de 1 à 4 pour préciser le type de problème.");
  }
  const typeLabel = { "1": "Maison inondée", "2": "Canalisation bouchée", "3": "Risque électrique", "4": "Autre" }[choix];
  const serviceId = URGENCE_TYPE_TO_SERVICE[choix];
  const service = SERVICES.find((s) => s.id === serviceId);
  const session = await db.getSession(from);

  const intervention = await db.createIntervention({
    client_id: client.id,
    type_service: service.label,
    type_probleme: typeLabel,
    position_gps: session.contexte.position || null,
    quartier: session.contexte.quartier || "non précisé",
    photos: session.contexte.photoMediaId ? [session.contexte.photoMediaId] : [],
    montant: Math.round((service.priceMin + service.priceMax) / 2),
  });

  await wa.sendText(
    from,
    `✅ Demande enregistrée, ${client.nom.split(" ")[0]}.\n\n📍 ${intervention.quartier}\n🏠 ${typeLabel}\n💰 Estimation : ${formatRange(service.priceMin, service.priceMax)}\n\n🔎 Recherche du technicien le plus proche...`
  );

  const result = await findNearestTechnicien(session.contexte.position);
  if (!result) {
    await db.updateIntervention(intervention.id, { statut: "en_attente_technicien" });
    await db.setSession(from, { etape: "menu_principal", contexte: {} });
    return wa.sendText(from, "⏳ Toutes nos équipes sont actuellement mobilisées. Vous êtes en tête de la prochaine file de dispatch — nous revenons vers vous dans les tout prochains instants.");
  }

  const { technicien, etaMinutes } = result;
  await db.updateIntervention(intervention.id, { statut: "assignée", technicien_id: technicien.id });
  await db.setTechnicienStatut(technicien.id, "en_intervention");
  await db.setSession(from, { etape: "menu_principal", contexte: { intervention_id: intervention.id } });

  const heureArrivee = new Date(Date.now() + etaMinutes * 60000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return wa.sendText(
    from,
    `✅ Technicien assigné : ${technicien.nom}\n🚗 Véhicule : ${technicien.plaque}\n⏱️ Arrivée estimée : ${heureArrivee}\n\nVous recevrez un message dès qu'il est en route, puis à son arrivée.\nTapez 4 à tout moment pour suivre votre intervention.`
  );
}

// Déclenché en interne (voir server.js /api/interventions/:id/statut) — pas par
// un message du client — pour les étapes "en route", "arrivée" et "terminée".
async function notifierChangementStatutIntervention(intervention, statut, extra = {}) {
  const client = await db.getClientById(intervention.client_id);
  const technicien = intervention.technicien_id ? await db.getTechnicien(intervention.technicien_id) : null;
  const to = client?.telephone;
  if (!to) return;

  if (statut === "en_route") {
    await db.updateIntervention(intervention.id, { statut: "en_route" });
    return wa.sendText(to, `🚗 ${technicien?.nom || "Votre technicien"} est en route vers vous — arrivée estimée dans ${extra.etaMinutes || 15} min.`);
  }
  if (statut === "arrivee") {
    await db.updateIntervention(intervention.id, { statut: "en_cours" });
    return wa.sendText(to, `📍 ${technicien?.nom || "Votre technicien"} est arrivé chez vous.`);
  }
  if (statut === "terminee") {
    const montant = extra.montant || intervention.montant;
    await db.updateIntervention(intervention.id, { statut: "terminée", montant });
    if (technicien) await db.setTechnicienStatut(technicien.id, "disponible");
    await db.setSession(to, { etape: "urgence_paiement", contexte: { intervention_id: intervention.id } });
    return wa.sendButtons(
      to,
      `✅ Intervention terminée par ${technicien?.nom || "notre équipe"}. Merci de votre confiance !\n\n💳 Montant à régler : ${formatFcfa(montant)}\n\nChoisissez votre moyen de paiement :`,
      [
        { id: "pay_1", title: "MTN Mobile Money" },
        { id: "pay_2", title: "Moov Money" },
        { id: "pay_3", title: "Carte / 2 fois" },
      ]
    );
  }
}

async function urgencePaiement(from, input, session) {
  const map = { pay_1: "mtn_momo", pay_2: "moov", pay_3: "carte", "1": "mtn_momo", "2": "moov", "3": "carte", "4": "deux_fois" };
  const choix = input.type === "choice" ? input.value : input.type === "text" ? input.value.trim() : "";
  const methode = map[choix];
  if (!methode) {
    return wa.sendText(from, "Choisissez un moyen de paiement parmi les options proposées, ou tapez 4 pour un paiement en 2 fois.");
  }
  const intervention = await db.getInterventionById(session.contexte.intervention_id);
  const client = await db.findClientByPhone(from);

  // TODO production : remplacer par un vrai appel à l'API CinetPay
  // (https://docs.cinetpay.com) qui initie la transaction MTN/Moov/carte et
  // renvoie un statut confirmé de manière asynchrone via son propre webhook.
  // Pour la Phase 1, le paiement est considéré confirmé immédiatement.
  const paiement = await db.createPaiement({
    intervention_id: intervention.id,
    methode,
    montant: intervention.montant,
    statut: methode === "deux_fois" ? "en_attente" : "payé",
  });

  const { filename } = await generateReceiptPdf({ intervention, client, paiement });
  const url = `${config.publicBaseUrl}/receipts/${filename}`;
  await db.updatePaiement(paiement.id, { recu_url: url });
  await db.updateIntervention(intervention.id, { statut: "payée" });

  await wa.sendText(from, `Merci pour votre paiement ✅`);
  await wa.sendDocumentByUrl(from, url, filename, "Votre reçu SOS INONDATION");
  await db.setSession(from, { etape: "urgence_notation", contexte: session.contexte });
  return wa.sendText(from, "Comment évaluez-vous notre service ?\nRépondez de 1 (déçu) à 5 (excellent) ⭐");
}

async function urgenceNotation(from, input, session) {
  const note = input.type === "text" ? parseInt(input.value.trim(), 10) : NaN;
  if (!note || note < 1 || note > 5) {
    return wa.sendText(from, "Répondez avec un chiffre de 1 à 5 pour noter le service 🙂");
  }
  const intervention = await db.getInterventionById(session.contexte.intervention_id);
  if (intervention?.technicien_id) {
    const t = await db.getTechnicien(intervention.technicien_id);
    if (t) {
      const nouvelleNote = Math.round(((t.note_moyenne * 9 + note) / 10) * 10) / 10;
      await db.updateTechnicienNote(t.id, nouvelleNote);
    }
  }
  const client = await db.findClientByPhone(from);
  await db.resetSession(from);
  await wa.sendText(from, `Merci ${client.nom.split(" ")[0]} 🙏`);
  return wa.sendText(
    from,
    "🎁 Parrainez un voisin et obtenez 5 000 FCFA de réduction sur votre prochaine intervention.\nRépondez PARRAINAGE pour recevoir votre code."
  );
}

// ============================================================================
// 5.4 — Branche 2 : Devis rapide
// ============================================================================
async function sendDevisMenu(from) {
  await db.setSession(from, { etape: "devis_choix_service", contexte: {} });
  return wa.sendList(
    from,
    "💰 Devis rapide — choisissez un service :",
    "Voir les tarifs",
    SERVICES.map((s) => ({
      id: s.id,
      title: s.label,
      description: `${formatRange(s.priceMin, s.priceMax)} · ${s.delai}`,
    })).concat([{ id: "retour", title: "⬅️ Retour au menu" }])
  );
}

async function devisChoixService(from, input) {
  const id = input.type === "choice" ? input.value : input.type === "text" ? input.value.trim() : "";
  if (id === "retour" || normCmd(id) === "MENU") return sendMainMenu(from, await db.findClientByPhone(from));
  const service = SERVICES.find((s) => s.id === id);
  if (!service) return wa.sendText(from, "Choisissez un service dans la liste proposée, ou tapez MENU.");
  await db.setSession(from, { etape: "devis_confirmation", contexte: { service_id: service.id } });
  return wa.sendButtons(
    from,
    `🧾 ${service.label}\nFourchette : ${formatRange(service.priceMin, service.priceMax)} · Délai : ${service.delai}\n\nRéserver cette intervention maintenant ?`,
    [
      { id: "oui", title: "OUI, réserver" },
      { id: "menu", title: "Retour au menu" },
    ]
  );
}

async function devisConfirmation(from, input, session) {
  const choix = input.type === "choice" ? input.value : normCmd(input.type === "text" ? input.value : "");
  if (choix === "oui" || choix === "OUI") {
    await db.setSession(from, { etape: "urgence_position", contexte: { service_preselectionne: session.contexte.service_id } });
    return startUrgence(from);
  }
  return sendMainMenu(from, await db.findClientByPhone(from));
}

// ============================================================================
// 5.5 — Branche 3 : Mon Pack Sécurité
// ============================================================================
async function sendAbonnementInfo(from, client) {
  const sub = await db.getActiveSubscription(client.id);
  if (sub) {
    const dateFin = new Date(sub.date_fin).toLocaleDateString("fr-FR");
    return wa.sendText(
      from,
      `🛡️ Votre Pack Sécurité est actif ✅\nValable jusqu'au ${dateFin}\nAvantage : -20% garanti + priorité absolue\n\nTapez 1 à tout moment pour une intervention prioritaire.`
    );
  }
  await db.setSession(from, { etape: "abonnement_confirmation", contexte: {} });
  return wa.sendButtons(
    from,
    `🛡️ PACK SÉCURITÉ SAISON DES PLUIES\n\n✅ Intervention prioritaire garantie\n✅ -20% sur toutes les interventions\n✅ Audit gratuit de vulnérabilité\n✅ Ligne dédiée 24h/24\n\n💰 ${formatRange(PACK_SECURITE.priceMin, PACK_SECURITE.priceMax)} / saison`,
    [
      { id: "oui", title: "Je souscris" },
      { id: "info", title: "Plus d'infos" },
    ]
  );
}

async function abonnementConfirmation(from, input, client) {
  const choix = input.type === "choice" ? input.value : normCmd(input.type === "text" ? input.value : "");
  if (choix === "oui" || choix === "OUI") {
    await db.createSubscription(client.id);
    await db.resetSession(from);
    return wa.sendText(from, "✅ Pack Sécurité activé ! Vous serez prioritaire dès la prochaine alerte pluie. Un conseiller vous contactera pour finaliser le règlement de l'abonnement.");
  }
  if (choix === "info" || choix === "INFO") {
    return wa.sendText(
      from,
      "Le Pack Sécurité couvre toute la saison des pluies (5 mois) : file prioritaire même en pic de crise, -20% sur toutes vos interventions, un audit gratuit pour repérer les points faibles de votre logement, et une ligne dédiée. Répondez OUI pour souscrire."
    );
  }
  return sendMainMenu(from, client);
}

// ============================================================================
// 5.6 — Branche 4 : Suivi de mon intervention
// ============================================================================
async function sendSuivi(from, client) {
  const intervention = await db.getActiveInterventionForClient(client.id);
  if (!intervention) {
    return wa.sendText(from, "Vous n'avez aucune intervention en cours actuellement.\nTapez 1 pour signaler une urgence.");
  }
  const steps = ["reçue", "assignée", "en_route", "en_cours", "terminée"];
  const idx = Math.max(steps.indexOf(intervention.statut), 0);
  const pct = Math.round(((idx + 1) / steps.length) * 100);
  const filled = Math.round(pct / 10);
  const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
  const technicien = intervention.technicien_id ? await db.getTechnicien(intervention.technicien_id) : null;

  const lignes = [
    `📍 Suivi de votre intervention #${intervention.id.slice(0, 8).toUpperCase()}`,
    "",
    `${bar}  ${pct}%`,
    "",
    `${idx >= 0 ? "✅" : "◻️"} Demande reçue`,
    `${idx >= 1 ? "✅" : "◻️"} Technicien assigné${technicien ? " : " + technicien.nom : ""}`,
    `${idx >= 2 ? "✅" : "◻️"} Technicien en route`,
    `${idx >= 3 ? "⏳" : "◻️"} Intervention en cours`,
    `${idx >= 4 ? "✅" : "◻️"} Terminée`,
  ];
  return wa.sendText(from, lignes.join("\n"));
}

// ============================================================================
// 5.7 — Branche 5 : Parler à un conseiller
// ============================================================================
async function handoffConseiller(from) {
  const session = await db.getSession(from);
  await db.setSession(from, { etape: session.etape, contexte: { ...session.contexte, handoff_jusqu_a: Date.now() + HANDOFF_DUREE_MS } });
  return wa.sendText(from, "👤 Je transmets votre demande à un conseiller humain.\nIl vous répondra sous peu (généralement moins de 10 minutes en journée).");
}

module.exports = { handleIncomingMessage, notifierChangementStatutIntervention };
