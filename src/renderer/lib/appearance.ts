export type Appearance = 'system' | 'light' | 'dark'
export function getAppearance(): Appearance {
  const value = localStorage.getItem('tenuvault-appearance')
  return value === 'light' || value === 'dark' ? value : 'system'
}
export function applyAppearance(value = getAppearance()) {
  document.documentElement.classList.toggle('dark', value === 'dark' || (value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches))
}
export function setAppearance(value: Appearance) {
  localStorage.setItem('tenuvault-appearance', value)
  applyAppearance(value)
}
applyAppearance()
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance())
