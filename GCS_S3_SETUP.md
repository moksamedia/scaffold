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
      "Content-Type",
      "Content-Length",
      "ETag",
      "x-amz-meta-mime",
      "x-amz-meta-createdat"
    ],
    "maxAgeSeconds": 3600
  }
]
```

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

### CORS still failing after applying the policy

- The browser caches CORS preflights for `maxAgeSeconds`. Hard-reload
  the app or wait out the TTL.
- Make sure the `origin` list includes the exact URL the app is loaded
  from, including scheme, host, and port. `http://localhost:9000` is
  not the same as `http://127.0.0.1:9000`.

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
