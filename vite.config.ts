import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Fail loudly if 5173 is taken instead of quietly moving to 5174. A drifted
    // port is how you end up with the browser on one server and HMR pointed at
    // another -- which looks exactly like "my edit did nothing".
    strictPort: true,
    hmr: {
      // Pinned, not inferred. Left to itself Vite works out the client's
      // websocket port from how the page was loaded, and when the app is opened
      // through anything other than a direct http://localhost:5173 -- a preview
      // pane, a proxy, a tunnel -- that inference produced
      // ws://localhost:undefined. The socket then never connects, HMR silently
      // stops, and the browser keeps serving the last successful build.
      //
      // That cost a full day on 19 August: edits appeared to do nothing, and
      // several things were reported broken that had already been fixed. The
      // failure is invisible unless you look at the console, because a dead HMR
      // socket looks identical to code that did not change.
      protocol: 'ws',
      host: 'localhost',
      clientPort: 5173,
    },
  },
})
