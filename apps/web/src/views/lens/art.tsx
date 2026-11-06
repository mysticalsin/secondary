// Empty-state illustrations. Brand-safe: drawn from the dots and lines of the v5 cards in the Mantu
// purple and yellow, with no people, no photos and no stock. Decorative, so hidden from assistive technology.

const P = "#8b5cf6";
const Y = "#f8f060";
const L = "#c4b5fd";

type Kind = "graph" | "people" | "facts" | "pulse" | "search" | "saved" | "palette";

export function EmptyArt({ kind }: { kind: Kind }) {
  return (
    <svg className="art8" viewBox="0 0 120 72" aria-hidden focusable="false">
      {kind === "graph" ? (
        <g fill="none" stroke={L} strokeOpacity=".55" strokeWidth="1.5">
          <line x1="60" y1="36" x2="26" y2="18" />
          <line x1="60" y1="36" x2="96" y2="22" />
          <line x1="60" y1="36" x2="88" y2="58" strokeDasharray="3 4" />
          <circle cx="60" cy="36" r="9" fill={Y} stroke="none" />
          <circle cx="26" cy="18" r="5" fill={P} stroke="none" />
          <circle cx="96" cy="22" r="5" fill={P} stroke="none" />
          <circle cx="88" cy="58" r="4" strokeDasharray="2 3" />
        </g>
      ) : null}
      {kind === "people" ? (
        <g>
          <circle cx="40" cy="30" r="12" fill={P} />
          <circle cx="68" cy="30" r="12" fill="#0f9d94" />
          <circle
            cx="92"
            cy="34"
            r="9"
            fill="none"
            stroke={L}
            strokeOpacity=".6"
            strokeDasharray="3 3"
          />
          <rect x="24" y="50" width="44" height="5" rx="2.5" fill={L} fillOpacity=".5" />
          <rect x="24" y="60" width="28" height="5" rx="2.5" fill={L} fillOpacity=".25" />
        </g>
      ) : null}
      {kind === "facts" ? (
        <g>
          <rect x="14" y="14" width="64" height="7" rx="3.5" fill={P} />
          <rect x="38" y="30" width="62" height="7" rx="3.5" fill="#0f9d94" />
          <rect
            x="22"
            y="46"
            width="30"
            height="7"
            rx="3.5"
            fill="none"
            stroke={L}
            strokeOpacity=".6"
            strokeDasharray="3 3"
          />
          <circle cx="104" cy="58" r="4" fill={Y} />
        </g>
      ) : null}
      {kind === "pulse" ? (
        <g>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((c) =>
            [0, 1, 2].map((r) => (
              <circle
                key={`${c}-${r}`}
                cx={18 + c * 12}
                cy={20 + r * 15}
                r={(c * 3 + r * 5) % 7 === 0 ? 4 : 2}
                fill={(c * 3 + r * 5) % 7 === 0 ? P : L}
                fillOpacity={(c * 3 + r * 5) % 7 === 0 ? 1 : 0.35}
              />
            )),
          )}
          <circle cx="102" cy="35" r="5" fill={Y} />
        </g>
      ) : null}
      {kind === "search" ? (
        <g fill="none" stroke={L} strokeWidth="2">
          <circle cx="54" cy="32" r="16" stroke={P} />
          <line x1="66" y1="44" x2="82" y2="58" stroke={P} strokeLinecap="round" />
          <circle cx="54" cy="32" r="3" fill={Y} stroke="none" />
          <line x1="90" y1="20" x2="108" y2="20" strokeOpacity=".5" strokeLinecap="round" />
          <line x1="90" y1="30" x2="102" y2="30" strokeOpacity=".3" strokeLinecap="round" />
        </g>
      ) : null}
      {kind === "saved" ? (
        <g fill="none" stroke={L} strokeWidth="1.5">
          <path
            d="M44 12h32a4 4 0 0 1 4 4v44l-20-12-20 12V16a4 4 0 0 1 4-4z"
            stroke={P}
            strokeWidth="2"
          />
          <circle cx="60" cy="30" r="4" fill={Y} stroke="none" />
        </g>
      ) : null}
      {kind === "palette" ? (
        <g>
          <rect
            x="22"
            y="14"
            width="76"
            height="12"
            rx="6"
            fill="none"
            stroke={P}
            strokeWidth="2"
          />
          <rect x="30" y="36" width="52" height="5" rx="2.5" fill={L} fillOpacity=".5" />
          <rect x="30" y="48" width="38" height="5" rx="2.5" fill={L} fillOpacity=".3" />
          <circle cx="90" cy="20" r="3" fill={Y} />
        </g>
      ) : null}
    </svg>
  );
}
