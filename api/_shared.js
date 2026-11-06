const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

// Amounts are in KES. Paystack wants the smallest unit, so x100.
// CHANGE THESE PRICES to whatever you decide.
const PLANS = {
  monthly: { kes: 199, days: 30, label: "Maternove Premium (1 month)" },
  yearly: { kes: 1999, days: 365, label: "Maternove Premium (12 months)" },
};

module.exports = { admin, PLANS };
