const appId = 'b5cbe5cf-26d3-4361-b818-8ece981d2fe4';
const apiKey = 'os_v2_app_wxf6ltzg2nbwdoayr3hjqhjp4skvxqceg2aeen5lbahmvnbqxlcppofxh7tmxrijwsk4getnknzzwq2fvtarjqe2oouyaxbd6cupm6a';

async function testPayload(payload, auth) {
    try {
        const res = await fetch('https://api.onesignal.com/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': auth
            },
            body: JSON.stringify(payload)
        });
        console.log(`Payload Test Result:`, await res.json());
    } catch (e) {
        console.error(e);
    }
}

async function run() {
    console.log("Testing Basic auth + Subscribed Users...");
    await testPayload({
        app_id: appId,
        included_segments: ['Subscribed Users'],
        headings: { en: 'Test Broadcast' },
        contents: { en: 'This is a test broadcast' }
    }, `Basic ${apiKey}`);

    console.log("\nTesting Key auth + target_channel: push + Active Users...");
    await testPayload({
        app_id: appId,
        target_channel: "push",
        included_segments: ['Active Users', 'Inactive Users'],
        headings: { en: 'Test Broadcast' },
        contents: { en: 'This is a test broadcast' }
    }, `Key ${apiKey}`);

    console.log("\nTesting Basic auth + target_channel: push + All...");
    await testPayload({
        app_id: appId,
        target_channel: "push",
        included_segments: ['All'],
        headings: { en: 'Test Broadcast' },
        contents: { en: 'This is a test broadcast' }
    }, `Basic ${apiKey}`);
}

run();
