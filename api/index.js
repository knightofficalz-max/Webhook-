const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Middlewares
app.use(cors()); // Isse tumhara HTML frontend backend se baat kar payega
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- FIREBASE ADMIN INITIALIZATION ---
// Vercel Settings mein 'FIREBASE_SERVICE_ACCOUNT' naam ka variable banayein 
// aur usme apni download ki hui JSON file ka pura content paste kar dein.
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (error) {
    console.error("Firebase Admin Error: Check your Environment Variables", error);
}

const db = admin.firestore();

// --- 1. HOME ROUTE (Testing ke liye) ---
app.get('/', (req, res) => {
    res.send('Tournament Zone API is Running Successfully!');
});

// --- 2. CREATE PAYMENT (Frontend se call hoga) ---
app.post('/api/create-payment', async (req, res) => {
    const { amount, order_id, customer_mobile, user_id } = req.body;

    if (!amount || !order_id || !user_id) {
        return res.status(400).json({ success: false, message: "Missing data" });
    }

    try {
        const payload = new URLSearchParams();
        payload.append('token_key', process.env.ZAP_TOKEN_KEY);
        payload.append('secret_key', process.env.ZAP_SECRET_KEY);
        payload.append('amount', amount);
        payload.append('order_id', order_id);
        payload.append('customer_mobile', customer_mobile || '9999999999');
        payload.append('redirect_url', 'https://your-tournament-app.com'); // Payment ke baad user kahan jaye
        payload.append('remark', `Wallet_Refill_${user_id}`);

        const response = await fetch("https://zapupi.com/api/create-order", {
            method: 'POST',
            body: payload
        });

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Order Creation Error:", error);
        res.status(500).json({ success: false, message: "Gateway connection failed" });
    }
});

// --- 3. WEBHOOK (Zap UPI automatic message bhejega payment ke baad) ---
app.post('/api/webhook', async (req, res) => {
    // Zap UPI webhook data 'req.body' mein bhejta hai
    const webhookData = req.body;
    console.log("Incoming Webhook:", webhookData);

    const orderId = webhookData.order_id;
    const status = webhookData.status; // 'Success' ya 'Failure'
    const amount = parseFloat(webhookData.amount);

    if (status === 'Success') {
        try {
            // Firestore mein 'transactions' collection mein Order ID dhundo
            const txnSnapshot = await db.collection('transactions')
                .where('Z_orderId', '==', orderId)
                .where('Z_status', '==', 'pending')
                .limit(1)
                .get();

            if (!txnSnapshot.empty) {
                const txnDoc = txnSnapshot.docs[0];
                const userId = txnDoc.data().Z_userId;

                const batch = db.batch();

                // Step A: Transaction status 'approved' karo
                batch.update(db.collection('transactions').doc(txnDoc.id), {
                    Z_status: 'approved',
                    Z_utr: webhookData.utr,
                    Z_processedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                // Step B: User ke wallet mein balance badhao
                batch.update(db.collection('users').doc(userId), {
                    Z_balance: admin.firestore.FieldValue.increment(amount)
                });

                await batch.commit();
                console.log(`✅ Balance Updated: User ${userId} got ₹${amount}`);
                return res.status(200).send("Webhook Processed Successfully");
            } else {
                console.log("❌ Transaction not found or already approved.");
                return res.status(200).send("No pending transaction found");
            }
        } catch (error) {
            console.error("Database Update Error:", error);
            return res.status(500).send("Internal Server Error");
        }
    } else {
        console.log("⚠️ Payment failed or status not success.");
        return res.status(200).send("Payment was not successful");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
