/** Recursively freeze serializable snapshots against host-callback mutation. @internal */
export function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
/** Deep-copy a structured-cloneable value. @internal */
export const clone = <T>(value: T): T => structuredClone(value);
