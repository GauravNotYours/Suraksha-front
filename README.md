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

## Build an APK

Set `EXPO_PUBLIC_API_URL` to the deployed HTTPS API URL in the EAS `preview` environment (and in `production` for store releases). The local `.env` is ignored and is not uploaded to EAS. Then run `npx eas-cli login` and `npx eas-cli build --platform android --profile preview`. The EAS build page provides the APK download when complete.
