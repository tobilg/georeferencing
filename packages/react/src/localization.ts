/**
 * Translate a default English UI message to host-localized text. The default
 * implementation returns the message unchanged.
 */
export type Translate = (message: string) => string;

export const identity: Translate = (s) => s;
