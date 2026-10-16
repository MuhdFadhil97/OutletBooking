'use client';

import { receiptDetailsSchema, type ReceiptDetailsInput } from '@outletbooking/shared';
import { s } from '@/strings/en';

const p = s.billing.pay;

export interface DetailsForm {
  companyName: string;
  ssmNo: string;
  tin: string;
  address: string;
  receiptEmail: string;
}

export const toForm = (d: { companyName: string; ssmNo: string | null; tin: string | null; address: string | null; receiptEmail: string }): DetailsForm => ({
  companyName: d.companyName,
  ssmNo: d.ssmNo ?? '',
  tin: d.tin ?? '',
  address: d.address ?? '',
  receiptEmail: d.receiptEmail,
});

export const toInput = (f: DetailsForm): ReceiptDetailsInput => ({
  companyName: f.companyName,
  ssmNo: f.ssmNo,
  tin: f.tin,
  address: f.address,
  receiptEmail: f.receiptEmail,
});

export type DetailsErrors = Partial<Record<keyof DetailsForm, string>>;

/** Field errors from the same schema the API uses. Empty object = valid. */
export function checkDetails(f: DetailsForm): DetailsErrors {
  const parsed = receiptDetailsSchema.safeParse(toInput(f));
  if (parsed.success) return {};
  const out: DetailsErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof DetailsForm | undefined;
    if (!key || out[key]) continue;
    out[key] = key === 'companyName' ? p.errors.companyName : key === 'receiptEmail' ? p.errors.receiptEmail : issue.message;
  }
  return out;
}

/** The receipt details fields (I4 and I17). */
export function DetailsFields({
  value,
  errors,
  onChange,
}: {
  value: DetailsForm;
  errors: DetailsErrors;
  onChange: (next: DetailsForm) => void;
}) {
  const field = (key: keyof DetailsForm, label: string, opts: { optional?: boolean; type?: string; wide?: boolean; autoComplete?: string } = {}) => (
    <label className={`fld${opts.wide ? ' fld-wide' : ''}`}>
      <span className="lbl">
        {label} {opts.optional && <span className="muted">{p.optional}</span>}
      </span>
      <input
        className="inp"
        type={opts.type ?? 'text'}
        name={key}
        autoComplete={opts.autoComplete ?? 'off'}
        value={value[key]}
        aria-invalid={errors[key] ? true : undefined}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
      {errors[key] && <span className="field-error">{errors[key]}</span>}
    </label>
  );
  return (
    <div className="details-grid">
      {field('companyName', p.companyName, { wide: true, autoComplete: 'organization' })}
      {field('ssmNo', p.ssm, { optional: true })}
      {field('receiptEmail', p.receiptEmail, { type: 'email', autoComplete: 'email' })}
      {field('tin', p.tin, { optional: true })}
      {field('address', p.address, { optional: true, wide: true, autoComplete: 'street-address' })}
    </div>
  );
}
