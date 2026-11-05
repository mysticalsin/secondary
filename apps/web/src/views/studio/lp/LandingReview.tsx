import { useMemo, useState } from "react";
import { useI18n } from "../../../i18n";
import { lineDiff } from "../../../lib/diff";
import { type LpReviewDetail, SLOT_IDS } from "../../../lp/types";
import { WikiDiff } from "../../wiki/WikiDiff";
import { DeviceToggle } from "./DeviceToggle";
import { type Device, Frame, PagePreview, shownTitle } from "./Preview";
import "./lp.css";

type Snap = Pick<LpReviewDetail["draft"], "slots" | "references" | "contact" | "lang">;

/** One line per block, so the diff reads like the page. */
function lines(s: Snap, t: ReturnType<typeof useI18n>["t"]): string {
  return [
    ...SLOT_IDS.map((id) => `${t(`lp.slot.${id}`)}: ${s.slots[id]}`),
    ...s.references.map(
      (r) =>
        `${t("lp.rv.ref")}: ${shownTitle(r, s.lang)} (${r.permission === "named" ? t("lp.ref.named") : t("lp.ref.generalised")})`,
    ),
    `${t("lp.rv.contact")}: ${[s.contact.name, s.contact.title, s.contact.email].filter(Boolean).join(", ")}`,
  ].join("\n");
}

/** A reviewer reads the page as the visitor will, then what changed since the last revision. */
export function LandingReview({ detail }: { detail: LpReviewDetail }) {
  const { t } = useI18n();
  const [device, setDevice] = useState<Device>("desktop");
  const d = detail.draft;
  const diff = useMemo(
    () =>
      lineDiff(
        detail.previous ? lines({ ...detail.previous, lang: d.lang }, t) : null,
        lines(d, t),
      ),
    [detail.previous, d, t],
  );
  return (
    <div className="lp-review" data-testid="lp-review">
      <div className="lp-review-bar">
        <h4>{t("lp.rv.title")}</h4>
        <DeviceToggle device={device} onChange={setDevice} />
      </div>
      <Frame device={device} actual={false} label={t("lp.preview")}>
        <PagePreview page={d} device={device} />
      </Frame>
      <h4>{t("lp.rv.changes")}</h4>
      {detail.previous ? null : <p className="muted">{t("lp.rv.first")}</p>}
      <WikiDiff lines={diff} label={t("lp.rv.changes")} />
    </div>
  );
}
