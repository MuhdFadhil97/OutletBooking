'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  PAID_PLANS,
  PLAN_FEATURES,
  updatePlansSchema,
  type AdminPlanCatalog,
  type PaidPlan,
  type PlanFeatures,
  type UpdatePlansInput,
} from '@outletbooking/shared';
import { getPlanCatalog, savePlanCatalog } from '@/lib/admin-api';
import { s } from '@/strings/en';
import { useAdmin } from './AdminShell';

const t = s.admin;
const p = t.planEditor;

interface PlanForm {
  price: string;
  resources: string;
  extra: string;
  features: PlanFeatures;
  isPublic: boolean;
}
interface Form {
  plans: Record<PaidPlan, PlanForm>;
  trialDays: string;
  graceDays: string;
  reminders: string;
}
type State = { kind: 'loading' } | { kind: 'ok'; catalog: AdminPlanCatalog } | { kind: 'refused'; message: string } | { kind: 'error' };

/** Integer sen → "49" / "49.50" for the RM inputs. */
const senToRm = (sen: number) => (sen / 100).toFixed(sen % 100 ? 2 : 0);
/** "49" / "49.5" / "49.50" → sen; NaN when it is not an amount. */
const rmToSen = (text: string) => (/^\d+(\.\d{1,2})?$/.test(text.trim()) ? Math.round(Number(text.trim()) * 100) : NaN);
const wholeNumber = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

function toForm(c: AdminPlanCatalog): Form {
  const plans = Object.fromEntries(
    c.plans.map((plan) => [
      plan.code,
      {
        price: senToRm(plan.priceSen),
        resources: String(plan.resourceLimit),
        extra: senToRm(plan.extraResourceSen),
        features: { ...plan.features },
        isPublic: plan.isPublic,
      } satisfies PlanForm,
    ]),
  ) as Record<PaidPlan, PlanForm>;
  return {
    plans,
    trialDays: String(c.settings.trialDays),
    graceDays: String(c.settings.graceDays),
    reminders: c.settings.renewalReminderDays.join(', '),
  };
}

function toInput(form: Form, reason: string): UpdatePlansInput {
  return {
    plans: PAID_PLANS.map((code) => ({
      code,
      priceSen: rmToSen(form.plans[code].price),
      resourceLimit: wholeNumber(form.plans[code].resources),
      extraResourceSen: rmToSen(form.plans[code].extra),
      features: form.plans[code].features,
      isPublic: form.plans[code].isPublic,
    })),
    settings: {
      trialDays: wholeNumber(form.trialDays),
      graceDays: wholeNumber(form.graceDays),
      renewalReminderDays: form.reminders
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((n) => (/^\d+$/.test(n) ? Number(n) : NaN)),
    },
    reason: reason.trim(),
  };
}

/** Field key → message, from the shared schema (so the API and the form always agree). */
function validate(input: UpdatePlansInput): Record<string, string> {
  const parsed = updatePlansSchema.safeParse(input);
  if (parsed.success) return {};
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const [root, index, field] = issue.path;
    let key: string;
    let message: string = p.errors.resources;
    if (root === 'plans' && typeof index === 'number' && typeof field === 'string') {
      const code = input.plans[index]?.code ?? 'starter';
      key = `${code}.${field}`;
      message = field === 'priceSen' ? p.errors.price : field === 'extraResourceSen' ? p.errors.extra : p.errors.resources;
    } else if (root === 'plans') {
      key = 'plans';
      message = p.errors.public;
    } else if (root === 'settings') {
      key = `settings.${String(index)}`;
      message = index === 'trialDays' ? p.errors.trialDays : index === 'graceDays' ? p.errors.graceDays : p.errors.reminders;
    } else {
      key = 'reason';
      message = t.business.reason;
    }
    if (!out[key]) out[key] = key === 'reason' ? (issue.message ?? message) : message;
  }
  return out;
}

/** I12 · Plans & prices: price, limits and features per plan; trial length, grace days, reminders. Super admins only. */
export function PlansAdmin() {
  const { admin, signedOut } = useAdmin();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (admin.role !== 'super_admin') return;
    let live = true;
    void getPlanCatalog().then((r) => {
      if (!live) return;
      if (r.kind === 'ok') {
        setState({ kind: 'ok', catalog: r.data });
        setForm(toForm(r.data));
      } else if (r.kind === 'signed_out') signedOut();
      else if (r.kind === 'refused') setState({ kind: 'refused', message: r.message });
      else setState({ kind: 'error' });
    });
    return () => {
      live = false;
    };
  }, [admin.role, attempt, signedOut]);

  const dirty = useMemo(
    () => state.kind === 'ok' && form !== null && JSON.stringify(form) !== JSON.stringify(toForm(state.catalog)),
    [state, form],
  );

  if (admin.role !== 'super_admin') {
    return (
      <div className="admin-page">
        <h1>{p.title}</h1>
        <p className="card admin-empty muted">{p.superOnly}</p>
      </div>
    );
  }

  const setPlan = (code: PaidPlan, patch: Partial<PlanForm>) => {
    setSaved(null);
    setForm((f) => (f ? { ...f, plans: { ...f.plans, [code]: { ...f.plans[code], ...patch } } } : f));
  };
  const setField = (patch: Partial<Pick<Form, 'trialDays' | 'graceDays' | 'reminders'>>) => {
    setSaved(null);
    setForm((f) => (f ? { ...f, ...patch } : f));
  };

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!form || state.kind !== 'ok') return;
    const input = toInput(form, reason);
    const found = validate(input);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const r = await savePlanCatalog(input);
    setBusy(false);
    if (r.kind === 'ok') {
      setState({ kind: 'ok', catalog: r.data });
      setForm(toForm(r.data));
      setReason('');
      setSaved(p.saved);
    } else if (r.kind === 'signed_out') signedOut();
    else setFormError(r.kind === 'refused' ? r.message : p.saveError);
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>{p.title}</h1>
          <p className="muted">{p.subtitle}</p>
        </div>
      </div>

      {state.kind === 'loading' && <p className="muted">{t.loading}</p>}
      {state.kind === 'refused' && <p className="card admin-empty muted">{state.message || p.superOnly}</p>}
      {state.kind === 'error' && (
        <div className="card admin-card">
          <p className="alert alert-error" role="alert">
            {t.loadError}
          </p>
          <button type="button" className="btn2" onClick={() => setAttempt((n) => n + 1)}>
            {t.retry}
          </button>
        </div>
      )}

      {state.kind === 'ok' && form && (
        // method="post": a submit before JS loads must never put anything in the URL.
        <form method="post" onSubmit={submit} noValidate className="plans-form">
          {saved && (
            <p className="alert alert-ok" role="status">
              {saved}
            </p>
          )}
          <div className="plans-grid">
            {state.catalog.plans.map((plan) => {
              const f = form.plans[plan.code];
              return (
                <section key={plan.code} className="card admin-section plan-edit" aria-labelledby={`plan-${plan.code}`}>
                  <div className="plan-edit-head">
                    <h2 id={`plan-${plan.code}`}>{plan.name}</h2>
                    <label className="check">
                      <input type="checkbox" checked={f.isPublic} onChange={(e) => setPlan(plan.code, { isPublic: e.target.checked })} />
                      {p.shownOnWebsite}
                    </label>
                  </div>
                  <p className="muted small">{p.onPlan(state.catalog.businessesByPlan[plan.code])}</p>
                  <div className="plan-fields">
                    <NumberField
                      label={p.price}
                      value={f.price}
                      inputMode="decimal"
                      error={errors[`${plan.code}.priceSen`]}
                      onChange={(v) => setPlan(plan.code, { price: v })}
                    />
                    <NumberField
                      label={p.resources}
                      value={f.resources}
                      inputMode="numeric"
                      error={errors[`${plan.code}.resourceLimit`]}
                      onChange={(v) => setPlan(plan.code, { resources: v })}
                    />
                    <NumberField
                      label={p.extra}
                      value={f.extra}
                      inputMode="decimal"
                      error={errors[`${plan.code}.extraResourceSen`]}
                      onChange={(v) => setPlan(plan.code, { extra: v })}
                    />
                  </div>
                  <fieldset className="plan-features">
                    {PLAN_FEATURES.map((feature) => (
                      <label key={feature} className="check">
                        <input
                          type="checkbox"
                          checked={f.features[feature]}
                          onChange={(e) => setPlan(plan.code, { features: { ...f.features, [feature]: e.target.checked } })}
                        />
                        {p.features[feature]}
                      </label>
                    ))}
                  </fieldset>
                </section>
              );
            })}
          </div>
          {errors.plans && (
            <p className="field-error" role="alert">
              {errors.plans}
            </p>
          )}

          <section className="card admin-section" aria-labelledby="plan-trial">
            <h2 id="plan-trial">{p.trialTitle}</h2>
            <div className="plan-fields">
              <NumberField
                label={p.trialDays}
                value={form.trialDays}
                inputMode="numeric"
                hint={p.trialHint}
                error={errors['settings.trialDays']}
                onChange={(v) => setField({ trialDays: v })}
              />
              <NumberField
                label={p.graceDays}
                value={form.graceDays}
                inputMode="numeric"
                hint={`${p.graceHint} ${p.notActive}`}
                error={errors['settings.graceDays']}
                onChange={(v) => setField({ graceDays: v })}
              />
              <NumberField
                label={p.reminders}
                value={form.reminders}
                inputMode="text"
                hint={`${p.remindersHint} ${p.notActive}`}
                error={errors['settings.renewalReminderDays']}
                onChange={(v) => setField({ reminders: v })}
              />
            </div>
          </section>

          <section className="card admin-section">
            <label className="fld">
              <span className="lbl">{p.reason}</span>
              <textarea
                className="inp"
                rows={2}
                maxLength={500}
                value={reason}
                placeholder={p.reasonPlaceholder}
                onChange={(e) => setReason(e.target.value)}
                aria-invalid={errors.reason ? true : undefined}
              />
              {errors.reason && <span className="field-error">{errors.reason}</span>}
            </label>
            {formError && (
              <p className="alert alert-error" role="alert">
                {formError}
              </p>
            )}
            <div className="actions">
              <button type="submit" className="btn" disabled={busy || !dirty}>
                {busy ? p.saving : p.save}
              </button>
              {dirty && !busy && <span className="muted small">{p.unsaved}</span>}
            </div>
          </section>
        </form>
      )}

      <p className="card admin-note small">{p.footnote}</p>
    </div>
  );
}

function NumberField({
  label,
  value,
  inputMode,
  hint,
  error,
  onChange,
}: {
  label: string;
  value: string;
  inputMode: 'numeric' | 'decimal' | 'text';
  hint?: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="fld">
      <span className="lbl">{label}</span>
      <input
        className="inp"
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {hint && <span className="muted small">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
