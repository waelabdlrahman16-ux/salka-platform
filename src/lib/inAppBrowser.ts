// Detection for social-app in-app browsers (embedded WebViews).
//
// Why this exists: Google refuses OAuth inside an embedded WebView and answers
// `403: disallowed_useragent` with a full-page "Access blocked" screen. Every
// customer arriving from a Facebook or Instagram ad opens Salka inside exactly
// such a WebView, and the first and largest button on the login card is
// «المتابعة بجوجل». So the single most prominent action offered to the traffic
// we are PAYING for was a guaranteed dead end, on a brand nobody in Sokhna has
// heard of yet.
//
// Falling back from popup to redirect does not help -- both run inside the same
// blocked WebView. The only fix is not to offer Google there at all.
//
// Signatures, and who they catch:
//   FBAN / FBAV   Facebook app (iOS uses FBAN, Android FBAV; both appear)
//   FB_IAB        Facebook's in-app browser proper, incl. Messenger
//   Instagram     Instagram's in-app browser -- same block, same fix
//   Line/         LINE
//   MicroMessenger WeChat
//
// Deliberately NOT matched:
//
//   `; wv)` -- the generic Android WebView token. It is set by Capacitor, and
//   the Android build IS Salka. Matching it would disable the login prompt in
//   our own shipped app, where Google sign-in works fine because Capacitor
//   routes OAuth through a Custom Tab rather than the WebView. This is the one
//   false positive that would actually cost us accounts, so it is excluded on
//   purpose rather than by omission.
//
// Nothing here changes behaviour for Safari or Chrome. If the UA does not match
// one of these, every caller behaves exactly as it did before.
const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger/i

export function isInAppBrowser(ua: string = navigator.userAgent): boolean {
  return IN_APP_BROWSER.test(ua)
}

/**
 * True when Google sign-in cannot possibly succeed in this browser, so the
 * button should not be rendered at all.
 *
 * Same predicate as `isInAppBrowser` today, named separately because they are
 * different questions and will not always share an answer -- if Google ever
 * relaxes the policy, or if we add a provider that does work in a WebView, only
 * this one changes.
 */
export const googleSignInBlocked = isInAppBrowser
