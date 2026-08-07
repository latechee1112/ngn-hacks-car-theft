interface ToggleSwitchProps {
  checked: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
}

// When onChange is omitted the switch renders but does nothing on click —
// used for controls that aren't wired up to real functionality yet.
function ToggleSwitch({ checked, onChange, disabled }: ToggleSwitchProps) {
  const interactive = !!onChange && !disabled

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={interactive ? () => onChange(!checked) : undefined}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-slate-700 transition-colors ${
        disabled ? 'opacity-40' : ''
      } ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full transition-transform ${
          checked ? 'translate-x-[18px] bg-white' : 'translate-x-1 bg-slate-400'
        }`}
      />
    </button>
  )
}

export default ToggleSwitch
