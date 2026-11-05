import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api";
import { PageHead } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useApi } from "../../useApi";
import { WikiTab } from "./WikiTab";

/** The wiki of a circle, department or Company Global: /wiki/:node. Accounts and My Secondary have their own tab. */
export function WikiPage() {
  const { ws = "" } = useParams();
  const { t } = useI18n();
  const node = useApi(() => api.node(ws), [ws]);
  const name = node.data?.node.label ?? ws;
  return (
    <div className="page">
      <p style={{ marginBottom: 16 }}>
        <Link className="btn sm ghost" to="/map">
          <ArrowLeft size={14} aria-hidden /> {t("nav.map")}
        </Link>
      </p>
      <PageHead eyebrow={t("wiki.tab")} title={t("wiki.title", { name })} />
      <WikiTab ws={ws} />
    </div>
  );
}
