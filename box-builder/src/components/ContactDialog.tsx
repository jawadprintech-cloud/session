import type { CatalogSettings } from "../../shared/catalog";

interface Props {
  settings: CatalogSettings;
  onClose: () => void;
  toast: (msg: string, kind?: "info" | "error" | "success") => void;
}

/** Ways to reach the business. Addresses are shown as text too, since mail/phone links can't open everywhere. */
export function ContactDialog({ settings: s, onClose, toast }: Props) {
  const wa = s.contactWhatsapp.replace(/[^\d]/g, "");
  const rows = [
    s.contactEmail && { label: "Email", value: s.contactEmail, href: `mailto:${s.contactEmail}?subject=${encodeURIComponent("Custom packaging enquiry")}`, cta: "Send email" },
    s.contactPhone && { label: "Phone", value: s.contactPhone, href: `tel:${s.contactPhone.replace(/[^\d+]/g, "")}`, cta: "Call" },
    wa && { label: "WhatsApp", value: s.contactWhatsapp, href: `https://wa.me/${wa}?text=${encodeURIComponent("Hi! I'm designing a custom box and have a question.")}`, cta: "Chat" },
    s.contactUrl && { label: "Contact page", value: s.contactUrl.replace(/^https:\/\//, ""), href: s.contactUrl, cta: "Open" },
  ].filter(Boolean) as { label: string; value: string; href: string; cta: string }[];

  const copy = (v: string) =>
    navigator.clipboard
      ?.writeText(v)
      .then(() => toast("Copied", "success"))
      .catch(() => toast("Select the text and copy it manually.", "info"));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="contact-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal contact-modal">
        <header className="modal-head">
          <h2 id="contact-title">Contact us</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body">
          <p className="lead">Questions about box styles, sizes, materials or finishes? Our packaging team is happy to help.</p>
          {rows.length ? (
            <ul className="contact-list">
              {rows.map((r) => (
                <li key={r.label}>
                  <span className="contact-label">{r.label}</span>
                  <span className="contact-value">{r.value}</span>
                  <span className="contact-actions">
                    <button className="btn small" onClick={() => copy(r.value)}>Copy</button>
                    <a className="btn small primary" href={r.href} target={r.href.startsWith("https") ? "_blank" : undefined} rel="noreferrer">
                      {r.cta}
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Contact details haven't been set up yet (Admin → Settings).</p>
          )}
          {s.contactHours && <p className="hint">Opening hours: {s.contactHours}</p>}
          <p className="hint">Ready for prices? Use <strong>Submit for Quote</strong> — we'll reply with a custom quotation.</p>
        </div>
      </div>
    </div>
  );
}
