import type { GeoreferencerController } from "../core/controller.js";

/**
 * Subscribe a map binding's render function to a controller without error feedback loops.
 *
 * `update` runs immediately and after every snapshot change. It may push recoverable
 * per-item errors into the supplied list or throw. The first error is reported through
 * the controller once, without re-entering `update`; a persisting failure is reported
 * again only after a later edit has cleared the error.
 * @param controller - Editor store to observe.
 * @param update - Render the current snapshot into the host map.
 * @returns `sync` to rerun the update manually and `unsubscribe` to stop observing.
 */
export function subscribeBinding(
  controller: GeoreferencerController,
  update: (errors: unknown[]) => void,
): {
  /** Rerun the update now, for example after a view or projection change. */
  sync(): void;
  /** Stop observing the controller. */
  unsubscribe(): void;
} {
  let active = true,
    reporting = false,
    reported: string | null = null;
  const sync = () => {
    if (!active || reporting) return;
    const errors: unknown[] = [];
    try {
      update(errors);
    } catch (error) {
      errors.push(error);
    }
    const message = errors.length ? String(errors[0]) : null;
    if (
      message === null ||
      (message === reported && controller.getSnapshot().error !== null)
    ) {
      reported = message;
      return;
    }
    reported = message;
    reporting = true;
    try {
      controller.reportError(errors[0]);
    } finally {
      reporting = false;
    }
  };
  const unsubscribeController = controller.subscribe(sync);
  sync();
  return {
    sync,
    unsubscribe() {
      active = false;
      unsubscribeController();
    },
  };
}
