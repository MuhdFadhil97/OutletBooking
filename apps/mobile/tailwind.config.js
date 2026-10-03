const { colors, fontFamily, radius } = require('./theme/tokens.js');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}', './features/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // Required on web: app.json forces userInterfaceStyle "light", which NativeWind can only apply with class-based dark mode.
  darkMode: 'class',
  theme: {
    extend: {
      colors,
      fontFamily,
      borderRadius: { card: `${radius.card}px`, button: `${radius.button}px`, input: `${radius.input}px` },
    },
  },
  plugins: [],
};
