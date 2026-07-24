/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: '#0A1020', shell: '#111A2E', shellup: '#18233C',
        line: '#243250', sea: '#2DD4BF', seadeep: '#0F766E',
        sand: '#F3B94D', foam: '#E6ECF7', mist: '#8CA0C3'
      },
      fontFamily: { arabic: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: []
}
