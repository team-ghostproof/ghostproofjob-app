# Stripe → automatic upgrades (and automatic downgrades)

## What was broken (and is now fixed)

The app always **read** entitlement correctly: `profiles/{uid}.tier` → every device →
`isPaid()` → paywall off. But **nothing ever wrote it** except a manual admin grant.

So, before this: **a customer paid through a Stripe link and kept the paywall.** And a
cancelled or failed subscription never went back to free, because nobody was ever
moved *off* free. Same on the employer side — paying $79/$149 left `plan:'free'` and
the 5-role cap in place.

`api/stripe-webhook.js` closes the loop, for both sides:

| Stripe event | What happens |
|---|---|
| `checkout.session.completed` | grant the tier/plan + `paidUntil` |
| `customer.subscription.updated` | roll `paidUntil` forward, or downgrade if canceled/unpaid |
| `customer.subscription.deleted` | **back to free** |
| `invoice.payment_failed` | **back to free** |

Plus a belt-and-braces guard in the app: if `paidUntil` has passed, the account reads
as **free** regardless of the cached tier — so a lapsed plan can never linger as paid
even if a webhook is ever missed.

---

## 1. Vercel environment variables

**Settings → Environment Variables**, then redeploy:

| Name | Where to get it |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → **Secret key** (`sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | from step 2 below (`whsec_…`) |
| `FIREBASE_SERVICE_ACCOUNT` | already set (same one the harvester/unsubscribe use) |

## 2. Create the webhook endpoint in Stripe

**Stripe → Developers → Webhooks → Add endpoint**

- **URL:** `https://ghostproofjob.com/api/stripe-webhook`
- **Events to send** (exactly these four):
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

Copy the **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` on Vercel.

> The signature check is what makes this endpoint safe to expose. Without it, anyone
> could POST a fake "you paid" event and grant themselves a tier. If the secret is
> wrong the endpoint returns 400 and grants nothing.

## 3. Turn ON "client reference ID" on all four payment links

This is the bit that tells us **who** paid. The app appends
`?client_reference_id=<uid>:<key>` to every checkout URL, but **Stripe payment links
ignore it unless the field is enabled on the link**.

For **each** of the four links → Stripe → **Payment links** → open the link → **⋯ →
Edit** → under *Options / Advanced*, enable **"Client reference ID"**:

| Link | key the app sends |
|---|---|
| Candidate Lifetime — $12 | `life` |
| Candidate Monthly — $0.99 | `month` |
| Recruiter Premium — $79/mo | `premium` |
| Recruiter Pro — $149/mo | `pro` |

If it's off, the payment still succeeds but the webhook can't tell who paid — it logs
`unusable client_reference_id` and grants nothing (deliberately: we never guess).

## 4. Test it before you trust it

Use Stripe **test mode** (test keys + a test webhook endpoint), then:

1. Sign in to the app as a throwaway account.
2. Click an upgrade button (it now refuses if you're signed out — the toast tells you why).
3. Pay with `4242 4242 4242 4242`, any future expiry, any CVC.
4. Within a second or two: **Stripe → Webhooks → your endpoint** should show a `200`,
   and the app should flip to unlimited (the tier propagates on next load/sign-in).
5. Then **cancel** the subscription in Stripe → the account should drop back to free.

`npm run test:billing` covers the grant/revoke logic itself (13 tests, in CI).

---

## Notes / limits

- **A signed-out user can't check out** for the candidate plans — we ask them to sign
  in first, otherwise there's no account to unlock. (Previously they could pay into
  the void.)
- **Lifetime never expires** — it stores no `paidUntil`.
- **Refunds** aren't wired (`charge.refunded` is ignored). If you refund someone,
  cancel their subscription too, or drop their tier from the admin panel.
- **Existing manual grants keep working** — an admin can still set a tier by hand, and
  that path is unchanged.
- **`stripe_customers/{customerId}`** maps a Stripe customer back to a uid on first
  payment, so later subscription events resolve with one doc read (D1-friendly).
