# Form System Reference

Form validation states, field groups, and special inputs for the Anthropic/Claude design style.

## Form Validation States

### Color Tokens for Validation

```css
:root {
  /* Validation state colors — warm, brand-aligned (NOT pure red/green) */
  --state-error: #b85b44; /* warm brick red — harmonious with brand clay */
  --state-error-bg: rgba(184, 91, 68, 0.06);
  --state-error-border: rgba(184, 91, 68, 0.35);
  --state-warning: #c4923a; /* warm amber — muted, on-brand */
  --state-warning-bg: rgba(154, 112, 32, 0.06);
  --state-success: #5a856a; /* muted sage green — low saturation */
  --state-success-bg: rgba(90, 133, 106, 0.06);
  --state-success-border: rgba(90, 133, 106, 0.3);
}
```

> **Why these colors?** Anthropic's palette is built on warm, restrained tones.
> Saturated reds like `#dc2626` or `#f87171` feel jarring against `#faf9f5` cream.
> `#b85b44` is a warm brick red derived from the same terracotta family as brand clay `#d97757`, but darker — signaling error without breaking the aesthetic.
> `#5a856a` is a muted sage green that reads "success" without the clinical brightness of `#16a34a`.
> Both colors maintain WCAG AA contrast on `--bg-primary` (#faf9f5).

### Field with Validation

```css
/* Base field */
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 20px;
}

.field-label {
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
}

.field-label .required {
  color: var(--state-error);
  margin-left: 3px;
}

/* Input — default */
.field-input {
  border: 1px solid var(--border-default);
  border-radius: 7.5px;
  padding: 9px 14px;
  font-size: 15px;
  font-family: var(--font-sans);
  background: var(--bg-card);
  color: var(--text-primary);
  transition:
    border-color 200ms ease,
    box-shadow 200ms ease;
  width: 100%;
}

.field-input::placeholder {
  color: var(--text-tertiary);
}

.field-input:focus {
  outline: none;
  border-color: var(--text-secondary);
  box-shadow: 0 0 0 2px var(--ring-color);
}

/* Error state */
.field.error .field-input {
  border-color: var(--state-error-border);
  background: var(--state-error-bg);
}
.field.error .field-input:focus {
  box-shadow: 0 0 0 2px rgba(184, 91, 68, 0.15);
}

/* Success state */
.field.success .field-input {
  border-color: var(--state-success-border);
}

/* Disabled state */
.field-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--bg-muted);
}
```

### Inline Error / Helper Text

```css
.field-message {
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.4;
  display: flex;
  align-items: flex-start;
  gap: 5px;
}

.field-message.error {
  color: var(--state-error);
}
.field-message.helper {
  color: var(--text-secondary);
}
.field-message.success {
  color: var(--state-success);
}

.field-message .icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 1px;
}
```

### Full Field Example (React + Tailwind)

```tsx
function FormField({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 mb-5">
      <label className="text-sm font-medium text-[--text-primary]">
        {label}
        {required && <span className="text-[--state-error] ml-0.5">*</span>}
      </label>
      {children}
      {error && (
        <p className="text-[13px] text-[--state-error] flex items-center gap-1">
          <AlertCircle size={13} />
          {error}
        </p>
      )}
      {hint && !error && <p className="text-[13px] text-[--text-secondary]">{hint}</p>}
    </div>
  );
}
```

---

## Field Groups

### Two-Column Layout

```css
.field-group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

@media (max-width: 640px) {
  .field-group {
    grid-template-columns: 1fr;
  }
}
```

### Section Divider in Form

```css
.form-section {
  margin-top: 32px;
  padding-top: 32px;
  border-top: 1px solid var(--border-section);
}

.form-section-title {
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 20px;
}
```

### Form Actions (Submit Row)

```css
.form-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--border-section);
}
```

---

## Select / Dropdown Input

```css
.field-select {
  border: 1px solid var(--border-default);
  border-radius: 7.5px;
  padding: 9px 36px 9px 14px;
  font-size: 15px;
  font-family: var(--font-sans);
  background: var(--bg-card);
  color: var(--text-primary);
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L6 7L11 1' stroke='%235e5d59' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  cursor: pointer;
  transition: border-color 200ms ease;
}
.field-select:focus {
  outline: none;
  border-color: var(--text-secondary);
  box-shadow: 0 0 0 2px var(--ring-color);
}
```

---

## Checkbox & Radio

```css
/* Custom checkbox */
.checkbox-wrap {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}

.checkbox-input {
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--border-default);
  border-radius: 4px;
  background: var(--bg-card);
  flex-shrink: 0;
  margin-top: 2px;
  appearance: none;
  transition: all 150ms ease;
  cursor: pointer;
}

.checkbox-input:checked {
  background: var(--bg-button);
  border-color: var(--bg-button);
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 12 10' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 5L4.5 8.5L11 1.5' stroke='%23faf9f5' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: center;
}

.checkbox-input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--ring-color);
}

.checkbox-label {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.5;
}

/* Radio — same as checkbox, border-radius: 50% */
.radio-input {
  border-radius: 50%;
}
.radio-input:checked {
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 8 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='4' cy='4' r='2.5' fill='%23faf9f5'/%3E%3C/svg%3E");
}
```

---

## Toggle / Switch

```css
.toggle-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.toggle {
  position: relative;
  width: 36px;
  height: 20px;
  background: var(--border-default);
  border-radius: 10px;
  transition: background 200ms ease;
  flex-shrink: 0;
}

.toggle.on {
  background: var(--bg-button);
}

.toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform 200ms ease;
}

.toggle.on::after {
  transform: translateX(16px);
}

.toggle-label {
  font-size: 14px;
  color: var(--text-primary);
}
```

---

## Tag Input (Chip Input)

```css
.tag-input-wrap {
  min-height: 42px;
  border: 1px solid var(--border-default);
  border-radius: 7.5px;
  padding: 6px 10px;
  background: var(--bg-card);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  transition: border-color 200ms ease;
}
.tag-input-wrap:focus-within {
  border-color: var(--text-secondary);
  box-shadow: 0 0 0 2px var(--ring-color);
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--bg-muted);
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-secondary);
}

.tag-remove {
  width: 14px;
  height: 14px;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color 150ms ease;
}
.tag-remove:hover {
  color: var(--text-primary);
}
```

---

## Multi-Step Form Indicator

```css
.steps {
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: 40px;
}

.step {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.step-circle {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1.5px solid var(--border-default);
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  flex-shrink: 0;
  transition: all 200ms ease;
}

.step.active .step-circle {
  border-color: var(--text-primary);
  background: var(--bg-button);
  color: var(--text-on-button);
}

.step.done .step-circle {
  border-color: var(--text-secondary);
  background: var(--bg-muted);
  color: var(--text-secondary);
}

.step-label {
  font-size: 13px;
  color: var(--text-secondary);
}
.step.active .step-label {
  color: var(--text-primary);
  font-weight: 500;
}

/* Connector line */
.step-connector {
  flex: 1;
  height: 1px;
  background: var(--border-default);
  margin: 0 8px;
}
.step-connector.done {
  background: var(--text-secondary);
}
```

---

## Form Error Banner (Top of Form)

```css
.form-error-banner {
  padding: 12px 16px;
  border-radius: 7.5px;
  background: var(--state-error-bg);
  border: 1px solid var(--state-error-border);
  color: var(--state-error);
  font-size: 14px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 24px;
}

.form-error-banner .icon {
  flex-shrink: 0;
  margin-top: 1px;
}
```

---

## Dark Mode

> **CSS Ordering Rule**: The `.dark` block MUST appear AFTER `:root` in the stylesheet.
> Both selectors have equal specificity (0,1,0); the later one wins. If `.dark` comes first,
> `:root` will override all dark mode variables, breaking dark mode entirely.

```css
/* ✅ CORRECT order — :root first, .dark second */
:root {
  --state-error: #b85b44;
}

/* IMPORTANT: must come AFTER :root */
.dark {
  /* Validation colors — lighter warm tones for dark backgrounds */
  --state-error: #d4826a; /* lighter warm terracotta — 5.1:1 contrast on #1a1a18 */
  --state-error-bg: rgba(212, 130, 106, 0.08);
  --state-error-border: rgba(212, 130, 106, 0.3);
  --state-success: #7aab87; /* lighter muted sage — 4.8:1 contrast on #1a1a18 */
  --state-success-bg: rgba(122, 171, 135, 0.08);
  --state-success-border: rgba(122, 171, 135, 0.25);
  --state-warning: #c9a84c; /* lighter warm amber */
  --state-warning-bg: rgba(201, 168, 76, 0.08);
}

/* Toggle knob in dark mode — use warm cream instead of pure white */
.dark .toggle::after {
  background: var(--text-primary); /* #ece9e1 */
}

/* Select dropdown arrow for dark mode */
.dark .field-select {
  background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L6 7L11 1' stroke='%239b9b95' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
}
```

---

## Mobile Touch Targets

````css
@media (max-width: 767px) {
  /* All inputs must be 16px to prevent iOS zoom */
  .field-input, .field-select, textarea {
    font-size: 16px !important;
  }

  /* Enlarge checkbox/radio touch area to 44px */
  .checkbox-wrap, .toggle-wrap {
    min-height: 44px;
    padding: 4px 0;
  }

  .checkbox-input, .radio-input {
    width: 20px;
    height: 20px;
  }

  /* Toggle needs larger touch area */
  .toggle {
    width: 44px;
    height: 24px;
    border-radius: 12px;
  }
  .toggle::after {
    width: 20px;
    height: 20px;
  }
  .toggle.on::after {
    transform: translateX(20px);
  }

  /* Tag remove button — larger tap target */
  .tag-remove {
    width: 20px;
    height: 20px;
    padding: 3px;
  }

  /* Step indicator — stack labels below on narrow screens */
  .steps {
    flex-wrap: wrap;
    gap: 8px;
  }
  .step-label {
    display: none;   /* hide labels, keep circles */
  }
}

---

## Date Picker

### Native Input Styling

Style the browser's built-in `input[type="date"]` to match the design system. For full calendar customization, pair with a headless library (e.g. react-day-picker, Flatpickr).

```css
/* Date input — matches .field-input sizing and feel */
.field-input[type="date"],
.field-input[type="time"],
.field-input[type="datetime-local"] {
  border: 1px solid var(--border-default);
  border-radius: 7.5px;
  padding: 9px 14px;
  font-size: 15px;
  font-family: var(--font-sans);
  background: var(--bg-card);
  color: var(--text-primary);
  transition: border-color 200ms ease, box-shadow 200ms ease;
  width: 100%;
  /* Remove default browser chrome (calendar icon tinting) */
  color-scheme: light;
}

.field-input[type="date"]::-webkit-calendar-picker-indicator {
  opacity: 0.5;
  cursor: pointer;
  transition: opacity 150ms ease;
  /* Tint to match --text-tertiary */
  filter: invert(40%) sepia(5%) saturate(200%) hue-rotate(10deg);
}
.field-input[type="date"]::-webkit-calendar-picker-indicator:hover {
  opacity: 0.85;
}

.field-input[type="date"]:focus {
  outline: none;
  border-color: var(--text-secondary);
  box-shadow: 0 0 0 2px var(--ring-color);
}

/* Dark mode */
.dark .field-input[type="date"],
.dark .field-input[type="time"],
.dark .field-input[type="datetime-local"] {
  color-scheme: dark;
}
.dark .field-input[type="date"]::-webkit-calendar-picker-indicator {
  filter: invert(70%) sepia(5%) saturate(200%) hue-rotate(10deg);
}
````

### Calendar Popup — Base Style Hints

When using a custom calendar/datepicker library, apply these styles to the popup container:

```css
/* Popup container (e.g. .rdp-root, .flatpickr-calendar, etc.) */
.datepicker-popup {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 8px; /* card radius */
  box-shadow: var(--shadow-md);
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--text-primary);
  padding: 16px;
  z-index: 200;
}

/* Day cell — default */
.datepicker-day {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 150ms ease,
    color 150ms ease;
  color: var(--text-primary);
}

.datepicker-day:hover {
  background: var(--bg-hover);
}

/* Selected day — inverted (matches primary button) */
.datepicker-day.selected {
  background: var(--bg-button);
  color: var(--text-on-button);
  font-weight: 500;
}

/* Today marker */
.datepicker-day.today {
  border: 1px solid var(--border-default);
}

/* Out-of-range / disabled days */
.datepicker-day.disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Range selection — start/end and in-between */
.datepicker-day.range-start,
.datepicker-day.range-end {
  background: var(--bg-button);
  color: var(--text-on-button);
}
.datepicker-day.in-range {
  background: var(--bg-muted);
}
```

---

## Autocomplete Attributes Guide

Add `autocomplete` attributes to help browsers and password managers prefill forms correctly, reducing user friction and improving accessibility.

```html
<!-- Personal identity -->
<input type="text" name="name" autocomplete="name" />
<input type="text" name="given_name" autocomplete="given-name" />
<input type="text" name="family_name" autocomplete="family-name" />

<!-- Contact -->
<input type="email" name="email" autocomplete="email" />
<input type="tel" name="phone" autocomplete="tel" />

<!-- Address -->
<input type="text" name="street" autocomplete="street-address" />
<input type="text" name="city" autocomplete="address-level2" />
<input type="text" name="state" autocomplete="address-level1" />
<input type="text" name="zip" autocomplete="postal-code" />
<select name="country" autocomplete="country">
  <!-- Account credentials -->
  <input type="text" name="username" autocomplete="username" />
  <input type="email" name="login_email" autocomplete="email" />
  <input type="password" name="password" autocomplete="current-password" />
  <input type="password" name="new_password" autocomplete="new-password" />

  <!-- Payment -->
  <input type="text" name="cc_name" autocomplete="cc-name" />
  <input type="text" name="cc_number" autocomplete="cc-number" />
  <input type="text" name="cc_expiry" autocomplete="cc-exp" />
  <input type="text" name="cc_cvc" autocomplete="cc-csc" />

  <!-- Organization -->
  <input type="text" name="company" autocomplete="organization" />
  <input type="text" name="job_title" autocomplete="organization-title" />

  <!-- Turn off autocomplete for sensitive / OTP fields -->
  <input type="text" name="otp" autocomplete="one-time-code" />
  <input type="text" name="captcha" autocomplete="off" />
</select>
```

> **Note**: Use `autocomplete="off"` sparingly. Browsers and password managers may ignore it for password fields. Prefer the correct semantic value whenever possible.

```

```
