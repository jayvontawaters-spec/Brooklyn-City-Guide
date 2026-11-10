---
name: Dish photo persistence
description: The requested storage constraint for the Brooklyn dish photo gallery.
---

For this project, store dish photo bytes as base64 in `dish_photos.image_base64`, following the user's supplied Drizzle schema. Do not move these photos to object storage or alter the table shape unless the user changes the requirement.

**Why:** the user explicitly requested this table shape and persistent storage behavior.

**How to apply:** Preserve the supplied schema and its storage approach when extending the dish gallery.
