import { Monitor, Smartphone } from "lucide-react";
import { useT } from "../../../i18n";
import type { Device } from "./Preview";

export function DeviceToggle({
  device,
  onChange,
}: {
  device: Device;
  onChange: (d: Device) => void;
}) {
  const t = useT();
  return (
    <div className="pills" role="group" aria-label={t("lp.dev.group")}>
      <button
        type="button"
        className="pill"
        aria-pressed={device === "desktop"}
        onClick={() => onChange("desktop")}
      >
        <Monitor size={14} aria-hidden /> {t("lp.dev.desktop")}
      </button>
      <button
        type="button"
        className="pill"
        aria-pressed={device === "phone"}
        onClick={() => onChange("phone")}
      >
        <Smartphone size={14} aria-hidden /> {t("lp.dev.phone")}
      </button>
    </div>
  );
}
