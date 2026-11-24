import { Resend } from 'resend';
import {
  computeNights,
  db,
  getEmailProviderSecrets,
  getEmailTemplates,
  getSettings,
  getStayById,
  type EmailLogRow,
  type EmailTemplateRow,
  type FolioChargeRow,
  type HotelSettings,
  type StayWithDetails,
} from './db.ts';
import type { TaxBreakdownItem } from './tax.ts';

function escapeHtml(input: string): string {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function isSafeLogoUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (/^https?:\/\/[^\s<>"{}|\\^`[\]]+$/i.test(trimmed)) return true;
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed) && trimmed.length <= 750_000) {
    return true;
  }
  return false;
}

interface InlineLogoAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  contentId: string;
}

function extractInlineLogoAttachment(url: string): InlineLogoAttachment | null {
  const trimmed = url.trim();
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(trimmed);
  if (!match || trimmed.length > 750_000) return null;
  const rawSubtype = match[1].toLowerCase();
  const mimeSubtype = rawSubtype === 'jpg' ? 'jpeg' : rawSubtype;
  const ext = rawSubtype === 'jpeg' ? 'jpg' : rawSubtype;
  return {
    filename: `hotel-logo.${ext}`,
    content: Buffer.from(match[2], 'base64'),
    contentType: `image/${mimeSubtype}`,
    contentId: 'hotel-logo',
  };
}

function interpolateTokens(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => tokens[key] ?? '');
}

export function isEmailServiceEnabled(): boolean {
  return getSettings().email_enabled === 1;
}

export function isResendConfigured(): boolean {
  const secrets = getEmailProviderSecrets();
  return secrets.apiKey.length > 0;
}

function getResendClient(): Resend | null {
  const secrets = getEmailProviderSecrets();
  if (!secrets.apiKey) return null;
  return new Resend(secrets.apiKey);
}

function getFromEmail(): string {
  const secrets = getEmailProviderSecrets();
  if (secrets.fromEmail) return secrets.fromEmail;
  const settings = getSettings();
  return `${settings.hotel_name} <onboarding@resend.dev>`;
}

function parseTaxBreakdown(jsonStr: string | undefined): TaxBreakdownItem[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => item && typeof item.name === 'string' && Number(item.amount) > 0);
    }
  } catch {
    // ignore malformed json
  }
  return [];
}

function buildBoardingPassHtml(
  settings: HotelSettings,
  stay: StayWithDetails,
  nights: number,
  taxBreakdown: TaxBreakdownItem[]
): string {
  const currency = settings.currency_symbol;
  const roomNumberLabel = stay.room_id ? `Room ${stay.room_number}` : 'Assigned at Desk';
  const depositPaid = stay.total_paid;
  const balanceRemaining = Math.max(0, stay.balance_due);

  const taxLinesHtml =
    taxBreakdown.length > 0
      ? taxBreakdown
          .map(
            (t) => `
          <tr>
            <td style="padding:4px 0;font-size:12px;color:#6E6E73;">${escapeHtml(t.name)} (${t.rate}%${t.mode === 'inclusive' ? ' incl.' : ''})</td>
            <td style="padding:4px 0;font-size:12px;text-align:right;font-family:monospace;color:#1D1D1F;">${escapeHtml(currency)}${Number(t.amount).toFixed(2)}</td>
          </tr>`
          )
          .join('')
      : stay.tax_amount > 0
        ? `<tr>
            <td style="padding:4px 0;font-size:12px;color:#6E6E73;">${escapeHtml(stay.tax_label || settings.tax_name || 'Tax')}</td>
            <td style="padding:4px 0;font-size:12px;text-align:right;font-family:monospace;color:#1D1D1F;">${escapeHtml(currency)}${stay.tax_amount.toFixed(2)}</td>
          </tr>`
        : '';

  return `
    <!-- Boarding Pass Style Reservation Details Card -->
    <div style="margin:24px 0;border:1px solid #D2D2D7;border-radius:16px;overflow:hidden;background:#FFFFFF;">
      <!-- Subtle Card Top Row -->
      <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #E5E5E7;background:#FFFFFF;">
        <tr>
          <td style="padding:12px 20px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6E6E73;">
            RESERVATION DETAILS
          </td>
          <td style="padding:12px 20px;text-align:right;font-family:monospace;font-size:13px;font-weight:700;color:#1D1D1F;">
            ${escapeHtml(stay.confirmation_code)}
          </td>
        </tr>
      </table>

      <!-- Main Check-In -> Check-Out Flight-Style Route -->
      <div style="padding:20px 20px 18px 20px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="width:40%;vertical-align:top;">
              <div style="font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6E6E73;">CHECK-IN</div>
              <div style="margin-top:4px;font-family:monospace;font-size:20px;font-weight:700;color:#1D1D1F;">${escapeHtml(stay.check_in_date)}</div>
              <div style="margin-top:2px;font-size:12px;color:#6E6E73;">From ${escapeHtml(settings.check_in_time || '15:00')}</div>
            </td>
            <td style="width:20%;text-align:center;vertical-align:middle;">
              <div style="font-family:monospace;font-size:11px;font-weight:600;color:#1D1D1F;border:1px solid #6AD4B0;border-radius:8px;padding:4px 8px;display:inline-block;">
                ${nights} ${nights === 1 ? 'NIGHT' : 'NIGHTS'}
              </div>
              <div style="margin-top:4px;font-size:12px;color:#6AD4B0;font-weight:700;">&#8594;</div>
            </td>
            <td style="width:40%;text-align:right;vertical-align:top;">
              <div style="font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6E6E73;">CHECK-OUT</div>
              <div style="margin-top:4px;font-family:monospace;font-size:20px;font-weight:700;color:#1D1D1F;">${escapeHtml(stay.check_out_date)}</div>
              <div style="margin-top:2px;font-size:12px;color:#6E6E73;">By ${escapeHtml(settings.check_out_time || '11:00')}</div>
            </td>
          </tr>
        </table>

        <!-- Passenger & Room Grid -->
        <table style="width:100%;border-collapse:collapse;margin-top:18px;border-top:1px solid #E5E5E7;">
          <tr>
            <td style="padding:12px 8px 0 0;width:50%;vertical-align:top;">
              <div style="font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#6E6E73;">GUEST</div>
              <div style="margin-top:3px;font-size:14px;font-weight:600;color:#1D1D1F;">${escapeHtml(stay.guest_name)}</div>
            </td>
            <td style="padding:12px 0 0 8px;width:50%;vertical-align:top;">
              <div style="font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#6E6E73;">ROOM / CATEGORY</div>
              <div style="margin-top:3px;font-size:14px;font-weight:600;color:#1D1D1F;">${escapeHtml(roomNumberLabel)} &middot; ${escapeHtml(stay.room_type)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 8px 0 0;width:50%;vertical-align:top;">
              <div style="font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#6E6E73;">OCCUPANCY</div>
              <div style="margin-top:3px;font-size:13px;color:#1D1D1F;">${stay.adults} ${stay.adults === 1 ? 'Adult' : 'Adults'}</div>
            </td>
            <td style="padding:12px 0 0 8px;width:50%;vertical-align:top;">
              <div style="font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#6E6E73;">NIGHTLY RATE</div>
              <div style="margin-top:3px;font-family:monospace;font-size:13px;color:#1D1D1F;">${escapeHtml(currency)}${stay.nightly_rate.toFixed(2)} / night</div>
            </td>
          </tr>
        </table>
      </div>

      <!-- Perforated Boarding Pass Tear Line -->
      <div style="border-top:2px dashed #D2D2D7;margin:0 14px;"></div>

      <!-- Payment & Balance Stub -->
      <div style="padding:18px 20px 20px 20px;background:#FFFFFF;">
        <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
          <tr>
            <td style="padding:4px 0;font-size:12px;color:#6E6E73;">Accommodation Subtotal (${nights} ${nights === 1 ? 'night' : 'nights'})</td>
            <td style="padding:4px 0;font-size:12px;text-align:right;font-family:monospace;color:#1D1D1F;">${escapeHtml(currency)}${stay.charges_subtotal.toFixed(2)}</td>
          </tr>
          ${taxLinesHtml}
          <tr>
            <td style="padding:6px 0 0 0;border-top:1px solid #E5E5E7;font-size:13px;font-weight:600;color:#1D1D1F;">Total Reservation Amount</td>
            <td style="padding:6px 0 0 0;border-top:1px solid #E5E5E7;font-size:13px;font-weight:600;text-align:right;font-family:monospace;color:#1D1D1F;">${escapeHtml(currency)}${stay.total_billed.toFixed(2)}</td>
          </tr>
        </table>

        <!-- Highlighted Deposit Paid & Balance Remaining Stub -->
        <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px;">
          <tr>
            <td style="width:50%;padding:12px 14px;border:1px solid #E5E5E7;border-radius:12px;vertical-align:top;">
              <div style="font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#6E6E73;">DEPOSIT PAID</div>
              <div style="margin-top:4px;font-family:monospace;font-size:18px;font-weight:700;color:#1D1D1F;">${escapeHtml(currency)}${depositPaid.toFixed(2)}</div>
            </td>
            <td style="width:50%;padding:12px 14px;border:1.5px solid #6AD4B0;border-radius:12px;vertical-align:top;">
              <div style="font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#6E6E73;">BALANCE REMAINING</div>
              <div style="margin-top:4px;font-family:monospace;font-size:18px;font-weight:700;color:#1D1D1F;">${escapeHtml(currency)}${balanceRemaining.toFixed(2)}</div>
            </td>
          </tr>
        </table>

        <!-- Minimal Barcode Stub Footer -->
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid #E5E5E7;font-size:11px;color:#6E6E73;text-align:center;">
          Present confirmation <strong style="font-family:monospace;color:#1D1D1F;">${escapeHtml(stay.confirmation_code)}</strong> with a valid photo ID at Front Desk
        </div>
      </div>
    </div>`;
}

export function renderHotelEmail(
  settings: HotelSettings,
  template: EmailTemplateRow,
  stay: StayWithDetails,
  charges: FolioChargeRow[]
): { subject: string; text: string; html: string; inlineLogo: InlineLogoAttachment | null } {
  const currency = settings.currency_symbol;
  const nights = computeNights(stay.check_in_date, stay.check_out_date);
  const roomDisplay = stay.room_id
    ? `Room ${stay.room_number} · ${stay.room_type}`
    : `${stay.room_type} (Room assigned at check-in)`;

  const balanceRemaining = Math.max(0, stay.balance_due);
  const tokens: Record<string, string> = {
    guest_name: stay.guest_name,
    hotel_name: settings.hotel_name,
    hotel_phone: settings.hotel_phone,
    hotel_email: settings.hotel_email,
    hotel_address: settings.hotel_address,
    hotel_website: settings.hotel_website,
    check_in_time: settings.check_in_time || '15:00',
    check_out_time: settings.check_out_time || '11:00',
    tax_id: settings.tax_id || '',
    room_number: stay.room_id ? stay.room_number : 'To be assigned',
    room_type: stay.room_type,
    confirmation_code: stay.confirmation_code,
    check_in_date: stay.check_in_date,
    check_out_date: stay.check_out_date,
    nights: String(nights),
    total_amount: `${currency}${stay.total_billed.toFixed(2)}`,
    deposit_paid: `${currency}${stay.total_paid.toFixed(2)}`,
    balance_remaining: `${currency}${balanceRemaining.toFixed(2)}`,
    balance_due: `${currency}${stay.balance_due.toFixed(2)}`,
  };

  const subject = interpolateTokens(template.subject, tokens);
  const headline = interpolateTokens(template.headline, tokens);
  const intro = interpolateTokens(template.intro_text, tokens);
  const body = interpolateTokens(template.body_text, tokens);
  const closing = interpolateTokens(template.closing_text, tokens);

  const stayTaxBreakdown = parseTaxBreakdown(stay.tax_breakdown_json);

  const chargeLinesText = charges
    .map((c) => `  - ${c.description}: ${currency}${c.total_amount.toFixed(2)}`)
    .join('\n');

  const textParts = [
    settings.hotel_name,
    settings.hotel_tagline ? settings.hotel_tagline : '',
    '',
    headline,
    '',
    intro,
    body ? `\n${body}` : '',
  ];

  if (template.show_stay_details) {
    if (template.event_type === 'reservation') {
      textParts.push(
        '',
        '=== RESERVATION BOARDING PASS ===',
        `Confirmation: ${stay.confirmation_code}`,
        `Guest: ${stay.guest_name}`,
        `Room: ${roomDisplay}`,
        `Check-In: ${stay.check_in_date} (From ${settings.check_in_time || '15:00'})`,
        `Check-Out: ${stay.check_out_date} (By ${settings.check_out_time || '11:00'}) · ${nights} ${nights === 1 ? 'night' : 'nights'}`,
        `Subtotal: ${currency}${stay.charges_subtotal.toFixed(2)}`,
        ...(stay.tax_amount > 0
          ? [`Tax (${stay.tax_label || settings.tax_name || 'Tax'}): ${currency}${stay.tax_amount.toFixed(2)}`]
          : []),
        `Total Stay Amount: ${currency}${stay.total_billed.toFixed(2)}`,
        `Deposit Paid: ${currency}${stay.total_paid.toFixed(2)}`,
        `Balance Remaining: ${currency}${balanceRemaining.toFixed(2)}`,
        '================================='
      );
    } else {
      textParts.push(
        '',
        `Confirmation Code: ${stay.confirmation_code}`,
        `Guest: ${stay.guest_name}`,
        `Room: ${roomDisplay}`,
        `Check-In: ${stay.check_in_date} (${settings.check_in_time})`,
        `Check-Out: ${stay.check_out_date} (${settings.check_out_time})`,
        `Nightly Rate: ${currency}${stay.nightly_rate.toFixed(2)}`
      );
    }
  }

  if (template.show_folio_summary && template.event_type !== 'reservation') {
    textParts.push(
      '',
      charges.length > 0 ? `Folio Statement:\n${chargeLinesText}` : 'Quoted Stay Summary:',
      `Subtotal: ${currency}${stay.charges_subtotal.toFixed(2)}`,
      ...(stay.tax_amount > 0
        ? [`${stay.tax_label || settings.tax_name || 'Tax'}: ${currency}${stay.tax_amount.toFixed(2)}`]
        : []),
      `Total Billed: ${currency}${stay.total_billed.toFixed(2)}`,
      `Total Paid: ${currency}${stay.total_paid.toFixed(2)}`,
      `Balance Due: ${currency}${stay.balance_due.toFixed(2)}`
    );
  }

  if (closing) {
    textParts.push('', closing);
  }

  if (template.show_contact_footer) {
    textParts.push(
      '',
      [
        settings.hotel_address,
        settings.hotel_phone,
        settings.hotel_email,
        settings.hotel_website,
        settings.tax_id ? `Tax ID: ${settings.tax_id}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    );
  }

  textParts.push('', 'Powered by Hosila');

  const inlineLogo =
    template.show_logo && settings.hotel_logo_url
      ? extractInlineLogoAttachment(settings.hotel_logo_url)
      : null;

  const logoSrc = inlineLogo
    ? `cid:${inlineLogo.contentId}`
    : settings.hotel_logo_url;

  const logoBlockHtml =
    template.show_logo && settings.hotel_logo_url && isSafeLogoUrl(settings.hotel_logo_url)
      ? `<div style="margin-bottom:20px;"><img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(settings.hotel_name)}" style="max-height:48px;max-width:180px;object-fit:contain;display:block;" /></div>`
      : '';

  const stayDetailsHtml = template.show_stay_details
    ? template.event_type === 'reservation'
      ? buildBoardingPassHtml(settings, stay, nights, stayTaxBreakdown)
      : `<table style="width:100%;border-collapse:collapse;margin:24px 0;">
          <tr>
            <td style="padding:10px 0;border-top:1px solid #E5E5E7;font-size:13px;color:#6E6E73;">Confirmation</td>
            <td style="padding:10px 0;border-top:1px solid #E5E5E7;font-size:14px;text-align:right;font-family:monospace;color:#1D1D1F;">${escapeHtml(stay.confirmation_code)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-top:1px solid #E5E5E7;font-size:13px;color:#6E6E73;">Room</td>
            <td style="padding:10px 0;border-top:1px solid #E5E5E7;font-size:14px;text-align:right;color:#1D1D1F;">${escapeHtml(roomDisplay)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-top:1px solid #E5E5E7;font-size:13px;color:#6E6E73;">Stay Dates</td>
            <td style="padding:10px 0;border-top:1px solid #E5E5E7;font-size:14px;text-align:right;font-family:monospace;color:#1D1D1F;">${escapeHtml(stay.check_in_date)} (${escapeHtml(settings.check_in_time)}) to ${escapeHtml(stay.check_out_date)} (${escapeHtml(settings.check_out_time)})</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-top:1px solid #E5E5E7;border-bottom:1px solid #E5E5E7;font-size:13px;color:#6E6E73;">Nightly Rate</td>
            <td style="padding:10px 0;border-top:1px solid #E5E5E7;border-bottom:1px solid #E5E5E7;font-size:14px;text-align:right;font-family:monospace;color:#1D1D1F;">${escapeHtml(currency)}${stay.nightly_rate.toFixed(2)}</td>
          </tr>
        </table>`
    : '';

  const chargeRowsHtml = charges
    .map(
      (c) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #E5E5E7;color:#1D1D1F;font-size:13px;">${escapeHtml(c.description)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #E5E5E7;color:#1D1D1F;font-size:13px;text-align:right;font-family:monospace;">${escapeHtml(currency)}${c.total_amount.toFixed(2)}</td>
      </tr>`
    )
    .join('');

  const taxRowHtml =
    stay.tax_amount > 0
      ? `<tr><td style="padding:4px 0;font-size:13px;color:#6E6E73;">${escapeHtml(stay.tax_label || settings.tax_name || 'Tax')}</td><td style="padding:4px 0;font-size:13px;text-align:right;font-family:monospace;color:#1D1D1F;">${escapeHtml(currency)}${stay.tax_amount.toFixed(2)}</td></tr>`
      : '';

  const folioSummaryHtml =
    template.show_folio_summary && template.event_type !== 'reservation'
      ? `<div style="margin:24px 0;">
          <h2 style="margin:0 0 10px 0;font-size:14px;font-weight:600;color:#1D1D1F;">Folio Summary</h2>
          ${
            charges.length > 0
              ? `<table style="width:100%;border-collapse:collapse;margin-bottom:14px;">${chargeRowsHtml}</table>`
              : ''
          }
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:4px 0;font-size:13px;color:#6E6E73;">Subtotal (Net)</td><td style="padding:4px 0;font-size:13px;text-align:right;font-family:monospace;color:#1D1D1F;">${escapeHtml(currency)}${stay.charges_subtotal.toFixed(2)}</td></tr>
            ${taxRowHtml}
            <tr><td style="padding:4px 0;font-size:13px;color:#1D1D1F;font-weight:500;">Total Billed</td><td style="padding:4px 0;font-size:13px;text-align:right;font-family:monospace;color:#1D1D1F;font-weight:500;">${escapeHtml(currency)}${stay.total_billed.toFixed(2)}</td></tr>
            <tr><td style="padding:4px 0;font-size:13px;color:#6E6E73;">Total Paid</td><td style="padding:4px 0;font-size:13px;text-align:right;font-family:monospace;color:#1D1D1F;">${escapeHtml(currency)}${stay.total_paid.toFixed(2)}</td></tr>
            <tr><td style="padding:10px 0 0 0;border-top:2px solid #6AD4B0;font-size:14px;font-weight:600;color:#1D1D1F;">Balance Due</td><td style="padding:10px 0 0 0;border-top:2px solid #6AD4B0;font-size:15px;font-weight:600;text-align:right;font-family:monospace;color:#1D1D1F;">${escapeHtml(currency)}${stay.balance_due.toFixed(2)}</td></tr>
          </table>
        </div>`
      : '';

  const contactFooterHtml = template.show_contact_footer
    ? `<p style="margin:24px 0 8px 0;padding-top:18px;border-top:1px solid #E5E5E7;font-size:12px;line-height:1.6;color:#6E6E73;">
        ${escapeHtml(settings.hotel_name)}${settings.tax_id ? ` · Tax ID: ${escapeHtml(settings.tax_id)}` : ''}<br/>
        ${escapeHtml([settings.hotel_address, settings.hotel_phone].filter(Boolean).join(' · '))}
        ${settings.hotel_email || settings.hotel_website ? `<br/>${escapeHtml([settings.hotel_email, settings.hotel_website].filter(Boolean).join(' · '))}` : ''}
      </p>`
    : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#FFFFFF;color:#1D1D1F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:580px;margin:0 auto;padding:36px 32px;background:#FFFFFF;border:1px solid #E5E5E7;border-top:4px solid #6AD4B0;border-radius:16px;">
      ${logoBlockHtml}
      <p style="margin:0 0 6px 0;font-size:13px;font-weight:600;color:#1D1D1F;">${escapeHtml(settings.hotel_name)}</p>
      ${settings.hotel_tagline ? `<p style="margin:0 0 18px 0;font-size:12px;color:#6E6E73;">${escapeHtml(settings.hotel_tagline)}</p>` : ''}
      <h1 style="margin:0 0 14px 0;font-size:24px;font-weight:600;line-height:1.25;letter-spacing:-0.02em;color:#1D1D1F;">${escapeHtml(headline)}</h1>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#1D1D1F;">${escapeHtml(intro)}</p>
      ${body ? `<p style="margin:0 0 18px 0;font-size:14px;line-height:1.65;color:#1D1D1F;white-space:pre-line;">${escapeHtml(body)}</p>` : ''}
      ${stayDetailsHtml}
      ${folioSummaryHtml}
      ${closing ? `<p style="margin:20px 0 0 0;font-size:14px;line-height:1.6;color:#1D1D1F;">${escapeHtml(closing)}</p>` : ''}
      ${contactFooterHtml}
      <p style="margin:14px 0 0 0;font-size:11px;color:#6E6E73;">Powered by Hosila</p>
    </div>
  </body>
</html>`;

  return {
    subject,
    text: textParts.filter((p) => p !== undefined).join('\n'),
    html,
    inlineLogo,
  };
}

export async function dispatchStayEmail(
  stayId: number,
  eventType: 'reservation' | 'checkin' | 'checkout' | 'manual',
  forceSend = false
): Promise<EmailLogRow | null> {
  // Always check master Email Service availability first before any email operation
  const settings = getSettings();
  if (!settings.email_enabled) {
    return null;
  }

  const stay = getStayById(stayId);
  if (!stay) return null;

  if (!forceSend) {
    if (eventType === 'reservation' && !settings.email_on_reservation) return null;
    if (eventType === 'checkin' && !settings.email_on_checkin) return null;
    if (eventType === 'checkout' && !settings.email_on_checkout) return null;
  }

  const recipientEmail = stay.guest_email.trim();
  if (!recipientEmail || !recipientEmail.includes('@')) {
    return null;
  }

  const charges = db
    .prepare('SELECT * FROM folio_charges WHERE stay_id = ? AND voided = 0 ORDER BY posted_at ASC')
    .all(stayId) as FolioChargeRow[];

  const templates = getEmailTemplates();
  const lookupKey = eventType === 'manual' ? 'checkout' : eventType;
  const template =
    templates.find((t) => t.event_type === lookupKey) ??
    templates[0] ?? {
      event_type: 'checkout',
      subject: 'Guest Statement · {{confirmation_code}} — {{hotel_name}}',
      headline: 'Guest Folio Statement',
      intro_text: 'Dear {{guest_name}}, here is your stay summary for {{hotel_name}}.',
      body_text: '',
      closing_text: 'Thank you for choosing {{hotel_name}}.',
      show_logo: 1,
      show_stay_details: 1,
      show_folio_summary: 1,
      show_contact_footer: 1,
    };

  const rendered = renderHotelEmail(settings, template, stay, charges);
  const nowIso = new Date().toISOString();
  const client = getResendClient();

  if (!client) {
    const info = db
      .prepare(
        `INSERT INTO email_logs (stay_id, event_type, recipient_email, recipient_name, subject, body_text, body_html, status, provider_id, error_message, created_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', '', 'Resend API key not configured (saved to local outbox)', ?, NULL)`
      )
      .run(stayId, eventType, recipientEmail, stay.guest_name, rendered.subject, rendered.text, rendered.html, nowIso);
    return db.prepare('SELECT * FROM email_logs WHERE id = ?').get(Number(info.lastInsertRowid)) as EmailLogRow;
  }

  try {
    const response = await client.emails.send({
      from: getFromEmail(),
      to: [recipientEmail],
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      ...(rendered.inlineLogo ? { attachments: [rendered.inlineLogo] } : {}),
    });

    if (response.error) {
      const info = db
        .prepare(
          `INSERT INTO email_logs (stay_id, event_type, recipient_email, recipient_name, subject, body_text, body_html, status, provider_id, error_message, created_at, sent_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', '', ?, ?, NULL)`
        )
        .run(
          stayId,
          eventType,
          recipientEmail,
          stay.guest_name,
          rendered.subject,
          rendered.text,
          rendered.html,
          response.error.message,
          nowIso
        );
      return db.prepare('SELECT * FROM email_logs WHERE id = ?').get(Number(info.lastInsertRowid)) as EmailLogRow;
    }

    const info = db
      .prepare(
        `INSERT INTO email_logs (stay_id, event_type, recipient_email, recipient_name, subject, body_text, body_html, status, provider_id, error_message, created_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?, '', ?, ?)`
      )
      .run(
        stayId,
        eventType,
        recipientEmail,
        stay.guest_name,
        rendered.subject,
        rendered.text,
        rendered.html,
        response.data?.id ?? '',
        nowIso,
        nowIso
      );
    return db.prepare('SELECT * FROM email_logs WHERE id = ?').get(Number(info.lastInsertRowid)) as EmailLogRow;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network unreachable (offline)';
    const info = db
      .prepare(
        `INSERT INTO email_logs (stay_id, event_type, recipient_email, recipient_name, subject, body_text, body_html, status, provider_id, error_message, created_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', '', ?, ?, NULL)`
      )
      .run(
        stayId,
        eventType,
        recipientEmail,
        stay.guest_name,
        rendered.subject,
        rendered.text,
        rendered.html,
        `Offline or network error: ${message}`,
        nowIso
      );
    return db.prepare('SELECT * FROM email_logs WHERE id = ?').get(Number(info.lastInsertRowid)) as EmailLogRow;
  }
}

export async function retryQueuedEmails(): Promise<{ attempted: number; sent: number; failed: number; disabled?: boolean }> {
  // Always check master Email Service availability first
  if (!isEmailServiceEnabled()) {
    return { attempted: 0, sent: 0, failed: 0, disabled: true };
  }

  const client = getResendClient();
  const pending = db
    .prepare("SELECT * FROM email_logs WHERE status IN ('queued', 'failed') ORDER BY created_at ASC LIMIT 25")
    .all() as EmailLogRow[];

  if (!client) {
    return { attempted: 0, sent: 0, failed: pending.length };
  }

  let sent = 0;
  let failed = 0;

  const currentInlineLogo = extractInlineLogoAttachment(getSettings().hotel_logo_url || '');

  for (const item of pending) {
    try {
      const needsCidLogo = Boolean(item.body_html && item.body_html.includes('cid:hotel-logo') && currentInlineLogo);
      const response = await client.emails.send({
        from: getFromEmail(),
        to: [item.recipient_email],
        subject: item.subject,
        text: item.body_text,
        ...(item.body_html ? { html: item.body_html } : {}),
        ...(needsCidLogo && currentInlineLogo ? { attachments: [currentInlineLogo] } : {}),
      });

      if (response.error) {
        failed += 1;
        db.prepare("UPDATE email_logs SET status = 'failed', error_message = ? WHERE id = ?").run(
          response.error.message,
          item.id
        );
      } else {
        sent += 1;
        db.prepare("UPDATE email_logs SET status = 'sent', provider_id = ?, error_message = '', sent_at = ? WHERE id = ?").run(
          response.data?.id ?? '',
          new Date().toISOString(),
          item.id
        );
      }
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : 'Network unavailable';
      db.prepare("UPDATE email_logs SET status = 'queued', error_message = ? WHERE id = ?").run(message, item.id);
    }
  }

  return { attempted: pending.length, sent, failed };
}
