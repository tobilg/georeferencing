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
 * Retain an editable numeric draft and commit only finite changed values on blur/Enter.
 */
export function NumberField({
  value,
  label,
  change,
  disabled = false,
}: {
  value: number;
  label: string;
  change: (value: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
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
        if (draft.trim() && Number.isFinite(n) && n !== value) change(n);
        else setDraft(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
