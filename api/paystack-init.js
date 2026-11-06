const crypto = require("crypto");
const { admin, PLANS } = require("./_shared");

const APP_URL = process.env.APP_URL; // e.g. https://maternove.web.app

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", APP_URL);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const header = req.headers.authorization || "";
    const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
    const decoded = await admin.auth().verifyIdToken(idToken);

    const plan = PLANS[req.body && req.body.plan];
    if (!plan) return res.status(400).json({ error: "Unknown plan." });
    if (!decoded.email) return res.status(400).json({ error: "Account has no email." });

    const reference = "mtv_" + decoded.uid.slice(0, 8) + "_" + crypto.randomBytes(6).toString("hex");

    const r = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.PAYSTACK_SECRET_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: decoded.email,
        amount: plan.kes * 100,
        currency: "KES",
        reference,
        channels: ["card", "mobile_money"],
        callback_url: APP_URL + "/profile.html?payment=done",
        metadata: { uid: decoded.uid, plan: req.body.plan },
      }),
    });
    const j = await r.json();
    if (!j.status) return res.status(502).json({ error: j.message || "Paystack error." });

    res.status(200).json({ url: j.data.authorization_url, reference });
  } catch (e) {
    console.error(e);
    res.status(401).json({ error: "Please log in again." });
  }
};
