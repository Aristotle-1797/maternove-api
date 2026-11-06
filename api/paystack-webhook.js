const crypto = require("crypto");
const { admin, PLANS } = require("./_shared");

// Need the raw body to check Paystack's signature.
module.exports.config = { api: { bodyParser: false } };

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const raw = await readRaw(req);
  const sig = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(raw)
    .digest("hex");
  if (sig !== req.headers["x-paystack-signature"]) return res.status(401).end();

  const event = JSON.parse(raw.toString("utf8"));
  if (event.event !== "charge.success") return res.status(200).end();

  try {
    const reference = event.data.reference;

    // Never trust the webhook body alone: ask Paystack directly.
    const v = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), {
      headers: { Authorization: "Bearer " + process.env.PAYSTACK_SECRET_KEY },
    });
    const vj = await v.json();
    const tx = vj && vj.data;
    if (!vj.status || !tx || tx.status !== "success") return res.status(200).end();

    const { uid, plan: planId } = tx.metadata || {};
    const plan = PLANS[planId];
    if (!uid || !plan) return res.status(200).end();
    if (tx.currency !== "KES" || tx.amount !== plan.kes * 100) {
      console.error("Amount mismatch", reference);
      return res.status(200).end();
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const payRef = db.collection("payments").doc(reference);

    await db.runTransaction(async (t) => {
      const [pay, user] = await Promise.all([t.get(payRef), t.get(userRef)]);
      if (pay.exists) return; // already processed (Paystack retries webhooks)

      const now = Date.now();
      const cur = user.exists && user.data().premiumUntil;
      const curMs = cur && cur.toMillis ? cur.toMillis() : 0;
      const start = Math.max(now, curMs); // renewing early stacks on top
      const until = admin.firestore.Timestamp.fromMillis(start + plan.days * 86400000);

      t.set(payRef, {
        uid, plan: planId, amount: tx.amount, currency: tx.currency,
        channel: tx.channel, paidAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      t.set(userRef, { plan: "premium", premiumUntil: until }, { merge: true });
    });

    res.status(200).end();
  } catch (e) {
    console.error(e);
    res.status(500).end(); // Paystack will retry
  }
};
