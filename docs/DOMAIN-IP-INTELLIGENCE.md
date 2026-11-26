# Passive domain and IP intelligence

## Domain route

`GET /api/osint/domain/:domain` requires an authenticated session.

Sources:
- DNS resolver: A, AAAA, MX, NS and TXT.
- crt.sh: publicly logged Certificate Transparency names matching the requested domain suffix.

Each provider is isolated with independent error status. Certificate results are capped, deduplicated and timestamped. A CT entry is historical evidence that a name appeared in a public certificate log; it does not prove current ownership or control.

## IP route

`GET /api/osint/ip/:address` requires an authenticated session.

- Accepts public unicast IPv4/IPv6 only.
- Refuses private, loopback, link-local, multicast and reserved ranges using ipaddr.js range classification.
- RDAP is queried through the fixed public RDAP bootstrap service.
- Reverse DNS uses PTR resolution.
- RDAP contact details are not returned; the API keeps only network registration metadata and role labels.
- Each source has independent status and error codes.

This is registration metadata and DNS information, not precise geolocation or attribution. It must not be used to identify or track a person. No port scan or direct connection to the target IP is performed.
