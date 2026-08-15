import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Must match the existing Bubblewrap package id so Play Store recognizes
  // this as an update of the existing app, not a new app.
  appId: 'com.rahilmundkur.jugalbandhiself',
  appName: 'Jugalbandhi Self',
  webDir: 'www',

  // Bundle the web app inside the native package — required for both Apple
  // App Store approval and to use Play Asset Delivery / iOS On-Demand
  // Resources for audio.
  server: {
    androidScheme: 'https',
    // iosScheme switched from the default 'capacitor' to 'https' to work
    // around the WKWebView custom-scheme audio limitation (audio elements
    // under a custom URL scheme can be unreliable — seeking/buffering in
    // particular). This was previously blocked because `npx cap sync ios`
    // failed outright: the Podfile/Xcode project's IPHONEOS_DEPLOYMENT_TARGET
    // (13.0) was below the floor recent Xcode Simulator SDKs will build for
    // (last failure was on Xcode 26). Both were bumped to 15.0 alongside
    // this change (see ios/App/Podfile and ios/App/App.xcodeproj).
    // UNVERIFIED: no Xcode/macOS environment was available here to actually
    // run `pod install` / build / test on a real device or Simulator. If
    // this causes problems (e.g. around same-origin/service-worker
    // behavior), the safest single-line revert is switching iosScheme back
    // to 'capacitor' — the deployment-target bump is independent and can
    // stay either way.
    iosScheme: 'https',
    // Optional: set hostname so the in-app origin is stable. Affects how
    // the service worker scope and any same-origin checks behave.
    // hostname: 'jugalbandhi.local'
  },

  android: {
    // Use the same keystore Bubblewrap was using so updates flow.
    // (Configure the actual signing in android/key.properties — see
    // Capacitor-Migration-Plan.md step 8.)
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true   // enable for dev, set to false for prod release
  },

  ios: {
    // Splash screen + status bar config goes here if needed.
    contentInset: 'automatic',
    backgroundColor: '#FAF8F4'
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#FAF8F4',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    }
  }
};

export default config;
