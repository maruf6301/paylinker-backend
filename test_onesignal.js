async function testOneSignal() {
    const ONESIGNAL_APP_ID = 'b5cbe5cf-26d3-4361-b818-8ece981d2fe4';
    const ONESIGNAL_REST_API_KEY = 'os_v2_app_wxf6ltzg2nbwdoayr3hjqhjp4skvxqceg2aeen5lbahmvnbqxlcppofxh7tmxrijwsk4getnknzzwq2fvtarjqe2oouyaxbd6cupm6a';

    const segmentsToTest = ['All', 'Subscribed Users', 'Total Subscriptions'];

    for (const segment of segmentsToTest) {
        console.log(`Testing segment: ${segment}`);
        const response = await fetch('https://api.onesignal.com/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
            },
            body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID,
                included_segments: [segment],
                headings: { en: `Test to ${segment}` },
                contents: { en: `Testing segment delivery` }
            })
        });

        const result = await response.json();
        console.log(`Response for ${segment}:`, result);
    }
}

testOneSignal();
