/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Salka — warm, appetite-driven palette (Breadfast-style light theme)
        night: '#FFFAF5',     // page background — warm cream, not stark white
        shell: '#FFFFFF',     // card background
        shellup: '#FFF1E6',   // elevated surface (header, active tab)
        line: '#F0DFCB',      // borders — warm sand line
        sea: '#0A5F5E',       // brand primary — matches the real logo teal exactly
        seadeep: '#063A39',   // primary hover/pressed
        sand: '#E9A23B',      // accent — amber (ratings, highlights)
        foam: '#2B1D12',      // primary text — warm dark brown, not pure black
        mist: '#8A7561'       // secondary/muted text — warm taupe
      },
      fontFamily: { arabic: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
}
