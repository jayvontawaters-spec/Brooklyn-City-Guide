import {
  CreateDishPhotoBody,
  CreateDishPhotoResponse,
  GetDishPhotoImageParams,
  ListDishPhotosResponse,
} from "@workspace/api-zod";
import { db, dishPhotosTable, type DishPhoto } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";

const router: IRouter = Router();
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];
type DishPhotoSummary = Pick<
  DishPhoto,
  "id" | "title" | "caption" | "mimeType" | "createdAt"
>;

const DATA_URL_PATTERN =
  /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const MIME_PREFIX_PATTERN = /^data:(image\/[^;]+);base64,/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function toDishPhotoItem(photo: DishPhotoSummary) {
  return {
    id: photo.id,
    title: photo.title,
    caption: photo.caption,
    mimeType: photo.mimeType,
    createdAt: photo.createdAt.toISOString(),
    imageUrl: `/api/dishes/${photo.id}/image`,
  };
}

function matchesImageSignature(
  bytes: Buffer,
  mimeType: AllowedMimeType,
): boolean {
  if (mimeType === "image/jpeg") {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }

  if (mimeType === "image/png") {
    return bytes.length >= PNG_SIGNATURE.length &&
      bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  }

  return (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  );
}

router.get("/dishes", async (_req, res): Promise<void> => {
  const photos = await db
    .select({
      id: dishPhotosTable.id,
      title: dishPhotosTable.title,
      caption: dishPhotosTable.caption,
      mimeType: dishPhotosTable.mimeType,
      createdAt: dishPhotosTable.createdAt,
    })
    .from(dishPhotosTable)
    .orderBy(desc(dishPhotosTable.createdAt), desc(dishPhotosTable.id));

  res.json(ListDishPhotosResponse.parse(photos.map(toDishPhotoItem)));
});

router.post("/dishes", async (req, res): Promise<void> => {
  const rawImage = req.body?.image;
  const mimePrefix =
    typeof rawImage === "string" ? MIME_PREFIX_PATTERN.exec(rawImage)?.[1] : undefined;

  if (
    mimePrefix &&
    !ALLOWED_MIME_TYPES.includes(mimePrefix as AllowedMimeType)
  ) {
    res.status(415).json({
      error: "Only JPEG, PNG, and WebP photos are supported.",
    });
    return;
  }

  const parsed = CreateDishPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Add a title and choose a valid JPEG, PNG, or WebP photo.",
    });
    return;
  }

  const title = parsed.data.title.trim();
  if (!title) {
    res.status(400).json({ error: "A title is required for each photo." });
    return;
  }

  const match = DATA_URL_PATTERN.exec(parsed.data.image);
  if (!match) {
    res.status(400).json({
      error: "The photo must be a JPEG, PNG, or WebP data URL.",
    });
    return;
  }

  const mimeType = match[1] as AllowedMimeType;
  const imageBase64 = match[2];
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (
    imageBytes.length === 0 ||
    imageBytes.length > MAX_IMAGE_BYTES ||
    imageBytes.toString("base64") !== imageBase64
  ) {
    res.status(400).json({
      error: "Choose a valid image no larger than 3 MB.",
    });
    return;
  }

  if (!matchesImageSignature(imageBytes, mimeType)) {
    res.status(400).json({
      error: "The photo content does not match its image type.",
    });
    return;
  }

  const [savedPhoto] = await db
    .insert(dishPhotosTable)
    .values({
      title,
      caption: parsed.data.caption?.trim() ?? "",
      mimeType,
      imageBase64,
    })
    .returning({
      id: dishPhotosTable.id,
      title: dishPhotosTable.title,
      caption: dishPhotosTable.caption,
      mimeType: dishPhotosTable.mimeType,
      createdAt: dishPhotosTable.createdAt,
    });

  res
    .status(201)
    .json(CreateDishPhotoResponse.parse(toDishPhotoItem(savedPhoto)));
});

router.get("/dishes/:id/image", async (req, res): Promise<void> => {
  const parsedParams = GetDishPhotoImageParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Choose a valid dish photo." });
    return;
  }

  const [photo] = await db
    .select({
      mimeType: dishPhotosTable.mimeType,
      imageBase64: dishPhotosTable.imageBase64,
    })
    .from(dishPhotosTable)
    .where(eq(dishPhotosTable.id, parsedParams.data.id));

  if (!photo) {
    res.status(404).json({ error: "Dish photo not found." });
    return;
  }

  res
    .set("Content-Type", photo.mimeType)
    .set("X-Content-Type-Options", "nosniff")
    .send(Buffer.from(photo.imageBase64, "base64"));
});

export default router;
