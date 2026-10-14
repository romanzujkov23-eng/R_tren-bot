
const c = (name) => `rgb(var(--${name}-rgb) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'),
        card: c('card'),
        card2: c('card2'),
        line: c('line'),
        fg: c('fg'),
        hint: c('hint'),
        accent: c('accent'),
        'accent-fg': c('accent-fg'),
        brand: c('brand'),
        link: c('brand'),
        danger: c('danger'),
        ok: c('ok'),
      },
      opacity: { 12: '0.12' },
      keyframes: {
        sheet: { from: { transform: 'translateY(24px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: { sheet: 'sheet .22s ease-out', fade: 'fade .18s ease-out' },
    },
  },
  plugins: [],
}
