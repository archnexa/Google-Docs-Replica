import { useId, useState } from 'react'
import { saveTheme, themes } from '../lib/theme'
import { Icon } from './Icon'

export function ThemeSwitcher() {
  const id = useId()
  const [selected, setSelected] = useState(
    () => themes.find((theme) => theme === document.documentElement.dataset.theme) ?? 'purple',
  )

  return (
    <div className="theme-control">
      <span className="theme-label" aria-hidden="true">Theme</span>
      <fieldset className="theme-options">
        <legend className="sr-only">Color theme</legend>
        {themes.map((theme) => {
          const label = theme[0].toUpperCase() + theme.slice(1)
          return (
            <label className="theme-option" data-color={theme} key={theme} title={label}>
              <input
                className="sr-only"
                type="radio"
                name={id}
                aria-label={label}
                checked={selected === theme}
                onChange={() => {
                  saveTheme(theme)
                  setSelected(theme)
                }}
              />
              <span className="theme-swatch"><Icon name="check" size={13} /></span>
            </label>
          )
        })}
      </fieldset>
    </div>
  )
}
