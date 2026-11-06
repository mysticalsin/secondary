// The full-page My Agent at /agent: the same thread, wider.
import { useI18n } from "../i18n";
import "./agent.css";
import { Thread } from "./Thread";

export default function AgentPage() {
  const { t } = useI18n();
  return (
    <div className="page v4page wide ag-page">
      <h1 className="ptitle">{t("v6.page.title")}</h1>
      <Thread variant="page" />
    </div>
  );
}
