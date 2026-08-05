import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.gosalka.app',
  appName: 'سالكة',
  webDir: 'dist',
  server: {
    androidScheme: 'https',

    // DRIVER BUILD ONLY. This APK is handed to three riders directly; it is
    // not going in the Play Store or the App Store.
    //
    // Loading the live site instead of a bundled copy is what keeps the deploy
    // loop intact: push to main, ~3 minutes, the driver reopens the app and has
    // the fix. A bundled build would freeze the drivers at whatever was
    // compiled, and rebuilding it needs Node and the Capacitor CLI on the
    // developer's machine -- which is exactly what is not available here, so
    // every typo would become a blocked release.
    //
    // Capacitor still injects the native bridge into a remote URL, so
    // @capacitor/push-notifications and @capacitor/geolocation work normally.
    //
    // REMOVE THIS LINE before building a customer app for either store: Apple
    // rejects apps that merely remote-load a website, and a store build wants
    // the bundled `dist` this repo already produces.
    url: 'https://app.gosalka.com',
    cleartext: false
  }
}

export default config
