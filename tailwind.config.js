/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Salka — teal, silver & gold (warm neutrals, cool teal accent — updated Aug 2026)
        // Rationale: the palette read as cold since every neutral had a cool teal-grey
        // undertone. Kept the teal brand color exactly as-is; warmed every neutral around
        // it instead, so teal now stands out as the one cool-toned element rather than
        // blending into a cool-grey family.
        night: '#FBF7F1',     // page background — warm ivory (was #F4F7F7, cool silver)
        shell: '#FFFFFF',     // card background
        shellup: '#F4EEE3',   // elevated surface (header, active tab, thumbnails) — warm tint (was #EAF1F0)
        line: '#E8E1D6',      // borders — warm light grey (was #E1E8E7, cool silver)
        sea: '#0A5F5E',       // brand primary — unchanged, matches the real logo teal exactly
        seadeep: '#063A39',   // primary hover/pressed — unchanged
        sand: '#B8934A',      // secondary/accent — unchanged, muted gold (ratings, highlights, warnings)
        foam: '#231F1A',      // primary text — warm near-black (was #17302E, cool teal-black)
        mist: '#6E655C'       // secondary/muted text — warm grey (was #64716F, cool silver-gray)
      },
      fontFamily: { arabic: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
}
