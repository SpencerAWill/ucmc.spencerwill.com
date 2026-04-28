import { customAlphabet } from "nanoid";

const generate = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export function generateUserPublicId(): string {
  return generate();
}
