import type { QuoteRecord } from "./app";

export interface MailConfig {
  /** e.g. smtps://user:pass@smtp.example.com:465 or smtp://user:pass@smtp.example.com:587 */
  smtpUrl: string;
  /** Sender address; defaults to the SMTP user. */
  from?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Header-safe single line. */
const line = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** Email the quote team about a new request, with links to every production file. */
export async function sendQuoteEmail(cfg: MailConfig, to: string, q: QuoteRecord, publicUrl?: string): Promise<void> {
  const { createTransport } = await import("nodemailer");
  const transport = createTransport(cfg.smtpUrl);
  let from = cfg.from;
  if (!from) {
    try {
      from = decodeURIComponent(new URL(cfg.smtpUrl).username) || undefined;
    } catch {
      /* invalid URL: createTransport/sendMail will report it */
    }
  }
  const base = publicUrl?.replace(/\/$/, "");
  const asset = (id: string) => (base ? `${base}/api/assets/${id}` : `/api/assets/${id}`);
  const r = q.requirements;
  const rows: [string, string][] = [
    ["Reference", q.reference],
    ["Customer", `${q.customer.name} <${q.customer.email}>`],
    ["Phone", q.customer.phone || "—"],
    ["Box style", q.summary.styleName],
    ["Box size (designed)", q.summary.dims],
    ...(r.dimensions ? ([["Requested dimensions", r.dimensions]] as [string, string][]) : []),
    ["Quantity", [r.quantity, ...r.extraQuantities].map((n) => n.toLocaleString("en-US")).join(" / ")],
    ["Material", q.summary.material],
    ["Printing", q.summary.printing],
    ["Printed sides", q.summary.interior ? "Exterior + interior" : "Exterior only"],
    ...(r.finishing ? ([["Finishing", r.finishing]] as [string, string][]) : []),
    ["Lamination", q.summary.lamination],
    ["Special finishes", q.summary.finishes.join(", ") || "None"],
  ];
  const files: [string, string][] = [
    ["Print-ready artwork (PNG)", q.files.printFile],
    ...(q.files.printInside ? ([["Interior print artwork (PNG)", q.files.printInside]] as [string, string][]) : []),
    ["Dieline (SVG)", q.files.dieline],
    ["Proof (JPG)", q.files.proof],
    ["Design data (JSON)", q.files.designJson],
    ...q.files.mockups.map((id, i) => [`3D mockup ${i + 1}`, id] as [string, string]),
    ...(q.files.masks ?? []).map((m) => [`Finish mask: ${m.finishId}`, m.assetId] as [string, string]),
    ...q.artwork.map((a) => [`Original upload: ${a.fileName}`, a.originalAssetId ?? a.assetId] as [string, string]),
  ];
  const adminUrl = base ? `${base}/admin#quote/${q.id}` : undefined;

  const text = [
    `New quote request ${q.reference}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(r.notes ? ["", "Customer notes:", r.notes] : []),
    "",
    "Files:",
    ...files.map(([k, id]) => `- ${k}: ${asset(id)}`),
    ...(adminUrl ? ["", `Open in admin: ${adminUrl}`] : []),
    "",
    "Reply to this email to answer the customer directly.",
  ].join("\n");

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">
<h2 style="margin:0 0 12px">New quote request ${esc(q.reference)}</h2>
<table cellpadding="4" style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="color:#6b7280;padding-right:16px">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join("")}</table>
${r.notes ? `<h3>Customer notes</h3><p style="white-space:pre-wrap">${esc(r.notes)}</p>` : ""}
<h3>Files</h3><ul>${files.map(([k, id]) => `<li><a href="${esc(asset(id))}">${esc(k)}</a></li>`).join("")}</ul>
${adminUrl ? `<p><a href="${esc(adminUrl)}">Open this quote in the admin panel</a></p>` : ""}
<p style="color:#6b7280">Reply to this email to answer the customer directly.</p></div>`;

  await transport.sendMail({
    from,
    to,
    replyTo: { name: line(q.customer.name), address: q.customer.email },
    subject: line(`Quote request ${q.reference} — ${q.summary.styleName}, ${r.quantity.toLocaleString("en-US")} pcs — ${q.customer.name}`),
    text,
    html,
  });
}
