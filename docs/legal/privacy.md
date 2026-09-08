# Privacy Policy

> **DRAFT — pending lawyer review (launch plan D7). Not yet published.**
> The product name and domain are undecided (D2); this draft says "the
> Service" throughout and must be updated with the final name, the operator's
> legal name and contact address, and any required regional disclosures
> before launch.

_Last updated: [DATE — set at publication]_

This policy describes what the Service — operated by [OPERATOR LEGAL NAME],
a sole proprietor — collects, why, and what happens to it.

## What we collect

**Without an account** the Service is usable anonymously. We collect
aggregate, privacy-preserving analytics (page counts and referrers in the
style of Plausible): no cookies, no cross-site tracking, no advertising
identifiers, and nothing that identifies you. Standard server logs (IP
address, user agent, request path) are kept briefly for security and
debugging.

**With an account** we store:

- your email address and a salted argon2id hash of your password — never
  the password itself;
- your email verification state and email preferences (recap and preview
  digests are opt-in, with one-tap unsubscribe);
- your subscription state (plan, period end, payment status) as reported by
  our payment processor;
- your "My Driver" selection and alert preferences, if you set them;
- push notification endpoints for devices where you enable race alerts
  (these are opaque browser-issued URLs plus the encryption keys required
  to deliver alerts to that device — they contain no personal details).

**If you subscribe to the recap email without an account**, we store only
your email address and your opt-in.

## Payments

Payments are processed by Stripe. Your card details go directly to Stripe
and never touch our servers; we store only the subscription state Stripe
reports (customer and subscription identifiers, plan, period end, payment
status). Stripe's own privacy policy applies to the data it processes.

## Service providers

We share data only with the providers needed to run the Service: Stripe
(payments), an email delivery provider (verification, reset, and digest
emails), and our hosting and content-delivery providers. Each receives only
what its function requires. **We do not sell your data**, and we do not
share it with advertisers.

## Password safety check

When you choose a password, a partial hash of it (never the password, never
your identity) is checked against a public breached-password service to
reject passwords that have appeared in known breaches.

## Retention and deletion

- You can delete your account yourself from the account page. Deletion is
  immediate; associated data (email, preferences, push endpoints, sessions)
  is purged from backups within 30 days.
- Records of payments are retained at Stripe as required for tax and
  accounting purposes.
- Bounce and complaint records for email addresses are kept so we do not
  mail addresses that rejected us.
- You can also request deletion or a copy of your data by email.

## Your choices

- All emails except account-security messages (verification, password
  reset) are opt-in and carry an unsubscribe link.
- Push alerts are per-device and can be turned off on the device or from
  the Service at any time.
- Analytics are aggregate-only; there is no tracking to opt out of.

## Age

The Service does not target children. You must be 18 or older to purchase
(fantasy-sports context); we do not knowingly collect personal data from
children under 13.

## Changes

We will announce material changes to this policy by email or an in-app
notice at least 14 days before they take effect.

## Contact

[CONTACT EMAIL — set at publication]
