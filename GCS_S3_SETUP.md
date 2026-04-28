# Google Cloud Storage S3 Setup (Scaffold)

This guide configures a Google Cloud Storage (GCS) bucket for Scaffold's
S3-compatible media adapter. GCS supports the S3 XML API, including
SigV4-signed `HEAD/GET/PUT/DELETE` and `ListObjectsV2`, which is exactly
what Scaffold uses.

## Prerequisites

- Google Cloud project with billing enabled
- `gcloud` CLI authenticated to that project
- An HMAC keypair for a service account or user (S3 interop credentials)

## 1) Create a bucket

```sh
gcloud storage buckets create gs://<bucket-name> --location=<region>
```

For example:

```sh
gcloud storage buckets create gs://scaffold-media-prod --location=us-central1
```

## 2) Create HMAC (S3-compatible) credentials

GCS HMAC keys are the equivalent of AWS access key ID + secret access key:

```sh
gcloud storage hmac create <service-account-email>
```

Or via the Cloud Console: **Cloud Storage → Settings → Interoperability →
Create a key**. Save the access key id and secret somewhere safe.

## 3) Configure CORS on the bucket (REQUIRED)

Without this step the browser will block every request from Scaffold to
the bucket — including `ListObjectsV2`, which Scaffold uses to compute
"what's already on S3" for the project storage view and the Push-to-S3
button. Symptoms include:

- "Stored locally" badges on files even when S3 is connected
- No "Media not yet on S3" banner / no Push-to-S3 button
- `media.s3.list.network.failed` errors in diagnostics with
  `errorMessage: "NetworkError when attempting to fetch resource."`
  and a `Cross-Origin Request Blocked` browser console message

Save this policy to a file (`cors.json`):

```json
[
  {
    "origin": [
      "http://localhost:9000",
      "http://127.0.0.1:9000",
      "https://your-production-domain.example"
    ],
    "method": ["GET", "HEAD", "PUT", "POST", "DELETE"],
    "responseHeader": [
      "Authorization",
      "Content-Type",
      "Content-Length",
      "Content-MD5",
      "ETag",
      "Host",
      "x-amz-content-sha256",
      "x-amz-date",
      "x-amz-meta-mime",
      "x-amz-meta-createdat"
    ],
    "maxAgeSeconds": 3600
  }
]
```

> **Important — `responseHeader` is dual-purpose.** GCS uses this single
> field to populate BOTH `Access-Control-Expose-Headers` (response) AND
> `Access-Control-Allow-Headers` (preflight). If a request header your
> client sends is not listed here, GCS will silently fail the preflight:
> it returns `200 OK` with only `vary: Origin` and **no `Access-Control-*`
> headers at all**, which the browser treats as a CORS rejection. SigV4
> signed requests always send `Authorization`, `x-amz-content-sha256`,
> and `x-amz-date`, so those three are mandatory in this list.

Each entry's origin must be `scheme://host[:port]` only — no trailing
path or slash. `https://example.com/app/` is a malformed origin and will
make GCS reject the entire policy entry at runtime.

Apply it to the bucket:

```sh
gcloud storage buckets update gs://<bucket-name> --cors-file=cors.json
```

Verify it took effect:

```sh
gcloud storage buckets describe gs://<bucket-name> --format='value(cors_config)'
```

## 4) Enter settings in Scaffold

- **Endpoint**: `https://storage.googleapis.com`
- **Region**: `auto` (or any AWS-style region string — GCS ignores it for
  signing purposes but Scaffold passes it through to SigV4).
- **Bucket**: your bucket name.
- **Path-style**: enabled (GCS only supports path-style for S3-interop).
- **Access key**: HMAC access key id from step 2.
- **Secret key**: HMAC secret from step 2.
- **Prefix**: optional (default `scaffold/media`).

## 5) Validate

1. Save settings in Scaffold.
2. Open Settings → Project tab. The Media files list should show the
   correct badge (e.g. "Local cache + S3" or "Local cache only").
3. Upload an image in a long note. Confirm the object appears in the
   bucket: `gcloud storage ls gs://<bucket-name>/scaffold/media/`.
4. Reload the app and verify the media still resolves.

## Troubleshooting

### Diagnose CORS with `curl`

The most reliable way to confirm the bucket's CORS policy is healthy is
to run the same preflight the browser would send and inspect the raw
response. Replace `<bucket-name>` and `<your-app-origin>`:

```sh
curl -v -X OPTIONS \
  'https://storage.googleapis.com/<bucket-name>/?list-type=2&prefix=scaffold%2Fmedia%2F' \
  -H 'Origin: <your-app-origin>' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization,x-amz-content-sha256,x-amz-date'
```

**Broken response** (rule didn't match — usually because the requested
headers aren't in `responseHeader`, or the origin doesn't match):

```text
< HTTP/2 200
< vary: Origin
< server: UploadServer
< content-type: text/html; charset=UTF-8
```

Note: status `200`, only `vary: Origin`, **no `access-control-*` headers
at all**. The browser will reject this preflight even though the status
code is `200`.

**Healthy response** (rule matched):

```text
< HTTP/2 200
< access-control-allow-origin: <your-app-origin>
< access-control-max-age: 3600
< access-control-allow-methods: GET,HEAD,PUT,POST,DELETE
< access-control-allow-headers: Authorization,Content-Type,Content-Length,...,x-amz-content-sha256,x-amz-date,...
< vary: Origin
```

If you see the broken pattern, fix the policy and re-apply with
`gcloud storage buckets update gs://<bucket-name> --cors-file=cors.json`.

### CORS still failing after applying the policy

- **`responseHeader` is missing the SigV4 headers.** This is the most
  common cause and the trickiest to spot because the bucket's
  `cors_config` looks correct in `gcloud describe`. See the [Important
  callout in step 3](#3-configure-cors-on-the-bucket-required) — every
  header your client sends in a preflight (`Access-Control-Request-Headers`)
  must appear in `responseHeader`. Scaffold sends `Authorization`,
  `x-amz-content-sha256`, and `x-amz-date` on every signed request.
- **One malformed origin invalidates the whole rule.** GCS rejects rules
  containing origins with paths or trailing slashes (e.g.
  `https://example.com/app/`) without a clear error message. Origins
  must be `scheme://host[:port]` only.
- **Browser preflight cache.** The browser caches preflights for
  `maxAgeSeconds`. Hard-reload (Cmd+Shift+R / Ctrl+Shift+R) or wait
  out the TTL.
- **Origin scheme/host/port mismatch.** `http://localhost:9000` is not
  the same as `http://127.0.0.1:9000`. List both if the app is reachable
  via either.

### Runtime symptoms inside Scaffold

When CORS is broken, Scaffold's diagnostics ring buffer (Settings →
Diagnostics → Export) will show:

- `media.s3.list.network.failed` with
  `errorMessage: "NetworkError when attempting to fetch resource."`
- The Project tab Media files table will show "S3 unreachable" badges
  (when the policy is broken) or "Stored locally" badges (when S3 is
  not configured at all).
- The "Media not yet on S3" banner will not appear even if local-only
  media exists, because the inventory cannot determine remote presence
  to compare against.

### `403 SignatureDoesNotMatch`

- HMAC keys must be associated with a principal that has at least
  Storage Object Admin on the bucket (`roles/storage.objectAdmin`).
- Time skew: SigV4 rejects requests where the client clock is more
  than 15 minutes off.

### `400 InvalidArgument` on uploads

- GCS's S3 API only supports a subset of `x-amz-meta-*` headers.
  Scaffold uses `x-amz-meta-mime` and `x-amz-meta-createdat`, both of
  which work; if you've added custom adapters that send other custom
  headers, expose them in the bucket CORS `responseHeader` list above.

## Rotation checklist

1. Create a new HMAC key for the same (or a fresh) service account.
2. Update Scaffold credentials in Settings → Program tab → S3.
3. Validate upload/read/delete flows.
4. Disable / delete the old HMAC key:

```sh
gcloud storage hmac update <ACCESS_KEY_ID> --inactive
gcloud storage hmac delete <ACCESS_KEY_ID>
```
