import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        daisy: {
          primary: '#006FAC',
          'primary-deep': '#005589',
          'primary-soft': '#D4E8F5',
          'primary-tint': '#EDF5FA',
          yellow: '#FFCB05',
          orange: '#DF542F',
          cyan: '#3AC1EA',
          green: '#67A671',
          amber: '#FCAF17',
          red: '#DF542F',
          ink: '#1A4359',
          'ink-soft': '#2D5570',
          muted: '#5A7A8F',
          line: '#D4E1E9',
          'line-soft': '#E8F0F5',
          bg: '#F5F9FB',
          paper: '#FFFFFF',
        },
      },
      fontFamily: {
        display: ['Quicksand', 'sans-serif'],
        sans: ['Poppins', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '8px',
        DEFAULT: '12px',
        lg: '18px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(0,60,100,0.06)',
        lift: '0 6px 20px rgba(0,60,100,0.10)',
      },
    },
  },
  plugins: [],
} satisfies Config
