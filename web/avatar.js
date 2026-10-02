// Private raster data only. Never load remote URLs or render SVG from an imported profile.
export const MAX_AVATAR_LENGTH = 32768;
export function normaliseAvatar(value) {
  if (typeof value !== "string" || value.length > MAX_AVATAR_LENGTH) return "";
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return "";
  try {
    const data = atob(match[2]);
    const valid =
      (match[1] === "png" && data.startsWith("\x89PNG\r\n\x1a\n")) ||
      (match[1] === "jpeg" && data.startsWith("\xff\xd8\xff")) ||
      (match[1] === "webp" && data.startsWith("RIFF") && data.slice(8, 12) === "WEBP");
    return valid ? value : "";
  } catch {
    return "";
  }
}
export function showAvatar(el, value, initials) {
  const avatar = normaliseAvatar(value);
  if (avatar && el.firstElementChild?.getAttribute("src") === avatar) return;
  el.replaceChildren();
  if (!avatar) {
    el.textContent = initials;
    return;
  }
  const img = document.createElement("img");
  img.alt = "";
  img.src = avatar;
  img.addEventListener("error", () => (el.textContent = initials), { once: true });
  el.append(img);
}
export async function readAvatar(file) {
  if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Choose a JPEG, PNG or WebP photo.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose a photo smaller than 8 MB.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 64000000)
      throw new Error("Image dimensions are too large.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    const context = canvas.getContext("2d"),
      size = Math.min(bitmap.width, bitmap.height);
    // Re-encode a square crop; camera metadata and the full original are not stored.
    context.drawImage(
      bitmap,
      (bitmap.width - size) / 2,
      (bitmap.height - size) / 2,
      size,
      size,
      0,
      0,
      192,
      192,
    );
    for (const quality of [0.82, 0.65, 0.45]) {
      const avatar = normaliseAvatar(canvas.toDataURL("image/webp", quality));
      if (avatar) return avatar;
    }
    throw new Error("Photo could not be resized.");
  } catch {
    throw new Error("That photo couldn't be opened. Try another JPEG, PNG or WebP photo.");
  } finally {
    bitmap?.close();
  }
}
