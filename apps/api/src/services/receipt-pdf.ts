import PDFDocument from 'pdfkit';
import { formatInTimeZone } from 'date-fns-tz';
import { LEGAL_COMPANY, SUPPORT_WHATSAPP } from '@outletbooking/shared';
import { rmText } from './billing-emails';

export interface ReceiptPdfInput {
  receiptNo: string;
  paidAt: Date;
  companyName: string;
  ssmNo: string | null;
  tin: string | null;
  address: string | null;
  description: string;
  amountSen: number;
  /** "FPX" / "DuitNow QR" … */
  method: string;
  /** ToyyibPay reference. */
  transactionRef: string | null;
}

const PRIMARY = '#0F7B55';
const TEXT = '#16211C';
const MUTED = '#56625B';
const LINE = '#E1E6E2';

/**
 * Plan payment receipt as a PDF (I15 "Download receipt", I17 history, M4 attachment).
 * Plain built-in fonts, one A4 page. It is a receipt, not an LHDN e-Invoice (the TIN is only kept for that later).
 */
export function renderReceiptPdf(r: ReceiptPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: `Receipt ${r.receiptNo}`, Author: LEGAL_COMPANY, Subject: 'OutletBooking plan payment' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const date = (d: Date, fmt: string) => formatInTimeZone(d, 'Asia/Kuala_Lumpur', fmt);

    doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(20).text('OutletBooking', left, 50);
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(LEGAL_COMPANY, left, 76);

    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(22).text('Receipt', left, 50, { width, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    doc.text(`Receipt no. ${r.receiptNo}`, left, 80, { width, align: 'right' });
    doc.text(`Date: ${date(r.paidAt, 'd MMM yyyy, h:mm a')}`, left, 95, { width, align: 'right' });

    doc.moveTo(left, 125).lineTo(right, 125).strokeColor(LINE).stroke();

    // Billed to
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text('BILLED TO', left, 145);
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(12).text(r.companyName, left, 160, { width: width / 2 });
    doc.font('Helvetica').fontSize(10).fillColor(TEXT);
    const lines = [r.ssmNo ? `SSM no.: ${r.ssmNo}` : null, r.tin ? `TIN: ${r.tin}` : null, r.address].filter((l): l is string => !!l);
    for (const line of lines) doc.text(line, { width: width / 2 });

    // Items
    const tableTop = Math.max(doc.y + 30, 230);
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9);
    doc.text('DESCRIPTION', left, tableTop);
    doc.text('AMOUNT', left, tableTop, { width, align: 'right' });
    doc.moveTo(left, tableTop + 16).lineTo(right, tableTop + 16).strokeColor(LINE).stroke();

    doc.fillColor(TEXT).font('Helvetica').fontSize(11);
    doc.text(r.description, left, tableTop + 28, { width: width - 120 });
    doc.text(rmText(r.amountSen), left, tableTop + 28, { width, align: 'right' });

    const afterItem = Math.max(doc.y, tableTop + 48) + 14;
    doc.moveTo(left, afterItem).lineTo(right, afterItem).strokeColor(LINE).stroke();
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text('Total paid', left, afterItem + 12);
    doc.text(rmText(r.amountSen), left, afterItem + 12, { width, align: 'right' });

    // Payment
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    doc.text(`Paid by ${r.method} through ToyyibPay${r.transactionRef ? ` · ref ${r.transactionRef}` : ''}`, left, afterItem + 50);

    doc.fontSize(9).fillColor(MUTED);
    doc.text(
      `This is a computer-generated receipt from ${LEGAL_COMPANY} for payment of an OutletBooking plan; no signature is needed. ` +
        `Questions about a charge? WhatsApp ${SUPPORT_WHATSAPP}.`,
      left,
      doc.page.height - 100,
      { width, align: 'left' },
    );
    doc.end();
  });
}
