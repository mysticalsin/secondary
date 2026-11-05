import { Link, useParams } from "react-router-dom";
import { Await, Empty, fmtDate } from "../../components/ui";
import { useI18n } from "../../i18n";
import { pageLink } from "../../lib/links";
import { useApi } from "../../useApi";
import { v3 } from "./api";
import { BrainFrame } from "./shared";

/** What changed in this brain this week. */
export function ActivityPage() {
  const { id = "" } = useParams();
  const { t, tn } = useI18n();
  const home = useApi(() => v3.brain(id), [id]);
  return (
    <BrainFrame id={id} title={t("v4.activity")}>
      <Await state={home} skeleton={3}>
        {(b) =>
          b.changedThisWeek.items.length ? (
            <>
              <p className="muted">
                {tn(b.changedThisWeek.total, "v4.activity.one", "v4.activity.other")}
              </p>
              <ul className="rows">
                {b.changedThisWeek.items.map((c) => (
                  <li key={`${c.pageId}-${c.revision}`} className="rowline">
                    <div>
                      <Link to={pageLink(id, c.pageId)}>{c.title}</Link>
                      <p className="muted">
                        {c.change === "new" ? t("v4.tag.new") : t("v4.tag.change")} ·{" "}
                        {fmtDate(c.at)}
                      </p>
                    </div>
                    <span className="diffsum">
                      <span className="plus">+{c.added}</span>{" "}
                      <span className="minus">-{c.removed}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty title={t("v4.activity.empty")}>{t("v4.activity.empty.lead")}</Empty>
          )
        }
      </Await>
    </BrainFrame>
  );
}

/** Pages a reviewed change archived. The API does not list them yet, so this says so plainly. */
export function TrashPage() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  return (
    <BrainFrame id={id} title={t("v4.trash")}>
      <Empty title={t("v4.trash.title")}>{t("v4.trash.lead")}</Empty>
    </BrainFrame>
  );
}
