export class CharterStorageError extends Error {
  constructor() {
    super("Charter storage is unavailable. Apply the charter migration and retry.");
    this.name = "CharterStorageError";
  }
}
