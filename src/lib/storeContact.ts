/**
 * Precedence of a storefront's contact information.
 *
 * `architecture.md` § Contacto (R14/R15). Pure, gemelo of `lib/pricing.ts`:
 * no Prisma, no React. There are TWO separate questions and mixing them is
 * exactly the bug this module exists to prevent:
 *
 *   - What the shopper SEES and taps (header, footer, the closed notice,
 *     the order page): the brand wins if it has anything (R14).
 *   - Where an order actually TRAVELS by WhatsApp: always the branch
 *     (R15) — a pedido is fulfilled by one physical location, never by a
 *     brand, and changing that would touch the POS pull and
 *     `docs/sync-contract.md`.
 */

export type StoreContactSource = {
  brand: {
    contactPhone: string | null;
    contactWhatsapp: string | null;
    contactEmail: string | null;
  };
  branch: { phone: string | null; whatsapp: string | null; email: string | null };
};

export type PresentationContact = {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
};

/** What the shopper sees and can tap. The brand's own contact wins field by
 *  field when it has one; the synced branch value is the fallback (R14). */
export function presentationContact(source: StoreContactSource): PresentationContact {
  return {
    phone: source.brand.contactPhone ?? source.branch.phone,
    whatsapp: source.brand.contactWhatsapp ?? source.branch.whatsapp,
    email: source.brand.contactEmail ?? source.branch.email,
  };
}

/**
 * The number an order's WhatsApp link is built against — ALWAYS the branch,
 * never the brand (R15). Replaces the `whatsapp ?? phone` that used to be
 * duplicated at `quote.ts:115` and `read.ts:92`.
 */
export function routingWhatsappNumber(branch: {
  whatsapp: string | null;
  phone: string | null;
}): string | null {
  return branch.whatsapp ?? branch.phone;
}
