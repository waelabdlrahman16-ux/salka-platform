import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.gosalka.app',
  appName: 'سالكة',
  webDir: 'dist',
  server: {
    androidScheme: 'https',

    // CUSTOMER APP. This is the build going on the Play Store — package
    // com.gosalka.app, the same identity the earlier driver-only build used.
    // (2026-08-12: retired as the driver build. No driver ever actually
    // installed that APK — see claude/salka-push-rules.md, "no native token
    // has ever existed" — so reusing the package here has no live install to
    // migrate. The staff app now lives at a separate package, built from a
    // separate android-staff/ project once that's set up, so a build produced
    // from THIS config can never land on a driver's or vendor's phone and
    // silently repoint their staff app at the customer home screen.)
    //
    // Loading the live site instead of a bundled copy keeps the deploy loop
    // intact: push to main, ~3 minutes, a customer who reopens the app has the
    // fix, with no rebuild and no new Play Store review. Capacitor still
    // injects the native bridge into a remote URL, so
    // @capacitor/push-notifications and @capacitor/geolocation work normally.
    // This is fine for Google Play (unlike Apple, which rejects a bare
    // WebView with no native functionality) because the app has real native
    // features -- push notifications and geolocation for live order tracking
    // -- beyond just rendering a site.
    //
    // Root, not /login: customers should land on the browsing/home screen,
    // not be forced to sign in before they can look at a menu.
    url: 'https://app.gosalka.com',
    cleartext: false
  }
}

export default config
