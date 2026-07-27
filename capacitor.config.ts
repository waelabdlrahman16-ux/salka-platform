import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.gosalka.app',
  appName: 'سالكة',
  webDir: 'dist',
  server: {
    // During review/dev this can point androidScheme to https for correct
    // cookie/storage behavior. No remote URL is set here -- the web build
    // is bundled INTO the native app (not loaded live from the internet),
    // which is both faster/more reliable and avoids Apple's "web wrapper"
    // rejection risk for apps that just remote-load a website.
    androidScheme: 'https'
  }
}

export default config
