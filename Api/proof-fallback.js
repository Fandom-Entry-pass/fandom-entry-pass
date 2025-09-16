// api/proof-fallback.js
import Busboy from "busboy";
import { Resend } from "resend";

export const config = { api: { bodyParser: false }, runtime: "nodejs" };

const resend = new Resend(process.env.RESEND_API_KEY);
const TO_EMAIL = process.env.PROOF_TO_EMAIL || "admin@example.com";
const FROM_EMAIL = process.env.PROOF_FROM_EMAIL || "fep@yourdomain.com"; // must be a verified domain/sender in Resend

async function parseMultipart(req) {
  return await new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    const fields = {};
    const files = [];

    busboy.on("field", (name, val) => { fields[name] = val; });
    busboy.on("file", (name, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => files.push({ field: name, filename, mimeType, buffer: Buffer.concat(chunks) }));
    });
    busboy.on("error", reject);
    busboy.on("finish", () => resolve({ fields, files }));

    req.pipe(busboy);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { fields, files } = await parseMultipart(req);
    const proof = files.find(f => f.field === "attachment") || files[0];

    if (!proof) return res.status(400).json({ error: "No attachment found" });

    const summary = [
      `New listing submitted with proof (fallback):`,
      `Group: ${fields.group || ""}`,
      `Date & Venue: ${fields.date || ""}`,
      `City: ${fields.city || ""}`,
      `Seat: ${fields.seat || ""}`,
      `Face: $${fields.face || ""}`,
      `Price: $${fields.price || ""}`,
      `Qty: ${fields.qty || ""}`,
      `Seller: ${fields.seller || ""} <${fields.sellerEmail || ""}> (${fields.sellerPhone || ""})`,
      `Listing ID: ${fields.listingId || ""}`
    ].join("\n");

    const attachments = [
      {
        filename: proof.filename || "proof.jpg",
        content: proof.buffer,
        contentType: proof.mimeType || "application/octet-stream"
      }
    ];

    await resend.emails.send({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      subject: "FEP: New Listing Proof (Fallback)",
      text: summary,
      attachments
    });

    return res.status(200).json({ ok: true, sent: true });
  } catch (e) {
    console.error("proof-fallback error:", e);
    return res.status(500).json({ error: "Failed to send fallback email" });
  }
}
