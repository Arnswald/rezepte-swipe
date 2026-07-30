// Rezepte-Swipe Logo „Gabel & Swipe": Terrakotta-Kachel, cremefarbene Gabel mit
// Swipe-Spur dahinter. Zeigt Kochen + Wischen zugleich. Skaliert über `size`.
export function LogoMark({
  size = 28,
  className = "",
  rounded = true,
}: {
  size?: number;
  className?: string;
  rounded?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Rezepte Logo"
    >
      <rect width="100" height="100" rx={rounded ? 24 : 0} fill="#bd5138" />
      {/* Swipe-Spur hinter der Gabel */}
      <path
        d="M24 76 Q36 34 78 32"
        fill="none"
        stroke="#faf3e8"
        strokeWidth="4.5"
        strokeLinecap="round"
        opacity="0.32"
      />
      {/* Zinken */}
      <line x1="40" y1="20" x2="40" y2="40" stroke="#faf3e8" strokeWidth="4.5" strokeLinecap="round" />
      <line x1="50" y1="20" x2="50" y2="40" stroke="#faf3e8" strokeWidth="4.5" strokeLinecap="round" />
      <line x1="60" y1="20" x2="60" y2="40" stroke="#faf3e8" strokeWidth="4.5" strokeLinecap="round" />
      {/* Hals */}
      <path d="M40 40 Q50 52 50 58" fill="none" stroke="#faf3e8" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M60 40 Q50 52 50 58" fill="none" stroke="#faf3e8" strokeWidth="4.5" strokeLinecap="round" />
      {/* Griff */}
      <line x1="50" y1="56" x2="50" y2="84" stroke="#faf3e8" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}
