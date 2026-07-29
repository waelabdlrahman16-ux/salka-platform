/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Salka — teal, silver & gold (cool, premium palette — confirmed July 2026)
        night: '#F4F7F7',     // page background — cool silver, not warm cream
        shell: '#FFFFFF',     // card background
        shellup: '#EAF1F0',   // elevated surface (header, active tab, thumbnails) — soft teal tint
        line: '#E1E8E7',      // borders — cool silver line
        sea: '#0A5F5E',       // brand primary — matches the real logo teal exactly
        seadeep: '#063A39',   // primary hover/pressed
        sand: '#B8934A',      // secondary/accent — muted gold (ratings, highlights, warnings)
        foam: '#17302E',      // primary text — deep cool teal-black, not warm brown
        mist: '#64716F'       // secondary/muted text — cool silver-gray
      },
      fontFamily: { arabic: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
}
