import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MigrationError,
  checksum,
  defaultMigrationsDir,
  loadMigrations,
  parseMigrationFilename,
} from "./migrate.js";

describe("parseMigrationFilename", () => {
  it("extracts the zero-padded version and snake_case name", () => {
    expect(parseMigrationFilename("0001_extensions.sql")).toEqual({
      version: "0001",
      name: "extensions",
    });
    expect(parseMigrationFilename("0042_add_posting_version_index.sql")).toEqual({
      version: "0042",
      name: "add_posting_version_index",
    });
  });

  it.each([
    "1_extensions.sql",
    "0001-extensions.sql",
    "0001_Extensions.sql",
    "0001_extensions.txt",
    "extensions.sql",
    "00001_extensions.sql",
  ])("rejects %s", (filename) => {
    expect(() => parseMigrationFilename(filename)).toThrow(MigrationError);
  });
});

describe("checksum", () => {
  it("is stable for identical content", () => {
    expect(checksum("SELECT 1;")).toBe(checksum("SELECT 1;"));
  });

  it("ignores CRLF versus LF so checkouts on Windows and Linux agree", () => {
    expect(checksum("CREATE TABLE a();\r\nSELECT 1;\r\n")).toBe(
      checksum("CREATE TABLE a();\nSELECT 1;\n"),
    );
  });

  it("changes when the SQL changes", () => {
    expect(checksum("SELECT 1;")).not.toBe(checksum("SELECT 2;"));
  });
});

describe("loadMigrations", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sf-migrations-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns migrations in ascending version order regardless of directory order", async () => {
    await writeFile(path.join(dir, "0010_ten.sql"), "SELECT 10;");
    await writeFile(path.join(dir, "0002_two.sql"), "SELECT 2;");
    await writeFile(path.join(dir, "0001_one.sql"), "SELECT 1;");

    const migrations = await loadMigrations(dir);

    expect(migrations.map((m) => m.version)).toEqual(["0001", "0002", "0010"]);
  });

  it("ignores non-SQL files", async () => {
    await writeFile(path.join(dir, "0001_one.sql"), "SELECT 1;");
    await writeFile(path.join(dir, "README.md"), "notes");

    const migrations = await loadMigrations(dir);

    expect(migrations).toHaveLength(1);
  });

  it("rejects a duplicated version number", async () => {
    await writeFile(path.join(dir, "0001_one.sql"), "SELECT 1;");
    await writeFile(path.join(dir, "0001_one_again.sql"), "SELECT 2;");

    await expect(loadMigrations(dir)).rejects.toThrow(/Duplicate migration version 0001/);
  });

  it("rejects a misnamed SQL file rather than silently skipping it", async () => {
    await writeFile(path.join(dir, "add_index.sql"), "SELECT 1;");

    await expect(loadMigrations(dir)).rejects.toThrow(MigrationError);
  });

  it("loads the repository's own migrations directory", async () => {
    const migrations = await loadMigrations(defaultMigrationsDir());

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0]).toMatchObject({ version: "0001", name: "extensions" });
    expect(migrations[0]!.sql).toContain("pg_trgm");
  });
});
