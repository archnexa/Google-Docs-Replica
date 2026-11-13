export const themes = ['purple', 'pink', 'blue'] as const
export type Theme = (typeof themes)[number]

const storageKey = 'ajaia-docs-theme'

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

export function initializeTheme() {
  try {
    const stored = localStorage.getItem(storageKey)
    const saved = themes.find((theme) => theme === stored)
    if (saved) applyTheme(saved)
  } catch {
    // The stylesheet supplies the default when storage isn't available.
  }
}

export function saveTheme(theme: Theme) {
  applyTheme(theme)
  try {
    localStorage.setItem(storageKey, theme)
  } catch {
    // The current page can still apply the palette.
  }
}
