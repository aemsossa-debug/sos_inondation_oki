const axios = require("axios");
const config = require("./config");

const GRAPH_URL = `https://graph.facebook.com/${config.waApiVersion}/${config.waPhoneNumberId}/messages`;

function client() {
  return axios.create({
    baseURL: `https://graph.facebook.com/${config.waApiVersion}`,
    headers: {
      Authorization: `Bearer ${config.waToken}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
}

async function post(payload) {
  try {
    const { data } = await client().post(`/${config.waPhoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...payload,
    });
    return data;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error("[whatsapp] Échec d'envoi:", detail);
    throw err;
  }
}

// ---------- Envoi ----------

function sendText(to, body) {
  return post({ to, type: "text", text: { body, preview_url: false } });
}

// buttons: [{ id: "oui", title: "OUI" }, ...] — 3 maximum, 20 caractères max par titre
function sendButtons(to, bodyText, buttons, footer) {
  return post({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      footer: footer ? { text: footer } : undefined,
      action: {
        buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })),
      },
    },
  });
}

// rows: [{ id, title, description }] — 10 maximum au total
function sendList(to, bodyText, buttonLabel, rows, headerText) {
  return post({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: headerText ? { type: "text", text: headerText } : undefined,
      body: { text: bodyText },
      action: {
        button: buttonLabel.slice(0, 20),
        sections: [{ title: "Choisissez une option", rows: rows.map((r) => ({ ...r, title: r.title.slice(0, 24) })) }],
      },
    },
  });
}

function requestLocation(to, bodyText) {
  return post({
    to,
    type: "interactive",
    interactive: {
      type: "location_request_message",
      body: { text: bodyText },
      action: { name: "send_location" },
    },
  });
}

function sendImageByUrl(to, link, caption) {
  return post({ to, type: "image", image: { link, caption } });
}

function sendDocumentByUrl(to, link, filename, caption) {
  return post({ to, type: "document", document: { link, filename, caption } });
}

async function markAsRead(messageId) {
  try {
    await client().post(`/${config.waPhoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  } catch (err) {
    // Non bloquant : un accusé de lecture manqué ne doit jamais interrompre la conversation.
    console.warn("[whatsapp] markAsRead a échoué (ignoré):", err.message);
  }
}

// Télécharge un média (photo envoyée par le client) et retourne { buffer, mimeType }
async function downloadMedia(mediaId) {
  const c = client();
  const { data: meta } = await c.get(`/${mediaId}`);
  const res = await axios.get(meta.url, {
    headers: { Authorization: `Bearer ${config.waToken}` },
    responseType: "arraybuffer",
  });
  return { buffer: Buffer.from(res.data), mimeType: meta.mime_type };
}

// ---------- Normalisation des messages entrants ----------
// Unifie "taper 1" et "appuyer sur l'option 1" en une seule valeur exploitable
// par les flux de conversation (voir conversation/index.js).
function normalizeIncoming(message) {
  if (!message) return { type: "unknown" };

  if (message.type === "text") {
    return { type: "text", value: message.text.body.trim() };
  }
  if (message.type === "interactive") {
    const inter = message.interactive;
    if (inter.type === "list_reply") return { type: "choice", value: inter.list_reply.id };
    if (inter.type === "button_reply") return { type: "choice", value: inter.button_reply.id };
  }
  if (message.type === "location") {
    return { type: "location", value: { lat: message.location.latitude, lng: message.location.longitude } };
  }
  if (message.type === "image") {
    return { type: "image", value: { mediaId: message.image.id, caption: message.image.caption } };
  }
  return { type: "unsupported" };
}

module.exports = {
  sendText,
  sendButtons,
  sendList,
  requestLocation,
  sendImageByUrl,
  sendDocumentByUrl,
  markAsRead,
  downloadMedia,
  normalizeIncoming,
};
