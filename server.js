const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

// ===== OneSignal Config =====
const ONESIGNAL_APP_ID = 'b5cbe5cf-26d3-4361-b818-8ece981d2fe4';
const ONESIGNAL_REST_API_KEY = 'os_v2_app_wxf6ltzg2nbwdoayr3hjqhjp4sszjj25l5qejwuuzmg4nilcpugshzjkogtdn75trijrussimqqtcu2hnbtr42etelgk2qzjsub6riq';

// Initialize Firebase Admin
// Note: For Render deployment, set FIREBASE_SERVICE_ACCOUNT env variable
// with the service account JSON content
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'pay-linker-f56b3'
    });
} else {
    admin.initializeApp({
        projectId: 'pay-linker-f56b3'
    });
}

const db = admin.firestore();
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ===== Health Check =====
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        app: 'Pay Linker API',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// ===== API Key Validation =====
app.post('/api/validate', async (req, res) => {
    try {
        const { apiKey, transactionId } = req.body;

        if (!apiKey || !transactionId) {
            return res.status(400).json({ error: 'apiKey and transactionId are required' });
        }

        // Find API key in Firestore
        const keysSnap = await db.collection('api_keys')
            .where('key', '==', apiKey)
            .where('isActive', '==', true)
            .get();

        if (keysSnap.empty) {
            return res.status(401).json({ error: 'Invalid or inactive API key' });
        }

        const keyDoc = keysSnap.docs[0];
        const keyData = keyDoc.data();

        // Check if user is blocked
        const userDoc = await db.collection('users').doc(keyData.userId).get();
        if (!userDoc.exists || userDoc.data().isBlocked) {
            return res.status(403).json({ error: 'User account is blocked' });
        }

        // Find transaction
        const txSnap = await db.collection('transactions')
            .where('transactionId', '==', transactionId)
            .where('userId', '==', keyData.userId)
            .get();

        if (txSnap.empty) {
            return res.status(404).json({
                valid: false,
                message: 'Transaction not found'
            });
        }

        const txData = txSnap.docs[0].data();

        // Update API key usage
        await keyDoc.ref.update({
            lastUsed: Date.now(),
            totalRequests: admin.firestore.FieldValue.increment(1)
        });

        // Update transaction status
        await txSnap.docs[0].ref.update({
            status: 'success',
            apiKeyUsed: apiKey
        });

        // Add activity
        await db.collection('activity').add({
            id: uuidv4(),
            userId: keyData.userId,
            type: 'api',
            message: `Transaction ${transactionId} validated via API`,
            timestamp: Date.now(),
            status: 'success'
        });

        // Webhook notification
        sendWebhook(keyData.userId, {
            event: 'transaction.validated',
            transactionId: transactionId,
            status: 'success',
            timestamp: Date.now()
        });

        // OneSignal push notification
        sendOneSignalNotification(
            keyData.userId,
            'Transaction Validated ✅',
            `Transaction ${transactionId} has been verified successfully.`,
            'transaction'
        );

        return res.json({
            valid: true,
            transactionId: txData.transactionId,
            status: txData.status,
            source: txData.source,
            timestamp: txData.timestamp
        });

    } catch (error) {
        console.error('Validation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== Transaction Lookup =====
app.get('/api/transactions/:userId', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'Authorization required' });
        }

        const apiKey = authHeader.replace('Bearer ', '');
        const keysSnap = await db.collection('api_keys')
            .where('key', '==', apiKey)
            .where('isActive', '==', true)
            .get();

        if (keysSnap.empty) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        const { userId } = req.params;
        const txSnap = await db.collection('transactions')
            .where('userId', '==', userId)
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();

        const transactions = txSnap.docs.map(d => d.data());
        res.json({ transactions });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== Webhook Endpoint =====
app.post('/api/webhook/register', async (req, res) => {
    try {
        const { userId, webhookUrl } = req.body;

        if (!userId || !webhookUrl) {
            return res.status(400).json({ error: 'userId and webhookUrl are required' });
        }

        await db.collection('webhooks').doc(userId).set({
            userId,
            webhookUrl,
            createdAt: Date.now(),
            isActive: true
        });

        res.json({ success: true, message: 'Webhook registered' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== Webhook Sender =====
async function sendWebhook(userId, payload) {
    try {
        const webhookDoc = await db.collection('webhooks').doc(userId).get();
        if (!webhookDoc.exists || !webhookDoc.data().isActive) return;

        const webhookUrl = webhookDoc.data().webhookUrl;

        const fetch = (await import('node-fetch')).default;
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log(`Webhook sent to ${webhookUrl}`);
    } catch (error) {
        console.error('Webhook error:', error.message);
    }
}

// ===== OneSignal Push Notification =====
async function sendOneSignalNotification(userId, title, message, type) {
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch('https://api.onesignal.com/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Key ${ONESIGNAL_REST_API_KEY}`
            },
            body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID,
                filters: [
                    { field: 'tag', key: 'user_id', relation: '=', value: userId }
                ],
                headings: { en: title },
                contents: { en: message },
                data: { type: type || 'general' },
                android_channel_id: type === 'transaction' ? 'paylinker_transactions' : 'paylinker_general'
            })
        });

        const result = await response.json();
        console.log('OneSignal notification sent:', result.id);
    } catch (error) {
        console.error('OneSignal notification error:', error.message);
    }
}

// ===== Send Notification API Endpoint =====
app.post('/api/notify', async (req, res) => {
    try {
        const { userId, title, body, type } = req.body;

        if (!userId || !title || !body) {
            return res.status(400).json({ error: 'userId, title, and body are required' });
        }

        await sendOneSignalNotification(userId, title, body, type);
        res.json({ success: true, message: 'Notification sent via OneSignal' });

    } catch (error) {
        console.error('Notify error:', error);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});

// ===== Broadcast Notification (Admin) =====
app.post('/api/broadcast', async (req, res) => {
    try {
        const { title, message } = req.body;

        if (!title || !message) {
            return res.status(400).json({ error: 'title and message are required' });
        }

        const fetch = (await import('node-fetch')).default;
        const response = await fetch('https://api.onesignal.com/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Key ${ONESIGNAL_REST_API_KEY}`
            },
            body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID,
                included_segments: ['All'],
                headings: { en: title },
                contents: { en: message },
                data: { type: 'broadcast' }
            })
        });

        const result = await response.json();
        res.json({ success: true, notificationId: result.id });

    } catch (error) {
        console.error('Broadcast error:', error);
        res.status(500).json({ error: 'Failed to broadcast' });
    }
});

// ===== Start Server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Pay Linker Backend running on port ${PORT}`);
});
