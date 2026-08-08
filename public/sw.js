// Compatibility entrypoint for installations that previously registered
// /sw.js. New app versions register /firebase-messaging-sw.js directly. If a
// browser updates this legacy URL before loading the new bundle, it still gets
// the exact same unified caching and push behavior.
importScripts('/firebase-messaging-sw.js')
