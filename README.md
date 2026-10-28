# Suraksha Android app

Expo / React Native mobile client for the Node.js API. User accounts and app records are loaded from the backend; the app does not create demo users or substitute offline sample records.

## Run for development

1. Install Node.js 20+, Android Studio (for an emulator), and Expo Go for an initial UI check.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL`.
   - Android emulator: `http://10.0.2.2:10000`
   - Physical phone: use the computer's LAN IP, for example `http://192.168.1.20:10000`; phone and computer must share a network.
   - Deployed backend: use the HTTPS Render URL.
4. Start the backend and MongoDB first (see `../back/README.md`), then run `npx expo start`.
5. Create an account in the app. Use the same API URL for every app build.

The speech-recognition native module requires a development/standalone build; it is not available in standard Expo Go. Voice SOS only listens while the app is open, and uses the device speech-recognition provider.

On an active SOS, a repeating alert tone starts automatically while the app is in the foreground. Tap **Silence emergency sound** to silence it or **Resume emergency sound** to turn it back on. It stops when the emergency resolves or the app goes to the background.

## Firebase push setup

1. Create a Firebase project at https://console.firebase.google.com and add an **Android** app with package name `com.suraksha.safety`.
2. Download `google-services.json` and place it in this `front` folder as `google-services.json`. The file is git-ignored and should not be committed. For EAS, upload it as a **file-type** environment variable named `GOOGLE_SERVICES_JSON` in the `preview` environment (and `production` if used); the dynamic Expo config reads that variable during native builds.
3. In Firebase Console, open **Project settings > Service accounts** and generate a private key. In Render, open your backend Web Service **Environment** settings and add `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY` from that service-account JSON. Keep the private key only in Render; when entering it on one line, retain `\n` separators. Save and redeploy the backend after adding these variables.
4. Create and install a fresh native APK after the Firebase file is configured: `npx eas-cli build --platform android --profile preview`. Push notifications using the native FCM token do not work in standard Expo Go.
5. Each trusted contact must install Suraksha on an Android phone, create an account using the same phone number entered in the trusted contact record, allow the notification permission when prompted, and open **Profile > Enable / refresh push alerts** on their device. Use **Test push** beside their contact to check the setup. If the contact has no registered app device, the backend falls back to SMS when SMS is configured.

FCM reports a successful send as accepted by Firebase, not proof the recipient's device displayed it. Push notifications require internet access and device notification permission; they are not an emergency-service dispatch guarantee. Notification sounds use Android's default sound on the `Emergency alerts` channel. Install an updated APK and check Android **Settings > Apps > Suraksha > Notifications > Emergency alerts** to ensure sound is enabled; Android preserves a user's channel sound/mute choice.

Alerts can appear on a registered recipient's device while Suraksha is in the background or closed. Journey alert links open a live-location page that checks for updates every 20 seconds. The journey owner's app uploads its latest GPS position every 20 seconds while it is running; if it is closed, contacts see the last saved location. For an automated alert when the user does not respond, they must start a safety journey before closing the app; the continuously running Render backend checks them in and escalates after missed check-ins. Closing the app by itself does not trigger SOS, and a sleeping/unavailable backend cannot run the escalation timer.

For Twilio trial accounts, a `21608` test-SMS error means the recipient must first be verified in Twilio Console under **Phone Numbers → Manage → Verified Caller IDs**, or the account must be upgraded. The app cannot bypass Twilio's trial restriction.

If the SMS result says the trial account only allows predefined templates, the provider is refusing Suraksha's custom alert text. Upgrade the provider account or configure an approved template with the emergency details and live-location link. This restriction cannot be removed in the app.

The bottom navigation keeps all seven tabs visible with equal-width touch targets on narrow and wide Android screens, and adds space for Android's system-navigation area. Delivery history is on the **Alerts** tab; trusted-contact setup remains on **Contacts**.

## Build an APK

Set `EXPO_PUBLIC_API_URL` to the deployed HTTPS API URL in the EAS `preview` environment (and in `production` for store releases). The local `.env` is ignored and is not uploaded to EAS. Then run `npx eas-cli login` and `npx eas-cli build --platform android --profile preview`. The EAS build page provides the APK download when complete.
