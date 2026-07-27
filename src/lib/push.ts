import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

// No-op on web/PWA -- push only works inside the native Capacitor app,
// where this actually has a real OS-level push channel behind it.
export async function registerPush(onToken: (token: string) => void) {
  if (!Capacitor.isNativePlatform()) return

  try {
    const current = await PushNotifications.checkPermissions()
    let granted = current.receive === 'granted'
    if (!granted) {
      const requested = await PushNotifications.requestPermissions()
      granted = requested.receive === 'granted'
    }
    if (!granted) return

    await PushNotifications.removeAllListeners()
    PushNotifications.addListener('registration', token => onToken(token.value))
    PushNotifications.addListener('registrationError', err => console.error('push registration error', err))

    await PushNotifications.register()
  } catch (e) {
    // push is an enhancement, never let it break the app
    console.error('push setup failed', e)
  }
}
