# Global Search

`POST /api/search` classifies and runs only the source modules that are actually available.

Supported inputs:
- Public domain: DNS records and public Certificate Transparency names.
- Public IPv4/IPv6: RDAP registration metadata and reverse DNS.
- E-mail: syntax and MX records only.
- International phone: numbering-plan metadata only.
- URL: HTTP(S) URL classification, then host analysis when the host is a public IP or valid public domain.
- MD5/SHA-1/SHA-256: hash classification only until a reputation provider is configured.

Unsupported values return an explicit `unsupported` status. There is no hidden username enumeration, mailbox verification, phone-owner lookup, precise geolocation or unconfigured threat-intelligence result.

Search history is opt-in through `saveToHistory: true`. When enabled, the user's query and result are stored in their own history. The UI checkbox is off by default because e-mail addresses and phone numbers can be sensitive. All POST search requests require authentication and CSRF protection.
