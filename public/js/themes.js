// Visual themes. Every theme uses the same rules; only tiles, colours and wording change.
// Each tile has a distinct shape so the game never relies on colour alone.
export const THEMES = {
  classic: {
    name: 'Classic', tagline: 'Pure logic, no frills.',
    a: { label: 'Dot', bg: '#FFC145', fg: '#2B1D00', svg: '<circle cx="12" cy="12" r="6.5"/>' },
    b: { label: 'Diamond', bg: '#5B6CFF', fg: '#FFFFFF', svg: '<path d="M12 4.5 19.5 12 12 19.5 4.5 12Z"/>' },
  },
  football: {
    name: 'Football', tagline: 'Balls and corner flags on the pitch.',
    a: { label: 'Ball', bg: '#1B9452', fg: '#FFFFFF', svg: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8.6 15 10.8 13.9 14.3H10.1L9 10.8Z"/>' },
    b: { label: 'Flag', bg: '#F5D547', fg: '#3A2E00', svg: '<path d="M8 4.5V19.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 5 17 8 9 11Z"/>' },
  },
  cricket: {
    name: 'Cricket', tagline: 'Leather balls and willow bats.',
    a: { label: 'Ball', bg: '#D7263D', fg: '#FFFFFF', svg: '<circle cx="12" cy="12" r="6.8"/><path d="M8.6 7.2C10.6 9.8 10.6 14.2 8.6 16.8M15.4 7.2C13.4 9.8 13.4 14.2 15.4 16.8" fill="none" stroke="#D7263D" stroke-width="1.3"/>' },
    b: { label: 'Bat', bg: '#EDCB7A', fg: '#3F2C08', svg: '<rect x="9.5" y="8" width="5" height="12" rx="2"/><rect x="11.2" y="3.5" width="1.6" height="5" rx=".8"/>' },
  },
  geography: {
    name: 'Geography', tagline: 'Mountains and oceans across the map.',
    a: { label: 'Mountain', bg: '#C9612A', fg: '#FFFFFF', svg: '<path d="M3.5 18.5 9.5 8l3.2 5.4L14.8 10l5.7 8.5Z"/>' },
    b: { label: 'Wave', bg: '#1E88E5', fg: '#FFFFFF', svg: '<path d="M3.5 10c2.2-2.4 4.4-2.4 6.6 0s4.4 2.4 6.6 0 2.4-1.6 3.8-1.2M3.5 15.5c2.2-2.4 4.4-2.4 6.6 0s4.4 2.4 6.6 0 2.4-1.6 3.8-1.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  },
};
export const THEME_ORDER = ['classic', 'football', 'cricket', 'geography'];

export function tileSvg(theme, which, size = 24) {
  const t = THEMES[theme][which];
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="currentColor">${t.svg}</svg>`;
}

export function applyTheme(theme, el = document.documentElement) {
  const t = THEMES[theme] || THEMES.classic;
  el.style.setProperty('--tile-a-bg', t.a.bg);
  el.style.setProperty('--tile-a-fg', t.a.fg);
  el.style.setProperty('--tile-b-bg', t.b.bg);
  el.style.setProperty('--tile-b-fg', t.b.fg);
  el.dataset.theme = theme;
}
