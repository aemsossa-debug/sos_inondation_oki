// Génère un reçu PDF de paiement, sobre et professionnel, et le stocke
// localement pour être servi par server.js puis envoyé au client par WhatsApp.
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const OCEAN = "#0E4C6B";
const INK = "#12222B";
const MUTED = "#5C7684";
const ALERT = "#D9782E";

const RECEIPTS_DIR = path.resolve(process.cwd(), "data/receipts");
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

function generateReceiptPdf({ intervention, client, paiement }) {
  return new Promise((resolve, reject) => {
    const filename = `recu-${intervention.id.slice(0, 8)}.pdf`;
    const filepath = path.join(RECEIPTS_DIR, filename);
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    doc.fillColor(OCEAN).fontSize(22).font("Helvetica-Bold").text("SOS INONDATION", { align: "left" });
    doc.fillColor(MUTED).fontSize(10).font("Helvetica").text("Intervention rapide en zones inondées — Cotonou & Abomey-Calavi", { align: "left" });
    doc.moveDown(1.2);
    doc.strokeColor(ALERT).lineWidth(2).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    doc.fillColor(INK).fontSize(16).font("Helvetica-Bold").text("Reçu de paiement");
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica").fillColor(MUTED).text(`Reçu N° : ${paiement.id.slice(0, 8).toUpperCase()}`);
    doc.text(`Date : ${new Date(paiement.date_creation || Date.now()).toLocaleString("fr-FR")}`);
    doc.moveDown(1);

    const row = (label, value) => {
      doc.font("Helvetica-Bold").fillColor(INK).fontSize(11).text(label, 50, doc.y, { continued: true, width: 200 });
      doc.font("Helvetica").fillColor(INK).text(`  ${value}`);
      doc.moveDown(0.35);
    };

    row("Client", client?.nom || "Client SOS INONDATION");
    row("Téléphone", client?.telephone || "-");
    row("Intervention", `#${intervention.id.slice(0, 8).toUpperCase()} — ${intervention.type_service || "Service"}`);
    row("Quartier", intervention.quartier || "-");
    row("Méthode de paiement", labelMethode(paiement.methode));
    doc.moveDown(0.6);

    doc.rect(50, doc.y, 495, 50).fill("#F3F9FB");
    doc.fillColor(OCEAN).font("Helvetica-Bold").fontSize(13).text("Montant réglé", 66, doc.y - 38);
    doc.fontSize(20).text(`${Number(paiement.montant).toLocaleString("fr-FR").replace(/,/g, " ")} FCFA`, 66, doc.y - 20);

    doc.moveDown(2.5);
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(
      "Merci de votre confiance. Ce reçu fait foi de paiement pour l'intervention mentionnée ci-dessus. " +
        "Pour toute question, répondez simplement à la conversation WhatsApp SOS INONDATION.",
      50,
      doc.y,
      { width: 495 }
    );

    doc.end();
    stream.on("finish", () => resolve({ filename, filepath }));
    stream.on("error", reject);
  });
}

function labelMethode(m) {
  return { mtn_momo: "MTN Mobile Money", moov: "Moov Money", carte: "Carte bancaire (CinetPay)", deux_fois: "Paiement en 2 fois" }[m] || m;
}

module.exports = { generateReceiptPdf, RECEIPTS_DIR };
