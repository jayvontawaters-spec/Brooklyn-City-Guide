import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Activity 2: the pantry shelf for dish photos.
// One row per uploaded photo. The image itself is stored as base64 text,
// which is fine for a class demo. Real apps keep files in object storage
// (Replit App Storage, Supabase Storage, S3) and save only the file's URL here.
export const dishPhotosTable = pgTable("dish_photos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  caption: text("caption").notNull().default(""),
  mimeType: text("mime_type").notNull(),
  imageBase64: text("image_base64").notNull(),
  inspectorNote: text("inspector_note"), // filled in by the Activity 3 agent
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DishPhoto = typeof dishPhotosTable.$inferSelect;
export type NewDishPhoto = typeof dishPhotosTable.$inferInsert;
