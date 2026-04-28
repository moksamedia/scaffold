# GCS S3-Compatible Bucket Setup

This document captures the exact CLI flow used to provision a Google Cloud Storage bucket for Scaffold's S3 adapter, plus a reusable future setup checklist.

## What this creates

- A dedicated GCS bucket for media objects
- A dedicated service account for app access
- Bucket-level IAM permissions for object operations
- An HMAC keypair for S3-compatible authentication
- CORS settings for local browser development

## Prerequisites

- `gcloud` CLI installed and authenticated
- Active project selected (`gcloud config get-value project`)
- Permissions to create service accounts, buckets, IAM bindings, and HMAC keys

## Commands used in this session

### 1) Verify CLI and active context

```bash
gcloud --version
gcloud config get-value project
gcloud auth list --filter=status:ACTIVE --format="value(account)"
```

### 2) Create a unique bucket

```bash
PROJECT_ID="$(gcloud config get-value project)"
BUCKET_NAME="scaffold-media-${PROJECT_ID}-$(date +%Y%m%d%H%M%S)"

gcloud storage buckets create "gs://${BUCKET_NAME}" \
  --project="${PROJECT_ID}" \
  --location="us-central1" \
  --uniform-bucket-level-access
```

### 3) Create a dedicated service account

```bash
PROJECT_ID="$(gcloud config get-value project)"
SA_NAME="scaffold-media-s3"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="Scaffold Media S3 Access" \
  --project="${PROJECT_ID}"
```

If it already exists, continue and reuse it.

### 4) Grant bucket permissions to the service account

```bash
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_NAME}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin" \
  --project="${PROJECT_ID}"
```

### 5) Create S3-compatible HMAC credentials

```bash
PROJECT_ID="$(gcloud config get-value project)"
SA_EMAIL="scaffold-media-s3@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud storage hmac create "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --format="json"
```

Save the output immediately. The `secret` is shown only once.

### 6) Configure CORS for local development

Create a temporary CORS file (example used here):

```json
[
  {
    "origin": [
      "http://localhost:9000",
      "http://127.0.0.1:9000",
      "http://localhost:8080",
      "http://127.0.0.1:8080"
    ],
    "method": ["GET", "HEAD", "PUT", "POST", "DELETE", "OPTIONS"],
    "responseHeader": [
      "Content-Type",
      "Content-Length",
      "ETag",
      "x-goog-resumable",
      "x-goog-meta-*",
      "Authorization"
    ],
    "maxAgeSeconds": 3600
  }
]
```

Apply it:

```bash
gcloud storage buckets update "gs://${BUCKET_NAME}" --cors-file="./cors.json"
```

Verify:

```bash
gcloud storage buckets describe "gs://${BUCKET_NAME}" --format="json(cors_config)"
```

## App configuration values (Scaffold S3 adapter)

- Endpoint: `https://storage.googleapis.com`
- Bucket: your `BUCKET_NAME`
- Access key: HMAC `accessId`
- Secret key: HMAC `secret`
- Region: `auto` (or `us-central1` if the UI requires a region string)
- Prefix: optional (for example `scaffold-media`)

## Repeatable future setup flow

1. Pick project and region.
2. Create new bucket with a globally unique name.
3. Reuse or create a dedicated service account.
4. Grant `roles/storage.objectAdmin` on that bucket to the service account.
5. Create a fresh HMAC key for that service account.
6. Add/update CORS origins for your local/prod app domains.
7. Enter credentials into Scaffold S3 settings and run an upload test.

## Key rotation and cleanup

### Rotate HMAC key

Create a new key:

```bash
PROJECT_ID="$(gcloud config get-value project)"
SA_EMAIL="scaffold-media-s3@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud storage hmac create "${SA_EMAIL}" --project="${PROJECT_ID}" --format="json"
```

List existing keys:

```bash
gcloud storage hmac list --project="${PROJECT_ID}" --format="table(accessId,state,serviceAccountEmail,timeCreated)"
```

Deactivate old key:

```bash
gcloud storage hmac update ACCESS_ID --state=INACTIVE --project="${PROJECT_ID}"
```

Delete old key after confirming app works with the new key:

```bash
gcloud storage hmac delete ACCESS_ID --project="${PROJECT_ID}"
```

### Optional cleanup

Delete bucket (irreversible):

```bash
gcloud storage rm --recursive "gs://${BUCKET_NAME}"
gcloud storage buckets delete "gs://${BUCKET_NAME}"
```

Delete service account (only if no longer used):

```bash
gcloud iam service-accounts delete "${SA_EMAIL}" --project="${PROJECT_ID}"
```

## Other S3-compatible providers worth considering

- **Cloudflare R2**: Best default choice for many media-heavy apps. Good S3 compatibility, strong global performance, and typically favorable egress economics.
- **Backblaze B2 (S3 API)**: Cost-effective and simple pricing model. Good fit when low storage cost is the main priority.
- **AWS S3**: Most mature ecosystem, strongest enterprise/compliance story, broadest tooling support.
- **Wasabi**: Predictable low-cost model and straightforward setup for standard object storage use cases.
- **MinIO (self-hosted)**: Best when you need full control or on-prem/private deployment. Requires managing your own operations.

### Quick decision guide

- Lowest ongoing cost with strong global edge behavior: **Cloudflare R2**
- Maximum ecosystem depth and enterprise features: **AWS S3**
- Budget-focused and simple: **Backblaze B2**
- Self-hosted/private infrastructure: **MinIO**

## Provider-specific setup guides

- Google Cloud Storage (S3-compatible via HMAC): this document
- Cloudflare R2: `R2_S3_SETUP.md`
- AWS S3: `AWS_S3_SETUP.md`
- Backblaze B2 (S3 API): `B2_S3_SETUP.md`
- MinIO (self-hosted): `MINIO_S3_SETUP.md`

