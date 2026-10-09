import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../env';

/**
 * File storage over the S3 API: RustFS / MinIO locally, Supabase Storage or Cloudflare R2 later.
 * Files are private; the app gets short-lived signed links. Tests pass a fake.
 */
export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Signed GET link, valid for `expiresInSec`. */
  signedUrl(key: string, expiresInSec: number): Promise<string>;
  remove(key: string): Promise<void>;
  /** Deletes every object under the prefix (H6 delete business). */
  removePrefix(prefix: string): Promise<void>;
}

/** null when S3_* is not configured: photo routes then answer 503. */
export function s3Storage(env: Env): ObjectStorage | null {
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null;
  const Bucket = env.S3_BUCKET;
  const config = {
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  };
  const client = new S3Client({ ...config, endpoint: env.S3_ENDPOINT });
  // Links are signed for the host the phone can reach (e.g. the laptop's LAN IP), not localhost.
  const signer = env.S3_PUBLIC_URL ? new S3Client({ ...config, endpoint: env.S3_PUBLIC_URL }) : client;

  // Local dev: create the bucket on first upload. In staging / production it already exists.
  let bucketReady: Promise<void> | null = null;
  const ensureBucket = () =>
    (bucketReady ??= client
      .send(new HeadBucketCommand({ Bucket }))
      .then(
        () => undefined,
        async () => void (await client.send(new CreateBucketCommand({ Bucket }))),
      )
      .catch((err: unknown) => {
        bucketReady = null;
        throw err;
      }));

  return {
    async put(key, body, contentType) {
      await ensureBucket();
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },
    signedUrl: (key, expiresInSec) => getSignedUrl(signer, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: expiresInSec }),
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async removePrefix(prefix) {
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
        if (keys.length) await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys } }));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
  };
}

/** Every file of one business lives under this prefix. */
export const businessPrefix = (businessId: number) => `businesses/${businessId}/`;
