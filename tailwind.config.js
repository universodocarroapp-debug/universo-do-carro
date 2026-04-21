/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './*.html',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // index.html / login.html
        brand: {
          500: '#FF5A00',
          600: '#E65100',
        },
        dark: {
          900: '#0A0A0A',
          800: '#141414',
          700: '#1A1A1A',
        },
        // admin.html / comprador.html / cotacao.html / loja.html
        primary:            '#FF5A00',
        secondary:          '#E63946',
        'background-light': '#f6f6f8',
        'background-dark':  '#050505',
        slate: {
          800: '#141414',
          900: '#0A0A0A',
        },
      },
      fontFamily: {
        inter:   ['Inter', 'sans-serif'],
        display: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg:      '0.5rem',
        xl:      '0.75rem',
        full:    '9999px',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries'),
  ],
};
