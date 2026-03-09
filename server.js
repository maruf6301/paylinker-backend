const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

// ===== OneSignal Config =====
const ONESIGNAL_APP_ID = 'b5cbe5cf-26d3-4361-b818-8ece981d2fe4';
const ONESIGNAL_REST_API_KEY = 'os_v2_app_wxf6ltzg2nbwdoayr3hjqhjp4skvxqceg2aeen5lbahmvnbqxlcppofxh7tmxrijwsk4getnknzzwq2fvtarjqe2oouyaxbd6cupm6a';

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

        const txDoc = txSnap.docs[0];
        const txData = txDoc.data();

        // Enforce Single-Use (Auto Payment Gateway Pro Level)
        if (txData.status === 'success' || txData.status === 'verified') {
            return res.status(400).json({
                valid: false,
                message: 'Transaction has already been used/verified previously.'
            });
        }

        // Check expiration logic if needed, or simply update usage
        const now = Date.now();

        // Update API key usage (Track daily usage for the 7-day graph)
        const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const currentStats = keyData.dailyStats || {};
        const newDailyCount = (currentStats[dateStr] || 0) + 1;

        await keyDoc.ref.update({
            lastUsed: now,
            totalRequests: admin.firestore.FieldValue.increment(1),
            [`dailyStats.${dateStr}`]: newDailyCount
        });

        // Update transaction status to verified so it can never be used again
        await txDoc.ref.update({
            status: 'success',
            apiKeyUsed: apiKey,
            verifiedAt: now
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
            status: 'success',
            source: txData.source,
            sourceApp: txData.sourceApp,
            rawMessage: txData.rawMessage, // Provides access to "koto tk"
            timestamp: txData.timestamp,
            verifiedAt: Date.now()
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

// ===== API Stats for App Terminal =====
app.get('/api/terminal/stats/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;

        const keysSnap = await db.collection('api_keys')
            .where('key', '==', apiKey)
            .get();

        if (keysSnap.empty) {
            return res.status(404).json({ error: 'API key not found' });
        }

        const keyData = keysSnap.docs[0].data();

        if (!keyData.isActive) {
            return res.json({
                isActive: false,
                message: 'API key is inactive or revoked.'
            });
        }

        // Construct 7-day graph data
        const graphData = [];
        const dailyStats = keyData.dailyStats || {};

        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const displayDate = dateStr.slice(5); // MM-DD
            graphData.push({
                date: displayDate,
                fullDate: dateStr,
                calls: dailyStats[dateStr] || 0
            });
        }

        res.json({
            isActive: true,
            appName: keyData.appName || 'Unknown Website/App',
            totalRequests: keyData.totalRequests || 0,
            createdAt: keyData.createdAt,
            graphData: graphData
        });

    } catch (error) {
        console.error('Terminal stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ===== Transaction Sync Endpoint =====
app.post('/api/transaction/sync', async (req, res) => {
    try {
        const { userId, transactionId, source, sourceApp, status, rawMessage, timestamp } = req.body;

        if (!userId || !transactionId) {
            return res.status(400).json({ error: 'userId and transactionId are required' });
        }

        const docId = uuidv4();

        // Save transaction to Firestore if not already exists
        const existingSnap = await db.collection('transactions')
            .where('transactionId', '==', transactionId)
            .where('userId', '==', userId)
            .get();

        if (existingSnap.empty) {
            await db.collection('transactions').doc(docId).set({
                id: docId,
                userId,
                transactionId,
                source: source || 'notification',
                sourceApp: sourceApp || 'unknown',
                status: status || 'pending',
                rawMessage: rawMessage || '',
                timestamp: timestamp || Date.now()
            });

            // Trigger Activity
            await db.collection('activity').add({
                id: uuidv4(),
                userId: userId,
                type: 'transaction',
                message: `Transaction ${transactionId} captured from ${sourceApp}`,
                timestamp: Date.now(),
                status: 'pending'
            });

            // Attempt to trigger webhook automatically
            sendWebhook(userId, {
                event: 'transaction.received',
                transactionId: transactionId,
                status: 'pending',
                source: sourceApp,
                timestamp: Date.now()
            });
        }

        res.json({ success: true, message: 'Transaction synced' });

    } catch (error) {
        console.error('Error syncing:', error);
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
                'accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Key ${ONESIGNAL_REST_API_KEY}`
            },
            body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID,
                target_channel: 'push',
                included_segments: ['Subscribed Users'],
                headings: { en: title },
                contents: { en: message },
                data: { type: 'broadcast' }
            })
        });

        const result = await response.json();
        if (result.errors && !result.id) {
            console.error('OneSignal broadcast error:', result.errors);
            return res.status(400).json({ error: 'Failed to push to OneSignal', details: result.errors });
        }

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
