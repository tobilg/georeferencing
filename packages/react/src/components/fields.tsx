import { useEffect, useState } from "react";

export function TextField({
  value,
  label,
  change,
}: {
  value: string;
  label: string;
  change: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() !== value) change(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/**
 * Retain an editable numeric draft and commit only finite values the user changed, on
 * blur/Enter. `decimals` rounds the displayed value; an untouched rounded display never
 * overwrites the stored full-precision value.
 */
export function NumberField({
  value,
  label,
  change,
  disabled = false,
  decimals,
}: {
  value: number;
  label: string;
  change: (value: number) => void;
  disabled?: boolean;
  decimals?: number;
}) {
  const shown =
    decimals === undefined
      ? String(value)
      : String(Number(value.toFixed(decimals)));
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  return (
    <input
      aria-label={label}
      type="number"
      step="any"
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft);
        if (draft.trim() && draft.trim() !== shown && Number.isFinite(n))
          change(n);
        else setDraft(shown);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
