import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ios: {
          bg: '#07080b',
          card: 'rgba(255, 255, 255, 0.05)',
          'card-hover': 'rgba(255, 255, 255, 0.09)',
          border: 'rgba(255, 255, 255, 0.12)',
          'border-highlight': 'rgba(255, 255, 255, 0.25)',
          primary: '#0A84FF',
          accent: '#5E5CE6',
          cyan: '#32D74B',
          teal: '#64D2FF',
          pink: '#FF375F',
          amber: '#FFD60A',
          purple: '#BF5AF2',
        },
      },
      backdropBlur: {
        '3xl': '40px',
        '4xl': '64px',
      },
      boxShadow: {
        'glass-glow': '0 0 50px -10px rgba(94, 92, 230, 0.35)',
        'island-glow': '0 10px 40px -10px rgba(0, 0, 0, 0.8), 0 0 20px 2px rgba(100, 210, 255, 0.15)',
        'node-glow': '0 0 35px 2px rgba(10, 132, 255, 0.4)',
        'node-hover': '0 0 50px 8px rgba(191, 90, 242, 0.55)',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'radar-sweep': 'sweep 6s linear infinite',
        'orb-float': 'float 12s ease-in-out infinite alternate',
        'spin-slow': 'spin 18s linear infinite',
      },
      keyframes: {
        sweep: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        float: {
          '0%': { transform: 'translate(0px, 0px) scale(1)' },
          '50%': { transform: 'translate(25px, -20px) scale(1.08)' },
          '100%': { transform: 'translate(-20px, 15px) scale(0.96)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
