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
| `charge.refunded` (full) | **back to free** — the only revoke signal for a **lifetime** pass |
| `charge.dispute.created` | **back to free** (chargeback) |

A **partial** refund is deliberately ignored — they still paid.

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
- **Events to send** (exactly these six):
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `charge.refunded`
  - `charge.dispute.created`

Copy the **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` on Vercel.

> The signature check is what makes this endpoint safe to expose. Without it, anyone
> could POST a fake "you paid" event and grant themselves a tier. If the secret is
> wrong the endpoint returns 400 and grants nothing.

## 3. The payment links need NO changes

**Nothing to toggle.** There is no "Client reference ID" setting on a payment link —
Stripe accepts it natively as a **URL query parameter**, and the app appends it for you:

```
https://buy.stripe.com/…?client_reference_id=<uid>__<key>
```

| Link | key the app sends |
|---|---|
| Candidate Lifetime — $12 | `life` |
| Candidate Monthly — $0.99 | `month` |
| Recruiter Premium — $79/mo | `premium` |
| Recruiter Pro — $149/mo | `pro` |

**Format matters:** Stripe only accepts `[A-Za-z0-9_-]` in `client_reference_id`, so
the separator is `__` (a colon is rejected and the reference would be silently dropped,
leaving a paying customer with nothing). The webhook splits on the **last** `__`.
If the reference is missing or unusable, the webhook logs it and grants **nothing** —
we never guess who paid from an email.

Keep the links' own settings as they are. "Collect customer names" / phone are fine and
unrelated.

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
- **Refunds ARE wired.** A full refund or a chargeback drops the account to free —
  including a **lifetime** pass, which has no subscription to cancel and would
  otherwise keep unlimited access forever. Partial refunds are left alone.
- **Existing manual grants keep working** — an admin can still set a tier by hand, and
  that path is unchanged.
- **`stripe_customers/{customerId}`** maps a Stripe customer back to a uid on first
  payment, so later subscription events resolve with one doc read (D1-friendly).
