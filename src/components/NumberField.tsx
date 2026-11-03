import { useEffect, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> & {
  /** Current numeric value; `null` shows as empty. */
  value: number | null;
  onCommit: (value: number | null) => void;
  /**
   * Value used when the field is left blank.
   * Pass `null` to allow a truly empty/cleared value.
   * Defaults to `0`.
   */
  emptyValue?: number | null;
};

/**
 * Number input that allows clearing while typing.
 * Focus selects contents; commits on blur or Enter.
 */
export default function NumberField({
  value,
  onCommit,
  emptyValue = 0,
  onBlur,
  onKeyDown,
  ...rest
}: Props) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value == null ? '' : String(value));
  }, [value, focused]);

  const commit = () => {
    const trimmed = draft.trim();
    if (
      trimmed === '' ||
      trimmed === '-' ||
      trimmed === '.' ||
      trimmed === '-.'
    ) {
      onCommit(emptyValue);
      setDraft(emptyValue == null ? '' : String(emptyValue));
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      setDraft(value == null ? '' : String(value));
      return;
    }
    onCommit(n);
    setDraft(String(n));
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={(e) => {
        setFocused(true);
        e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        setFocused(false);
        commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
        onKeyDown?.(e);
      }}
    />
  );
}
