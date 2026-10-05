/** Custom Box Makers wordmark: an open-seam cube beside the stacked name. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 220 64" role="img" aria-label="Custom Box Makers">
      <g stroke="#3b2a1a" strokeWidth="2.2" strokeLinejoin="round">
        <path d="M30 6 54 18 30 30 6 18Z" fill="#f2a24a" />
        <path d="M6 18 30 30v28L6 46Z" fill="#d9822b" />
        <path d="M54 18 30 30v28l24-12Z" fill="#b8661b" />
      </g>
      <path d="M18 12 42 24" stroke="#3b2a1a" strokeWidth="1.6" opacity="0.55" />
      <text x="66" y="31" fill="#e0882f" fontFamily="'Poppins', 'Segoe UI', Arial, sans-serif" fontSize="22" fontWeight="500">
        CUSTOM BOX
      </text>
      <text x="80" y="55" fill="#2b2b2b" fontFamily="'Poppins', 'Segoe UI', Arial, sans-serif" fontSize="20" fontWeight="500" letterSpacing="3.5">
        MAKERS
      </text>
    </svg>
  );
}
