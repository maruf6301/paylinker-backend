# Pay Linker Backend — সেটআপ গাইড (বাংলায়)

## 🟢 Backend কি করে?

Backend হলো একটা Node.js সার্ভার যেটা তোমার Pay Linker app আর Admin Panel এর মাঝে কাজ করে। এটা:
- API Key দিয়ে Transaction verify করে
- OneSignal দিয়ে Push Notification পাঠায়
- Webhook notification সেন্ড করে

---

## 📋 ধাপে ধাপে Backend সেটআপ

### ধাপ ১: Node.js ইনস্টল করো

তোমার কম্পিউটারে Node.js ইনস্টল থাকতে হবে।

1. এই লিংকে যাও: https://nodejs.org
2. **LTS** version ডাউনলোড করো
3. ইনস্টল করো (Next Next করে)
4. ইনস্টল হয়ে গেলে চেক করো — CMD/Terminal খুলে লেখো:
```
node --version
npm --version
```
দুইটাতেই version number আসলে ঠিক আছে ✅

---

### ধাপ ২: Backend এর Dependencies ইনস্টল করো

1. CMD/Terminal খোলো
2. `backend` ফোল্ডারে যাও:
```
cd "C:\Users\HP\Desktop\Pay Linker\backend"
```
3. Dependencies ইনস্টল করো:
```
npm install
```
এটা একটু সময় নিবে, সব packages ডাউনলোড হবে।

---

### ধাপ ৩: Firebase Service Account তৈরি করো

Backend যাতে Firestore Database এ কাজ করতে পারে, তার জন্য একটা Service Account key লাগবে।

1. **Firebase Console** এ যাও: https://console.firebase.google.com
2. তোমার **pay-linker-f56b3** project সিলেক্ট করো
3. বাম সাইডে ⚙️ (gear icon) → **Project Settings** এ ক্লিক করো
4. উপরে **"Service accounts"** ট্যাবে ক্লিক করো
5. **"Generate new private key"** বাটনে ক্লিক করো
6. একটা JSON ফাইল ডাউনলোড হবে — এটা খুব গুরুত্বপূর্ণ, সেভ রাখো!

---

### ধাপ ৪: লোকালে Backend চালাও (টেস্ট করার জন্য)

1. ডাউনলোড হওয়া JSON ফাইলের সব content কপি করো
2. CMD তে এই কমান্ড দাও:
```
set FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"pay-linker-f56b3",...বাকি content...}
npm start
```
3. দেখবে এই মেসেজ আসবে:
```
🚀 Pay Linker Backend running on port 3000
```
4. Browser এ যাও: http://localhost:3000
5. যদি `{"status":"ok",...}` দেখায়, তাহলে কাজ করতেছে! ✅

---

### ধাপ ৫: Render.com এ Deploy করো (ফ্রী!)

Render.com এ ফ্রী তে backend হোস্ট করা যায়।

1. **GitHub এ repository তৈরি করো:**
   - https://github.com এ যাও, account না থাকলে তৈরি করো
   - "New Repository" ক্লিক করো
   - নাম দাও: `paylinker-backend`
   - Create করো

2. **Backend ফোল্ডার GitHub এ push করো:**
```
cd "C:\Users\HP\Desktop\Pay Linker\backend"
git init
git add .
git commit -m "Initial backend"
git remote add origin https://github.com/TOMAR_USERNAME/paylinker-backend.git
git push -u origin main
```

3. **Render.com এ যাও:**
   - https://render.com এ account তৈরি করো
   - **"New +"** → **"Web Service"** ক্লিক করো
   - GitHub connect করো
   - তোমার `paylinker-backend` repo সিলেক্ট করো

4. **Settings দাও:**
   - **Name:** `paylinker-api`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free

5. **Environment Variable সেট করো:**
   - Key: `FIREBASE_SERVICE_ACCOUNT`
   - Value: Service Account JSON ফাইলের পুরো content পেস্ট করো

6. **"Create Web Service"** ক্লিক করো

7. কিছুক্ষণ পর তোমার URL পাবে, যেমন: `https://paylinker-api.onrender.com`

---

### ধাপ ৬: Firestore Enable করো

1. Firebase Console এ যাও
2. বাম সাইডে **"Firestore Database"** ক্লিক করো
3. **"Create database"** ক্লিক করো
4. **"Start in test mode"** সিলেক্ট করো
5. Location: **asia-south1** (ভারত) সিলেক্ট করো — ফাস্ট হবে
6. Done!

---

## 🔧 API Endpoints

| Method | URL | কি করে |
|--------|-----|--------|
| `GET /` | Health check | সার্ভার চলতেছে কিনা |
| `POST /api/validate` | Transaction verify | API Key দিয়ে Transaction check |
| `GET /api/transactions/:userId` | Transaction list | User এর সব transactions |
| `POST /api/webhook/register` | Webhook register | Webhook URL সেট করো |
| `POST /api/notify` | Push notification | OneSignal দিয়ে notification পাঠাও |
| `POST /api/broadcast` | Broadcast | সবাইকে notification পাঠাও |

---

## ⚠️ গুরুত্বপূর্ণ তথ্য

- **Firebase Storage** বর্তমানে **OFF** আছে (টাকা লাগে তাই)
- Profile image শুধু locally সেভ হবে, Firebase তে upload হবে না
- **OneSignal** দিয়ে Push Notification চলবে (ফ্রী!)
- Render.com এর ফ্রী plan এ server ১৫ মিনিট inactive থাকলে sleep হয়ে যায়, প্রথম request এ আবার wake up হয়

---

## 🆘 সমস্যা হলে?

| সমস্যা | সমাধান |
|--------|--------|
| `npm install` error | Node.js ঠিকমতো install হয়েছে চেক করো |
| Firebase error | Service Account JSON ঠিক আছে কিনা দেখো |
| Render deploy fail | Package.json এ `"main": "server.js"` আছে কিনা চেক করো |
| Notification আসে না | OneSignal dashboard এ check করো subscriber আছে কিনা |
