interface ToggleSwitchProps {
  checked: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
}

const TRACK_SIZE = {
  sm: 'w-8 h-4.5',
  md: 'w-9 h-5',
}

const DOT_SIZE = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
}

const DOT_TRANSLATE = {
  sm: 'translate-x-[14px]',
  md: 'translate-x-4',
}

// When onChange is omitted the switch renders but does nothing on click —
// used for controls that aren't wired up to real functionality yet.
function ToggleSwitch({ checked, onChange, disabled, size = 'sm' }: ToggleSwitchProps) {
  const interactive = !!onChange && !disabled

  return (
    <label className={`relative flex items-center ${interactive ? 'cursor-pointer' : 'cursor-default'}`}>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={interactive ? (e) => onChange(e.target.checked) : undefined}
      />
      <div
        className={`${TRACK_SIZE[size]} flex items-center rounded-full transition-colors duration-200 ${
          checked ? 'bg-primary' : 'bg-outline'
        } ${disabled ? 'opacity-40' : ''}`}
      >
        <div
          className={`${DOT_SIZE[size]} absolute left-0.5 rounded-full bg-on-background transition-transform duration-200 ${
            checked ? DOT_TRANSLATE[size] : 'translate-x-0'
          }`}
        />
      </div>
    </label>
  )
}

export default ToggleSwitch
