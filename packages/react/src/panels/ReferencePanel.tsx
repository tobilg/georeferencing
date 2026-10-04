import type { GeoreferencerController } from "@georeferencing/core";
import { useGeoreferencer } from "../hooks/useGeoreferencer.js";
import type { Translate } from "../localization.js";
import { identity } from "../localization.js";

/**
 * Accessible loading/error/partial-result feedback for configured references; returns null when no provider statuses exist.
 *
 * This composable panel subscribes to the controller but does not attach the reference map or install an unsaved-work guard; manage those in the host when composing panels yourself.
 */
export function ReferencePanel({
  /** Shared authoritative editor controller; the panel does not own its lifecycle. */
  controller,
  /** Optional translation function; defaults to returning English messages unchanged. */
  t = identity,
}: {
  /** Shared authoritative editor controller; the panel does not own its lifecycle. */
  controller: GeoreferencerController;
  /** Optional translation function; defaults to returning English messages unchanged. */
  t?: Translate;
}) {
  const { references } = useGeoreferencer(controller);
  if (!Object.keys(references).length) return null;
  return (
    <section
      className="rg-references"
      aria-label={t("Reference sources")}
      aria-live="polite"
    >
      {Object.entries(references).map(([id, status]) => (
        <p key={id} className={status.state === "error" ? "rg-error" : ""}>
          <strong>{status.label}</strong>
          {" · "}
          {t(
            status.state === "loading"
              ? "Loading reference"
              : status.state === "error"
                ? "Reference unavailable"
                : status.partial
                  ? "Incomplete reference results"
                  : "Reference ready",
          )}
          {status.message && <> · {t(status.message)}</>}
        </p>
      ))}
    </section>
  );
}
