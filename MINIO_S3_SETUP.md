# MinIO S3 Setup (Scaffold)

This guide configures MinIO (self-hosted S3-compatible object storage) for Scaffold's media adapter.

## Why choose MinIO

- Full control over data location and infrastructure
- S3-compatible API for app integration
- Good fit for on-prem or private cloud deployments

## Tradeoffs

- You operate and monitor storage yourself
- You handle backups, upgrades, TLS, and availability

## Prerequisites

- Docker (or another deployment method) on your server
- A DNS name and TLS certificate for production use
- Network access from your app to MinIO endpoint

## 1) Run MinIO (single-node example)

Create a host data directory:

```bash
mkdir -p ./minio-data
```

Run MinIO with Docker:

```bash
docker run -d --name minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin123 \
  -v "$(pwd)/minio-data:/data" \
  quay.io/minio/minio server /data --console-address ":9001"
```

For production, use strong credentials and TLS.

## 2) Create bucket and scoped access key

Use the MinIO console (`http://localhost:9001`) or `mc` CLI.

With `mc` CLI:

```bash
mc alias set local http://localhost:9000 minioadmin minioadmin123
mc mb local/scaffold-media
```

Create an application user/access key with least privilege policy for this bucket.

## 3) Configure CORS

Configure MinIO CORS to allow app origins. Example policy:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:9000",
      "http://127.0.0.1:9000",
      "https://your-production-domain.example"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT", "POST", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Apply via your MinIO admin workflow (console/admin API).

## 4) Enter settings in Scaffold

- Endpoint: `http://localhost:9000` (dev) or `https://storage.yourdomain.example` (prod)
- Bucket: `scaffold-media` (or your chosen bucket)
- Access key: MinIO access key
- Secret key: MinIO secret key
- Region: `us-east-1` (common MinIO default)
- Prefix: optional (for example `scaffold-media`)

## 5) Validate

1. Save settings in Scaffold.
2. Upload image/audio in a long note.
3. Reload app and verify media resolution.
4. Confirm object exists in MinIO bucket.

## Security checklist (recommended)

- Use HTTPS/TLS in production.
- Use strong, unique credentials.
- Create app-specific user instead of root credentials.
- Restrict bucket access with least-privilege policy.
- Enable regular backups/snapshots for MinIO data volume.
- Monitor storage usage and server health.

## Rotation checklist

1. Create new app access key/secret.
2. Update Scaffold settings.
3. Validate uploads and reads.
4. Disable and remove old credentials.

